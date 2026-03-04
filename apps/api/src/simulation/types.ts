import type { DroneFlightState, MissionWaypoint, WindVector } from "@sgcx/shared-types";

export interface SimGeofence {
  id: string;
  isActive: boolean;
  polygon: Array<{ lat: number; lon: number }>;
}

export interface SimMission {
  id: string;
  name: string;
  waypoints: MissionWaypoint[];
  index: number;
  hoverUntilMs?: number;
}

export interface SimDroneState {
  id: string;
  name: string;
  homeLat: number;
  homeLon: number;
  homeAlt: number;
  lat: number;
  lon: number;
  alt: number;
  vNorth: number;
  vEast: number;
  vUp: number;
  heading: number;
  batteryPct: number;
  signalPct: number;
  flightState: DroneFlightState;
  mode: string;
  wind: WindVector;
  collisionFlag: boolean;
  geofenceViolation: boolean;
  targetAltitude: number;
  manualControl?: {
    forward: number;
    right: number;
    up: number;
    yawRate: number;
    lastInputMs: number;
  };
  manualTarget?: { lat: number; lon: number; alt: number };
  mission?: SimMission;
  pendingMissionCompletion?: {
    missionId: string;
    missionName: string;
  };
  lastAlertAt: Record<string, number>;

  // Orientation control (decoupled from velocity)
  targetHeading?: number;
  headingMode?: "velocity" | "absolute" | "poi";
  poiTarget?: { lat: number; lon: number; alt: number };

  // Camera state (smooth-interpolated toward targets)
  cameraPitch: number;
  fpvYaw: number;
  fpvZoom: number;

  // Waypoint-driven camera targets
  targetCameraPitch?: number;
  targetFpvYaw?: number;
  targetFpvZoom?: number;
}

export interface CollisionResponse {
  collisions: Set<string>;
  avoidanceVectors: Map<string, { north: number; east: number }>;
}
