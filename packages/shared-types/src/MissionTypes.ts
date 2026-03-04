import type { GeoPoint } from "./DroneTelemetry";

export type HeadingMode = "velocity" | "absolute" | "poi";

export type SwarmTriggerMode = "mission_start" | "waypoint_reached";
export type SwarmEventMode = "transit" | "final_destination";
export type SwarmTriggerStopRule = "timer" | "manual_confirm";
export type SwarmPostAction = "resume" | "rtl" | "land" | "hold";

export interface SwarmTrigger {
  groupId: string;
  presetId: string;
  triggerMode?: SwarmTriggerMode;
  eventMode?: SwarmEventMode;
  stopRule?: SwarmTriggerStopRule;
  postAction?: SwarmPostAction;
  durationSec?: number;
  maneuverOverrides?: Record<string, unknown>;
}

export interface MissionWaypoint {
  id: string;
  name?: string;
  lat: number;
  lon: number;
  alt: number;
  hover: number;
  swarmTrigger?: SwarmTrigger;
  // Orientation & camera
  heading?: number;
  headingMode?: HeadingMode;
  curveSize?: number;
  rotationDir?: number;
  gimbalMode?: number;
  cameraPitch?: number;
  altitudeMode?: number;
  speed?: number;
  poiLat?: number;
  poiLon?: number;
  poiAlt?: number;
  poiAltitudeMode?: number;
  photoTimeInterval?: number;
  photoDistInterval?: number;
  fpvYaw?: number;
  fpvPitch?: number;
  fpvZoom?: number;
  cameraViewMode?: string;
}

export interface MissionPlan {
  id: string;
  droneId: string;
  name: string;
  waypoints: MissionWaypoint[];
  geofenceId?: string;
  status: "queued" | "running" | "completed" | "aborted";
  createdAt: string;
  updatedAt: string;
}

export interface FormationPreset {
  id: string;
  name: "triangle" | "arrowhead" | "v_wedge" | "diamond" | "grid" | "circle";
  offsets: GeoPoint[];
}
