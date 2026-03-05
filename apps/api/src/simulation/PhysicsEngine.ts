import type { DroneFlightState, MissionWaypoint } from "@sgcx/shared-types";
import { BatteryModel } from "./BatteryModel";
import {
  bearingDeg,
  clamp,
  haversineMeters,
  insidePolygon,
  localMetersFromLatLon,
  offsetLatLon,
  shortestTurnDegrees,
  vectorMagnitude
} from "./geo";
import type { SimDroneState, SimGeofence } from "./types";

export interface PhysicsAlert {
  severity: "info" | "warning" | "critical";
  message: string;
}

export class PhysicsEngine {
  // Tuned to a fast but still plausible civilian/custom multirotor envelope.
  private readonly maxSpeed = 22.35;
  private readonly maxAccel = 7;
  private readonly maxTurnRateDeg = 95;
  private readonly maxClimbRate = 7;
  private readonly maxDescentRate = 6;
  private readonly batteryModel = new BatteryModel();

  updateDrone(
    drone: SimDroneState,
    dtSeconds: number,
    nowMs: number,
    geofences: SimGeofence[],
    killSwitchEnabled: boolean
  ): PhysicsAlert[] {
    const alerts: PhysicsAlert[] = [];

    if (killSwitchEnabled && drone.flightState !== "grounded") {
      drone.flightState = "emergency";
      drone.mode = "kill-switch";
    }

    // Keep grounded/armed drones fixed at home with zero drift. Recharge battery.
    if (drone.flightState === "grounded" || drone.flightState === "armed") {
      drone.lat = drone.homeLat;
      drone.lon = drone.homeLon;
      drone.alt = 0;
      drone.vNorth = 0;
      drone.vEast = 0;
      drone.vUp = 0;
      drone.signalPct = 100;
      drone.geofenceViolation = false;
      drone.batteryPct = this.batteryModel.recharge(drone.batteryPct, dtSeconds);
      return alerts;
    }

    const manualControl = this.activeManualControl(drone, nowMs);
    if (!manualControl) {
      this.updateMissionState(drone, nowMs, alerts);
    }

    if (manualControl) {
      // Manual stick mode uses much higher acceleration for snappy response.
      const accelLimit = this.maxAccel * 3.5;
      const yawStep = clamp(manualControl.yawRate, -220, 220) * dtSeconds;
      drone.heading = (drone.heading + yawStep + 360) % 360;

      const headingRad = (drone.heading * Math.PI) / 180;
      const desiredNorth = Math.cos(headingRad) * manualControl.forward - Math.sin(headingRad) * manualControl.right;
      const desiredEast = Math.sin(headingRad) * manualControl.forward + Math.cos(headingRad) * manualControl.right;
      const desiredUp = clamp(manualControl.up, -this.maxDescentRate * 1.5, this.maxClimbRate * 1.5);

      drone.vNorth = this.approachValue(drone.vNorth, desiredNorth, accelLimit * dtSeconds);
      drone.vEast = this.approachValue(drone.vEast, desiredEast, accelLimit * dtSeconds);
      drone.vUp = this.approachValue(drone.vUp, desiredUp, accelLimit * dtSeconds);
    } else {
      const target = this.resolveTarget(drone);
      if (target) {
      const isManualNav = drone.mode === "manual-nav" && !drone.mission;
      const isMissionTransit = Boolean(drone.mission && !drone.manualTarget);
      const turnRateLimitDeg = isManualNav ? this.maxTurnRateDeg * 2.2 : this.maxTurnRateDeg;
      const accelLimit = isManualNav ? this.maxAccel * 1.35 : this.maxAccel;
      const bearing = bearingDeg(drone.lat, drone.lon, target.lat, target.lon);

      // Velocity: navigate toward target along bearing (independent of heading)
      const relative = localMetersFromLatLon(drone.lat, drone.lon, target.lat, target.lon);
      const horizontalDistance = vectorMagnitude(relative.north, relative.east);
      const speedCap = isMissionTransit
        ? this.maxSpeed
        : target.speed && target.speed > 0
          ? Math.min(target.speed, this.maxSpeed)
          : this.maxSpeed;
      const desiredSpeed = isMissionTransit
        ? (() => {
            const slowdownDistance = clamp(speedCap * 3, 20, 120);
            if (horizontalDistance >= slowdownDistance) {
              return speedCap;
            }
            return clamp(speedCap * (horizontalDistance / slowdownDistance), 2, speedCap);
          })()
        : clamp(horizontalDistance * (isManualNav ? 0.55 : 0.35), 0, speedCap);
      const bearingRad = (bearing * Math.PI) / 180;
      const desiredNorth = Math.cos(bearingRad) * desiredSpeed;
      const desiredEast = Math.sin(bearingRad) * desiredSpeed;

      drone.vNorth = this.approachValue(drone.vNorth, desiredNorth, accelLimit * dtSeconds);
      drone.vEast = this.approachValue(drone.vEast, desiredEast, accelLimit * dtSeconds);

      // Heading: resolve independently from velocity bearing
      const desiredHeading = isMissionTransit ? bearing : this.resolveDesiredHeading(drone, bearing);
      const headingDelta = shortestTurnDegrees(drone.heading, desiredHeading);
      const headingStep = clamp(headingDelta, -turnRateLimitDeg * dtSeconds, turnRateLimitDeg * dtSeconds);
      drone.heading = (drone.heading + headingStep + 360) % 360;

      const altDiff = target.alt - drone.alt;
      const altitudeDeadband = 0.6;
      const desiredVUp = Math.abs(altDiff) <= altitudeDeadband
        ? 0
        : clamp((altDiff * 0.45) - (drone.vUp * 0.35), -this.maxDescentRate, this.maxClimbRate);
      const verticalAccelLimit = accelLimit * 0.6;
      drone.vUp = this.approachValue(drone.vUp, desiredVUp, verticalAccelLimit * dtSeconds);
      } else {
        drone.vNorth = this.approachValue(drone.vNorth, 0, this.maxAccel * dtSeconds);
        drone.vEast = this.approachValue(drone.vEast, 0, this.maxAccel * dtSeconds);
        drone.vUp = this.approachValue(drone.vUp, 0, this.maxAccel * dtSeconds);
      }
    }

    // Smoothly interpolate camera state toward waypoint targets
    this.updateCameraState(drone, dtSeconds);

    // Reduce wind influence during manual stick control for tighter feel.
    const windFactor = manualControl ? 0.04 : 0.15;
    const windVertFactor = manualControl ? 0.005 : 0.02;
    drone.vNorth += drone.wind.y * windFactor;
    drone.vEast += drone.wind.x * windFactor;
    drone.vUp += drone.wind.z * windVertFactor;

    const next = offsetLatLon(drone.lat, drone.lon, drone.vNorth * dtSeconds, drone.vEast * dtSeconds);
    drone.lat = next.lat;
    drone.lon = next.lon;
    drone.alt = Math.max(0, drone.alt + drone.vUp * dtSeconds);

    const speed = vectorMagnitude(drone.vNorth, drone.vEast, drone.vUp);
    drone.batteryPct = this.batteryModel.drain(drone.batteryPct, speed, drone.vUp, dtSeconds);

    const distanceFromHome = haversineMeters(drone.homeLat, drone.homeLon, drone.lat, drone.lon);
    // Signal budget targets roughly 20km practical range before forced RTL at typical mission altitudes.
    const signal = 100 - distanceFromHome / 215 - drone.alt / 600;
    drone.signalPct = clamp(signal, 0, 100);

    if (drone.batteryPct <= 0) {
      drone.flightState = "emergency";
      drone.mode = "battery-depleted";
      drone.manualControl = undefined;
      this.pushAlert(alerts, drone, nowMs, "battery-depleted", 0, "critical", `${drone.id}: battery depleted, emergency landing`);
    } else if (drone.batteryPct < 12 && drone.flightState !== "landing" && drone.flightState !== "rtl") {
      drone.flightState = "rtl";
      drone.mode = "rtl-low-battery";
      drone.manualControl = undefined;
      this.pushAlert(alerts, drone, nowMs, "battery-low", 8_000, "warning", `${drone.id}: low battery, initiating RTL`);
    }

    if (drone.signalPct < 6 && ["airborne", "rtl", "taking_off"].includes(drone.flightState)) {
      drone.flightState = "rtl";
      drone.mode = "rtl-low-signal";
      drone.manualControl = undefined;
      this.pushAlert(alerts, drone, nowMs, "signal-low", 8_000, "warning", `${drone.id}: low signal, initiating RTL`);
    }

    this.abortMissionIfEnergyInsufficient(drone, nowMs, alerts);

    if (drone.flightState === "taking_off" && drone.alt >= drone.targetAltitude - 0.8) {
      drone.flightState = "airborne";
      drone.mode = drone.mission ? `mission-wp-${drone.mission.index + 1}/${drone.mission.waypoints.length}` : "loiter";
    }

    if ((drone.flightState === "landing" || drone.flightState === "emergency") && drone.alt <= 0.2) {
      drone.flightState = "grounded";
      drone.mode = "grounded";
      drone.vNorth = 0;
      drone.vEast = 0;
      drone.vUp = 0;
      drone.alt = 0;
      drone.manualControl = undefined;
      drone.manualTarget = undefined;
      drone.mission = undefined;
      if (drone.pendingMissionCompletion) {
        this.pushAlert(
          alerts,
          drone,
          nowMs,
          `mission-success-${drone.pendingMissionCompletion.missionId}`,
          0,
          "info",
          `${drone.id}: mission successful, landed at home`
        );
        drone.pendingMissionCompletion = undefined;
      }
    }

    if (drone.flightState === "rtl" && distanceFromHome < 5 && drone.alt < 4) {
      drone.flightState = "landing";
      drone.mode = "rtl-landing";
    }

    const activeGeofences = geofences.filter((f) => f.isActive);
    if (activeGeofences.length > 0 && drone.flightState !== "grounded") {
      const insideAny = activeGeofences.some((f) => insidePolygon(drone.lat, drone.lon, f.polygon));
      drone.geofenceViolation = !insideAny;

      if (!insideAny) {
        drone.flightState = "rtl";
        drone.mode = "rtl-geofence";
        drone.manualControl = undefined;
        this.pushAlert(alerts, drone, nowMs, "geofence", 5_000, "warning", `${drone.id}: geofence breach detected`);
      }
    } else {
      drone.geofenceViolation = false;
    }

    return alerts;
  }

  private activeManualControl(drone: SimDroneState, nowMs: number):
    | {
        forward: number;
        right: number;
        up: number;
        yawRate: number;
        lastInputMs: number;
      }
    | undefined {
    const input = drone.manualControl;
    if (!input) {
      return undefined;
    }

    if (nowMs - input.lastInputMs <= 2000) {
      return input;
    }

    drone.manualControl = undefined;
    if (drone.mode === "manual-stick" && !drone.mission && !drone.manualTarget) {
      drone.mode = "loiter";
    }
    return undefined;
  }

  private abortMissionIfEnergyInsufficient(drone: SimDroneState, nowMs: number, alerts: PhysicsAlert[]): void {
    if (!drone.mission) {
      return;
    }

    if (!["taking_off", "airborne"].includes(drone.flightState)) {
      return;
    }

    const requiredPct = this.estimateRemainingMissionBatteryPct(drone, nowMs);
    const reservePct = 10;
    const requiredWithReserve = requiredPct + reservePct;
    if (drone.batteryPct > requiredWithReserve) {
      return;
    }

    drone.flightState = "rtl";
    drone.mode = "rtl-mission-energy";
    drone.mission = undefined;
    this.pushAlert(
      alerts,
      drone,
      nowMs,
      "mission-energy",
      12_000,
      "warning",
      `${drone.id}: battery forecast insufficient (${Math.round(drone.batteryPct)}% < ${Math.round(
        requiredWithReserve
      )}%), aborting mission and returning to launch`
    );
  }

  private estimateRemainingMissionBatteryPct(drone: SimDroneState, nowMs: number): number {
    const mission = drone.mission;
    if (!mission || mission.index >= mission.waypoints.length) {
      const homeDistance = haversineMeters(drone.lat, drone.lon, drone.homeLat, drone.homeLon);
      return this.estimateTravelDrain(homeDistance, 0);
    }

    let distanceMeters = 0;
    let fromLat = drone.lat;
    let fromLon = drone.lon;
    for (let i = mission.index; i < mission.waypoints.length; i += 1) {
      const wp = mission.waypoints[i];
      distanceMeters += haversineMeters(fromLat, fromLon, wp.lat, wp.lon);
      fromLat = wp.lat;
      fromLon = wp.lon;
    }
    distanceMeters += haversineMeters(fromLat, fromLon, drone.homeLat, drone.homeLon);

    let hoverSeconds = 0;
    if (mission.hoverUntilMs) {
      hoverSeconds += Math.max(0, (mission.hoverUntilMs - nowMs) / 1000);
      for (let i = mission.index + 1; i < mission.waypoints.length; i += 1) {
        hoverSeconds += Math.max(0, mission.waypoints[i].hover);
      }
    } else {
      for (let i = mission.index; i < mission.waypoints.length; i += 1) {
        hoverSeconds += Math.max(0, mission.waypoints[i].hover);
      }
    }

    return this.estimateTravelDrain(distanceMeters, hoverSeconds);
  }

  private estimateTravelDrain(distanceMeters: number, hoverSeconds: number): number {
    const cruiseSpeed = Math.max(10, this.maxSpeed * 0.62);
    const travelSeconds = distanceMeters / cruiseSpeed;
    // Match the updated BatteryModel drain rates.
    const drainPerSec = 0.006 + cruiseSpeed * 0.0008 + 0.0003;
    return drainPerSec * (travelSeconds + hoverSeconds) + 1.5;
  }

  private updateMissionState(drone: SimDroneState, nowMs: number, alerts: PhysicsAlert[]): void {
    if (!drone.mission || drone.mission.index >= drone.mission.waypoints.length) {
      return;
    }

    if (drone.mode === "swarm-nav" && drone.manualTarget) {
      return;
    }

    drone.mode = `mission-wp-${drone.mission.index + 1}/${drone.mission.waypoints.length}`;

    const waypoint = drone.mission.waypoints[drone.mission.index];
    const distance = haversineMeters(drone.lat, drone.lon, waypoint.lat, waypoint.lon);
    const altDistance = Math.abs(drone.alt - waypoint.alt);

    const horizontalSpeed = vectorMagnitude(drone.vNorth, drone.vEast);
    const curveBonus =
      this.canSmoothTurn(drone.mission.waypoints, drone.mission.index) ? clamp((waypoint.curveSize ?? 0) * 0.4, 0, 36) : 0;
    const acceptanceRadius = clamp(8 + horizontalSpeed * 1.25 + curveBonus, 8, 60);
    const altitudeWindow = clamp(3 + Math.abs(drone.vUp) * 0.4, 3, 8);

    if (!drone.mission.hoverUntilMs && distance <= acceptanceRadius && altDistance <= altitudeWindow) {
      drone.mission.hoverUntilMs = nowMs + waypoint.hover * 1000;
      this.pushAlert(
        alerts,
        drone,
        nowMs,
        `mission-wp-reached-${drone.mission.id}-${drone.mission.index}`,
        0,
        "info",
        `${drone.id}: reached waypoint ${drone.mission.index + 1}/${drone.mission.waypoints.length}, hover ${Math.round(waypoint.hover)}s`
      );
    }

    if (drone.mission.hoverUntilMs && nowMs >= drone.mission.hoverUntilMs) {
      drone.mission.index += 1;
      drone.mission.hoverUntilMs = undefined;

      if (drone.mission.index >= drone.mission.waypoints.length) {
        this.pushAlert(
          alerts,
          drone,
          nowMs,
          `mission-route-complete-${drone.mission.id}`,
          0,
          "info",
          `${drone.id}: route complete, returning to launch`
        );
        drone.pendingMissionCompletion = {
          missionId: drone.mission.id,
          missionName: drone.mission.name
        };
        drone.mission = undefined;
        drone.flightState = "rtl";
        drone.mode = "route-complete-rtl";
      } else {
        drone.mode = `mission-wp-${drone.mission.index + 1}/${drone.mission.waypoints.length}`;
      }
    }
  }

  private canSmoothTurn(waypoints: MissionWaypoint[], index: number): boolean {
    const waypoint = waypoints[index];
    const next = waypoints[index + 1];
    return Boolean(
      waypoint &&
      next &&
      (waypoint.curveSize ?? 0) > 0 &&
      waypoint.hover <= 0 &&
      !waypoint.swarmTrigger &&
      waypoint.cameraPitch === undefined &&
      waypoint.heading === undefined &&
      waypoint.cameraViewMode === undefined
    );
  }

  private resolveMissionTarget(
    drone: SimDroneState,
    index: number
  ): { lat: number; lon: number; alt: number; speed?: number } {
    const mission = drone.mission!;
    const waypoint = mission.waypoints[index];
    const next = mission.waypoints[index + 1];

    if (!this.canSmoothTurn(mission.waypoints, index) || !next) {
      return { lat: waypoint.lat, lon: waypoint.lon, alt: waypoint.alt, speed: waypoint.speed };
    }

    const distanceToWaypoint = haversineMeters(drone.lat, drone.lon, waypoint.lat, waypoint.lon);
    const curveMeters = clamp(waypoint.curveSize ?? 0, 0, 220);
    const lookaheadDistance = Math.min(curveMeters, haversineMeters(waypoint.lat, waypoint.lon, next.lat, next.lon) * 0.35);
    if (lookaheadDistance < 1 || distanceToWaypoint > curveMeters * 3) {
      return { lat: waypoint.lat, lon: waypoint.lon, alt: waypoint.alt, speed: waypoint.speed };
    }

    const outgoing = localMetersFromLatLon(waypoint.lat, waypoint.lon, next.lat, next.lon);
    const outgoingDistance = vectorMagnitude(outgoing.north, outgoing.east);
    if (outgoingDistance < 1) {
      return { lat: waypoint.lat, lon: waypoint.lon, alt: waypoint.alt, speed: waypoint.speed };
    }

    const progress = clamp(1 - distanceToWaypoint / Math.max(curveMeters * 3, 1), 0, 1);
    const advanceMeters = lookaheadDistance * progress;
    const unitNorth = outgoing.north / outgoingDistance;
    const unitEast = outgoing.east / outgoingDistance;
    const offset = offsetLatLon(waypoint.lat, waypoint.lon, unitNorth * advanceMeters, unitEast * advanceMeters);
    const altBlend = outgoingDistance > 0 ? advanceMeters / outgoingDistance : 0;

    return {
      lat: offset.lat,
      lon: offset.lon,
      alt: waypoint.alt + (next.alt - waypoint.alt) * altBlend,
      speed: next.speed ?? waypoint.speed
    };
  }

  private resolveDesiredHeading(drone: SimDroneState, velocityBearing: number): number {
    const mode = drone.headingMode ?? "velocity";
    switch (mode) {
      case "absolute":
        return drone.targetHeading ?? velocityBearing;
      case "poi":
        if (drone.poiTarget) {
          return bearingDeg(drone.lat, drone.lon, drone.poiTarget.lat, drone.poiTarget.lon);
        }
        return velocityBearing;
      case "velocity":
      default:
        // targetHeading in velocity mode = relative offset from travel direction
        if (drone.targetHeading !== undefined) {
          return (velocityBearing + drone.targetHeading + 360) % 360;
        }
        return velocityBearing;
    }
  }

  private updateCameraState(drone: SimDroneState, dtSeconds: number): void {
    const rate = 90; // degrees/sec
    if (drone.targetCameraPitch !== undefined) {
      const d = drone.targetCameraPitch - drone.cameraPitch;
      drone.cameraPitch += clamp(d, -rate * dtSeconds, rate * dtSeconds);
    }
    if (drone.targetFpvYaw !== undefined) {
      const d = shortestTurnDegrees(drone.fpvYaw, drone.targetFpvYaw);
      drone.fpvYaw += clamp(d, -rate * dtSeconds, rate * dtSeconds);
    }
    if (drone.targetFpvZoom !== undefined) {
      const d = drone.targetFpvZoom - drone.fpvZoom;
      drone.fpvZoom += clamp(d, -2 * dtSeconds, 2 * dtSeconds);
    }
  }

  private resolveTarget(drone: SimDroneState): { lat: number; lon: number; alt: number; speed?: number } | null {
    const state: DroneFlightState = drone.flightState;

    if (state === "grounded" || state === "armed") {
      return { lat: drone.lat, lon: drone.lon, alt: 0 };
    }

    if (state === "taking_off") {
      return { lat: drone.homeLat, lon: drone.homeLon, alt: drone.targetAltitude };
    }

    if (state === "landing") {
      return { lat: drone.lat, lon: drone.lon, alt: 0 };
    }

    if (state === "emergency") {
      return { lat: drone.homeLat, lon: drone.homeLon, alt: 0 };
    }

    if (state === "rtl") {
      const cruiseAltitude = Math.max(25, drone.targetAltitude);
      const horizontalDistance = haversineMeters(drone.lat, drone.lon, drone.homeLat, drone.homeLon);
      const targetAltitude = horizontalDistance > 20 ? cruiseAltitude : Math.min(cruiseAltitude, 4);
      return { lat: drone.homeLat, lon: drone.homeLon, alt: targetAltitude };
    }

    if (drone.manualTarget) {
      return drone.manualTarget;
    }

    if (drone.mission && drone.mission.index < drone.mission.waypoints.length) {
      return this.resolveMissionTarget(drone, drone.mission.index);
    }

    return { lat: drone.lat, lon: drone.lon, alt: drone.alt };
  }

  private pushAlert(
    alerts: PhysicsAlert[],
    drone: SimDroneState,
    nowMs: number,
    key: string,
    cooldownMs: number,
    severity: "info" | "warning" | "critical",
    message: string
  ): void {
    const last = drone.lastAlertAt[key] ?? 0;
    if (nowMs - last < cooldownMs) {
      return;
    }

    drone.lastAlertAt[key] = nowMs;
    alerts.push({ severity, message });
  }

  private approachValue(current: number, target: number, maxDelta: number): number {
    const delta = target - current;
    if (Math.abs(delta) <= maxDelta) {
      return target;
    }
    return current + Math.sign(delta) * maxDelta;
  }

  /**
   * Compute a smoothed path using Catmull-Rom spline interpolation.
   * Returns interpolated waypoints between input waypoints for smoother turns.
   */
  static computeSmoothedPath(
    waypoints: Array<{ lat: number; lon: number; alt: number }>,
    pointsPerSegment = 8
  ): Array<{ lat: number; lon: number; alt: number }> {
    if (waypoints.length < 2) return [...waypoints];

    const result: Array<{ lat: number; lon: number; alt: number }> = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const p0 = waypoints[Math.max(0, i - 1)];
      const p1 = waypoints[i];
      const p2 = waypoints[i + 1];
      const p3 = waypoints[Math.min(waypoints.length - 1, i + 2)];

      for (let t = 0; t < pointsPerSegment; t++) {
        const s = t / pointsPerSegment;
        result.push({
          lat: PhysicsEngine.catmullRom(p0.lat, p1.lat, p2.lat, p3.lat, s),
          lon: PhysicsEngine.catmullRom(p0.lon, p1.lon, p2.lon, p3.lon, s),
          alt: PhysicsEngine.catmullRom(p0.alt, p1.alt, p2.alt, p3.alt, s)
        });
      }
    }

    // Always include the last waypoint
    result.push(waypoints[waypoints.length - 1]);
    return result;
  }

  private static catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
      (2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  }
}
