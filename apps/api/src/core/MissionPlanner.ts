import type { MissionWaypoint } from "@sgcx/shared-types";
import { haversineMeters } from "../simulation/geo";

export class MissionPlanner {
  validate(waypoints: MissionWaypoint[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (waypoints.length === 0) {
      errors.push("Mission requires at least one waypoint");
    }

    if (waypoints.length > 1000) {
      errors.push("Mission waypoint limit exceeded (1000)");
    }

    for (let i = 0; i < waypoints.length; i += 1) {
      const wp = waypoints[i];
      if (wp.alt < 5 || wp.alt > 5000) {
        errors.push(`Waypoint ${i + 1} altitude must be between 5m and 5000m`);
      }

      if (i > 0) {
        const prev = waypoints[i - 1];
        const segment = haversineMeters(prev.lat, prev.lon, wp.lat, wp.lon);
        if (segment > 20_000) {
          errors.push(`Waypoint ${i + 1} exceeds maximum segment distance (20km)`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  estimateDistanceMeters(waypoints: MissionWaypoint[]): number {
    let total = 0;
    for (let i = 1; i < waypoints.length; i += 1) {
      const a = waypoints[i - 1];
      const b = waypoints[i];
      total += haversineMeters(a.lat, a.lon, b.lat, b.lon);
    }
    return total;
  }
}
