const EARTH_RADIUS_M = 6378137;
const METERS_PER_DEG_LAT = 111320;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function wrapHeading(heading: number): number {
  let h = heading % 360;
  if (h < 0) {
    h += 360;
  }
  return h;
}

export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const lat1 = aLat * toRad;
  const lat2 = bLat * toRad;

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const dLon = (bLon - aLon) * toRad;
  const lat1 = aLat * toRad;
  const lat2 = bLat * toRad;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return wrapHeading(Math.atan2(y, x) * toDeg);
}

export function localMetersFromLatLon(originLat: number, originLon: number, lat: number, lon: number): { north: number; east: number } {
  const dLat = lat - originLat;
  const dLon = lon - originLon;
  const north = dLat * METERS_PER_DEG_LAT;
  const east = dLon * METERS_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
  return { north, east };
}

export function offsetLatLon(lat: number, lon: number, northMeters: number, eastMeters: number): { lat: number; lon: number } {
  const dLat = northMeters / METERS_PER_DEG_LAT;
  const lonScale = METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dLon = lonScale === 0 ? 0 : eastMeters / lonScale;
  return {
    lat: lat + dLat,
    lon: lon + dLon
  };
}

export function insidePolygon(lat: number, lon: number, polygon: Array<{ lat: number; lon: number }>): boolean {
  if (polygon.length < 3) {
    return false;
  }

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i].lat;
    const xi = polygon[i].lon;
    const yj = polygon[j].lat;
    const xj = polygon[j].lon;

    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

export function shortestTurnDegrees(from: number, to: number): number {
  const diff = ((to - from + 540) % 360) - 180;
  return diff;
}

export function vectorMagnitude(x: number, y: number, z = 0): number {
  return Math.sqrt(x * x + y * y + z * z);
}
