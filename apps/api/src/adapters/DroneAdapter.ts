import type { DroneCommandType, MissionWaypoint } from "@sgcx/shared-types";
import type { AdapterType } from "@sgcx/shared-types";
import type { DroneTelemetry } from "@sgcx/shared-types";

export interface AdapterDroneRegistration {
  id: string;
  name: string;
  adapter: AdapterType;
  homeLat: number;
  homeLon: number;
  homeAlt: number;
}

export interface DroneAdapter {
  readonly adapterType: AdapterType;
  registerDrone(drone: AdapterDroneRegistration): void;
  removeDrone(droneId: string): void;
  updateHome(droneId: string, homeLat: number, homeLon: number, homeAlt: number): void;
  sendCommand(droneId: string, type: DroneCommandType, params?: Record<string, unknown>): void;
  uploadMission(droneId: string, missionId: string, name: string, waypoints: MissionWaypoint[]): void;
  setKillSwitch(enabled: boolean): void;
  setGeofences(geofences: Array<{ id: string; polygon: Array<{ lat: number; lon: number }>; isActive: boolean }>): void;
  setSwarmMembers?(members: Map<string, string>): void;
  tick(dtSeconds: number, nowMs: number): {
    telemetry: Array<{ droneId: string; payload: DroneTelemetry }>;
    alerts: Array<{ droneId: string; severity: "info" | "warning" | "critical"; message: string; timestamp: string }>;
  };
}
