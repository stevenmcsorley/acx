import type { FastifyInstance } from "fastify";
import { AdapterType, FlightState, UserRole } from "@prisma/client";
import { z } from "zod";
import type { DroneCommandType } from "@sgcx/shared-types";
import { prisma } from "../db/prisma";
import { requireAuth, requireRoles } from "../auth/rbac";
import type { TelemetryBus } from "../core/TelemetryBus";
import { RedisChannels } from "../core/TelemetryBus";

const commandTypes: DroneCommandType[] = [
  "arm",
  "disarm",
  "takeoff",
  "land",
  "rtl",
  "manualControl",
  "setWaypoint",
  "setSwarmTarget",
  "clearSwarmTarget",
  "uploadMission"
];

const registerDroneSchema = z.object({
  id: z.string().min(3),
  name: z.string().min(2).max(80).optional(),
  adapter: z.enum(["mock", "mavlink", "dji", "custom"]),
  homeLat: z.number().min(-90).max(90),
  homeLon: z.number().min(-180).max(180),
  homeAlt: z.number().min(-100).max(10000).optional()
});

const updateHomeSchema = z.object({
  homeLat: z.number().min(-90).max(90),
  homeLon: z.number().min(-180).max(180),
  homeAlt: z.number().min(-100).max(10000).optional()
});

const archiveDroneSchema = z.object({
  archived: z.boolean()
});

const commandSchema = z.object({
  type: z.enum(commandTypes as [DroneCommandType, ...DroneCommandType[]]),
  params: z.record(z.unknown()).optional()
});

function toAdapterType(adapter: "mock" | "mavlink" | "dji" | "custom"): AdapterType {
  switch (adapter) {
    case "mock":
      return AdapterType.MOCK;
    case "mavlink":
      return AdapterType.MAVLINK;
    case "dji":
      return AdapterType.DJI;
    case "custom":
      return AdapterType.CUSTOM;
  }
}

export async function droneRoutes(server: FastifyInstance, bus: TelemetryBus): Promise<void> {
  server.get("/api/drones", { preHandler: [requireAuth] }, async () => {
    const drones = await prisma.drone.findMany({
      orderBy: [{ archivedAt: "asc" }, { createdAt: "asc" }]
    });

    return {
      drones: drones.map((drone) => ({
        id: drone.id,
        name: drone.name,
        adapter: drone.adapter.toLowerCase(),
        status: drone.status.toLowerCase(),
        archivedAt: drone.archivedAt,
        home: {
          lat: drone.homeLat,
          lon: drone.homeLon,
          alt: drone.homeAlt
        },
        lastKnown: drone.lastKnownLat
          ? {
              lat: drone.lastKnownLat,
              lon: drone.lastKnownLon,
              alt: drone.lastKnownAlt,
              batteryPct: drone.lastBatteryPct,
              signalPct: drone.lastSignalPct,
              timestamp: drone.lastTelemetryAt
            }
          : null
      }))
    };
  });

  server.post(
    "/api/drones",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const parsed = registerDroneSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid request", errors: parsed.error.flatten() });
        return;
      }

      const payload = parsed.data;
      const existing = await prisma.drone.findUnique({ where: { id: payload.id } });
      if (existing) {
        reply.status(409).send({ message: `Drone ${payload.id} already exists` });
        return;
      }

      const drone = await prisma.drone.create({
        data: {
          id: payload.id,
          name: payload.name ?? payload.id.toUpperCase(),
          adapter: toAdapterType(payload.adapter),
          homeLat: payload.homeLat,
          homeLon: payload.homeLon,
          homeAlt: payload.homeAlt ?? 0,
          status: FlightState.GROUNDED
        }
      });

      await bus.publish(RedisChannels.droneRegistration, {
        id: drone.id,
        name: drone.name,
        adapter: payload.adapter,
        homeLat: drone.homeLat,
        homeLon: drone.homeLon,
        homeAlt: drone.homeAlt
      });

      reply.status(201).send({
        drone: {
          id: drone.id,
          name: drone.name,
          adapter: payload.adapter,
          status: "grounded"
        }
      });
    }
  );

  server.patch(
    "/api/drones/:id/archive",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const droneId = z.string().min(1).parse((request.params as { id: string }).id);
      const parsed = archiveDroneSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid archive payload", errors: parsed.error.flatten() });
        return;
      }

      const existing = await prisma.drone.findUnique({ where: { id: droneId } });
      if (!existing) {
        reply.status(404).send({ message: `Drone ${droneId} not found` });
        return;
      }

      const archivedAt = parsed.data.archived ? new Date() : null;
      const drone = await prisma.drone.update({
        where: { id: droneId },
        data: { archivedAt }
      });

      if (archivedAt) {
        await bus.publish(RedisChannels.droneRemoval, { id: drone.id });
      } else {
        await bus.publish(RedisChannels.droneRegistration, {
          id: drone.id,
          name: drone.name,
          adapter: drone.adapter.toLowerCase(),
          homeLat: drone.homeLat,
          homeLon: drone.homeLon,
          homeAlt: drone.homeAlt
        });
      }

      await prisma.commandAudit.create({
        data: {
          droneId,
          userId: request.authUser!.id,
          command: archivedAt ? "archiveDrone" : "restoreDrone",
          payloadJson: JSON.stringify({ archived: Boolean(archivedAt) }),
          result: "accepted"
        }
      });

      reply.send({
        updated: true,
        drone: {
          id: drone.id,
          archivedAt: drone.archivedAt
        }
      });
    }
  );

  server.patch(
    "/api/drones/:id/home",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const droneId = z.string().min(1).parse((request.params as { id: string }).id);
      const parsed = updateHomeSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid home payload", errors: parsed.error.flatten() });
        return;
      }

      const existing = await prisma.drone.findUnique({ where: { id: droneId } });
      if (!existing) {
        reply.status(404).send({ message: `Drone ${droneId} not found` });
        return;
      }
      if (existing.archivedAt) {
        reply.status(409).send({ message: `Drone ${droneId} is archived` });
        return;
      }

      const payload = parsed.data;
      const homeAlt = payload.homeAlt ?? existing.homeAlt;
      const drone = await prisma.drone.update({
        where: { id: droneId },
        data: {
          homeLat: payload.homeLat,
          homeLon: payload.homeLon,
          homeAlt
        }
      });

      await bus.publish(RedisChannels.droneHomeUpdate, {
        id: drone.id,
        homeLat: drone.homeLat,
        homeLon: drone.homeLon,
        homeAlt: drone.homeAlt
      });

      await prisma.commandAudit.create({
        data: {
          droneId,
          userId: request.authUser!.id,
          command: "setHome",
          payloadJson: JSON.stringify({
            homeLat: drone.homeLat,
            homeLon: drone.homeLon,
            homeAlt: drone.homeAlt
          }),
          result: "accepted"
        }
      });

      reply.send({
        updated: true,
        drone: {
          id: drone.id,
          home: {
            lat: drone.homeLat,
            lon: drone.homeLon,
            alt: drone.homeAlt
          }
        }
      });
    }
  );

  server.delete(
    "/api/drones/:id",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const droneId = z.string().min(1).parse((request.params as { id: string }).id);
      const existing = await prisma.drone.findUnique({ where: { id: droneId } });
      if (!existing) {
        reply.status(404).send({ message: `Drone ${droneId} not found` });
        return;
      }

      await prisma.drone.delete({
        where: { id: droneId }
      });

      await bus.publish(RedisChannels.droneRemoval, { id: droneId });

      reply.send({
        removed: true,
        droneId
      });
    }
  );

  server.post(
    "/api/drones/:id/command",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const droneId = z.string().min(1).parse((request.params as { id: string }).id);
      const parsed = commandSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid command payload", errors: parsed.error.flatten() });
        return;
      }

      const drone = await prisma.drone.findUnique({ where: { id: droneId } });
      if (!drone) {
        reply.status(404).send({ message: `Drone ${droneId} not found` });
        return;
      }
      if (drone.archivedAt) {
        reply.status(409).send({ message: `Drone ${droneId} is archived` });
        return;
      }

      const command = parsed.data;
      await bus.publish(RedisChannels.commands, {
        droneId,
        type: command.type,
        params: command.params,
        requestedBy: request.authUser?.id,
        requestedAt: new Date().toISOString()
      });

      await prisma.commandAudit.create({
        data: {
          droneId,
          userId: request.authUser!.id,
          command: command.type,
          payloadJson: JSON.stringify(command.params ?? {}),
          result: "accepted"
        }
      });

      reply.send({
        accepted: true,
        droneId,
        command: command.type
      });
    }
  );
}
