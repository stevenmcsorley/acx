import { AdapterType } from "@prisma/client";
import { env } from "./config/env";
import { MockDroneAdapter } from "./adapters/MockDroneAdapter";
import { MAVLinkAdapter } from "./adapters/MAVLinkAdapter";
import type { DroneAdapter } from "./adapters/DroneAdapter";
import { DroneRegistry } from "./core/DroneRegistry";
import { applyScenarioPresetConfig, findDefaultScenarioPreset } from "./core/ScenarioPresets";
import { SwarmEngine, type FormationName, type FormationParams } from "./core/SwarmEngine";
import { ManeuverEngine, type ManeuverType } from "./core/ManeuverEngine";
import {
  CommandChannelMessage,
  DroneHomeUpdateMessage,
  DroneRemovalMessage,
  DroneRegistrationMessage,
  KillSwitchChannelMessage,
  MissionChannelMessage,
  RedisChannels,
  SwarmFormationMessage,
  TelemetryBus
} from "./core/TelemetryBus";
import { prisma } from "./db/prisma";
import { haversineMeters } from "./simulation/geo";

interface ActiveSwarmGroup {
  groupId: string;
  leaderId: string;
  followerIds: string[];
  formation: FormationName;
  spacing: number;
  headingDeg: number;
  altOffset: number;
  state: "IDLE" | "FORMING" | "IN_FORMATION" | "MANEUVERING" | "DISBANDING";
  maneuverEngine?: ManeuverEngine;
  leaderParticipatesInManeuver?: boolean;
  eventMode?: "transit" | "final_destination";
  postAction?: "resume" | "rtl" | "land" | "hold";
  eventAnchor?: { lat: number; lon: number; alt: number };
  pendingManeuver?: {
    type: ManeuverType;
    params: Record<string, unknown>;
  };
}

interface MissionTriggerState {
  missionId: string;
  waypoints: MissionChannelMessage["waypoints"];
  firedWaypointIndexes: Set<number>;
}

type MissionSwarmTrigger = NonNullable<MissionChannelMessage["waypoints"][number]["swarmTrigger"]>;
type TriggerManeuverType = ManeuverType | "hold";
type MissionSwarmEventMode = NonNullable<MissionSwarmTrigger["eventMode"]>;
type MissionSwarmPostAction = NonNullable<MissionSwarmTrigger["postAction"]>;

const PREDICT_AHEAD_SEC = 0.4;
const FORMATION_QUALITY_THRESHOLD = 80; // percent to transition FORMING -> IN_FORMATION
const REACHED_WAYPOINT_REGEX = /reached waypoint (\d+)\/(\d+)/i;
const DEFAULT_PRESET_HOLD_DURATION_SEC = 18;

async function bootstrapSimulation(): Promise<void> {
  const bus = new TelemetryBus(env.REDIS_URL);
  const adapters: DroneAdapter[] = [];

  // Always register mock adapter
  const mockAdapter = new MockDroneAdapter(env.SIMULATION_MAX_DRONES);
  adapters.push(mockAdapter);

  // Optionally register MAVLink adapter
  if (env.MAVLINK_ENABLED) {
    const mavlinkAdapter = new MAVLinkAdapter({
      connectionString: env.MAVLINK_CONNECTION_STRING
    });
    adapters.push(mavlinkAdapter);
    // eslint-disable-next-line no-console
    console.log(`MAVLink adapter enabled: ${env.MAVLINK_CONNECTION_STRING}`);
  }

  const registry = new DroneRegistry(adapters);
  const swarmEngine = new SwarmEngine();
  const activeSwarmGroups = new Map<string, ActiveSwarmGroup>();
  const missionTriggerStateByDrone = new Map<string, MissionTriggerState>();

  async function loadActiveGeofences(): Promise<void> {
    const geofences = await prisma.geofence.findMany({
      where: { isActive: true }
    });

    registry.setGeofences(
      geofences.map((g) => ({
        id: g.id,
        isActive: g.isActive,
        polygon: JSON.parse(g.polygonJson) as Array<{ lat: number; lon: number }>
      }))
    );
  }

  await loadActiveGeofences();

  const resolvePreset = async (presetId: string) => {
    const preset = findDefaultScenarioPreset(presetId);
    if (!preset) {
      return undefined;
    }

    const config = await prisma.swarmPresetConfig.findUnique({ where: { presetId } });
    return applyScenarioPresetConfig(preset, config);
  };

  const clearLeaderSwarmOverride = (group: ActiveSwarmGroup): void => {
    if (!group.leaderParticipatesInManeuver) {
      return;
    }

    try {
      registry.sendCommand(group.leaderId, "clearSwarmTarget" as never);
    } catch {
      // Leader may no longer be registered.
    }

    group.leaderParticipatesInManeuver = false;
  };

  const clearGroupEventContext = (group: ActiveSwarmGroup): void => {
    group.eventMode = undefined;
    group.postAction = undefined;
    group.eventAnchor = undefined;
  };

  const resetGroupRuntime = (group: ActiveSwarmGroup, nextState: ActiveSwarmGroup["state"]): void => {
    clearLeaderSwarmOverride(group);
    group.state = nextState;
    group.pendingManeuver = undefined;
    group.maneuverEngine = undefined;
    group.leaderParticipatesInManeuver = false;
    clearGroupEventContext(group);
  };

  const sendGroupCommand = (group: ActiveSwarmGroup, command: "rtl" | "land"): void => {
    for (const droneId of [group.leaderId, ...group.followerIds]) {
      try {
        registry.sendCommand(droneId, command as never);
      } catch {
        // Drone may no longer be registered.
      }
    }
  };

  const persistGroupState = (
    group: ActiveSwarmGroup,
    state: ActiveSwarmGroup["state"],
    maneuver: TriggerManeuverType | null,
    maneuverParams?: Record<string, unknown> | null
  ): void => {
    prisma.swarmGroup.update({
      where: { id: group.groupId },
      data: {
        state,
        maneuver,
        maneuverJson: maneuverParams ? JSON.stringify(maneuverParams) : null
      }
    }).catch(() => {});
  };

  const transitionGroupToFormation = (group: ActiveSwarmGroup): void => {
    resetGroupRuntime(group, "IN_FORMATION");
    persistGroupState(group, "IN_FORMATION", null);
  };

  const transitionGroupToHold = (
    group: ActiveSwarmGroup,
    anchor: { lat: number; lon: number; alt: number }
  ): void => {
    clearLeaderSwarmOverride(group);
    clearGroupEventContext(group);
    group.state = "MANEUVERING";
    group.pendingManeuver = undefined;
    group.leaderParticipatesInManeuver = true;
    const holdParams: Record<string, unknown> = {
      includeLeader: true,
      centerLat: anchor.lat,
      centerLon: anchor.lon,
      alt: anchor.alt
    };
    group.maneuverEngine = new ManeuverEngine("hold", holdParams, group.followerIds.length);
    persistGroupState(group, "MANEUVERING", "hold", holdParams);
  };

  const completeTriggeredEvent = (
    group: ActiveSwarmGroup,
    leaderPosition: { lat: number; lon: number; alt: number }
  ): "resume" | "hold" | "rtl" | "land" => {
    const eventMode: MissionSwarmEventMode = group.eventMode ?? "transit";
    const postAction: MissionSwarmPostAction = group.postAction ?? (eventMode === "final_destination" ? "hold" : "resume");
    const anchor = group.eventAnchor ?? leaderPosition;

    if (postAction === "hold") {
      transitionGroupToHold(group, anchor);
      return "hold";
    }

    if (postAction === "rtl" || postAction === "land") {
      resetGroupRuntime(group, "IDLE");
      sendGroupCommand(group, postAction);
      return postAction;
    }

    transitionGroupToFormation(group);
    return "resume";
  };

  const dispatchTargets = (
    group: ActiveSwarmGroup,
    targets: Array<{ droneId: string; lat: number; lon: number; alt: number }>
  ): void => {
    for (const target of targets) {
      try {
        if (group.leaderParticipatesInManeuver && target.droneId === group.leaderId) {
          registry.sendCommand(target.droneId, "setSwarmTarget" as never, {
            lat: target.lat,
            lon: target.lon,
            alt: target.alt
          });
        } else {
          registry.sendCommand(target.droneId, "setWaypoint" as never, {
            lat: target.lat,
            lon: target.lon,
            alt: target.alt
          });
        }
      } catch {
        // Skip drones that are no longer registered.
      }
    }
  };

  const engageGroupFromPresetTrigger = async (
    swarmTrigger: MissionSwarmTrigger,
    leaderDroneId: string,
    leaderPosition: { lat: number; lon: number; alt: number },
    maneuverAnchor: { lat: number; lon: number; alt: number }
  ): Promise<{ ok: boolean; message: string }> => {
    const preset = await resolvePreset(swarmTrigger.presetId);
    if (!preset) {
      return { ok: false, message: `Swarm preset ${swarmTrigger.presetId} not found` };
    }

    const groupRecord = await prisma.swarmGroup.findUnique({ where: { id: swarmTrigger.groupId } });
    if (!groupRecord || groupRecord.archivedAt) {
      return { ok: false, message: `Swarm group ${swarmTrigger.groupId} not found` };
    }

    if (groupRecord.leaderId !== leaderDroneId) {
      return {
        ok: false,
        message: `Swarm trigger ignored: mission drone ${leaderDroneId} is not leader of group ${groupRecord.name}`
      };
    }

    const formationParams: FormationParams = {
      formation: preset.formation,
      spacing: preset.spacing,
      headingDeg: preset.headingDeg,
      altOffset: preset.altOffset,
      droneCount: groupRecord.followerIds.length
    };

    const triggerManeuverType: TriggerManeuverType = preset.maneuver ?? "hold";
    const eventMode: MissionSwarmEventMode = swarmTrigger.eventMode ?? "transit";
    const triggerStopRule = swarmTrigger.stopRule ?? "timer";
    const postAction: MissionSwarmPostAction = swarmTrigger.postAction ?? (eventMode === "final_destination" ? "hold" : "resume");
    const presetParams = preset.maneuverParams ?? {};
    const overrideParams = swarmTrigger.maneuverOverrides ?? {};
    const durationOverride =
      typeof swarmTrigger.durationSec === "number" && Number.isFinite(swarmTrigger.durationSec)
        ? swarmTrigger.durationSec
        : undefined;
    const resolvedManeuverParams: Record<string, unknown> = {
      ...presetParams,
      ...overrideParams,
      includeLeader: true,
      eventMode,
      postAction,
      ...(triggerManeuverType === "hold"
        ? {
            durationSec:
              durationOverride
              ?? (overrideParams.durationSec as number | undefined)
              ?? (presetParams.durationSec as number | undefined)
              ?? DEFAULT_PRESET_HOLD_DURATION_SEC
          }
        : {}),
      ...(["hold", "orbit", "perimeter", "search_grid", "search_spiral"].includes(triggerManeuverType)
        ? {
            centerLat:
              (overrideParams.centerLat as number | undefined)
              ?? (presetParams.centerLat as number | undefined)
              ?? maneuverAnchor.lat,
            centerLon:
              (overrideParams.centerLon as number | undefined)
              ?? (presetParams.centerLon as number | undefined)
              ?? maneuverAnchor.lon,
            alt:
              (overrideParams.alt as number | undefined)
              ?? (presetParams.alt as number | undefined)
              ?? maneuverAnchor.alt
          }
        : {})
    };

    if (durationOverride !== undefined) {
      resolvedManeuverParams.durationSec = durationOverride;
    }

    if (triggerStopRule === "manual_confirm") {
      delete resolvedManeuverParams.durationSec;
    }

    const maneuverEngine = new ManeuverEngine(
      triggerManeuverType,
      resolvedManeuverParams,
      groupRecord.followerIds.length
    );

    const maneuverDroneIds = [groupRecord.leaderId, ...groupRecord.followerIds];
    const initialTargets =
      maneuverEngine?.tick(
        {
          lat: leaderPosition.lat,
          lon: leaderPosition.lon,
          alt: leaderPosition.alt
        },
        maneuverDroneIds,
        formationParams,
        0
      ) ??
      swarmEngine.computeFollowerTargets(
        leaderPosition,
        groupRecord.followerIds,
        formationParams,
        PREDICT_AHEAD_SEC
      );

    const existingGroup = activeSwarmGroups.get(groupRecord.id);
    if (existingGroup) {
      clearLeaderSwarmOverride(existingGroup);
    }

    const activeGroup: ActiveSwarmGroup = {
      groupId: groupRecord.id,
      leaderId: groupRecord.leaderId,
      followerIds: groupRecord.followerIds,
      formation: preset.formation,
      spacing: preset.spacing,
      headingDeg: preset.headingDeg,
      altOffset: preset.altOffset,
      state: "MANEUVERING",
      maneuverEngine,
      leaderParticipatesInManeuver: true,
      eventMode,
      postAction,
      eventAnchor: maneuverAnchor
    };

    dispatchTargets(activeGroup, initialTargets);
    activeSwarmGroups.set(groupRecord.id, activeGroup);

    await prisma.swarmGroup.update({
      where: { id: groupRecord.id },
      data: {
        formation: preset.formation,
        spacing: preset.spacing,
        headingDeg: preset.headingDeg,
        altOffset: preset.altOffset,
        state: "MANEUVERING",
        maneuver: triggerManeuverType,
        maneuverJson: JSON.stringify(resolvedManeuverParams)
      }
    });

    return {
      ok: true,
      message: `Swarm trigger engaged "${groupRecord.name}" with preset "${preset.name}"`
    };
  };

  // Load persisted swarm groups that were active before restart
  const persistedGroups = await prisma.swarmGroup.findMany({
    where: {
      archivedAt: null,
      state: { in: ["FORMING", "IN_FORMATION", "MANEUVERING"] }
    }
  });
  for (const pg of persistedGroups) {
    const group: ActiveSwarmGroup = {
      groupId: pg.id,
      leaderId: pg.leaderId,
      followerIds: pg.followerIds,
      formation: pg.formation as FormationName,
      spacing: pg.spacing,
      headingDeg: pg.headingDeg,
      altOffset: pg.altOffset,
      state: pg.state as ActiveSwarmGroup["state"]
    };
    if (pg.state === "MANEUVERING" && pg.maneuver) {
      const params = pg.maneuverJson ? JSON.parse(pg.maneuverJson) as Record<string, unknown> : {};
      group.leaderParticipatesInManeuver = Boolean(params.includeLeader);
      if (params.eventMode === "transit" || params.eventMode === "final_destination") {
        group.eventMode = params.eventMode;
      }
      if (params.postAction === "resume" || params.postAction === "rtl" || params.postAction === "land" || params.postAction === "hold") {
        group.postAction = params.postAction;
      }
      if (
        typeof params.centerLat === "number" &&
        typeof params.centerLon === "number" &&
        typeof params.alt === "number"
      ) {
        group.eventAnchor = {
          lat: params.centerLat,
          lon: params.centerLon,
          alt: params.alt
        };
      }
      group.maneuverEngine = new ManeuverEngine(
        pg.maneuver as ManeuverType,
        params,
        pg.followerIds.length
      );
    }
    activeSwarmGroups.set(pg.id, group);
    // eslint-disable-next-line no-console
    console.log(`Restored swarm group ${pg.id} in state ${pg.state}`);
  }

  // Load all drones (both mock and mavlink)
  const drones = await prisma.drone.findMany();

  for (const drone of drones) {
    const adapterType = drone.adapter.toLowerCase();
    if (adapterType === "mock" || (adapterType === "mavlink" && env.MAVLINK_ENABLED)) {
      try {
        registry.registerDrone({
          id: drone.id,
          name: drone.name,
          adapter: adapterType as "mock" | "mavlink",
          homeLat: drone.homeLat,
          homeLon: drone.homeLon,
          homeAlt: drone.homeAlt
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`Failed to register drone ${drone.id} (${adapterType})`, error);
      }
    }
  }

  await bus.subscribe(RedisChannels.droneRegistration, async (_channel, message) => {
    const payload = JSON.parse(message) as DroneRegistrationMessage;
    const adapterType = payload.adapter.toLowerCase();

    if (adapterType !== "mock" && (adapterType !== "mavlink" || !env.MAVLINK_ENABLED)) {
      return;
    }

    try {
      registry.registerDrone({
        id: payload.id,
        name: payload.name,
        adapter: adapterType as "mock" | "mavlink",
        homeLat: payload.homeLat,
        homeLon: payload.homeLon,
        homeAlt: payload.homeAlt
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to register drone ${payload.id} in simulation`, error);
    }
  });

  await bus.subscribe(RedisChannels.droneHomeUpdate, async (_channel, message) => {
    const payload = JSON.parse(message) as DroneHomeUpdateMessage;
    try {
      registry.updateHome(payload.id, payload.homeLat, payload.homeLon, payload.homeAlt);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to update home for ${payload.id}`, error);
    }
  });

  await bus.subscribe(RedisChannels.droneRemoval, async (_channel, message) => {
    const payload = JSON.parse(message) as DroneRemovalMessage;
    try {
      registry.removeDrone(payload.id);
      for (const [groupId, group] of activeSwarmGroups.entries()) {
        if (group.leaderId === payload.id || group.followerIds.includes(payload.id)) {
          clearLeaderSwarmOverride(group);
          activeSwarmGroups.delete(groupId);
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to remove drone ${payload.id}`, error);
    }
  });

  await bus.subscribe(RedisChannels.commands, async (_channel, message) => {
    const payload = JSON.parse(message) as CommandChannelMessage;
    try {
      registry.sendCommand(payload.droneId, payload.type as never, payload.params);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to apply command for ${payload.droneId}`, error);
    }
  });

  await bus.subscribe(RedisChannels.missions, async (_channel, message) => {
    const payload = JSON.parse(message) as MissionChannelMessage;
    try {
      registry.uploadMission(payload.droneId, payload.missionId, payload.name, payload.waypoints);
      missionTriggerStateByDrone.set(payload.droneId, {
        missionId: payload.missionId,
        waypoints: payload.waypoints,
        firedWaypointIndexes: new Set()
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to upload mission for ${payload.droneId}`, error);
    }
  });

  await bus.subscribe(RedisChannels.killSwitch, async (_channel, message) => {
    const payload = JSON.parse(message) as KillSwitchChannelMessage;
    registry.setKillSwitch(payload.enabled);
  });

  await bus.subscribe(RedisChannels.swarmFormations, async (_channel, message) => {
    const payload = JSON.parse(message) as SwarmFormationMessage;

    if (payload.action === "engage") {
      activeSwarmGroups.set(payload.groupId, {
        groupId: payload.groupId,
        leaderId: payload.leaderId!,
        followerIds: payload.followerIds!,
        formation: (payload.formation ?? "triangle") as FormationName,
        spacing: payload.spacing ?? 15,
        headingDeg: payload.headingDeg ?? 0,
        altOffset: payload.altOffset ?? 0,
        state: "FORMING",
        leaderParticipatesInManeuver: false
      });
      // eslint-disable-next-line no-console
      console.log(`Swarm group ${payload.groupId} engaged: ${payload.formation} (leader=${payload.leaderId}, followers=${payload.followerIds?.length})`);
    } else if (payload.action === "disengage") {
      const existing = activeSwarmGroups.get(payload.groupId);
      if (existing) {
        resetGroupRuntime(existing, "IDLE");
      }
      activeSwarmGroups.delete(payload.groupId);
      // eslint-disable-next-line no-console
      console.log(`Swarm group ${payload.groupId} disbanded`);
    } else if (payload.action === "update") {
      const existing = activeSwarmGroups.get(payload.groupId);
      if (existing) {
        if (payload.formation) existing.formation = payload.formation as FormationName;
        if (payload.spacing !== undefined) existing.spacing = payload.spacing;
        if (payload.headingDeg !== undefined) existing.headingDeg = payload.headingDeg;
        if (payload.altOffset !== undefined) existing.altOffset = payload.altOffset;
        // eslint-disable-next-line no-console
        console.log(`Swarm group ${payload.groupId} updated: ${existing.formation} spacing=${existing.spacing}`);
      }
    } else if (payload.action === "maneuver") {
      const existing = activeSwarmGroups.get(payload.groupId);
      if (existing && payload.maneuverType) {
        existing.state = "MANEUVERING";
        existing.pendingManeuver = undefined;
        existing.leaderParticipatesInManeuver = Boolean(payload.maneuverParams?.includeLeader);
        clearGroupEventContext(existing);
        existing.maneuverEngine = new ManeuverEngine(
          payload.maneuverType as ManeuverType,
          payload.maneuverParams ?? {},
          existing.followerIds.length
        );
        // eslint-disable-next-line no-console
        console.log(`Swarm group ${payload.groupId} started maneuver: ${payload.maneuverType}`);
      }
    } else if (payload.action === "stop-maneuver") {
      const existing = activeSwarmGroups.get(payload.groupId);
      if (existing) {
        const wantsHoldPostAction =
          existing.postAction === "hold" || (existing.postAction === undefined && existing.eventMode === "final_destination");
        const completionAction = wantsHoldPostAction && !existing.eventAnchor
          ? (transitionGroupToFormation(existing), "resume" as const)
          : completeTriggeredEvent(existing, existing.eventAnchor ?? { lat: 0, lon: 0, alt: 0 });
        if (completionAction === "rtl" || completionAction === "land") {
          activeSwarmGroups.delete(payload.groupId);
          persistGroupState(existing, "IDLE", null);
        }
        // eslint-disable-next-line no-console
        console.log(`Swarm group ${payload.groupId} stopped maneuver (${completionAction})`);
      }
    }
  });

  setInterval(() => {
    loadActiveGeofences().catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Failed to refresh geofences", error);
    });
  }, 5000);

  const tickIntervalMs = Math.floor(1000 / env.TELEMETRY_HZ);
  let lastTickMs = Date.now();

  // Throttle swarm formation updates — don't need to send every single tick.
  let lastSwarmUpdateMs = 0;
  const SWARM_UPDATE_INTERVAL_MS = 200; // 5Hz formation updates

  // Throttle swarm status broadcasts
  let lastSwarmStatusMs = 0;
  const SWARM_STATUS_INTERVAL_MS = 1000; // 1Hz status

  const loop = setInterval(async () => {
    const nowMs = Date.now();
    const dt = (nowMs - lastTickMs) / 1000;
    lastTickMs = nowMs;

    // Build and pass swarm member map to adapters for collision engine.
    const swarmMembers = new Map<string, string>();
    for (const group of activeSwarmGroups.values()) {
      swarmMembers.set(group.leaderId, group.groupId);
      for (const fid of group.followerIds) {
        swarmMembers.set(fid, group.groupId);
      }
    }
    registry.setSwarmMembers(swarmMembers);

    const result = registry.tick(dt, nowMs);

    const telemetryMap = new Map<string, {
      position: { lat: number; lon: number; alt: number };
      flightState: string;
      mode?: string;
      vNorth?: number;
      vEast?: number;
      heading?: number;
    }>();
    for (const packet of result.telemetry) {
      const tel = packet.payload as {
        position?: { lat: number; lon: number; alt: number };
        flightState?: string;
        mode?: string;
        velocity?: { north: number; east: number; up: number };
        heading?: number;
      };
      if (tel.position && tel.flightState) {
        telemetryMap.set(packet.droneId, {
          position: tel.position,
          flightState: tel.flightState,
          mode: tel.mode,
          vNorth: tel.velocity?.north,
          vEast: tel.velocity?.east,
          heading: tel.heading
        });
      }
    }

    for (const [droneId, triggerState] of missionTriggerStateByDrone.entries()) {
      const leaderTelemetry = telemetryMap.get(droneId);
      if (!leaderTelemetry) {
        continue;
      }

      for (let waypointIndex = 0; waypointIndex < triggerState.waypoints.length; waypointIndex++) {
        if (triggerState.firedWaypointIndexes.has(waypointIndex)) {
          continue;
        }

        const swarmTrigger = triggerState.waypoints[waypointIndex]?.swarmTrigger;
        if (!swarmTrigger?.groupId || !swarmTrigger.presetId) {
          continue;
        }

        if ((swarmTrigger.triggerMode ?? "waypoint_reached") !== "mission_start") {
          continue;
        }

        triggerState.firedWaypointIndexes.add(waypointIndex);

        try {
        const triggerResult = await engageGroupFromPresetTrigger(
          swarmTrigger,
          droneId,
          leaderTelemetry.position,
          leaderTelemetry.position
        );

          result.alerts.push({
            droneId,
            severity: triggerResult.ok ? "info" : "warning",
            message: `${droneId}: ${triggerResult.message}`,
            timestamp: new Date(nowMs).toISOString()
          });
        } catch (error) {
          result.alerts.push({
            droneId,
            severity: "warning",
            message: `${droneId}: swarm mission-start trigger failed`,
            timestamp: new Date(nowMs).toISOString()
          });
          // eslint-disable-next-line no-console
          console.error("Swarm mission-start trigger execution failed", error);
        }
      }
    }

    for (const alert of result.alerts) {
      const triggerState = missionTriggerStateByDrone.get(alert.droneId);
      if (!triggerState) {
        continue;
      }

      const reachedMatch = REACHED_WAYPOINT_REGEX.exec(alert.message);
      if (!reachedMatch) {
        const lowerMessage = alert.message.toLowerCase();
        if (lowerMessage.includes("mission successful")) {
          await prisma.mission.updateMany({
            where: { id: triggerState.missionId },
            data: { status: "completed" }
          });
          missionTriggerStateByDrone.delete(alert.droneId);
        }
        if (lowerMessage.includes("aborting mission")) {
          await prisma.mission.updateMany({
            where: { id: triggerState.missionId },
            data: { status: "aborted" }
          });
          missionTriggerStateByDrone.delete(alert.droneId);
        }
        continue;
      }

      const reachedWaypointIndex = Number(reachedMatch[1]) - 1;
      if (!Number.isFinite(reachedWaypointIndex) || reachedWaypointIndex < 0) {
        continue;
      }
      if (triggerState.firedWaypointIndexes.has(reachedWaypointIndex)) {
        continue;
      }

      const waypoint = triggerState.waypoints[reachedWaypointIndex];
      const swarmTrigger = waypoint?.swarmTrigger;
      if (!swarmTrigger?.groupId || !swarmTrigger.presetId) {
        continue;
      }
      if ((swarmTrigger.triggerMode ?? "waypoint_reached") !== "waypoint_reached") {
        continue;
      }

      triggerState.firedWaypointIndexes.add(reachedWaypointIndex);
      const leaderTelemetry = telemetryMap.get(alert.droneId);
      if (!leaderTelemetry) {
        result.alerts.push({
          droneId: alert.droneId,
          severity: "warning",
          message: `${alert.droneId}: swarm trigger skipped at WP-${reachedWaypointIndex + 1}, leader telemetry unavailable`,
          timestamp: new Date(nowMs).toISOString()
        });
        continue;
      }

      try {
        const triggerResult = await engageGroupFromPresetTrigger(
          swarmTrigger,
          alert.droneId,
          leaderTelemetry.position,
          {
            lat: waypoint.lat,
            lon: waypoint.lon,
            alt: waypoint.alt
          }
        );

        result.alerts.push({
          droneId: alert.droneId,
          severity: triggerResult.ok ? "info" : "warning",
          message: `${alert.droneId}: ${triggerResult.message}`,
          timestamp: new Date(nowMs).toISOString()
        });
      } catch (error) {
        result.alerts.push({
          droneId: alert.droneId,
          severity: "warning",
          message: `${alert.droneId}: swarm trigger failed at WP-${reachedWaypointIndex + 1}`,
          timestamp: new Date(nowMs).toISOString()
        });
        // eslint-disable-next-line no-console
        console.error("Swarm trigger execution failed", error);
      }
    }

    // Continuous swarm formation tracking: update follower targets based on leader position.
    if (activeSwarmGroups.size > 0 && nowMs - lastSwarmUpdateMs >= SWARM_UPDATE_INTERVAL_MS) {
      lastSwarmUpdateMs = nowMs;

      const groupsToDeactivate: string[] = [];

      for (const group of activeSwarmGroups.values()) {
        const leaderTel = telemetryMap.get(group.leaderId);
        if (!leaderTel) continue;

        const leaderState = leaderTel.flightState;
        const leaderMode = (leaderTel.mode ?? "").toLowerCase();

        // If the leader is grounded, the mission/flight is over. Land followers and disband.
        if (leaderState === "grounded") {
          resetGroupRuntime(group, "IDLE");
          for (const followerId of group.followerIds) {
            try {
              registry.sendCommand(followerId, "land" as never);
            } catch {
              // Follower may not be registered.
            }
          }
          groupsToDeactivate.push(group.groupId);
          continue;
        }

        const formationParams: FormationParams = {
          formation: group.formation,
          spacing: group.spacing,
          headingDeg: group.headingDeg,
          altOffset: group.altOffset,
          droneCount: group.followerIds.length
        };

        // If the leader is RTL or landing, terminate the swarm session and return followers home.
        if (
          leaderState === "rtl" ||
          leaderState === "landing" ||
          leaderMode.includes("rtl") ||
          leaderMode.includes("mission-complete")
        ) {
          resetGroupRuntime(group, "IDLE");
          for (const followerId of group.followerIds) {
            try {
              registry.sendCommand(followerId, "rtl" as never);
            } catch {
              // skip
            }
          }
          groupsToDeactivate.push(group.groupId);
          continue;
        }

        // Check if we should use maneuver engine
        let targets: Array<{ droneId: string; lat: number; lon: number; alt: number }>;

        if (group.state === "MANEUVERING" && group.maneuverEngine) {
          const maneuverDroneIds = group.leaderParticipatesInManeuver
            ? [group.leaderId, ...group.followerIds]
            : group.followerIds;
          const maneuverTargets = group.maneuverEngine.tick(
            {
              lat: leaderTel.position.lat,
              lon: leaderTel.position.lon,
              alt: leaderTel.position.alt,
              heading: leaderTel.heading,
              vNorth: leaderTel.vNorth,
              vEast: leaderTel.vEast
            },
            maneuverDroneIds,
            formationParams,
            dt
          );

          if (maneuverTargets) {
            targets = maneuverTargets;
          } else {
            const completionAction = completeTriggeredEvent(group, leaderTel.position);
            if (completionAction === "rtl" || completionAction === "land") {
              groupsToDeactivate.push(group.groupId);
              continue;
            }

            if (group.state === "MANEUVERING" && group.maneuverEngine) {
              const postActionTargets = group.maneuverEngine.tick(
                {
                  lat: leaderTel.position.lat,
                  lon: leaderTel.position.lon,
                  alt: leaderTel.position.alt,
                  heading: leaderTel.heading,
                  vNorth: leaderTel.vNorth,
                  vEast: leaderTel.vEast
                },
                [group.leaderId, ...group.followerIds],
                formationParams,
                0
              );
              if (postActionTargets) {
                targets = postActionTargets;
              } else {
                transitionGroupToFormation(group);
                targets = swarmEngine.computeFollowerTargets(
                  {
                    ...leaderTel.position,
                    heading: leaderTel.heading,
                    vNorth: leaderTel.vNorth,
                    vEast: leaderTel.vEast
                  },
                  group.followerIds,
                  formationParams,
                  PREDICT_AHEAD_SEC
                );
              }
            } else {
              targets = swarmEngine.computeFollowerTargets(
                {
                  ...leaderTel.position,
                  heading: leaderTel.heading,
                  vNorth: leaderTel.vNorth,
                  vEast: leaderTel.vEast
                },
                group.followerIds,
                formationParams,
                PREDICT_AHEAD_SEC
              );
            }
          }
        } else {
          // Normal airborne/taking_off — maintain formation around leader with velocity prediction.
          targets = swarmEngine.computeFollowerTargets(
            {
              ...leaderTel.position,
              heading: leaderTel.heading,
              vNorth: leaderTel.vNorth,
              vEast: leaderTel.vEast
            },
            group.followerIds,
            formationParams,
            PREDICT_AHEAD_SEC
          );
        }

        // Calculate formation quality: average distance-to-target for followers
        let totalError = 0;
        let measured = 0;
        for (const target of targets) {
          const followerTel = telemetryMap.get(target.droneId);
          if (followerTel) {
            const dist = haversineMeters(
              followerTel.position.lat,
              followerTel.position.lon,
              target.lat,
              target.lon
            );
            totalError += dist;
            measured++;
          }
        }

        const avgError = measured > 0 ? totalError / measured : 999;
        // Quality: 100% when avg error is 0, 0% when avg error >= spacing
        const quality = Math.max(0, Math.min(100, 100 * (1 - avgError / Math.max(group.spacing, 5))));

        // State transitions
        if (group.state === "FORMING" && quality >= FORMATION_QUALITY_THRESHOLD) {
          if (group.pendingManeuver) {
            group.state = "MANEUVERING";
            group.leaderParticipatesInManeuver = Boolean(group.pendingManeuver.params.includeLeader);
            group.maneuverEngine = new ManeuverEngine(
              group.pendingManeuver.type,
              group.pendingManeuver.params,
              group.followerIds.length
            );
            prisma.swarmGroup.update({
              where: { id: group.groupId },
              data: {
                state: "MANEUVERING",
                maneuver: group.pendingManeuver.type,
                maneuverJson: JSON.stringify(group.pendingManeuver.params)
              }
            }).catch(() => {});
            // eslint-disable-next-line no-console
            console.log(`Swarm group ${group.groupId} reached formation and started maneuver ${group.pendingManeuver.type}`);
            group.pendingManeuver = undefined;
          } else {
            group.state = "IN_FORMATION";
            prisma.swarmGroup.update({
              where: { id: group.groupId },
              data: { state: "IN_FORMATION" }
            }).catch(() => {});
            // eslint-disable-next-line no-console
            console.log(`Swarm group ${group.groupId} reached formation (quality=${quality.toFixed(0)}%)`);
          }
        }

        // Publish swarm status
        if (nowMs - lastSwarmStatusMs >= SWARM_STATUS_INTERVAL_MS) {
          bus.publish(RedisChannels.swarmStatus, {
            groupId: group.groupId,
            state: group.state,
            formationQuality: Math.round(quality),
            maneuver: group.maneuverEngine?.type,
            maneuverProgress: group.maneuverEngine?.progress
          }).catch(() => {});
        }

        dispatchTargets(group, targets);
      }

      if (nowMs - lastSwarmStatusMs >= SWARM_STATUS_INTERVAL_MS) {
        lastSwarmStatusMs = nowMs;
      }

      // Clean up disbanded groups.
      for (const groupId of groupsToDeactivate) {
        const existing = activeSwarmGroups.get(groupId);
        if (existing) {
          clearLeaderSwarmOverride(existing);
          activeSwarmGroups.delete(groupId);
        }
        bus.publish(RedisChannels.swarmStatus, {
          groupId,
          state: "IDLE",
          formationQuality: 0
        }).catch(() => {});
        prisma.swarmGroup.update({
          where: { id: groupId },
          data: {
            state: "IDLE",
            maneuver: null,
            maneuverJson: null,
            archivedAt: null
          }
        }).catch(() => {});
        // eslint-disable-next-line no-console
        console.log(`Swarm group ${groupId} returned to IDLE: leader grounded`);
      }
    }

    await Promise.all([
      ...result.telemetry.map((packet) => bus.publish(RedisChannels.telemetry, packet)),
      ...result.alerts.map((packet) => bus.publish(RedisChannels.alerts, packet))
    ]);
  }, tickIntervalMs);

  const shutdown = async () => {
    clearInterval(loop);
    await bus.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // eslint-disable-next-line no-console
  console.log(`SGC-X simulation runner online @ ${env.TELEMETRY_HZ}Hz`);
}

bootstrapSimulation().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
