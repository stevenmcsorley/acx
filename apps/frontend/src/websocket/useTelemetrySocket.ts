import { useEffect } from "react";
import { useGroundControlStore } from "../store/useGroundControlStore";
import type { SwarmState } from "../store/useGroundControlStore";
import type { AlertEvent, TelemetryEvent } from "../types/domain";
import type { DroneTelemetry } from "../types/domain";

interface TelemetryBatchMessage {
  type: "telemetry-batch";
  events: TelemetryEvent[];
}

interface SwarmStatusMessage {
  type: "swarmStatus";
  groupId: string;
  state: SwarmState;
  formationQuality: number;
  maneuver?: string;
  maneuverProgress?: number;
}

type WsMessage = TelemetryEvent | AlertEvent | TelemetryBatchMessage | SwarmStatusMessage | { type: string };

export function useTelemetrySocket(): void {
  const token = useGroundControlStore((s) => s.token);
  const wsBaseUrl = useGroundControlStore((s) => s.wsBaseUrl);
  const pushTelemetryBatch = useGroundControlStore((s) => s.pushTelemetryBatch);
  const pushAlert = useGroundControlStore((s) => s.pushAlert);
  const setSwarmGroupStatus = useGroundControlStore((s) => s.setSwarmGroupStatus);

  useEffect(() => {
    if (!token) {
      return;
    }

    const url = new URL(`${wsBaseUrl}/ws`);
    url.searchParams.set("token", token);

    let socket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let flushInterval: ReturnType<typeof setInterval> | null = null;
    let closedByUser = false;
    const telemetryBuffer: Record<string, DroneTelemetry> = {};

    const connect = () => {
      if (closedByUser) {
        return;
      }

      socket = new WebSocket(url.toString());

      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data as string) as WsMessage;

        if (payload.type === "telemetry") {
          const tel = payload as TelemetryEvent;
          telemetryBuffer[tel.droneId] = tel.payload;
        }

        if (payload.type === "telemetry-batch") {
          const batch = payload as TelemetryBatchMessage;
          for (const evt of batch.events) {
            telemetryBuffer[evt.droneId] = evt.payload;
          }
        }

        if (payload.type === "alert") {
          pushAlert(payload as AlertEvent);
        }

        if (payload.type === "swarmStatus") {
          const status = payload as SwarmStatusMessage;
          setSwarmGroupStatus(
            status.groupId,
            status.state,
            status.formationQuality,
            status.maneuver,
            status.maneuverProgress
          );
        }
      };

      socket.onclose = () => {
        if (closedByUser) {
          return;
        }
        // Auto-reconnect after 3 seconds
        reconnectTimeout = setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();
    flushInterval = setInterval(() => {
      if (Object.keys(telemetryBuffer).length === 0) {
        return;
      }

      const snapshot = { ...telemetryBuffer };
      for (const key of Object.keys(telemetryBuffer)) {
        delete telemetryBuffer[key];
      }
      pushTelemetryBatch(snapshot);
    }, 33);

    return () => {
      closedByUser = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (flushInterval) clearInterval(flushInterval);
      socket?.close();
    };
  }, [token, wsBaseUrl, pushTelemetryBatch, pushAlert, setSwarmGroupStatus]);
}
