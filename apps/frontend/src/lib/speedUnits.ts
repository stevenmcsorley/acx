export const METERS_PER_SECOND_TO_MPH = 2.2369362920544;
export const MAX_CUSTOM_DRONE_SPEED_MPH = 50;
export const MAX_MANEUVER_SPEED_MPH = 50;
export const MAX_VERTICAL_RATE_MPH = 20;

export function mpsToMph(value: number): number {
  return value * METERS_PER_SECOND_TO_MPH;
}

export function mphToMps(value: number): number {
  return value / METERS_PER_SECOND_TO_MPH;
}

export function formatSpeedMph(value: number, precision = 0): string {
  return `${mpsToMph(value).toFixed(precision)} mph`;
}
