import type { MissionWaypoint } from "@sgcx/shared-types";
import Redis from "ioredis";

export const RedisChannels = {
  telemetry: "sgcx.telemetry",
  alerts: "sgcx.alerts",
  commands: "sgcx.commands",
  missions: "sgcx.missions",
  droneRegistration: "sgcx.drones.register",
  droneRemoval: "sgcx.drones.remove",
  droneHomeUpdate: "sgcx.drones.home.update",
  killSwitch: "sgcx.admin.killswitch",
  swarmFormations: "sgcx.swarm.formations",
  swarmStatus: "sgcx.swarm.status",
  swarmManeuvers: "sgcx.swarm.maneuvers"
} as const;

export interface TelemetryChannelMessage {
  droneId: string;
  payload: unknown;
}

export interface AlertChannelMessage {
  droneId: string;
  severity: "info" | "warning" | "critical";
  message: string;
  timestamp: string;
}

export interface CommandChannelMessage {
  droneId: string;
  type: string;
  params?: Record<string, unknown>;
  requestedBy: string;
  requestedAt: string;
}

export interface MissionChannelMessage {
  missionId: string;
  droneId: string;
  name: string;
  waypoints: MissionWaypoint[];
}

export interface DroneRegistrationMessage {
  id: string;
  name: string;
  adapter: string;
  homeLat: number;
  homeLon: number;
  homeAlt: number;
}

export interface DroneHomeUpdateMessage {
  id: string;
  homeLat: number;
  homeLon: number;
  homeAlt: number;
}

export interface DroneRemovalMessage {
  id: string;
}

export interface KillSwitchChannelMessage {
  enabled: boolean;
  requestedBy: string;
  requestedAt: string;
}

export interface SwarmFormationMessage {
  action: "engage" | "disengage" | "update" | "maneuver" | "stop-maneuver";
  groupId: string;
  leaderId?: string;
  followerIds?: string[];
  formation?: string;
  spacing?: number;
  headingDeg?: number;
  altOffset?: number;
  maneuverType?: string;
  maneuverParams?: Record<string, unknown>;
}

export interface SwarmStatusMessage {
  groupId: string;
  state: string;
  formationQuality: number; // 0-100
  maneuver?: string;
  maneuverProgress?: number; // 0-1
}

type MessageHandler = (channel: string, payload: string) => Promise<void>;

export class TelemetryBus {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly handlers = new Map<string, Set<MessageHandler>>();

  constructor(redisUrl: string) {
    this.publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });

    this.subscriber.on("message", async (channel, payload) => {
      const channelHandlers = this.handlers.get(channel);
      if (!channelHandlers || channelHandlers.size === 0) {
        return;
      }

      await Promise.all(
        [...channelHandlers].map(async (handler) => {
          try {
            await handler(channel, payload);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error(`TelemetryBus handler failed for channel ${channel}`, error);
          }
        })
      );
    });
  }

  async publish(channel: string, message: unknown): Promise<void> {
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, handler: MessageHandler): Promise<void> {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      await this.subscriber.subscribe(channel);
    }

    this.handlers.get(channel)?.add(handler);
  }

  async close(): Promise<void> {
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }
}
