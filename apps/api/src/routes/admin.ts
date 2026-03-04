import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { requireAuth, requireRoles } from "../auth/rbac";
import type { TelemetryBus } from "../core/TelemetryBus";
import { RedisChannels } from "../core/TelemetryBus";
import { insidePolygon } from "../simulation/geo";

const geofenceSchema = z.object({
  name: z.string().min(2).max(100),
  polygon: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180)
      })
    )
    .min(3)
    .max(1000),
  isActive: z.boolean().default(true)
});

const homeBaseSlotSchema = z.object({
  droneId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180)
});

const homeBaseSchema = z.object({
  name: z.string().min(2).max(100),
  polygon: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180)
      })
    )
    .min(3)
    .max(1000),
  slots: z.array(homeBaseSlotSchema).max(256).optional().nullable(),
  swarmGroupId: z.string().min(1).optional().nullable(),
  homeAlt: z.number().min(-100).max(10000).default(0)
});

const assignDroneToHomeBaseSchema = z.object({
  droneId: z.string().min(1)
});

const killSwitchSchema = z.object({
  enabled: z.boolean()
});

function serializeHomeBase(base: {
  id: string;
  name: string;
  polygonJson: string;
  slotsJson: string | null;
  swarmGroupId: string | null;
  homeAlt: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: base.id,
    name: base.name,
    polygon: JSON.parse(base.polygonJson) as Array<{ lat: number; lon: number }>,
    slots: base.slotsJson ? (JSON.parse(base.slotsJson) as Array<{ droneId: string; lat: number; lon: number }>) : [],
    swarmGroupId: base.swarmGroupId,
    homeAlt: base.homeAlt,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt
  };
}

type HomeBaseSlot = {
  droneId: string;
  lat: number;
  lon: number;
};

function computePolygonCentroid(polygon: Array<{ lat: number; lon: number }>): { lat: number; lon: number } {
  const lat = polygon.reduce((sum, point) => sum + point.lat, 0) / polygon.length;
  const lon = polygon.reduce((sum, point) => sum + point.lon, 0) / polygon.length;
  return { lat, lon };
}

function pickHomeSlots(
  polygon: Array<{ lat: number; lon: number }>,
  count: number,
  seed: Array<{ lat: number; lon: number }> = []
): Array<{ lat: number; lon: number }> {
  if (count <= 0) {
    return [];
  }

  const centroid = computePolygonCentroid(polygon);
  const minLat = Math.min(...polygon.map((point) => point.lat));
  const maxLat = Math.max(...polygon.map((point) => point.lat));
  const minLon = Math.min(...polygon.map((point) => point.lon));
  const maxLon = Math.max(...polygon.map((point) => point.lon));
  const candidates: Array<{ lat: number; lon: number }> = [];
  const selected: Array<{ lat: number; lon: number }> = [];

  for (const slot of seed) {
    if (!insidePolygon(slot.lat, slot.lon, polygon)) {
      continue;
    }
    if (selected.some((candidate) => Math.abs(candidate.lat - slot.lat) < 1e-9 && Math.abs(candidate.lon - slot.lon) < 1e-9)) {
      continue;
    }
    selected.push(slot);
    if (selected.length >= count) {
      return selected.slice(0, count);
    }
  }

  if (insidePolygon(centroid.lat, centroid.lon, polygon)) {
    candidates.push(centroid);
  }

  for (let density = 2; density <= 12 && candidates.length < count * 8; density += 1) {
    const cols = Math.max(2, Math.ceil(Math.sqrt(count * density * 2)));
    const rows = Math.max(2, Math.ceil((count * density * 2) / cols));
    const latStep = (maxLat - minLat) / rows;
    const lonStep = (maxLon - minLon) / cols;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const lat = minLat + ((row + 0.5) * latStep);
        const lon = minLon + ((col + 0.5) * lonStep);
        if (!insidePolygon(lat, lon, polygon)) {
          continue;
        }
        if (candidates.some((candidate) => Math.abs(candidate.lat - lat) < 1e-9 && Math.abs(candidate.lon - lon) < 1e-9)) {
          continue;
        }
        candidates.push({ lat, lon });
      }
    }
  }

  if (candidates.length === 0) {
    return selected.slice(0, count);
  }

  const remaining = [...candidates];

  for (let index = remaining.length - 1; index >= 0; index -= 1) {
    const candidate = remaining[index];
    if (selected.some((slot) => Math.abs(slot.lat - candidate.lat) < 1e-9 && Math.abs(slot.lon - candidate.lon) < 1e-9)) {
      remaining.splice(index, 1);
    }
  }

  if (selected.length === 0) {
    remaining.sort((a, b) => {
      const da = ((a.lat - centroid.lat) ** 2) + ((a.lon - centroid.lon) ** 2);
      const db = ((b.lat - centroid.lat) ** 2) + ((b.lon - centroid.lon) ** 2);
      return da - db;
    });
    if (remaining.length > 0) {
      selected.push(remaining.shift()!);
    }
  }

  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -Infinity;

    remaining.forEach((candidate, index) => {
      const minDistanceSq = Math.min(
        ...selected.map((slot) => ((slot.lat - candidate.lat) ** 2) + ((slot.lon - candidate.lon) ** 2))
      );
      if (minDistanceSq > bestScore) {
        bestScore = minDistanceSq;
        bestIndex = index;
      }
    });

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected.slice(0, count);
}

async function assignHomeBaseToGroup(
  groupId: string | null | undefined,
  polygon: Array<{ lat: number; lon: number }>,
  homeAlt: number,
  bus: TelemetryBus,
  requestedSlots: HomeBaseSlot[] = []
): Promise<HomeBaseSlot[]> {
  if (!groupId) {
    return [];
  }

  const group = await prisma.swarmGroup.findUnique({ where: { id: groupId } });
  if (!group) {
    throw new Error(`Swarm group ${groupId} not found`);
  }

  const orderedDroneIds = [group.leaderId, ...group.followerIds];
  const drones = await prisma.drone.findMany({
    where: {
      id: { in: orderedDroneIds },
      archivedAt: null
    }
  });
  const dronesById = new Map(drones.map((drone) => [drone.id, drone]));
  const orderedDrones = orderedDroneIds.map((id) => dronesById.get(id)).filter((drone): drone is NonNullable<typeof drone> => Boolean(drone));
  if (orderedDrones.length === 0) {
    return [];
  }

  const manualSlotsByDrone = new Map<string, { lat: number; lon: number }>();
  for (const slot of requestedSlots) {
    if (!orderedDroneIds.includes(slot.droneId)) {
      continue;
    }
    if (!insidePolygon(slot.lat, slot.lon, polygon)) {
      continue;
    }
    if (!manualSlotsByDrone.has(slot.droneId)) {
      manualSlotsByDrone.set(slot.droneId, { lat: slot.lat, lon: slot.lon });
    }
  }

  const seededSlots = orderedDroneIds
    .map((droneId) => manualSlotsByDrone.get(droneId))
    .filter((slot): slot is { lat: number; lon: number } => Boolean(slot));
  const generatedCoords = pickHomeSlots(polygon, orderedDrones.length, seededSlots);
  if (generatedCoords.length < orderedDrones.length) {
    throw new Error("Home base area is too small to place every drone in the assigned swarm group");
  }

  const autoQueue = generatedCoords.slice(seededSlots.length);
  const finalSlots: HomeBaseSlot[] = [];
  let autoIndex = 0;

  for (let index = 0; index < orderedDrones.length; index += 1) {
    const drone = orderedDrones[index];
    const slot =
      manualSlotsByDrone.get(drone.id) ??
      autoQueue[autoIndex++];
    if (!slot) {
      throw new Error("Home base area is too small to place every drone in the assigned swarm group");
    }
    await prisma.drone.update({
      where: { id: drone.id },
      data: {
        homeLat: slot.lat,
        homeLon: slot.lon,
        homeAlt
      }
    });

    finalSlots.push({
      droneId: drone.id,
      lat: slot.lat,
      lon: slot.lon
    });

    await bus.publish(RedisChannels.droneHomeUpdate, {
      id: drone.id,
      homeLat: slot.lat,
      homeLon: slot.lon,
      homeAlt
    });
  }

  return finalSlots;
}

async function applyHomeBaseSlots(
  polygon: Array<{ lat: number; lon: number }>,
  slots: HomeBaseSlot[],
  homeAlt: number,
  bus: TelemetryBus
): Promise<HomeBaseSlot[]> {
  if (slots.length === 0) {
    return [];
  }

  const uniqueDroneIds = [...new Set(slots.map((slot) => slot.droneId))];
  const drones = await prisma.drone.findMany({
    where: {
      id: { in: uniqueDroneIds },
      archivedAt: null
    }
  });
  if (drones.length !== uniqueDroneIds.length) {
    throw new Error("One or more drones assigned to this home base do not exist or are archived");
  }

  for (const slot of slots) {
    if (!insidePolygon(slot.lat, slot.lon, polygon)) {
      throw new Error(`Home slot for ${slot.droneId} lies outside the home base area`);
    }
  }

  for (const slot of slots) {
    await prisma.drone.update({
      where: { id: slot.droneId },
      data: {
        homeLat: slot.lat,
        homeLon: slot.lon,
        homeAlt
      }
    });

    await bus.publish(RedisChannels.droneHomeUpdate, {
      id: slot.droneId,
      homeLat: slot.lat,
      homeLon: slot.lon,
      homeAlt
    });
  }

  return slots;
}

export async function adminRoutes(server: FastifyInstance, bus: TelemetryBus): Promise<void> {
  server.post(
    "/api/admin/kill-switch",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN)] },
    async (request, reply) => {
      const parsed = killSwitchSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      await bus.publish(RedisChannels.killSwitch, {
        enabled: parsed.data.enabled,
        requestedBy: request.authUser!.id,
        requestedAt: new Date().toISOString()
      });

      reply.send({
        accepted: true,
        enabled: parsed.data.enabled
      });
    }
  );

  server.get("/api/geofences", { preHandler: [requireAuth] }, async () => {
    const geofences = await prisma.geofence.findMany({
      orderBy: { createdAt: "desc" }
    });

    return {
      geofences: geofences.map((f) => ({
        id: f.id,
        name: f.name,
        polygon: JSON.parse(f.polygonJson) as Array<{ lat: number; lon: number }>,
        isActive: f.isActive,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt
      }))
    };
  });

  server.post(
    "/api/geofences",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN)] },
    async (request, reply) => {
      const parsed = geofenceSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      const geofence = await prisma.geofence.create({
        data: {
          name: parsed.data.name,
          polygonJson: JSON.stringify(parsed.data.polygon),
          isActive: parsed.data.isActive
        }
      });

      reply.status(201).send({
        geofence: {
          id: geofence.id,
          name: geofence.name,
          polygon: parsed.data.polygon,
          isActive: geofence.isActive
        }
      });
    }
  );

  server.patch(
    "/api/geofences/:id",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN)] },
    async (request, reply) => {
      const id = z.string().parse((request.params as { id: string }).id);
      const parsed = geofenceSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      const current = await prisma.geofence.findUnique({ where: { id } });
      if (!current) {
        reply.status(404).send({ message: `Geofence ${id} not found` });
        return;
      }

      const updated = await prisma.geofence.update({
        where: { id },
        data: {
          name: parsed.data.name ?? current.name,
          polygonJson: parsed.data.polygon ? JSON.stringify(parsed.data.polygon) : current.polygonJson,
          isActive: parsed.data.isActive ?? current.isActive
        }
      });

      reply.send({
        geofence: {
          id: updated.id,
          name: updated.name,
          polygon: JSON.parse(updated.polygonJson),
          isActive: updated.isActive
        }
      });
    }
  );

  server.delete(
    "/api/geofences/:id",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN)] },
    async (request, reply) => {
      const id = z.string().parse((request.params as { id: string }).id);
      await prisma.geofence.delete({ where: { id } });
      reply.status(204).send();
    }
  );

  server.get("/api/home-bases", { preHandler: [requireAuth] }, async () => {
    const homeBases = await prisma.homeBase.findMany({
      orderBy: { createdAt: "desc" }
    });

    return {
      homeBases: homeBases.map((base) => serializeHomeBase(base))
    };
  });

  server.post(
    "/api/home-bases",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN)] },
    async (request, reply) => {
      const parsed = homeBaseSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      try {
        const created = await prisma.homeBase.create({
          data: {
            name: parsed.data.name,
            polygonJson: JSON.stringify(parsed.data.polygon),
            slotsJson: null,
            swarmGroupId: parsed.data.swarmGroupId ?? null,
            homeAlt: parsed.data.homeAlt
          }
        });

        const slots = parsed.data.swarmGroupId
          ? await assignHomeBaseToGroup(
              parsed.data.swarmGroupId ?? null,
              parsed.data.polygon,
              parsed.data.homeAlt,
              bus,
              parsed.data.slots ?? []
            )
          : await applyHomeBaseSlots(parsed.data.polygon, parsed.data.slots ?? [], parsed.data.homeAlt, bus);
        const homeBase =
          slots.length > 0
            ? await prisma.homeBase.update({
                where: { id: created.id },
                data: {
                  slotsJson: JSON.stringify(slots)
                }
              })
            : created;
        const assignedDroneIds = slots.map((slot) => slot.droneId);

        reply.status(201).send({
          homeBase: serializeHomeBase(homeBase),
          assignedDroneIds
        });
      } catch (error) {
        reply.status(400).send({ message: (error as Error).message });
      }
    }
  );

  server.patch(
    "/api/home-bases/:id",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN)] },
    async (request, reply) => {
      const id = z.string().parse((request.params as { id: string }).id);
      const parsed = homeBaseSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      const current = await prisma.homeBase.findUnique({ where: { id } });
      if (!current) {
        reply.status(404).send({ message: `Home base ${id} not found` });
        return;
      }

      const polygon = parsed.data.polygon ?? (JSON.parse(current.polygonJson) as Array<{ lat: number; lon: number }>);
      const swarmGroupId = parsed.data.swarmGroupId === undefined ? current.swarmGroupId : parsed.data.swarmGroupId;
      const homeAlt = parsed.data.homeAlt ?? current.homeAlt;
      const currentSlots = current.slotsJson ? (JSON.parse(current.slotsJson) as HomeBaseSlot[]) : [];
      const requestedSlots = parsed.data.slots === undefined ? currentSlots : parsed.data.slots ?? [];

      try {
        await prisma.homeBase.update({
          where: { id },
          data: {
            name: parsed.data.name ?? current.name,
            polygonJson: JSON.stringify(polygon),
            slotsJson: null,
            swarmGroupId: swarmGroupId ?? null,
            homeAlt
          }
        });

        const slots = swarmGroupId
          ? await assignHomeBaseToGroup(
              swarmGroupId ?? null,
              polygon,
              homeAlt,
              bus,
              requestedSlots
            )
          : await applyHomeBaseSlots(polygon, requestedSlots, homeAlt, bus);
        const finalized = await prisma.homeBase.update({
          where: { id },
          data: {
            slotsJson: slots.length > 0 ? JSON.stringify(slots) : null
          }
        });
        const assignedDroneIds = slots.map((slot) => slot.droneId);

        reply.send({
          homeBase: serializeHomeBase(finalized),
          assignedDroneIds
        });
      } catch (error) {
        reply.status(400).send({ message: (error as Error).message });
      }
    }
  );

  server.delete(
    "/api/home-bases/:id",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN)] },
    async (request, reply) => {
      const id = z.string().parse((request.params as { id: string }).id);
      await prisma.homeBase.delete({ where: { id } });
      reply.status(204).send();
    }
  );

  server.post(
    "/api/home-bases/:id/assign-drone",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const id = z.string().parse((request.params as { id: string }).id);
      const parsed = assignDroneToHomeBaseSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      const homeBase = await prisma.homeBase.findUnique({ where: { id } });
      if (!homeBase) {
        reply.status(404).send({ message: `Home base ${id} not found` });
        return;
      }
      if (homeBase.swarmGroupId) {
        reply.status(409).send({ message: "This home base is managed by a swarm group. Assign the drone through the group instead." });
        return;
      }

      const drone = await prisma.drone.findUnique({ where: { id: parsed.data.droneId } });
      if (!drone || drone.archivedAt) {
        reply.status(404).send({ message: `Drone ${parsed.data.droneId} not found` });
        return;
      }

      const polygon = JSON.parse(homeBase.polygonJson) as Array<{ lat: number; lon: number }>;
      const existingSlots = homeBase.slotsJson ? (JSON.parse(homeBase.slotsJson) as HomeBaseSlot[]) : [];
      const filteredSlots = existingSlots.filter((slot) => slot.droneId !== parsed.data.droneId);
      const nextCoords = pickHomeSlots(
        polygon,
        filteredSlots.length + 1,
        filteredSlots.map((slot) => ({ lat: slot.lat, lon: slot.lon }))
      );
      if (nextCoords.length < filteredSlots.length + 1) {
        reply.status(400).send({ message: "Home base area is too small to place this drone" });
        return;
      }

      const newSlot = nextCoords[nextCoords.length - 1];
      const slots = await applyHomeBaseSlots(
        polygon,
        [...filteredSlots, { droneId: parsed.data.droneId, lat: newSlot.lat, lon: newSlot.lon }],
        homeBase.homeAlt,
        bus
      );
      const updated = await prisma.homeBase.update({
        where: { id },
        data: {
          slotsJson: JSON.stringify(slots)
        }
      });

      reply.send({
        homeBase: serializeHomeBase(updated),
        slot: slots.find((slot) => slot.droneId === parsed.data.droneId)
      });
    }
  );

  server.get(
    "/api/admin/audit",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.SUPERVISOR)] },
    async (request) => {
      const query = z
        .object({
          limit: z.coerce.number().min(1).max(500).optional()
        })
        .parse(request.query ?? {});

      const rows = await prisma.commandAudit.findMany({
        include: {
          user: true
        },
        orderBy: { createdAt: "desc" },
        take: query.limit ?? 100
      });

      return {
        logs: rows.map((row) => ({
          id: row.id,
          droneId: row.droneId,
          command: row.command,
          payload: JSON.parse(row.payloadJson),
          result: row.result,
          createdAt: row.createdAt,
          user: {
            id: row.user.id,
            email: row.user.email,
            displayName: row.user.displayName,
            role: row.user.role
          }
        }))
      };
    }
  );
}
