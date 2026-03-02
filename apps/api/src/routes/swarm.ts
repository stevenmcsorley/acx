import type { FastifyInstance } from "fastify";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireRoles } from "../auth/rbac";
import { ALL_FORMATION_NAMES, SwarmEngine, type FormationName } from "../core/SwarmEngine";
import type { TelemetryBus } from "../core/TelemetryBus";
import { RedisChannels } from "../core/TelemetryBus";
import { prisma } from "../db/prisma";
import {
  DEFAULT_SCENARIO_PRESETS,
  applyScenarioPresetConfig,
  applyScenarioPresetConfigs,
  findDefaultScenarioPreset,
  type ScenarioPreset
} from "../core/ScenarioPresets";

const formationEnum = z.enum(ALL_FORMATION_NAMES as [FormationName, ...FormationName[]]);

const swarmPreviewSchema = z.object({
  leader: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    alt: z.number().min(0).max(5000)
  }),
  followerDroneIds: z.array(z.string()).min(1).max(199),
  formation: formationEnum,
  spacing: z.number().min(3).max(200).default(15),
  headingDeg: z.number().min(0).max(360).default(0),
  altOffset: z.number().min(-50).max(50).default(0)
});

const createGroupSchema = z.object({
  name: z.string().min(1).max(100),
  leaderId: z.string().min(1),
  followerIds: z.array(z.string()).min(1).max(199),
  formation: formationEnum,
  spacing: z.number().min(3).max(200).default(15),
  headingDeg: z.number().min(0).max(360).default(0),
  altOffset: z.number().min(-50).max(50).default(0)
});

const updateGroupSchema = z.object({
  formation: formationEnum.optional(),
  spacing: z.number().min(3).max(200).optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  altOffset: z.number().min(-50).max(50).optional()
});

const engageSchema = z.object({
  leaderPosition: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    alt: z.number().min(0).max(5000)
  }).optional()
});

const maneuverSchema = z.object({
  type: z.enum(["orbit", "expand", "contract", "rotate", "search_grid", "search_spiral", "escort", "perimeter", "corridor"]),
  params: z.record(z.unknown()).default({})
});

const fromPresetSchema = z.object({
  presetId: z.string().min(1),
  name: z.string().min(1).max(100),
  leaderId: z.string().min(1),
  followerIds: z.array(z.string()).min(1).max(199),
  overrides: z.object({
    spacing: z.number().min(3).max(200).optional(),
    headingDeg: z.number().min(0).max(360).optional(),
    altOffset: z.number().min(-50).max(50).optional()
  }).optional()
});

const presetConfigSchema = z.object({
  formation: formationEnum,
  spacing: z.number().min(3).max(200),
  headingDeg: z.number().min(0).max(360),
  altOffset: z.number().min(-50).max(50),
  maneuverParams: z.record(z.unknown()).optional()
});

function formatZodMessage(prefix: string, error: z.ZodError): string {
  const firstIssue = error.issues[0];
  if (!firstIssue) {
    return prefix;
  }

  const path = firstIssue.path.length > 0 ? firstIssue.path.join(".") : "request";
  return `${prefix}: ${path} ${firstIssue.message}`;
}

export async function swarmRoutes(server: FastifyInstance, bus?: TelemetryBus): Promise<void> {
  const engine = new SwarmEngine();

  const resolvePreset = async (presetId: string): Promise<ScenarioPreset | undefined> => {
    const preset = findDefaultScenarioPreset(presetId);
    if (!preset) {
      return undefined;
    }

    const config = await prisma.swarmPresetConfig.findUnique({ where: { presetId } });
    return applyScenarioPresetConfig(preset, config);
  };

  const resolveAllPresets = async (): Promise<ScenarioPreset[]> => {
    const configs = await prisma.swarmPresetConfig.findMany();
    return applyScenarioPresetConfigs(DEFAULT_SCENARIO_PRESETS, configs);
  };

  // Formation preview
  server.post(
    "/api/swarm/formation/preview",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const parsed = swarmPreviewSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      const payload = parsed.data;
      const targets = engine.computeFollowerTargets(
        payload.leader,
        payload.followerDroneIds,
        {
          formation: payload.formation as FormationName,
          spacing: payload.spacing,
          headingDeg: payload.headingDeg,
          altOffset: payload.altOffset,
          droneCount: payload.followerDroneIds.length
        }
      );
      reply.send({ targets });
    }
  );

  // Create swarm group (persisted in DB)
  server.post(
    "/api/swarm/groups",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const parsed = createGroupSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({
          message: formatZodMessage("Invalid payload", parsed.error),
          errors: parsed.error.flatten()
        });
        return;
      }

      const { name, leaderId, followerIds, formation, spacing, headingDeg, altOffset } = parsed.data;

      const group = await prisma.swarmGroup.create({
        data: {
          name,
          leaderId,
          followerIds,
          formation,
          spacing,
          headingDeg,
          altOffset,
          state: "IDLE"
        }
      });

      reply.status(201).send({ group });
    }
  );

  // List swarm groups (active only, not archived)
  server.get(
    "/api/swarm/groups",
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      const groups = await prisma.swarmGroup.findMany({
        where: { archivedAt: null },
        orderBy: { createdAt: "desc" }
      });
      reply.send({ groups });
    }
  );

  // Get single swarm group
  server.get(
    "/api/swarm/groups/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const group = await prisma.swarmGroup.findUnique({ where: { id } });
      if (!group || group.archivedAt) {
        reply.status(404).send({ message: "Swarm group not found" });
        return;
      }
      reply.send({ group });
    }
  );

  // Update swarm group (live formation/spacing/heading changes)
  server.patch(
    "/api/swarm/groups/:id",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateGroupSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      const existing = await prisma.swarmGroup.findUnique({ where: { id } });
      if (!existing || existing.archivedAt) {
        reply.status(404).send({ message: "Swarm group not found" });
        return;
      }

      const group = await prisma.swarmGroup.update({
        where: { id },
        data: parsed.data
      });

      // Notify simulation runner of formation change if group is active
      if (bus && (group.state === "IN_FORMATION" || group.state === "FORMING")) {
        await bus.publish(RedisChannels.swarmFormations, {
          action: "update",
          groupId: group.id,
          leaderId: group.leaderId,
          followerIds: group.followerIds,
          formation: group.formation,
          spacing: group.spacing,
          headingDeg: group.headingDeg,
          altOffset: group.altOffset
        });
      }

      reply.send({ group });
    }
  );

  // Engage swarm formation
  server.post(
    "/api/swarm/groups/:id/engage",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const group = await prisma.swarmGroup.findUnique({ where: { id } });
      if (!group || group.archivedAt) {
        reply.status(404).send({ message: "Swarm group not found" });
        return;
      }

      const parsed = engageSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      // Resolve leader position: use provided, or look up from DB
      let leaderPos = parsed.data.leaderPosition;
      if (!leaderPos) {
        const leader = await prisma.drone.findUnique({ where: { id: group.leaderId } });
        if (leader?.lastKnownLat != null && leader?.lastKnownLon != null) {
          leaderPos = {
            lat: leader.lastKnownLat,
            lon: leader.lastKnownLon,
            alt: leader.lastKnownAlt ?? leader.homeAlt
          };
        } else if (leader) {
          leaderPos = { lat: leader.homeLat, lon: leader.homeLon, alt: leader.homeAlt };
        } else {
          reply.status(400).send({ message: "Leader drone not found and no position provided" });
          return;
        }
      }

      const formationParams = {
        formation: group.formation as FormationName,
        spacing: group.spacing,
        headingDeg: group.headingDeg,
        altOffset: group.altOffset,
        droneCount: group.followerIds.length
      };

      const targets = engine.computeFollowerTargets(leaderPos, group.followerIds, formationParams);

      // Transition state to FORMING
      await prisma.swarmGroup.update({
        where: { id },
        data: { state: "FORMING" }
      });

      // Send initial setWaypoint commands to position followers
      if (bus) {
        for (const target of targets) {
          await bus.publish(RedisChannels.commands, {
            droneId: target.droneId,
            type: "setWaypoint",
            params: { lat: target.lat, lon: target.lon, alt: target.alt },
            requestedBy: "swarm-engine",
            requestedAt: new Date().toISOString()
          });
        }

        // Publish engage event so the simulation runner starts continuous tracking
        await bus.publish(RedisChannels.swarmFormations, {
          action: "engage",
          groupId: group.id,
          leaderId: group.leaderId,
          followerIds: group.followerIds,
          formation: group.formation,
          spacing: group.spacing,
          headingDeg: group.headingDeg,
          altOffset: group.altOffset
        });
      }

      reply.send({ engaged: true, targets });
    }
  );

  // Start maneuver
  server.post(
    "/api/swarm/groups/:id/maneuver",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = maneuverSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      const group = await prisma.swarmGroup.findUnique({ where: { id } });
      if (!group || group.archivedAt) {
        reply.status(404).send({ message: "Swarm group not found" });
        return;
      }

      if (group.state !== "IN_FORMATION" && group.state !== "MANEUVERING") {
        reply.status(400).send({ message: `Cannot start maneuver in state ${group.state}. Group must be IN_FORMATION.` });
        return;
      }

      const updated = await prisma.swarmGroup.update({
        where: { id },
        data: {
          state: "MANEUVERING",
          maneuver: parsed.data.type,
          maneuverJson: JSON.stringify(parsed.data.params)
        }
      });

      if (bus) {
        await bus.publish(RedisChannels.swarmFormations, {
          action: "maneuver",
          groupId: group.id,
          maneuverType: parsed.data.type,
          maneuverParams: parsed.data.params
        });
      }

      reply.send({ group: updated });
    }
  );

  // Stop maneuver
  server.post(
    "/api/swarm/groups/:id/stop-maneuver",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const group = await prisma.swarmGroup.findUnique({ where: { id } });
      if (!group || group.archivedAt) {
        reply.status(404).send({ message: "Swarm group not found" });
        return;
      }

      if (bus && group.state === "MANEUVERING") {
        await bus.publish(RedisChannels.swarmFormations, {
          action: "stop-maneuver",
          groupId: group.id
        });
        reply.send({ group, stopRequested: true });
        return;
      }

      const updated = await prisma.swarmGroup.update({
        where: { id },
        data: {
          state: group.state,
          maneuver: null,
          maneuverJson: null
        }
      });

      reply.send({ group: updated, stopRequested: false });
    }
  );

  // Disengage swarm group without deleting it
  server.post(
    "/api/swarm/groups/:id/disengage",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const group = await prisma.swarmGroup.findUnique({ where: { id } });
      if (!group || group.archivedAt) {
        reply.status(404).send({ message: "Swarm group not found" });
        return;
      }

      const updated = await prisma.swarmGroup.update({
        where: { id },
        data: {
          state: "IDLE",
          maneuver: null,
          maneuverJson: null,
          archivedAt: null
        }
      });

      if (bus) {
        await bus.publish(RedisChannels.swarmFormations, {
          action: "disengage",
          groupId: id,
          leaderId: group.leaderId,
          followerIds: group.followerIds,
          formation: group.formation
        });
      }

      reply.send({ group: updated, disengaged: true });
    }
  );

  // Disband swarm group (archive, don't hard delete)
  server.delete(
    "/api/swarm/groups/:id",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const group = await prisma.swarmGroup.findUnique({ where: { id } });
      if (!group || group.archivedAt) {
        reply.status(404).send({ message: "Swarm group not found" });
        return;
      }

      await prisma.swarmGroup.update({
        where: { id },
        data: { state: "DISBANDING", archivedAt: new Date() }
      });

      // Notify simulation runner to stop formation tracking
      if (bus) {
        await bus.publish(RedisChannels.swarmFormations, {
          action: "disengage",
          groupId: id,
          leaderId: group.leaderId,
          followerIds: group.followerIds,
          formation: group.formation
        });
      }

      reply.send({ disbanded: true });
    }
  );

  // Get all scenario presets
  server.get(
    "/api/swarm/presets",
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      const presets = await resolveAllPresets();
      // Group presets by category
      const grouped: Record<string, ScenarioPreset[]> = {};
      for (const preset of presets) {
        if (!grouped[preset.category]) {
          grouped[preset.category] = [];
        }
        grouped[preset.category].push(preset);
      }
      reply.send({ presets, grouped });
    }
  );

  server.patch(
    "/api/swarm/presets/:id",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = presetConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      const preset = findDefaultScenarioPreset(id);
      if (!preset) {
        reply.status(404).send({ message: "Preset not found" });
        return;
      }

      const maneuverJson =
        parsed.data.maneuverParams !== undefined
          ? JSON.stringify(parsed.data.maneuverParams)
          : preset.maneuverParams
            ? JSON.stringify(preset.maneuverParams)
            : null;

      const config = await prisma.swarmPresetConfig.upsert({
        where: { presetId: id },
        update: {
          formation: parsed.data.formation,
          spacing: parsed.data.spacing,
          headingDeg: parsed.data.headingDeg,
          altOffset: parsed.data.altOffset,
          maneuverJson
        },
        create: {
          presetId: id,
          formation: parsed.data.formation,
          spacing: parsed.data.spacing,
          headingDeg: parsed.data.headingDeg,
          altOffset: parsed.data.altOffset,
          maneuverJson
        }
      });

      reply.send({ preset: applyScenarioPresetConfig(preset, config) });
    }
  );

  server.delete(
    "/api/swarm/presets/:id",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const preset = findDefaultScenarioPreset(id);
      if (!preset) {
        reply.status(404).send({ message: "Preset not found" });
        return;
      }

      await prisma.swarmPresetConfig.deleteMany({ where: { presetId: id } });
      reply.send({ preset: { ...preset, customized: false }, reset: true });
    }
  );

  // Create swarm group from preset
  server.post(
    "/api/swarm/groups/from-preset",
    { preHandler: [requireAuth, requireRoles(UserRole.ADMIN, UserRole.OPERATOR)] },
    async (request, reply) => {
      const parsed = fromPresetSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ message: "Invalid payload", errors: parsed.error.flatten() });
        return;
      }

      const preset = await resolvePreset(parsed.data.presetId);
      if (!preset) {
        reply.status(404).send({ message: "Preset not found" });
        return;
      }

      const overrides = parsed.data.overrides ?? {};
      const group = await prisma.swarmGroup.create({
        data: {
          name: parsed.data.name,
          leaderId: parsed.data.leaderId,
          followerIds: parsed.data.followerIds,
          formation: preset.formation,
          spacing: overrides.spacing ?? preset.spacing,
          headingDeg: overrides.headingDeg ?? preset.headingDeg,
          altOffset: overrides.altOffset ?? preset.altOffset,
          state: "IDLE"
        }
      });

      reply.status(201).send({ group, preset });
    }
  );
}
