import type { ScenarioPreset } from "../types/domain";

function canonicalizePresetId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function findScenarioPreset(
  presets: ScenarioPreset[],
  presetId: string | null | undefined
): ScenarioPreset | undefined {
  if (!presetId) {
    return undefined;
  }

  const direct = presets.find((preset) => preset.id === presetId);
  if (direct) {
    return direct;
  }

  const canonical = canonicalizePresetId(presetId);
  return presets.find((preset) => canonicalizePresetId(preset.id) === canonical);
}

export function buildScenarioPresetLookup(presets: ScenarioPreset[]): Map<string, ScenarioPreset> {
  const lookup = new Map<string, ScenarioPreset>();
  for (const preset of presets) {
    lookup.set(preset.id, preset);
    lookup.set(canonicalizePresetId(preset.id), preset);
  }
  return lookup;
}
