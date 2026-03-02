import { offsetLatLon } from "../simulation/geo";
import type { FormationParams } from "./SwarmEngine";
import { SwarmEngine } from "./SwarmEngine";

export type ManeuverType =
  | "hold"
  | "orbit"
  | "expand"
  | "contract"
  | "rotate"
  | "search_grid"
  | "search_spiral"
  | "escort"
  | "perimeter"
  | "corridor";

interface LeaderState {
  lat: number;
  lon: number;
  alt: number;
  heading?: number;
  vNorth?: number;
  vEast?: number;
}

export class ManeuverEngine {
  readonly type: ManeuverType;
  private readonly params: Record<string, unknown>;
  private readonly droneCount: number;
  private readonly swarmEngine = new SwarmEngine();
  private startedAt: number;
  private elapsed = 0;
  progress = 0; // 0-1

  constructor(type: ManeuverType, params: Record<string, unknown>, droneCount: number) {
    this.type = type;
    this.params = params;
    this.droneCount = droneCount;
    this.startedAt = Date.now();
  }

  /**
   * Returns per-drone target positions for this tick, or null if the maneuver is complete.
   */
  tick(
    leader: LeaderState,
    droneIds: string[],
    formationParams: FormationParams,
    dt: number
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> | null {
    this.elapsed += dt;

    switch (this.type) {
      case "hold":
        return this.tickHold(leader, droneIds, formationParams);
      case "orbit":
        return this.tickOrbit(leader, droneIds, formationParams);
      case "expand":
        return this.tickExpand(leader, droneIds, formationParams);
      case "contract":
        return this.tickContract(leader, droneIds, formationParams);
      case "rotate":
        return this.tickRotate(leader, droneIds, formationParams, dt);
      case "search_grid":
        return this.tickSearchGrid(leader, droneIds, formationParams);
      case "search_spiral":
        return this.tickSearchSpiral(leader, droneIds, formationParams);
      case "escort":
        return this.tickEscort(leader, droneIds, formationParams);
      case "perimeter":
        return this.tickPerimeter(leader, droneIds);
      case "corridor":
        return this.tickCorridor(leader, droneIds, formationParams);
      default:
        return null;
    }
  }

  private shouldIncludeLeader(droneIds: string[]): boolean {
    return Boolean(this.params.includeLeader) && droneIds.length > 0;
  }

  private computeFormationTargets(
    anchor: LeaderState,
    droneIds: string[],
    formationParams: FormationParams,
    predictAheadSec = 0
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> {
    if (!this.shouldIncludeLeader(droneIds)) {
      return this.swarmEngine.computeFollowerTargets(anchor, droneIds, formationParams, predictAheadSec);
    }

    const [leaderId, ...followerIds] = droneIds;
    return this.swarmEngine.computeAnchoredFormationTargets(
      anchor,
      leaderId,
      followerIds,
      formationParams,
      predictAheadSec
    );
  }

  private getDurationSec(): number | null {
    const duration = this.params.durationSec as number | undefined;
    return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  private isTimedComplete(): boolean {
    const duration = this.getDurationSec();
    if (duration === null) {
      return false;
    }
    this.progress = Math.min(this.elapsed / duration, 1);
    return this.elapsed >= duration;
  }

  private tickHold(
    leader: LeaderState,
    droneIds: string[],
    formationParams: FormationParams
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> | null {
    if (this.isTimedComplete()) {
      return null;
    }

    const anchor = {
      lat: (this.params.centerLat as number) ?? leader.lat,
      lon: (this.params.centerLon as number) ?? leader.lon,
      alt: (this.params.alt as number) ?? leader.alt,
      heading: leader.heading,
      vNorth: leader.vNorth,
      vEast: leader.vEast
    };

    if (this.getDurationSec() === null) {
      this.progress = 0;
    }

    return this.computeFormationTargets(anchor, droneIds, formationParams, 0);
  }

  private tickOrbit(
    leader: LeaderState,
    droneIds: string[],
    formationParams: FormationParams
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> | null {
    if (this.isTimedComplete()) {
      return null;
    }

    const radius = (this.params.radius as number) ?? formationParams.spacing * 3;
    const speed = (this.params.speed as number) ?? 8; // m/s tangential
    const direction = (this.params.direction as string) === "ccw" ? -1 : 1;
    const centerLat = (this.params.centerLat as number) ?? leader.lat;
    const centerLon = (this.params.centerLon as number) ?? leader.lon;
    const alt = (this.params.alt as number) ?? leader.alt;

    // Angular velocity: omega = v / r
    const omega = speed / Math.max(radius, 1);
    const baseAngle = this.elapsed * omega * direction;

    if (this.getDurationSec() === null) {
      this.progress = (this.elapsed * omega) / (2 * Math.PI) % 1;
    }

    return droneIds.map((droneId, idx) => {
      const angle = baseAngle + (2 * Math.PI * idx) / droneIds.length;
      const pos = offsetLatLon(centerLat, centerLon, Math.cos(angle) * radius, Math.sin(angle) * radius);
      return { droneId, lat: pos.lat, lon: pos.lon, alt };
    });
  }

  private tickExpand(
    leader: LeaderState,
    droneIds: string[],
    formationParams: FormationParams
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> | null {
    const targetSpacing = (this.params.targetSpacing as number) ?? formationParams.spacing * 2;
    const duration = (this.params.duration as number) ?? 10; // seconds
    const t = Math.min(this.elapsed / duration, 1);
    this.progress = t;

    const currentSpacing = formationParams.spacing + (targetSpacing - formationParams.spacing) * this.easeInOut(t);
    const targets = this.computeFormationTargets(
      leader,
      droneIds,
      { ...formationParams, spacing: currentSpacing },
      0.4
    );

    if (t >= 1) return null; // Complete
    return targets;
  }

  private tickContract(
    leader: LeaderState,
    droneIds: string[],
    formationParams: FormationParams
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> | null {
    const targetSpacing = (this.params.targetSpacing as number) ?? Math.max(5, formationParams.spacing * 0.5);
    const duration = (this.params.duration as number) ?? 10;
    const t = Math.min(this.elapsed / duration, 1);
    this.progress = t;

    const currentSpacing = formationParams.spacing + (targetSpacing - formationParams.spacing) * this.easeInOut(t);
    const targets = this.computeFormationTargets(
      leader,
      droneIds,
      { ...formationParams, spacing: currentSpacing },
      0.4
    );

    if (t >= 1) return null;
    return targets;
  }

  private tickRotate(
    leader: LeaderState,
    droneIds: string[],
    formationParams: FormationParams,
    dt: number
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> | null {
    const rotationSpeed = (this.params.rotationSpeed as number) ?? 30; // deg/sec
    const targetHeading = this.params.targetHeading as number | undefined;

    let currentHeading = formationParams.headingDeg + this.elapsed * rotationSpeed;

    if (targetHeading !== undefined) {
      // Rotate toward target heading
      const diff = ((targetHeading - formationParams.headingDeg + 540) % 360) - 180;
      const maxRotation = this.elapsed * rotationSpeed;
      if (Math.abs(diff) <= maxRotation) {
        currentHeading = targetHeading;
        this.progress = 1;
      } else {
        currentHeading = formationParams.headingDeg + Math.sign(diff) * maxRotation;
        this.progress = maxRotation / Math.abs(diff);
      }
    } else {
      // Continuous rotation
      if (this.isTimedComplete()) {
        return null;
      }
      this.progress = (this.elapsed * rotationSpeed / 360) % 1;
    }

    return this.computeFormationTargets(
      leader,
      droneIds,
      { ...formationParams, headingDeg: currentHeading % 360 },
      0.4
    );
  }

  private tickSearchGrid(
    leader: LeaderState,
    droneIds: string[],
    formationParams: FormationParams
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> | null {
    const width = (this.params.width as number) ?? 200; // meters
    const height = (this.params.height as number) ?? 200;
    const speed = (this.params.speed as number) ?? 5; // m/s
    const alt = (this.params.alt as number) ?? leader.alt;
    const centerLat = (this.params.centerLat as number) ?? leader.lat;
    const centerLon = (this.params.centerLon as number) ?? leader.lon;

    // Lawnmower pattern: formation moves as a unit
    const swathWidth = formationParams.spacing * droneIds.length;
    const numPasses = Math.ceil(height / swathWidth);
    const totalDistance = numPasses * width + (numPasses - 1) * swathWidth;
    const distanceCovered = this.elapsed * speed;
    this.progress = Math.min(distanceCovered / totalDistance, 1);

    if (this.progress >= 1) return null;

    // Calculate current position in lawnmower pattern
    let remaining = distanceCovered;
    let pass = 0;
    let x = 0;
    let y = -height / 2;

    while (pass < numPasses && remaining > 0) {
      if (remaining <= width) {
        x = pass % 2 === 0 ? -width / 2 + remaining : width / 2 - remaining;
        y = -height / 2 + pass * swathWidth;
        break;
      }
      remaining -= width;
      if (remaining <= swathWidth && pass < numPasses - 1) {
        x = pass % 2 === 0 ? width / 2 : -width / 2;
        y = -height / 2 + pass * swathWidth + remaining;
        remaining = 0;
        break;
      }
      remaining -= swathWidth;
      pass++;
    }

    // Position formation at the calculated center point
    const center = offsetLatLon(centerLat, centerLon, y, x);
    return this.computeFormationTargets(
      { ...leader, lat: center.lat, lon: center.lon, alt },
      droneIds,
      { ...formationParams, formation: "line_abreast" },
      0
    );
  }

  private tickSearchSpiral(
    leader: LeaderState,
    droneIds: string[],
    formationParams: FormationParams
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> | null {
    const maxRadius = (this.params.maxRadius as number) ?? 300;
    const speed = (this.params.speed as number) ?? 5;
    const alt = (this.params.alt as number) ?? leader.alt;
    const centerLat = (this.params.centerLat as number) ?? leader.lat;
    const centerLon = (this.params.centerLon as number) ?? leader.lon;

    // Expanding spiral: radius grows linearly with angle
    const spiralRate = formationParams.spacing * droneIds.length / (2 * Math.PI);
    const distanceCovered = this.elapsed * speed;
    // Approximate angle from arc length: s ≈ 0.5 * spiralRate * theta^2
    const theta = Math.sqrt(2 * distanceCovered / Math.max(spiralRate, 0.1));
    const radius = spiralRate * theta;

    if (radius >= maxRadius) {
      this.progress = 1;
      return null;
    }
    this.progress = radius / maxRadius;

    const center = offsetLatLon(
      centerLat, centerLon,
      Math.cos(theta) * radius,
      Math.sin(theta) * radius
    );

    return this.computeFormationTargets(
      { ...leader, lat: center.lat, lon: center.lon, alt },
      droneIds,
      { ...formationParams, formation: "column" },
      0
    );
  }

  private tickEscort(
    leader: LeaderState,
    droneIds: string[],
    formationParams: FormationParams
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> | null {
    if (this.isTimedComplete()) {
      return null;
    }

    // Escort: formation tracks around a virtual moving point (the leader itself, or an updated target)
    const escortLat = (this.params.targetLat as number) ?? leader.lat;
    const escortLon = (this.params.targetLon as number) ?? leader.lon;
    const escortAlt = (this.params.targetAlt as number) ?? leader.alt;

    if (this.getDurationSec() === null) {
      this.progress = 0;
    }

    return this.computeFormationTargets(
      { lat: escortLat, lon: escortLon, alt: escortAlt, heading: leader.heading, vNorth: leader.vNorth, vEast: leader.vEast },
      droneIds,
      formationParams,
      0.4
    );
  }

  private tickPerimeter(
    leader: LeaderState,
    droneIds: string[]
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> | null {
    if (this.isTimedComplete()) {
      return null;
    }

    const radius = (this.params.radius as number) ?? 100;
    const alt = (this.params.alt as number) ?? leader.alt;
    const centerLat = (this.params.centerLat as number) ?? leader.lat;
    const centerLon = (this.params.centerLon as number) ?? leader.lon;
    const patrolSpeed = (this.params.speed as number) ?? 3; // m/s

    // Each drone patrols its own segment of the perimeter
    const circumference = 2 * Math.PI * radius;
    const segmentLength = circumference / droneIds.length;
    const patrolPhase = (this.elapsed * patrolSpeed / segmentLength) % 1;

    if (this.getDurationSec() === null) {
      this.progress = patrolPhase;
    }

    return droneIds.map((droneId, idx) => {
      // Base angle for this drone's segment + oscillation within segment
      const segmentCenter = (2 * Math.PI * idx) / droneIds.length;
      const oscillation = Math.sin(patrolPhase * 2 * Math.PI) * (Math.PI / droneIds.length);
      const angle = segmentCenter + oscillation;

      const pos = offsetLatLon(centerLat, centerLon, Math.cos(angle) * radius, Math.sin(angle) * radius);
      return { droneId, lat: pos.lat, lon: pos.lon, alt };
    });
  }

  private tickCorridor(
    leader: LeaderState,
    droneIds: string[],
    formationParams: FormationParams
  ): Array<{ droneId: string; lat: number; lon: number; alt: number }> | null {
    if (this.isTimedComplete()) {
      return null;
    }

    const corridorWidth = (this.params.width as number) ?? 50;
    const headingDeg = (this.params.headingDeg as number) ?? formationParams.headingDeg;
    const alt = (this.params.alt as number) ?? leader.alt;

    if (this.getDurationSec() === null) {
      this.progress = 0;
    }

    const headingRad = headingDeg * Math.PI / 180;
    const perpN = -Math.sin(headingRad);
    const perpE = Math.cos(headingRad);
    if (!this.shouldIncludeLeader(droneIds)) {
      const halfCount = Math.ceil(droneIds.length / 2);
      return droneIds.map((droneId, idx) => {
        const side = idx < halfCount ? -1 : 1;
        const posInSide = idx < halfCount ? idx : idx - halfCount;
        const alongSpacing = formationParams.spacing;
        const alongN = Math.cos(headingRad) * posInSide * alongSpacing;
        const alongE = Math.sin(headingRad) * posInSide * alongSpacing;
        const crossN = perpN * side * corridorWidth / 2;
        const crossE = perpE * side * corridorWidth / 2;

        const pos = offsetLatLon(leader.lat, leader.lon, alongN + crossN, alongE + crossE);
        return { droneId, lat: pos.lat, lon: pos.lon, alt };
      });
    }

    const [leaderId, ...followerIds] = droneIds;
    const halfCount = Math.ceil(followerIds.length / 2);
    const corridorTargets = followerIds.map((droneId, idx) => {
      const side = idx < halfCount ? -1 : 1;
      const posInSide = idx < halfCount ? idx : idx - halfCount;
      const alongSpacing = formationParams.spacing;
      const alongN = Math.cos(headingRad) * posInSide * alongSpacing;
      const alongE = Math.sin(headingRad) * posInSide * alongSpacing;
      const crossN = perpN * side * corridorWidth / 2;
      const crossE = perpE * side * corridorWidth / 2;

      const pos = offsetLatLon(leader.lat, leader.lon, alongN + crossN, alongE + crossE);
      return { droneId, lat: pos.lat, lon: pos.lon, alt };
    });

    return [{ droneId: leaderId, lat: leader.lat, lon: leader.lon, alt }, ...corridorTargets];
  }

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }
}
