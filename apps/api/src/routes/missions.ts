import type { FastifyInstance } from "fastify";
import type { MissionWaypoint } from "@sgcx/shared-types";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { requireAuth, requireRoles } from "../auth/rbac";
import type { TelemetryBus } from "../core/TelemetryBus";
import { RedisChannels } from "../core/TelemetryBus";
import { MissionPlanner } from "../core/MissionPlanner";

const waypointSchema = z.object({
  id: z.string().optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  alt: z.number().min(5).max(5000),
  hover: z.number().int().min(0).max(120).default(0),
  swarmTrigger: z
    .object({
      groupId: z.string().min(1),
      presetId: z.string().min(1),
      triggerMode: z.enum(["mission_start", "waypoint_reached"]).optional(),
      eventMode: z.enum(["transit", "final_destination"]).optional(),
      stopRule: z.enum(["timer", "manual_confirm"]).optional(),
      postAction: z.enum(["resume", "rtl", "land", "hold"]).optional(),
      durationSec: z.number().min(1).max(600).optional(),
      maneuverOverrides: z.record(z.unknown()).optional()
    })
    .optional(),
  name: z.string().optional(),
  heading: z.number().optional(),
  curveSize: z.number().optional(),
  rotationDir: z.number().optional(),
  gimbalMode: z.number().optional(),
  cameraPitch: z.number().optional(),
  altitudeMode: z.number().optional(),
  speed: z.number().optional(),
  poiLat: z.number().optional(),
  poiLon: z.number().optional(),
  poiAlt: z.number().optional(),
  poiAltitudeMode: z.number().optional(),
  photoTimeInterval: z.number().optional(),
  photoDistInterval: z.number().optional(),
  cameraViewMode: z.enum(["follow", "cinematic", "fpv"]).optional(),
  fpvYaw: z.number().optional(),
  fpvPitch: z.number().optional(),
  fpvZoom: z.number().optional(),
});

const CORE_WP_KEYS = new Set(["id", "lat", "lon", "alt", "hover"]);

function extractExtFields(wp: z.infer<typeof waypointSchema>): string | null {
  const ext: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(wp)) {
    if (!CORE_WP_KEYS.has(key) && value !== undefined) {
      ext[key] = value;
    }
  }
  return Object.keys(ext).length > 0 ? JSON.stringify(ext) : null;
}

function mergeExtFields(wp: { id: string; lat: number; lon: number; alt: number; hoverSec: number; extJson?: string | null }): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: wp.id,
    lat: wp.lat,
    lon: wp.lon,
    alt: wp.alt,
    hover: wp.hoverSec,
  };
  if (wp.extJson) {
    try {
      Object.assign(base, JSON.parse(wp.extJson));
    } catch {
      // ignore malformed extJson
    }
  }
  return base;
}

function storedWaypointToMissionWaypoint(wp: {
  id: string;
  lat: number;
  lon: number;
  alt: number;
  hoverSec: number;
  extJson?: string | null;
}): MissionWaypoint {
  const merged = mergeExtFields(wp) as Record<string, unknown>;
  return {
    ...(merged as Omit<MissionWaypoint, "id" | "lat" | "lon" | "alt" | "hover">),
    id: String(merged.id),
    lat: Number(merged.lat),
    lon: Number(merged.lon),
    alt: Number(merged.alt),
    hover: Number(merged.hover)
  };
}

const missionSchema = z.object({
  droneId: z.string().min(2),
  name: z.string().min(2).max(120).optional(),
  geofenceId: z.string().optional(),
  waypoints: z.array(waypointSchema).min(1).max(500)
});

const missionPlanner = new MissionPlanner();

type StoredMissionWithWaypoints = {
  id: string;
  droneId: string;
  name: string;
  geofenceId: string | null;
  status: string;
  executionCount: number;
  lastExecutedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  waypoints: Array<{
    id: string;
    lat: number;
    lon: number;
    alt: number;
    hoverSec: number;
    extJson?: string | null;
  }>;
};

function serializeMission(mission: StoredMissionWithWaypoints) {
  const waypoints = mission.waypoints.map((wp) => storedWaypointToMissionWaypoint(wp));
  const swarmGroupIds = [...new Set(
    waypoints
      .map((wp) => {
        const trigger = wp.swarmTrigger as { groupId?: string } | undefined;
        return trigger?.groupId;
      })
      .filter((groupId): groupId is string => Boolean(groupId))
  )];

  return {
    id: mission.id,
    droneId: mission.droneId,
    name: mission.name,
    geofenceId: mission.geofenceId,
    status: mission.status,
    executionCount: mission.executionCount,
    lastExecutedAt: mission.lastExecutedAt,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    waypointCount: waypoints.length,
    curveWaypointCount: waypoints.filter((wp) => typeof wp.curveSize === "number" && wp.curveSize > 0).length,
    estimatedDistanceMeters: missionPlanner.estimateDistanceMeters(waypoints),
    swarmGroupIds,
    waypoints
  };
}

export async function missionRoutes(server: FastifyInstance, bus: TelemetryBus): Promise<void> {
  server.post(
    "/api/missions",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const parsed = missionSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid mission payload", errors: parsed.error.flatten() });
        return;
      }

      const input = parsed.data;
      const drone = await prisma.drone.findUnique({ where: { id: input.droneId } });
      if (!drone) {
        reply.status(404).send({ message: `Drone ${input.droneId} not found` });
        return;
      }

      const missionName = input.name ?? `Mission ${new Date().toISOString()}`;

      const mission = await prisma.$transaction(async (tx) => {
        const created = await tx.mission.create({
          data: {
            droneId: input.droneId,
            name: missionName,
            geofenceId: input.geofenceId,
            status: "uploaded"
          }
        });

        await tx.waypoint.createMany({
          data: input.waypoints.map((wp, idx) => ({
            missionId: created.id,
            seq: idx,
            lat: wp.lat,
            lon: wp.lon,
            alt: wp.alt,
            hoverSec: wp.hover,
            extJson: extractExtFields(wp)
          }))
        });

        await tx.commandAudit.create({
          data: {
            droneId: input.droneId,
            userId: request.authUser!.id,
            command: "uploadMission",
            payloadJson: JSON.stringify({
              missionId: created.id,
              waypointCount: input.waypoints.length
            }),
            result: "accepted"
          }
        });

        return tx.mission.findUniqueOrThrow({
          where: { id: created.id },
          include: {
            waypoints: {
              orderBy: { seq: "asc" }
            }
          }
        });
      });

      reply.status(201).send({
        mission: serializeMission(mission)
      });
    }
  );

  server.put(
    "/api/missions/:id",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const missionId = z.string().min(1).parse((request.params as { id: string }).id);
      const parsed = missionSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid mission payload", errors: parsed.error.flatten() });
        return;
      }

      const existing = await prisma.mission.findUnique({
        where: { id: missionId },
        include: {
          waypoints: {
            orderBy: { seq: "asc" }
          }
        }
      });
      if (!existing) {
        reply.status(404).send({ message: `Mission ${missionId} not found` });
        return;
      }
      if (existing.status === "executing") {
        reply.status(409).send({ message: "Cannot edit a mission while it is executing" });
        return;
      }

      const input = parsed.data;
      const drone = await prisma.drone.findUnique({ where: { id: input.droneId } });
      if (!drone) {
        reply.status(404).send({ message: `Drone ${input.droneId} not found` });
        return;
      }

      const updatedMission = await prisma.$transaction(async (tx) => {
        await tx.waypoint.deleteMany({ where: { missionId } });

        const updated = await tx.mission.update({
          where: { id: missionId },
          data: {
            droneId: input.droneId,
            name: input.name ?? existing.name,
            geofenceId: input.geofenceId
          }
        });

        await tx.waypoint.createMany({
          data: input.waypoints.map((wp, idx) => ({
            missionId,
            seq: idx,
            lat: wp.lat,
            lon: wp.lon,
            alt: wp.alt,
            hoverSec: wp.hover,
            extJson: extractExtFields(wp)
          }))
        });

        await tx.commandAudit.create({
          data: {
            droneId: input.droneId,
            userId: request.authUser!.id,
            command: "updateMission",
            payloadJson: JSON.stringify({
              missionId,
              waypointCount: input.waypoints.length
            }),
            result: "accepted"
          }
        });

        return tx.mission.findUniqueOrThrow({
          where: { id: updated.id },
          include: {
            waypoints: {
              orderBy: { seq: "asc" }
            }
          }
        });
      });

      reply.send({ mission: serializeMission(updatedMission) });
    }
  );

  server.post(
    "/api/missions/:id/execute",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const missionId = z.string().min(1).parse((request.params as { id: string }).id);

      const mission = await prisma.mission.findUnique({
        where: { id: missionId },
        include: {
          waypoints: {
            orderBy: { seq: "asc" }
          }
        }
      });

      if (!mission) {
        reply.status(404).send({ message: `Mission ${missionId} not found` });
        return;
      }

      if (mission.waypoints.length === 0) {
        reply.status(400).send({ message: `Mission ${missionId} has no waypoints` });
        return;
      }

      const rawWaypoints = mission.waypoints.map((wp) => storedWaypointToMissionWaypoint(wp));
      await bus.publish(RedisChannels.missions, {
        missionId: mission.id,
        droneId: mission.droneId,
        name: mission.name,
        waypoints: rawWaypoints
      });

      const updatedMission = await prisma.$transaction(async (tx) => {
        await tx.mission.updateMany({
          where: { droneId: mission.droneId, id: { not: mission.id }, status: "executing" },
          data: { status: "uploaded" }
        });

        await tx.mission.update({
          where: { id: mission.id },
          data: {
            status: "executing",
            executionCount: { increment: 1 },
            lastExecutedAt: new Date()
          }
        });

        await tx.commandAudit.create({
          data: {
            droneId: mission.droneId,
            userId: request.authUser!.id,
            command: "executeMission",
            payloadJson: JSON.stringify({
              missionId: mission.id,
              waypointCount: mission.waypoints.length
            }),
            result: "accepted"
          }
        });

        return tx.mission.findUniqueOrThrow({
          where: { id: mission.id },
          include: {
            waypoints: {
              orderBy: { seq: "asc" }
            }
          }
        });
      });

      reply.send({
        accepted: true,
        mission: serializeMission(updatedMission)
      });
    }
  );

  server.get("/api/missions", { preHandler: [requireAuth] }, async (request) => {
    const droneId = (request.query as { droneId?: string }).droneId;
    const missions = await prisma.mission.findMany({
      where: droneId ? { droneId } : undefined,
      include: {
        waypoints: {
          orderBy: { seq: "asc" }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return {
      missions: missions.map((mission) => serializeMission(mission))
    };
  });

  server.delete(
    "/api/missions/:id",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const missionId = z.string().min(1).parse((request.params as { id: string }).id);
      const mission = await prisma.mission.findUnique({ where: { id: missionId } });
      if (!mission) {
        reply.status(404).send({ message: `Mission ${missionId} not found` });
        return;
      }
      if (mission.status === "executing") {
        reply.status(409).send({ message: "Cannot delete a mission while it is executing" });
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.commandAudit.create({
          data: {
            droneId: mission.droneId,
            userId: request.authUser!.id,
            command: "deleteMission",
            payloadJson: JSON.stringify({ missionId }),
            result: "accepted"
          }
        });
        await tx.mission.delete({ where: { id: missionId } });
      });

      reply.send({ deleted: true, missionId });
    }
  );

  // Smoothed path preview - returns rounded-corner path honoring waypoint curveSize.
  server.post(
    "/api/missions/:id/smoothed-path",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const missionId = z.string().min(1).parse((request.params as { id: string }).id);
      const pointsPerSegment = z.coerce.number().min(2).max(20).default(8).parse(
        (request.query as { points?: string }).points ?? 8
      );

      const mission = await prisma.mission.findUnique({
        where: { id: missionId },
        include: { waypoints: { orderBy: { seq: "asc" } } }
      });

      if (!mission) {
        reply.status(404).send({ message: `Mission ${missionId} not found` });
        return;
      }

      const rawWaypoints = mission.waypoints.map((wp) => storedWaypointToMissionWaypoint(wp));
      const smoothed = missionPlanner.buildPreviewPath(rawWaypoints, pointsPerSegment);

      reply.send({ smoothedPath: smoothed });
    }
  );
}
