import type { MissionWaypoint } from "../types/domain";

const METERS_PER_DEG_LAT = 111320;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function vectorMagnitude(north: number, east: number): number {
  return Math.sqrt((north * north) + (east * east));
}

function localMetersFromLatLon(originLat: number, originLon: number, targetLat: number, targetLon: number) {
  const dLat = (targetLat - originLat) * METERS_PER_DEG_LAT;
  const lonScale = METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  const dLon = (targetLon - originLon) * lonScale;
  return { north: dLat, east: dLon };
}

function offsetLatLon(lat: number, lon: number, northMeters: number, eastMeters: number) {
  const dLat = northMeters / METERS_PER_DEG_LAT;
  const lonScale = METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dLon = lonScale === 0 ? 0 : eastMeters / lonScale;
  return { lat: lat + dLat, lon: lon + dLon };
}

function quadraticBezier(a: number, b: number, c: number, t: number): number {
  const mt = 1 - t;
  return (mt * mt * a) + (2 * mt * t * b) + (t * t * c);
}

function shouldCurveWaypoint(waypoint: MissionWaypoint): boolean {
  return (
    (waypoint.curveSize ?? 0) > 0 &&
    waypoint.hover <= 0 &&
    !waypoint.swarmTrigger &&
    waypoint.cameraPitch === undefined &&
    waypoint.heading === undefined &&
    waypoint.cameraViewMode === undefined
  );
}

export function buildMissionDisplayPath(
  waypoints: MissionWaypoint[],
  samplesPerCurve = 8
): Array<{ lat: number; lon: number; alt: number }> {
  if (waypoints.length <= 2) {
    return waypoints.map((waypoint) => ({
      lat: waypoint.lat,
      lon: waypoint.lon,
      alt: waypoint.alt
    }));
  }

  const result: Array<{ lat: number; lon: number; alt: number }> = [
    { lat: waypoints[0].lat, lon: waypoints[0].lon, alt: waypoints[0].alt }
  ];

  for (let index = 1; index < waypoints.length - 1; index += 1) {
    const previous = waypoints[index - 1];
    const current = waypoints[index];
    const next = waypoints[index + 1];

    if (!shouldCurveWaypoint(current)) {
      result.push({ lat: current.lat, lon: current.lon, alt: current.alt });
      continue;
    }

    const incoming = localMetersFromLatLon(current.lat, current.lon, previous.lat, previous.lon);
    const outgoing = localMetersFromLatLon(current.lat, current.lon, next.lat, next.lon);
    const incomingDistance = vectorMagnitude(incoming.north, incoming.east);
    const outgoingDistance = vectorMagnitude(outgoing.north, outgoing.east);

    if (incomingDistance < 5 || outgoingDistance < 5) {
      result.push({ lat: current.lat, lon: current.lon, alt: current.alt });
      continue;
    }

    const curveMeters = clamp(current.curveSize ?? 0, 0, Math.min(incomingDistance, outgoingDistance) * 0.35);
    if (curveMeters < 1) {
      result.push({ lat: current.lat, lon: current.lon, alt: current.alt });
      continue;
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
      current.lat,
      current.lon,
      incomingUnit.north * curveMeters,
      incomingUnit.east * curveMeters
    );
    const exitGeo = offsetLatLon(
      current.lat,
      current.lon,
      outgoingUnit.north * curveMeters,
      outgoingUnit.east * curveMeters
    );

    const entry = {
      lat: entryGeo.lat,
      lon: entryGeo.lon,
      alt: current.alt + ((previous.alt - current.alt) * (curveMeters / incomingDistance))
    };
    const exit = {
      lat: exitGeo.lat,
      lon: exitGeo.lon,
      alt: current.alt + ((next.alt - current.alt) * (curveMeters / outgoingDistance))
    };

    const last = result[result.length - 1];
    if (!last || last.lat !== entry.lat || last.lon !== entry.lon || last.alt !== entry.alt) {
      result.push(entry);
    }

    for (let step = 1; step <= samplesPerCurve; step += 1) {
      const t = step / (samplesPerCurve + 1);
      result.push({
        lat: quadraticBezier(entry.lat, current.lat, exit.lat, t),
        lon: quadraticBezier(entry.lon, current.lon, exit.lon, t),
        alt: quadraticBezier(entry.alt, current.alt, exit.alt, t)
      });
    }

    result.push(exit);
  }

  const finalWaypoint = waypoints[waypoints.length - 1];
  result.push({ lat: finalWaypoint.lat, lon: finalWaypoint.lon, alt: finalWaypoint.alt });
  return result;
}
