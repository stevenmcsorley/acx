import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { requireAuth, requireRoles } from "../auth/rbac";
import type { TelemetryBus } from "../core/TelemetryBus";
import { RedisChannels } from "../core/TelemetryBus";

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

const killSwitchSchema = z.object({
  enabled: z.boolean()
});

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
