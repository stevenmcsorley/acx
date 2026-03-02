import type { DroneTelemetry } from "./DroneTelemetry";
import type { MissionWaypoint } from "./MissionTypes";

export type AdapterType = "mock" | "mavlink" | "dji" | "custom";

export interface RegisterDroneRequest {
  id: string;
  name?: string;
  adapter: AdapterType;
  homeLat: number;
  homeLon: number;
  homeAlt?: number;
}

export interface UpdateDroneHomeRequest {
  homeLat: number;
  homeLon: number;
  homeAlt?: number;
}

export type DroneCommandType =
  | "arm"
  | "disarm"
  | "takeoff"
  | "land"
  | "rtl"
  | "manualControl"
  | "setWaypoint"
  | "setSwarmTarget"
  | "clearSwarmTarget"
  | "uploadMission";

export interface DroneCommandRequest {
  type: DroneCommandType;
  params?: Record<string, unknown>;
}

export interface UploadMissionRequest {
  droneId: string;
  name?: string;
  geofenceId?: string;
  waypoints: MissionWaypoint[];
}

export interface TelemetryEvent {
  type: "telemetry";
  droneId: string;
  payload: DroneTelemetry;
}

export interface AlertEvent {
  type: "alert";
  droneId: string;
  severity: "info" | "warning" | "critical";
  message: string;
  timestamp: string;
}

export interface DroneSnapshot {
  id: string;
  name: string;
  adapter: AdapterType;
  lastTelemetry?: DroneTelemetry;
}
