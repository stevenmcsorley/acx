import type { MissionWaypoint } from "@sgcx/shared-types";
import { clamp, haversineMeters, localMetersFromLatLon, offsetLatLon, vectorMagnitude } from "../simulation/geo";

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

  buildPreviewPath(
    waypoints: MissionWaypoint[],
    samplesPerCurve = 8
  ): Array<{ lat: number; lon: number; alt: number }> {
    if (waypoints.length <= 2) {
      return waypoints.map((wp) => ({ lat: wp.lat, lon: wp.lon, alt: wp.alt }));
    }

    const result: Array<{ lat: number; lon: number; alt: number }> = [
      { lat: waypoints[0].lat, lon: waypoints[0].lon, alt: waypoints[0].alt }
    ];

    for (let i = 1; i < waypoints.length - 1; i += 1) {
      const prev = waypoints[i - 1];
      const curr = waypoints[i];
      const next = waypoints[i + 1];
      const roundedTurn = this.buildRoundedTurn(prev, curr, next, samplesPerCurve);

      if (!roundedTurn) {
        result.push({ lat: curr.lat, lon: curr.lon, alt: curr.alt });
        continue;
      }

      const last = result[result.length - 1];
      if (
        !last ||
        Math.abs(last.lat - roundedTurn.entry.lat) > Number.EPSILON ||
        Math.abs(last.lon - roundedTurn.entry.lon) > Number.EPSILON ||
        Math.abs(last.alt - roundedTurn.entry.alt) > Number.EPSILON
      ) {
        result.push(roundedTurn.entry);
      }

      result.push(...roundedTurn.curvePoints);
    }

    const finalWaypoint = waypoints[waypoints.length - 1];
    result.push({ lat: finalWaypoint.lat, lon: finalWaypoint.lon, alt: finalWaypoint.alt });
    return result;
  }

  private buildRoundedTurn(
    prev: MissionWaypoint,
    curr: MissionWaypoint,
    next: MissionWaypoint,
    samplesPerCurve: number
  ): {
    entry: { lat: number; lon: number; alt: number };
    curvePoints: Array<{ lat: number; lon: number; alt: number }>;
  } | null {
    if (
      (curr.curveSize ?? 0) <= 0 ||
      curr.hover > 0 ||
      curr.swarmTrigger ||
      curr.cameraPitch !== undefined ||
      curr.heading !== undefined ||
      curr.cameraViewMode !== undefined
    ) {
      return null;
    }

    const incoming = localMetersFromLatLon(curr.lat, curr.lon, prev.lat, prev.lon);
    const outgoing = localMetersFromLatLon(curr.lat, curr.lon, next.lat, next.lon);
    const incomingDistance = vectorMagnitude(incoming.north, incoming.east);
    const outgoingDistance = vectorMagnitude(outgoing.north, outgoing.east);

    if (incomingDistance < 5 || outgoingDistance < 5) {
      return null;
    }

    const curveMeters = clamp(curr.curveSize ?? 0, 0, Math.min(incomingDistance, outgoingDistance) * 0.35);
    if (curveMeters < 1) {
      return null;
    }

    const incomingUnit = {
      north: incoming.north / incomingDistance,
      east: incoming.east / incomingDistance
    };
    const outgoingUnit = {
      north: outgoing.north / outgoingDistance,
      east: outgoing.east / outgoingDistance
    };

    const entryGeo = offsetLatLon(
      curr.lat,
      curr.lon,
      incomingUnit.north * curveMeters,
      incomingUnit.east * curveMeters
    );
    const exitGeo = offsetLatLon(
      curr.lat,
      curr.lon,
      outgoingUnit.north * curveMeters,
      outgoingUnit.east * curveMeters
    );

    const entry = {
      lat: entryGeo.lat,
      lon: entryGeo.lon,
      alt: curr.alt + (prev.alt - curr.alt) * (curveMeters / incomingDistance)
    };

    const curvePoints: Array<{ lat: number; lon: number; alt: number }> = [];
    for (let step = 1; step <= samplesPerCurve; step += 1) {
      const t = step / (samplesPerCurve + 1);
      curvePoints.push({
        lat: MissionPlanner.quadraticBezier(entry.lat, curr.lat, exitGeo.lat, t),
        lon: MissionPlanner.quadraticBezier(entry.lon, curr.lon, exitGeo.lon, t),
        alt: MissionPlanner.quadraticBezier(entry.alt, curr.alt, curr.alt + (next.alt - curr.alt) * (curveMeters / outgoingDistance), t)
      });
    }

    curvePoints.push({
      lat: exitGeo.lat,
      lon: exitGeo.lon,
      alt: curr.alt + (next.alt - curr.alt) * (curveMeters / outgoingDistance)
    });

    return { entry, curvePoints };
  }

  private static quadraticBezier(a: number, b: number, c: number, t: number): number {
    const mt = 1 - t;
    return mt * mt * a + 2 * mt * t * b + t * t * c;
  }
}
