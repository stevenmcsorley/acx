export type UserRole = "ADMIN" | "OPERATOR" | "SUPERVISOR" | "OBSERVER";

export interface UserInfo {
  id: string;
  email: string;
  role: UserRole;
  displayName: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  alt: number;
}

export interface DroneTelemetry {
  timestamp: string;
  position: GeoPoint;
  heading: number;
  velocity: { x: number; y: number; z: number; speed: number };
  batteryPct: number;
  signalPct: number;
  flightState: "grounded" | "armed" | "taking_off" | "airborne" | "landing" | "rtl" | "emergency";
  wind: { x: number; y: number; z: number; speed: number };
  collisionFlag: boolean;
  geofenceViolation: boolean;
  mode: string;
}

export interface DroneRecord {
  id: string;
  name: string;
  adapter: string;
  status: string;
  archivedAt?: string | null;
  home: GeoPoint;
  lastKnown:
    | {
        lat: number;
        lon: number;
        alt: number;
        batteryPct: number;
        signalPct: number;
        timestamp: string;
      }
    | null;
}

export type CameraViewMode = "follow" | "cinematic" | "fpv";
export type SwarmTriggerMode = "mission_start" | "waypoint_reached";
export type SwarmEventMode = "transit" | "final_destination";
export type SwarmTriggerStopRule = "timer" | "manual_confirm";
export type SwarmPostAction = "resume" | "rtl" | "land" | "hold";
export type ScenarioPresetContext = "manual" | "waypoint_event" | "final_destination";
export type ScenarioPresetBehavior = "formation" | "anchored" | "leader_tracking" | "transition";

export interface MissionWaypoint {
  id?: string;
  name?: string;
  lat: number;
  lon: number;
  alt: number;
  hover: number;
  swarmTrigger?: {
    groupId: string;
    presetId: string;
    triggerMode?: SwarmTriggerMode;
    eventMode?: SwarmEventMode;
    stopRule?: SwarmTriggerStopRule;
    postAction?: SwarmPostAction;
    durationSec?: number;
    maneuverOverrides?: Record<string, unknown>;
  };
  cameraPitch?: number;
  heading?: number;
  curveSize?: number;
  rotationDir?: number;
  gimbalMode?: number;
  altitudeMode?: number;
  speed?: number;
  poiLat?: number;
  poiLon?: number;
  poiAlt?: number;
  poiAltitudeMode?: number;
  photoTimeInterval?: number;
  photoDistInterval?: number;
  cameraViewMode?: CameraViewMode;
  fpvYaw?: number;
  fpvPitch?: number;
  fpvZoom?: number;
}

export interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  category: string;
  formation: string;
  spacing: number;
  headingDeg: number;
  altOffset: number;
  maneuver?: string;
  maneuverParams?: Record<string, unknown>;
  supportedContexts?: ScenarioPresetContext[];
  behavior?: ScenarioPresetBehavior;
  customized?: boolean;
}

export interface MissionRecord {
  id: string;
  droneId: string;
  name: string;
  status: string;
  geofenceId?: string;
  executionCount?: number;
  lastExecutedAt?: string | null;
  waypointCount?: number;
  curveWaypointCount?: number;
  estimatedDistanceMeters?: number;
  swarmGroupIds?: string[];
  waypoints: MissionWaypoint[];
  createdAt: string;
  updatedAt: string;
}

export interface GeofenceRecord {
  id: string;
  name: string;
  polygon: Array<{ lat: number; lon: number }>;
  isActive: boolean;
}

export interface HomeBaseSlot {
  droneId: string;
  lat: number;
  lon: number;
}

export interface HomeBaseRecord {
  id: string;
  name: string;
  polygon: Array<{ lat: number; lon: number }>;
  slots: HomeBaseSlot[];
  swarmGroupId?: string | null;
  homeAlt: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TelemetryEvent {
  type: "telemetry";
  droneId: string;
  payload: DroneTelemetry;
}

export interface AlertEvent {
  type: "alert";
  droneId: string;
  severity: "info" | "warning" | "critical";
  message: string;
  timestamp: string;
}
