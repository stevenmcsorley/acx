export type DroneFlightState =
  | "grounded"
  | "armed"
  | "taking_off"
  | "airborne"
  | "landing"
  | "rtl"
  | "emergency";

export interface GeoPoint {
  lat: number;
  lon: number;
  alt: number;
}

export interface WindVector {
  x: number;
  y: number;
  z: number;
  speed: number;
}

export interface VelocityVector {
  x: number;
  y: number;
  z: number;
  speed: number;
}

export interface CameraState {
  cameraPitch: number;
  fpvYaw: number;
  fpvZoom: number;
}

export interface DroneTelemetry {
  timestamp: string;
  position: GeoPoint;
  heading: number;
  velocity: VelocityVector;
  batteryPct: number;
  signalPct: number;
  flightState: DroneFlightState;
  wind: WindVector;
  collisionFlag: boolean;
  geofenceViolation: boolean;
  mode: string;
  camera?: CameraState;
}
