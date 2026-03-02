import fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import bcrypt from "bcryptjs";
import type { DroneTelemetry } from "@sgcx/shared-types";
import { FlightState, UserRole } from "@prisma/client";
import { env } from "./config/env";
import { prisma } from "./db/prisma";
import {
  AlertChannelMessage,
  RedisChannels,
  TelemetryBus,
  TelemetryChannelMessage
} from "./core/TelemetryBus";
import { authRoutes } from "./routes/auth";
import { droneRoutes } from "./routes/drones";
import { missionRoutes } from "./routes/missions";
import { adminRoutes } from "./routes/admin";
import { healthRoutes } from "./routes/health";
import { videoRoutes } from "./routes/video";
import { swarmRoutes } from "./routes/swarm";
import { WebsocketGateway } from "./websocket/WebsocketGateway";

function mapFlightState(state: string): FlightState {
  switch (state) {
    case "grounded":
      return FlightState.GROUNDED;
    case "armed":
      return FlightState.ARMED;
    case "taking_off":
      return FlightState.TAKING_OFF;
    case "airborne":
      return FlightState.AIRBORNE;
    case "landing":
      return FlightState.LANDING;
    case "rtl":
      return FlightState.RTL;
    case "emergency":
      return FlightState.EMERGENCY;
    default:
      return FlightState.GROUNDED;
  }
}

async function ensureDefaultAdmin(): Promise<void> {
  const email = env.DEFAULT_ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  const displayName = "SGC-X Administrator";
  if (existing) {
    if (existing.displayName !== displayName) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { displayName }
      });
    }
    return;
  }

  const passwordHash = await bcrypt.hash(env.DEFAULT_ADMIN_PASSWORD, 12);
  await prisma.user.create({
    data: {
      email,
      displayName,
      role: UserRole.ADMIN,
      passwordHash
    }
  });
}

async function bootstrap(): Promise<void> {
  await ensureDefaultAdmin();

  const bus = new TelemetryBus(env.REDIS_URL);
  const server = fastify({ logger: true, bodyLimit: 1024 * 1024 * 5 });

  await server.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true
  });

  await server.register(websocket);

  const gateway = new WebsocketGateway(bus);
  gateway.register(server);

  await healthRoutes(server);
  await authRoutes(server);
  await droneRoutes(server, bus);
  await missionRoutes(server, bus);
  await adminRoutes(server, bus);
  await videoRoutes(server);
  await swarmRoutes(server, bus);

  const lastPersistAt = new Map<string, number>();
  const unknownDroneWarnAt = new Map<string, number>();

  await bus.subscribe(RedisChannels.telemetry, async (_channel, message) => {
    try {
      const data = JSON.parse(message) as TelemetryChannelMessage;
      const telemetryEvent = {
        type: "telemetry" as const,
        droneId: data.droneId,
        payload: data.payload as DroneTelemetry
      };

      gateway.broadcastTelemetry(telemetryEvent);

      const now = Date.now();
      const lastPersist = lastPersistAt.get(data.droneId) ?? 0;
      if (now - lastPersist <= 1000) {
        return;
      }
      lastPersistAt.set(data.droneId, now);

      const payload = telemetryEvent.payload;
      const result = await prisma.drone.updateMany({
        where: { id: data.droneId },
        data: {
          lastKnownLat: payload.position.lat,
          lastKnownLon: payload.position.lon,
          lastKnownAlt: payload.position.alt,
          lastBatteryPct: payload.batteryPct,
          lastSignalPct: payload.signalPct,
          lastTelemetryAt: new Date(payload.timestamp),
          status: mapFlightState(payload.flightState)
        }
      });

      if (result.count === 0) {
        const lastWarn = unknownDroneWarnAt.get(data.droneId) ?? 0;
        if (now - lastWarn > 30_000) {
          unknownDroneWarnAt.set(data.droneId, now);
          server.log.warn(
            {
              droneId: data.droneId
            },
            "Skipping telemetry persistence for unknown drone id"
          );
        }
      }
    } catch (error) {
      server.log.error(
        {
          err: error
        },
        "Telemetry subscriber handler failed"
      );
    }
  });

  await bus.subscribe(RedisChannels.alerts, async (_channel, message) => {
    const data = JSON.parse(message) as AlertChannelMessage;
    gateway.broadcastAlert({
      type: "alert",
      droneId: data.droneId,
      severity: data.severity,
      message: data.message,
      timestamp: data.timestamp
    });
  });

  await bus.subscribe(RedisChannels.swarmStatus, async (_channel, message) => {
    const data = JSON.parse(message) as unknown;
    gateway.broadcastSwarmStatus(data);
  });

  await server.listen({ port: env.PORT, host: "0.0.0.0" });

  const shutdown = async () => {
    server.log.info("Shutting down API...");
    await bus.close();
    await prisma.$disconnect();
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
