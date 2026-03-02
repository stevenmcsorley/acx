import type { FastifyInstance } from "fastify";
import type { AlertEvent, TelemetryEvent } from "@sgcx/shared-types";
import WebSocket from "ws";
import { verifyAccessToken } from "../auth/jwt";
import type { TelemetryBus } from "../core/TelemetryBus";
import { RedisChannels } from "../core/TelemetryBus";

interface WsClientContext {
  role: string;
  userId: string;
}

interface ManualControlMessage {
  type: "manual-control";
  droneId: string;
  forward: number;
  right: number;
  up: number;
  yawRate?: number;
  nowMs?: number;
}

export class WebsocketGateway {
  private readonly clients = new Map<WebSocket, WsClientContext>();
  private telemetryBatch: TelemetryEvent[] = [];
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private maxConnections = 100;

  constructor(private readonly bus: TelemetryBus) {}

  register(server: FastifyInstance): void {
    server.get("/ws", { websocket: true }, (socket: WebSocket, request) => {
      // Connection limit
      if (this.clients.size >= this.maxConnections) {
        socket.close(4003, "Connection limit reached");
        return;
      }

      const token = this.extractToken(request.headers.authorization, request.query as Record<string, unknown>);
      if (!token) {
        socket.close(4001, "Missing token");
        return;
      }

      try {
        const claims = verifyAccessToken(token);
        this.clients.set(socket, {
          role: claims.role,
          userId: claims.sub
        });
      } catch {
        socket.close(4001, "Invalid token");
        return;
      }

      socket.on("close", () => {
        this.clients.delete(socket);
      });

      socket.on("message", (payload: WebSocket.RawData) => {
        void this.handleIncomingMessage(socket, payload).catch(() => {
          // Ignore malformed/failed control packets.
        });
      });
    });

    // Batch telemetry every 50ms for efficiency (combines multiple drone updates into single WS frame)
    this.batchTimer = setInterval(() => {
      this.flushTelemetryBatch();
    }, 50);
  }

  broadcastTelemetry(event: TelemetryEvent): void {
    this.telemetryBatch.push(event);

    // If batch is getting large, flush immediately
    if (this.telemetryBatch.length >= 20) {
      this.flushTelemetryBatch();
    }
  }

  broadcastAlert(event: AlertEvent): void {
    // Alerts are sent immediately (not batched)
    this.broadcast(event);
  }

  broadcastSwarmStatus(status: unknown): void {
    this.broadcast({ type: "swarmStatus", ...status as Record<string, unknown> });
  }

  private flushTelemetryBatch(): void {
    if (this.telemetryBatch.length === 0) return;

    if (this.telemetryBatch.length === 1) {
      this.broadcast(this.telemetryBatch[0]);
    } else {
      // Batch multiple telemetry events into a single message
      this.broadcast({
        type: "telemetry-batch",
        events: this.telemetryBatch
      });
    }

    this.telemetryBatch = [];
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const socket of this.clients.keys()) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  private extractToken(
    authorizationHeader: string | undefined,
    query: Record<string, unknown>
  ): string | null {
    if (authorizationHeader?.startsWith("Bearer ")) {
      return authorizationHeader.slice(7);
    }

    const queryToken = query.token;
    if (typeof queryToken === "string" && queryToken.length > 0) {
      return queryToken;
    }

    return null;
  }

  private async handleIncomingMessage(socket: WebSocket, payload: WebSocket.RawData): Promise<void> {
    const context = this.clients.get(socket);
    if (!context) {
      return;
    }

    let messageText: string;
    if (typeof payload === "string") {
      messageText = payload;
    } else if (Buffer.isBuffer(payload)) {
      messageText = payload.toString("utf8");
    } else {
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(messageText);
    } catch {
      return;
    }

    if (
      typeof message !== "object" ||
      message === null ||
      (message as { type?: string }).type !== "manual-control"
    ) {
      return;
    }

    if (!["ADMIN", "OPERATOR"].includes(context.role)) {
      return;
    }

    const manual = message as ManualControlMessage;
    if (typeof manual.droneId !== "string" || manual.droneId.length === 0) {
      return;
    }

    const forward = this.clampNumber(manual.forward, -24, 24);
    const right = this.clampNumber(manual.right, -24, 24);
    const up = this.clampNumber(manual.up, -8, 8);
    const yawRate = this.clampNumber(manual.yawRate ?? 0, -180, 180);
    const nowMs = Number.isFinite(manual.nowMs) ? Number(manual.nowMs) : Date.now();

    if (![forward, right, up, yawRate, nowMs].every((v) => Number.isFinite(v))) {
      return;
    }

    await this.bus.publish(RedisChannels.commands, {
      droneId: manual.droneId,
      type: "manualControl",
      params: {
        forward,
        right,
        up,
        yawRate,
        nowMs
      },
      requestedBy: context.userId,
      requestedAt: new Date().toISOString()
    });
  }

  private clampNumber(value: number, min: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return Number.NaN;
    }
    return Math.max(min, Math.min(max, numeric));
  }
}
