import type { DroneAdapter, AdapterDroneRegistration } from "./DroneAdapter";
import type { DroneCommandType, DroneTelemetry, MissionWaypoint, AdapterType } from "@sgcx/shared-types";

/**
 * DJI Adapter Stub
 *
 * DJI drone integration requires the DJI Mobile SDK (iOS/Android) or
 * DJI Onboard SDK (C++). This adapter serves as a documented integration
 * point for bridging DJI SDK commands to the SGC-X platform.
 *
 * Integration approach:
 * 1. A mobile companion app (or onboard computer) runs the DJI SDK
 * 2. The companion connects to SGC-X API via WebSocket/REST
 * 3. SGC-X sends commands to this adapter, which forwards them to the
 *    companion app via a dedicated WebSocket channel
 * 4. The companion translates commands to DJI SDK calls
 * 5. Telemetry flows back through the same WebSocket channel
 *
 * Required DJI SDK capabilities:
 * - DJIFlightController for arm/disarm/takeoff/land
 * - DJIMissionControl for waypoint missions
 * - DJIBattery for battery status
 * - DJICamera for video feed
 * - DJIRemoteController for signal strength
 *
 * TODO: Implement WebSocket bridge protocol
 * TODO: Implement DJI Mobile SDK companion app
 * TODO: Add DJI developer key configuration
 */
export class DJIAdapter implements DroneAdapter {
  readonly adapterType: AdapterType = "dji";

  registerDrone(_drone: AdapterDroneRegistration): void {
    throw new Error(
      "DJI adapter is not yet implemented. DJI integration requires a companion mobile app " +
      "running the DJI Mobile SDK. See DJIAdapter.ts for integration documentation."
    );
  }

  removeDrone(_droneId: string): void {
    throw new Error("DJI adapter is not yet implemented");
  }

  updateHome(_droneId: string, _homeLat: number, _homeLon: number, _homeAlt: number): void {
    throw new Error("DJI adapter is not yet implemented");
  }

  sendCommand(_droneId: string, _type: DroneCommandType, _params?: Record<string, unknown>): void {
    throw new Error("DJI adapter is not yet implemented");
  }

  uploadMission(_droneId: string, _missionId: string, _name: string, _waypoints: MissionWaypoint[]): void {
    throw new Error("DJI adapter is not yet implemented");
  }

  setKillSwitch(_enabled: boolean): void {
    // DJI kill switch would trigger emergency motor stop via DJIFlightController
  }

  setGeofences(_geofences: Array<{ id: string; polygon: Array<{ lat: number; lon: number }>; isActive: boolean }>): void {
    // DJI has built-in GeoFencing (DJI FlySafe). Custom geofences would be
    // enforced at the SGC-X level by monitoring telemetry and issuing RTL.
  }

  tick(): {
    telemetry: Array<{ droneId: string; payload: DroneTelemetry }>;
    alerts: Array<{ droneId: string; severity: "info" | "warning" | "critical"; message: string; timestamp: string }>;
  } {
    return { telemetry: [], alerts: [] };
  }
}
