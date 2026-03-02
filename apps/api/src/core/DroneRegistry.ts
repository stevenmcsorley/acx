import type { AdapterType, DroneCommandType, MissionWaypoint } from "@sgcx/shared-types";
import type { AdapterDroneRegistration, DroneAdapter } from "../adapters/DroneAdapter";

export class DroneRegistry {
  private readonly adapters = new Map<AdapterType, DroneAdapter>();
  private readonly droneAdapter = new Map<string, AdapterType>();

  constructor(adapters: DroneAdapter[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.adapterType, adapter);
    }
  }

  registerDrone(drone: AdapterDroneRegistration): void {
    const adapter = this.adapters.get(drone.adapter);
    if (!adapter) {
      throw new Error(`Adapter ${drone.adapter} is not available`);
    }

    adapter.registerDrone(drone);
    this.droneAdapter.set(drone.id, drone.adapter);
  }

  removeDrone(droneId: string): void {
    const adapter = this.adapterForDrone(droneId);
    adapter.removeDrone(droneId);
    this.droneAdapter.delete(droneId);
  }

  updateHome(droneId: string, homeLat: number, homeLon: number, homeAlt: number): void {
    const adapter = this.adapterForDrone(droneId);
    adapter.updateHome(droneId, homeLat, homeLon, homeAlt);
  }

  sendCommand(droneId: string, type: DroneCommandType, params?: Record<string, unknown>): void {
    const adapter = this.adapterForDrone(droneId);
    adapter.sendCommand(droneId, type, params);
  }

  uploadMission(droneId: string, missionId: string, name: string, waypoints: MissionWaypoint[]): void {
    const adapter = this.adapterForDrone(droneId);
    adapter.uploadMission(droneId, missionId, name, waypoints);
  }

  setKillSwitch(enabled: boolean): void {
    for (const adapter of this.adapters.values()) {
      adapter.setKillSwitch(enabled);
    }
  }

  setGeofences(geofences: Array<{ id: string; polygon: Array<{ lat: number; lon: number }>; isActive: boolean }>): void {
    for (const adapter of this.adapters.values()) {
      adapter.setGeofences(geofences);
    }
  }

  setSwarmMembers(members: Map<string, string>): void {
    for (const adapter of this.adapters.values()) {
      adapter.setSwarmMembers?.(members);
    }
  }

  tick(dtSeconds: number, nowMs: number): {
    telemetry: Array<{ droneId: string; payload: unknown }>;
    alerts: Array<{ droneId: string; severity: "info" | "warning" | "critical"; message: string; timestamp: string }>;
  } {
    const telemetry: Array<{ droneId: string; payload: unknown }> = [];
    const alerts: Array<{ droneId: string; severity: "info" | "warning" | "critical"; message: string; timestamp: string }> = [];

    for (const adapter of this.adapters.values()) {
      const result = adapter.tick(dtSeconds, nowMs);
      telemetry.push(...result.telemetry);
      alerts.push(...result.alerts);
    }

    return { telemetry, alerts };
  }

  private adapterForDrone(droneId: string): DroneAdapter {
    const adapterType = this.droneAdapter.get(droneId);
    if (!adapterType) {
      throw new Error(`No adapter bound for drone ${droneId}`);
    }

    const adapter = this.adapters.get(adapterType);
    if (!adapter) {
      throw new Error(`Adapter ${adapterType} is unavailable`);
    }

    return adapter;
  }
}
