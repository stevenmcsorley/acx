import type { DroneCommandType, DroneTelemetry, MissionWaypoint } from "@sgcx/shared-types";
import { CollisionEngine } from "../simulation/CollisionEngine";
import { PhysicsEngine } from "../simulation/PhysicsEngine";
import type { SimDroneState, SimGeofence } from "../simulation/types";
import { WindModel } from "../simulation/WindModel";
import { clamp, vectorMagnitude } from "../simulation/geo";
import type { DroneAdapter, AdapterDroneRegistration } from "./DroneAdapter";
import type { AdapterType } from "@sgcx/shared-types";

export class MockDroneAdapter implements DroneAdapter {
  readonly adapterType: AdapterType = "mock";

  private readonly drones = new Map<string, SimDroneState>();
  private readonly queuedAlerts: Array<{
    droneId: string;
    severity: "info" | "warning" | "critical";
    message: string;
    timestamp: string;
  }> = [];
  private readonly physicsEngine = new PhysicsEngine();
  private readonly collisionEngine = new CollisionEngine(8, 20);
  private readonly windModel = new WindModel();
  private geofences: SimGeofence[] = [];
  private killSwitchEnabled = false;
  private swarmMembers = new Map<string, string>();

  constructor(private readonly maxDrones: number) {}

  registerDrone(drone: AdapterDroneRegistration): void {
    if (this.drones.size >= this.maxDrones && !this.drones.has(drone.id)) {
      throw new Error(`Simulation capacity exceeded (${this.maxDrones})`);
    }

    this.drones.set(drone.id, {
      id: drone.id,
      name: drone.name,
      homeLat: drone.homeLat,
      homeLon: drone.homeLon,
      homeAlt: drone.homeAlt,
      lat: drone.homeLat,
      lon: drone.homeLon,
      alt: 0,
      vNorth: 0,
      vEast: 0,
      vUp: 0,
      heading: 0,
      batteryPct: 100,
      signalPct: 100,
      flightState: "grounded",
      mode: "standby",
      wind: { x: 0, y: 0, z: 0, speed: 0 },
      collisionFlag: false,
      geofenceViolation: false,
      targetAltitude: 30,
      lastAlertAt: {},
      cameraPitch: 0,
      fpvYaw: 0,
      fpvZoom: 1
    });
  }

  removeDrone(droneId: string): void {
    if (!this.drones.delete(droneId)) {
      throw new Error(`Drone ${droneId} is not registered in mock adapter`);
    }
  }

  updateHome(droneId: string, homeLat: number, homeLon: number, homeAlt: number): void {
    const drone = this.drones.get(droneId);
    if (!drone) {
      throw new Error(`Drone ${droneId} is not registered in mock adapter`);
    }

    drone.homeLat = homeLat;
    drone.homeLon = homeLon;
    drone.homeAlt = homeAlt;

    if (drone.flightState === "grounded" || drone.flightState === "armed") {
      drone.lat = homeLat;
      drone.lon = homeLon;
      drone.alt = 0;
      drone.vNorth = 0;
      drone.vEast = 0;
      drone.vUp = 0;
    }

    this.queuedAlerts.push({
      droneId: drone.id,
      severity: "info",
      message: `${drone.id}: home updated to ${homeLat.toFixed(5)}, ${homeLon.toFixed(5)} @ ${Math.round(homeAlt)}m`,
      timestamp: new Date().toISOString()
    });
  }

  sendCommand(droneId: string, type: DroneCommandType, params?: Record<string, unknown>): void {
    const drone = this.drones.get(droneId);
    if (!drone) {
      throw new Error(`Drone ${droneId} is not registered in mock adapter`);
    }

    switch (type) {
      case "arm": {
        if (drone.flightState === "grounded") {
          drone.flightState = "armed";
          drone.mode = "armed";
          drone.manualControl = undefined;
        }
        break;
      }
      case "disarm": {
        if (drone.flightState === "grounded" || drone.flightState === "armed") {
          drone.flightState = "grounded";
          drone.mode = "standby";
          drone.manualControl = undefined;
          drone.manualTarget = undefined;
          drone.mission = undefined;
        }
        break;
      }
      case "takeoff": {
        const altitude = Number(params?.altitude ?? 30);
        drone.targetAltitude = clamp(altitude, 5, 300);
        if (drone.flightState === "grounded" || drone.flightState === "armed") {
          drone.flightState = "taking_off";
          drone.mode = "takeoff";
          drone.manualControl = undefined;
        }
        break;
      }
      case "land": {
        if (drone.flightState !== "grounded") {
          drone.flightState = "landing";
          drone.mode = "landing";
          drone.manualControl = undefined;
          drone.mission = undefined;
          drone.manualTarget = undefined;
        }
        break;
      }
      case "rtl": {
        if (drone.flightState !== "grounded") {
          drone.flightState = "rtl";
          drone.mode = "rtl";
          drone.manualControl = undefined;
          drone.mission = undefined;
          drone.manualTarget = undefined;
        }
        break;
      }
      case "manualControl": {
        const forward = clamp(Number(params?.forward ?? 0), -24, 24);
        const right = clamp(Number(params?.right ?? 0), -24, 24);
        const up = clamp(Number(params?.up ?? 0), -8, 8);
        const yawRate = clamp(Number(params?.yawRate ?? 0), -220, 220);
        const nowMs = Number(params?.nowMs ?? Date.now());

        if (![forward, right, up, yawRate, nowMs].every((value) => Number.isFinite(value))) {
          throw new Error("manualControl requires numeric forward/right/up/yawRate");
        }

        drone.mission = undefined;
        drone.manualTarget = undefined;
        drone.manualControl = {
          forward,
          right,
          up,
          yawRate,
          lastInputMs: nowMs
        };

        if (drone.flightState === "grounded" || drone.flightState === "armed") {
          drone.targetAltitude = Math.max(drone.targetAltitude, 20);
          drone.flightState = "taking_off";
        } else if (drone.flightState !== "rtl") {
          drone.flightState = "airborne";
        }

        drone.mode = "manual-stick";
        break;
      }
      case "setWaypoint": {
        const lat = Number(params?.lat);
        const lon = Number(params?.lon);
        const alt = Number(params?.alt ?? drone.targetAltitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          throw new Error("setWaypoint requires numeric lat/lon");
        }

        // Manual input must immediately take over from mission autopilot.
        drone.manualControl = undefined;
        drone.mission = undefined;
        drone.manualTarget = { lat, lon, alt: clamp(alt, 5, 500) };

        // Apply heading override if provided
        if (params?.heading !== undefined) {
          drone.targetHeading = Number(params.heading);
          drone.headingMode = (params.headingMode as typeof drone.headingMode) ?? "absolute";
        } else {
          drone.targetHeading = undefined;
          drone.headingMode = "velocity";
        }

        if (drone.flightState === "grounded" || drone.flightState === "armed") {
          drone.flightState = "taking_off";
          drone.mode = "manual-nav";
        } else {
          drone.flightState = "airborne";
          drone.mode = "manual-nav";
        }
        break;
      }
      case "setSwarmTarget": {
        const lat = Number(params?.lat);
        const lon = Number(params?.lon);
        const alt = Number(params?.alt ?? drone.targetAltitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          throw new Error("setSwarmTarget requires numeric lat/lon");
        }

        // Swarm override must not cancel the active mission. It temporarily
        // steers the leader/follower until the runner clears the override.
        drone.manualControl = undefined;
        drone.manualTarget = { lat, lon, alt: clamp(alt, 5, 500) };

        // Apply heading override if provided
        if (params?.heading !== undefined) {
          drone.targetHeading = Number(params.heading);
          drone.headingMode = (params.headingMode as typeof drone.headingMode) ?? "absolute";
        }

        if (drone.flightState === "grounded" || drone.flightState === "armed") {
          drone.flightState = "taking_off";
          drone.mode = "swarm-nav";
        } else {
          drone.flightState = "airborne";
          drone.mode = "swarm-nav";
        }
        break;
      }
      case "clearSwarmTarget": {
        drone.manualTarget = undefined;
        if (drone.mission) {
          drone.mode = `mission-wp-${drone.mission.index + 1}/${drone.mission.waypoints.length}`;
        } else if (drone.flightState === "airborne") {
          drone.mode = "loiter";
        }
        break;
      }
      case "uploadMission": {
        throw new Error("Use uploadMission channel for mission payloads");
      }
      default:
        throw new Error(`Command ${type} is not supported by mock adapter`);
    }
  }

  uploadMission(droneId: string, missionId: string, name: string, waypoints: MissionWaypoint[]): void {
    const drone = this.drones.get(droneId);
    if (!drone) {
      throw new Error(`Drone ${droneId} is not registered in mock adapter`);
    }

    if (waypoints.length === 0) {
      throw new Error("Mission must include at least one waypoint");
    }

    drone.manualControl = undefined;
    drone.manualTarget = undefined;
    drone.mission = {
      id: missionId,
      name,
      waypoints,
      index: 0
    };
    drone.mode = `mission-wp-1/${waypoints.length}`;
    this.queuedAlerts.push({
      droneId: drone.id,
      severity: "info",
      message: `${drone.id}: mission "${name}" started (${waypoints.length} waypoints)`,
      timestamp: new Date().toISOString()
    });

    const firstAltitude = waypoints[0]?.alt ?? drone.targetAltitude;
    drone.targetAltitude = clamp(firstAltitude, 5, 500);

    if (drone.flightState === "grounded" || drone.flightState === "armed") {
      drone.flightState = "taking_off";
    } else if (drone.flightState !== "rtl") {
      drone.flightState = "airborne";
    }
  }

  setKillSwitch(enabled: boolean): void {
    this.killSwitchEnabled = enabled;
  }

  setGeofences(geofences: Array<{ id: string; polygon: Array<{ lat: number; lon: number }>; isActive: boolean }>): void {
    this.geofences = geofences.map((f) => ({ id: f.id, polygon: f.polygon, isActive: f.isActive }));
  }

  setSwarmMembers(members: Map<string, string>): void {
    this.swarmMembers = members;
  }

  tick(dtSeconds: number, nowMs: number): {
    telemetry: Array<{ droneId: string; payload: DroneTelemetry }>;
    alerts: Array<{ droneId: string; severity: "info" | "warning" | "critical"; message: string; timestamp: string }>;
  } {
    const telemetry: Array<{ droneId: string; payload: DroneTelemetry }> = [];
    const alerts: Array<{ droneId: string; severity: "info" | "warning" | "critical"; message: string; timestamp: string }> = [];

    for (const drone of this.drones.values()) {
      drone.wind = this.windModel.sample(nowMs, drone.id);
      drone.collisionFlag = false;

      const physicsAlerts = this.physicsEngine.updateDrone(drone, dtSeconds, nowMs, this.geofences, this.killSwitchEnabled);
      for (const alert of physicsAlerts) {
        alerts.push({
          droneId: drone.id,
          severity: alert.severity,
          message: alert.message,
          timestamp: new Date(nowMs).toISOString()
        });
      }
    }

    const collisionResult = this.collisionEngine.detect([...this.drones.values()], this.swarmMembers);
    for (const droneId of collisionResult.collisions) {
      const drone = this.drones.get(droneId);
      if (!drone) {
        continue;
      }

      drone.collisionFlag = true;
      const vector = collisionResult.avoidanceVectors.get(droneId);
      if (vector) {
        // Apply avoidance as a direct velocity nudge scaled by dt.
        drone.vNorth += vector.north * dtSeconds * 2.5;
        drone.vEast += vector.east * dtSeconds * 2.5;
      }

      const lastCollisionAlert = drone.lastAlertAt.collision ?? 0;
      if (nowMs - lastCollisionAlert > 2_000) {
        drone.lastAlertAt.collision = nowMs;
        alerts.push({
          droneId: drone.id,
          severity: "warning",
          message: `${drone.id}: collision risk, evasive vector applied`,
          timestamp: new Date(nowMs).toISOString()
        });
      }
    }

    for (const drone of this.drones.values()) {
      const speed = vectorMagnitude(drone.vEast, drone.vNorth, drone.vUp);

      telemetry.push({
        droneId: drone.id,
        payload: {
          timestamp: new Date(nowMs).toISOString(),
          position: {
            lat: drone.lat,
            lon: drone.lon,
            alt: drone.alt
          },
          heading: drone.heading,
          velocity: {
            x: drone.vEast,
            y: drone.vNorth,
            z: drone.vUp,
            speed
          },
          batteryPct: drone.batteryPct,
          signalPct: drone.signalPct,
          flightState: drone.flightState,
          wind: drone.wind,
          collisionFlag: drone.collisionFlag,
          geofenceViolation: drone.geofenceViolation,
          mode: drone.mode,
          camera: {
            cameraPitch: drone.cameraPitch,
            fpvYaw: drone.fpvYaw,
            fpvZoom: drone.fpvZoom
          }
        }
      });
    }

    return { telemetry, alerts: [...this.queuedAlerts.splice(0), ...alerts] };
  }
}
