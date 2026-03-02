import type { ScenarioPreset, ScenarioPresetBehavior, ScenarioPresetContext, SwarmEventMode } from "../types/domain";

export function inferScenarioPresetBehavior(preset: ScenarioPreset): ScenarioPresetBehavior {
  switch (preset.maneuver) {
    case "orbit":
    case "perimeter":
    case "search_grid":
    case "search_spiral":
      return "anchored";
    case "escort":
      return "leader_tracking";
    case "expand":
    case "contract":
    case "rotate":
      return "transition";
    default:
      return "formation";
  }
}

export function inferScenarioPresetContexts(preset: ScenarioPreset): ScenarioPresetContext[] {
  const behavior = preset.behavior ?? inferScenarioPresetBehavior(preset);
  if (behavior === "leader_tracking" || behavior === "transition") {
    return ["manual", "waypoint_event"];
  }

  return ["manual", "waypoint_event", "final_destination"];
}

export function presetSupportsContext(preset: ScenarioPreset, context: ScenarioPresetContext): boolean {
  const supportedContexts = preset.supportedContexts ?? inferScenarioPresetContexts(preset);
  return supportedContexts.includes(context);
}

export function presetContextForEventMode(eventMode?: SwarmEventMode): ScenarioPresetContext {
  return eventMode === "final_destination" ? "final_destination" : "waypoint_event";
}

export function supportsPresetStopRule(preset?: ScenarioPreset): boolean {
  return !preset?.maneuver || ["orbit", "perimeter", "escort", "corridor", "rotate"].includes(preset.maneuver);
}

export function defaultDurationForPreset(preset?: ScenarioPreset): number | undefined {
  if (!preset) {
    return 18;
  }

  if (!preset.maneuver) {
    return numericParam(preset.maneuverParams, "durationSec", 18);
  }

  if (["orbit", "perimeter", "escort", "corridor", "rotate"].includes(preset.maneuver)) {
    return numericParam(preset.maneuverParams, "durationSec", 18);
  }

  return undefined;
}

export function numericParam(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const raw = params?.[key];
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

export function stringParam(params: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const raw = params?.[key];
  return typeof raw === "string" && raw.length > 0 ? raw : fallback;
}
