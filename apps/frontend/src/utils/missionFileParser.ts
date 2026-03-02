import type { MissionWaypoint } from "../types/domain";

export interface ParsedMission {
  name: string;
  waypoints: MissionWaypoint[];
  sourceFormat: "litchi-csv" | "kml";
}

export function detectFormat(fileName: string): "litchi-csv" | "kml" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "litchi-csv";
  if (lower.endsWith(".kml")) return "kml";
  return null;
}

export function parseLitchiCsv(text: string, fileName: string): ParsedMission {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV file is empty or contains only a header row");
  }

  // Skip header row
  const waypoints: MissionWaypoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 8) continue;

    const lat = parseFloat(cols[0]);
    const lon = parseFloat(cols[1]);
    const alt = parseFloat(cols[2]);
    const heading = parseFloat(cols[3]);
    const curveSize = parseFloat(cols[4]);
    const rotationDir = parseFloat(cols[5]);
    const gimbalMode = parseFloat(cols[6]);
    const cameraPitch = parseFloat(cols[7]);
    const altitudeMode = cols.length > 8 ? parseFloat(cols[8]) : NaN;
    const speed = cols.length > 9 ? parseFloat(cols[9]) : NaN;
    const poiLat = cols.length > 10 ? parseFloat(cols[10]) : NaN;
    const poiLon = cols.length > 11 ? parseFloat(cols[11]) : NaN;
    const poiAlt = cols.length > 12 ? parseFloat(cols[12]) : NaN;
    const poiAltitudeMode = cols.length > 13 ? parseFloat(cols[13]) : NaN;
    const photoTimeInterval = cols.length > 14 ? parseFloat(cols[14]) : NaN;
    const photoDistInterval = cols.length > 15 ? parseFloat(cols[15]) : NaN;

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      continue;
    }

    waypoints.push({
      lat,
      lon,
      alt: isNaN(alt) ? 50 : alt,
      hover: 2,
      heading: isNaN(heading) ? 0 : heading,
      curveSize: isNaN(curveSize) ? 0.2 : curveSize,
      rotationDir: isNaN(rotationDir) ? 0 : rotationDir,
      gimbalMode: isNaN(gimbalMode) ? 0 : gimbalMode,
      cameraPitch: isNaN(cameraPitch) ? 0 : cameraPitch,
      altitudeMode: isNaN(altitudeMode) ? 1 : altitudeMode,
      speed: isNaN(speed) ? 0 : speed,
      poiLat: isNaN(poiLat) ? 0 : poiLat,
      poiLon: isNaN(poiLon) ? 0 : poiLon,
      poiAlt: isNaN(poiAlt) ? 0 : poiAlt,
      poiAltitudeMode: isNaN(poiAltitudeMode) ? 0 : poiAltitudeMode,
      photoTimeInterval: isNaN(photoTimeInterval) ? -1 : photoTimeInterval,
      photoDistInterval: isNaN(photoDistInterval) ? -1 : photoDistInterval,
    });
  }

  if (waypoints.length === 0) {
    throw new Error("No valid waypoints found in CSV file");
  }

  return {
    name: fileName.replace(/\.csv$/i, ""),
    waypoints,
    sourceFormat: "litchi-csv",
  };
}

export function parseKml(text: string, fileName: string): ParsedMission {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid KML file: XML parsing failed");
  }

  // Extract mission name from Document > name, fallback to filename
  const docName = doc.querySelector("Document > name")?.textContent?.trim();
  const missionName = docName || fileName.replace(/\.kml$/i, "");

  const waypoints: MissionWaypoint[] = [];

  const placemarks = Array.from(doc.querySelectorAll("Placemark"));
  for (const placemark of placemarks) {
    // Check for Point coordinates
    const point = placemark.querySelector("Point > coordinates");
    if (point?.textContent) {
      const wp = parseKmlCoordinate(point.textContent.trim());
      if (wp) waypoints.push(wp);
      continue;
    }

    // Check for LineString coordinates
    const lineString = placemark.querySelector("LineString > coordinates");
    if (lineString?.textContent) {
      const tuples = lineString.textContent.trim().split(/\s+/);
      for (const tuple of tuples) {
        const wp = parseKmlCoordinate(tuple.trim());
        if (wp) waypoints.push(wp);
      }
    }
  }

  if (waypoints.length === 0) {
    throw new Error("No valid waypoints found in KML file");
  }

  return {
    name: missionName,
    waypoints,
    sourceFormat: "kml",
  };
}

function parseKmlCoordinate(coord: string): MissionWaypoint | null {
  const parts = coord.split(",");
  if (parts.length < 2) return null;

  const lon = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);
  const alt = parts.length >= 3 ? parseFloat(parts[2]) : 50;

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }

  return {
    lat,
    lon,
    alt: isNaN(alt) ? 50 : alt,
    hover: 2,
  };
}

export function exportLitchiCsv(waypoints: MissionWaypoint[]): string {
  const header =
    "latitude,longitude,altitude(m),heading(deg),curvesize(m),rotationdir,gimbalmode,gimbalpitchangle,altitudemode,speed(m/s),poi_latitude,poi_longitude,poi_altitude(m),poi_altitudemode,photo_timeinterval,photo_distinterval";
  const rows = waypoints.map(
    (wp) =>
      `${wp.lat},${wp.lon},${wp.alt},${wp.heading ?? 0},${wp.curveSize ?? 0.2},${wp.rotationDir ?? 0},${wp.gimbalMode ?? 0},${wp.cameraPitch ?? 0},${wp.altitudeMode ?? 1},${wp.speed ?? 0},${wp.poiLat ?? 0},${wp.poiLon ?? 0},${wp.poiAlt ?? 0},${wp.poiAltitudeMode ?? 0},${wp.photoTimeInterval ?? -1},${wp.photoDistInterval ?? -1}`
  );
  return [header, ...rows].join("\n");
}

export function exportKml(waypoints: MissionWaypoint[], name: string): string {
  const placemarks = waypoints
    .map(
      (wp, i) =>
        `    <Placemark>
      <name>${escapeXml(wp.name || `WP-${i + 1}`)}</name>
      <Point>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>${wp.lon},${wp.lat},${wp.alt}</coordinates>
      </Point>
    </Placemark>`
    )
    .join("\n");

  const lineCoords = waypoints
    .map((wp) => `${wp.lon},${wp.lat},${wp.alt}`)
    .join(" ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
${placemarks}
    <Placemark>
      <name>Route</name>
      <LineString>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>${lineCoords}</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
