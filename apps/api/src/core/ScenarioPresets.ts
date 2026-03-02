import type { FormationName } from "./SwarmEngine";
import type { ManeuverType } from "./ManeuverEngine";

export type ScenarioPresetContext = "manual" | "waypoint_event" | "final_destination";
export type ScenarioPresetBehavior = "formation" | "anchored" | "leader_tracking" | "transition";

export interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  category: "military" | "sar" | "film" | "security" | "mapping" | "geometric" | "cinematic" | "3d";
  formation: FormationName;
  spacing: number;
  headingDeg: number;
  altOffset: number;
  maneuver?: ManeuverType;
  maneuverParams?: Record<string, unknown>;
  supportedContexts?: ScenarioPresetContext[];
  behavior?: ScenarioPresetBehavior;
  customized?: boolean;
}

export interface ScenarioPresetConfigRecord {
  presetId: string;
  formation: string;
  spacing: number;
  headingDeg: number;
  altOffset: number;
  maneuverJson?: string | null;
}

function inferScenarioPresetBehavior(preset: ScenarioPreset): ScenarioPresetBehavior {
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

function inferScenarioPresetContexts(preset: ScenarioPreset): ScenarioPresetContext[] {
  const behavior = preset.behavior ?? inferScenarioPresetBehavior(preset);
  if (behavior === "leader_tracking" || behavior === "transition") {
    return ["manual", "waypoint_event"];
  }

  return ["manual", "waypoint_event", "final_destination"];
}

function normalizeScenarioPreset(preset: ScenarioPreset): ScenarioPreset {
  const behavior = preset.behavior ?? inferScenarioPresetBehavior(preset);
  return {
    ...preset,
    behavior,
    supportedContexts: preset.supportedContexts ?? inferScenarioPresetContexts({ ...preset, behavior })
  };
}

const RAW_DEFAULT_SCENARIO_PRESETS: ScenarioPreset[] = [
  // ── Military ──
  {
    id: "mil-recon",
    name: "Recon Sweep",
    description: "Wide V-wedge for maximum forward coverage",
    category: "military",
    formation: "v_wedge",
    spacing: 40,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "mil-overwatch",
    name: "Overwatch Orbit",
    description: "Circular orbit around a point of interest",
    category: "military",
    formation: "circle",
    spacing: 25,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "orbit",
    maneuverParams: { radius: 120, speed: 6, durationSec: 18 }
  },
  {
    id: "mil-escort",
    name: "Escort Formation",
    description: "Diamond formation tracking a moving target",
    category: "military",
    formation: "diamond",
    spacing: 20,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "escort",
    maneuverParams: { durationSec: 20 }
  },
  {
    id: "mil-perimeter",
    name: "Perimeter Defense",
    description: "Circle formation with perimeter patrol",
    category: "military",
    formation: "circle",
    spacing: 30,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "perimeter",
    maneuverParams: { radius: 100, speed: 4, durationSec: 24 }
  },

  // ── Search & Rescue ──
  {
    id: "sar-grid",
    name: "Grid Search",
    description: "Systematic lawnmower pattern over rectangular area",
    category: "sar",
    formation: "line_abreast",
    spacing: 25,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "search_grid",
    maneuverParams: { width: 400, height: 400, speed: 5 }
  },
  {
    id: "sar-spiral",
    name: "Spiral Search",
    description: "Expanding spiral from last known position",
    category: "sar",
    formation: "column",
    spacing: 20,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "search_spiral",
    maneuverParams: { maxRadius: 500, speed: 5 }
  },
  {
    id: "sar-expanding",
    name: "Expanding Square",
    description: "Expand formation for wider area coverage",
    category: "sar",
    formation: "grid",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "expand",
    maneuverParams: { targetSpacing: 50, duration: 15 }
  },

  // ── Film ──
  {
    id: "film-orbit",
    name: "Orbit Shot",
    description: "Cinematic orbital shot around subject",
    category: "film",
    formation: "circle",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "orbit",
    maneuverParams: { radius: 60, speed: 4, direction: "cw", durationSec: 12 }
  },
  {
    id: "film-flyby",
    name: "Flyby",
    description: "Line abreast formation for dramatic flyby",
    category: "film",
    formation: "line_abreast",
    spacing: 12,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "film-tracking",
    name: "Tracking Shot",
    description: "Echelon formation tracking moving subject",
    category: "film",
    formation: "echelon_right",
    spacing: 15,
    headingDeg: 0,
    altOffset: 2,
    maneuver: "escort",
    maneuverParams: { durationSec: 18 }
  },

  // ── Security ──
  {
    id: "sec-perimeter",
    name: "Perimeter Patrol",
    description: "Continuous perimeter patrol around facility",
    category: "security",
    formation: "circle",
    spacing: 20,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "perimeter",
    maneuverParams: { radius: 150, speed: 3, durationSec: 30 }
  },
  {
    id: "sec-crowd",
    name: "Crowd Monitoring",
    description: "Grid pattern overhead for crowd surveillance",
    category: "security",
    formation: "grid",
    spacing: 30,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "sec-corridor",
    name: "Corridor Watch",
    description: "Two parallel lines monitoring a corridor",
    category: "security",
    formation: "wall",
    spacing: 20,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "corridor",
    maneuverParams: { width: 40, durationSec: 20 }
  },

  // ── Mapping ──
  {
    id: "map-grid",
    name: "Grid Survey",
    description: "Systematic grid mapping of terrain",
    category: "mapping",
    formation: "line_abreast",
    spacing: 20,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "search_grid",
    maneuverParams: { width: 500, height: 500, speed: 4 }
  },
  {
    id: "map-crosshatch",
    name: "Crosshatch Survey",
    description: "Two-pass grid for detailed 3D mapping",
    category: "mapping",
    formation: "line_abreast",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "search_grid",
    maneuverParams: { width: 300, height: 300, speed: 3 }
  },
  {
    id: "map-checkerboard",
    name: "Checkerboard Scan",
    description: "Alternating grid positions for efficient area mapping",
    category: "mapping",
    formation: "checkerboard",
    spacing: 25,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "search_grid",
    maneuverParams: { width: 400, height: 400, speed: 4 }
  },

  // ── Military Expansion ──
  {
    id: "mil-phalanx",
    name: "Phalanx Advance",
    description: "Tight rectangular block for overwhelming forward presence",
    category: "military",
    formation: "phalanx",
    spacing: 12,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "mil-layered-wedge",
    name: "Layered Wedge Stack",
    description: "Stacked V formations at multiple altitudes for vertical redundancy",
    category: "military",
    formation: "layered_wedge",
    spacing: 20,
    headingDeg: 0,
    altOffset: 8
  },
  {
    id: "mil-funnel",
    name: "Funnel Corridor",
    description: "Wide entrance narrowing to tight exit — valley traversal",
    category: "military",
    formation: "funnel",
    spacing: 18,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "mil-dual-overwatch",
    name: "Dual Grid Overwatch",
    description: "Two offset grids for redundant scanning coverage",
    category: "military",
    formation: "offset_dual_grid",
    spacing: 20,
    headingDeg: 0,
    altOffset: 5
  },
  {
    id: "mil-encirclement",
    name: "Encirclement Ring",
    description: "Contracting circle closing on target position",
    category: "military",
    formation: "concentric_rings",
    spacing: 25,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "contract",
    maneuverParams: { targetSpacing: 10, duration: 20 }
  },
  {
    id: "mil-flank-sweep",
    name: "Flank Sweep",
    description: "Mirrored split formation for pincer movement",
    category: "military",
    formation: "mirrored_split",
    spacing: 20,
    headingDeg: 0,
    altOffset: 0
  },

  // ── Geometric / Mathematical ──
  {
    id: "geo-fibonacci",
    name: "Fibonacci Spiral",
    description: "Golden-ratio radial distribution — organic and elegant",
    category: "geometric",
    formation: "fibonacci_spiral",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "geo-sphere",
    name: "Spherical Shell",
    description: "Full 3D sphere around center point — impressive in vertical stack",
    category: "geometric",
    formation: "spherical_shell",
    spacing: 12,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "geo-double-helix",
    name: "Double Helix",
    description: "Two interwoven spiral columns climbing — DNA-like structure",
    category: "geometric",
    formation: "double_helix",
    spacing: 12,
    headingDeg: 0,
    altOffset: 3
  },
  {
    id: "geo-torus",
    name: "Torus Ring",
    description: "3D donut formation — next-gen swarm geometry",
    category: "geometric",
    formation: "torus",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "geo-mobius",
    name: "Mobius Strip",
    description: "Continuous twisted ribbon loop — mind-bending geometry",
    category: "geometric",
    formation: "mobius",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "geo-geodesic",
    name: "Geodesic Dome",
    description: "Buckminster Fuller sphere mesh — architectural intelligence",
    category: "geometric",
    formation: "geodesic_dome",
    spacing: 12,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "geo-lissajous",
    name: "Lissajous Pattern",
    description: "Sinusoidal curve distribution — mesmerizing mathematical beauty",
    category: "geometric",
    formation: "lissajous",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "geo-fractal",
    name: "Fractal Branch",
    description: "Recursive branching like neural network or tree canopy",
    category: "geometric",
    formation: "fractal_branch",
    spacing: 20,
    headingDeg: 0,
    altOffset: 2
  },
  {
    id: "geo-parametric",
    name: "Parametric Surface",
    description: "Oscillating surface wave — mathematically beautiful terrain",
    category: "geometric",
    formation: "parametric_surface",
    spacing: 15,
    headingDeg: 0,
    altOffset: 5
  },
  {
    id: "geo-concentric",
    name: "Concentric Rings",
    description: "Multiple circles at different radii — persistent coverage",
    category: "geometric",
    formation: "concentric_rings",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0
  },

  // ── Cinematic / Film Expansion ──
  {
    id: "cin-crown",
    name: "Rising Crown",
    description: "Radial burst upward — slow-motion explosion effect",
    category: "cinematic",
    formation: "radial_crown",
    spacing: 15,
    headingDeg: 0,
    altOffset: 5
  },
  {
    id: "cin-wave",
    name: "Wave Curtain",
    description: "Vertical wall with sine wave ripple — stunning side view",
    category: "cinematic",
    formation: "vertical_wave",
    spacing: 10,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "cin-starburst",
    name: "Starburst",
    description: "Radial straight-line outward rays — sharp geometric burst",
    category: "cinematic",
    formation: "starburst",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "cin-dna",
    name: "DNA Ladder",
    description: "Parallel vertical strands with cross connectors — night lighting showcase",
    category: "cinematic",
    formation: "dna_ladder",
    spacing: 12,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "cin-bloom",
    name: "Bloom Expand",
    description: "Tight cluster expands outward — breathing motion effect",
    category: "cinematic",
    formation: "circle",
    spacing: 8,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "expand",
    maneuverParams: { targetSpacing: 40, duration: 12 }
  },
  {
    id: "cin-orbit-shot",
    name: "Cinematic Orbit",
    description: "Fibonacci spiral with orbital rotation around subject",
    category: "cinematic",
    formation: "fibonacci_spiral",
    spacing: 12,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "orbit",
    maneuverParams: { radius: 80, speed: 3, direction: "cw", durationSec: 20 }
  },
  {
    id: "cin-mirror-reveal",
    name: "Mirror Reveal",
    description: "Swarm splits into mirrored halves — dramatic cinematic reveal",
    category: "cinematic",
    formation: "mirrored_split",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0
  },

  // ── 3D Platonic Solids ──
  {
    id: "3d-tetrahedron",
    name: "Tetrahedron",
    description: "4-vertex platonic solid — simplest 3D polyhedron",
    category: "3d",
    formation: "tetrahedron",
    spacing: 20,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "3d-cube",
    name: "Cube",
    description: "8-12 drones forming rotating cube vertices and edges",
    category: "3d",
    formation: "cube_3d",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "3d-octahedron",
    name: "Octahedron",
    description: "6-vertex dual of cube — 8 triangular faces",
    category: "3d",
    formation: "octahedron",
    spacing: 18,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "3d-icosahedron",
    name: "Icosahedron",
    description: "12 vertices, 20 triangular faces — near-spherical solid",
    category: "3d",
    formation: "icosahedron",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "3d-dodecahedron",
    name: "Dodecahedron",
    description: "20 vertices, 12 pentagonal faces — most complex platonic solid",
    category: "3d",
    formation: "dodecahedron",
    spacing: 12,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "3d-lattice",
    name: "Diamond Lattice",
    description: "3D FCC crystal lattice — complex volumetric structure",
    category: "3d",
    formation: "diamond_lattice",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "3d-rotating-cube",
    name: "Rotating Cube",
    description: "Cube formation with continuous rotation maneuver",
    category: "3d",
    formation: "cube_3d",
    spacing: 15,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "rotate",
    maneuverParams: { rotationSpeed: 15, durationSec: 30 }
  },

  // ── Surveillance Expansion ──
  {
    id: "sec-sector-scan",
    name: "Sector Fan Scan",
    description: "120-degree pie slice for directional forward coverage",
    category: "security",
    formation: "sector_fan",
    spacing: 20,
    headingDeg: 0,
    altOffset: 0
  },
  {
    id: "sec-starburst-watch",
    name: "Starburst Overwatch",
    description: "Radial ray pattern for 360-degree coverage from a central point",
    category: "security",
    formation: "starburst",
    spacing: 25,
    headingDeg: 0,
    altOffset: 0,
    maneuver: "perimeter",
    maneuverParams: { radius: 120, speed: 3, durationSec: 30 }
  },
  {
    id: "sec-ring-layers",
    name: "Layered Ring Watch",
    description: "Concentric rings for persistent multi-depth surveillance",
    category: "security",
    formation: "concentric_rings",
    spacing: 20,
    headingDeg: 0,
    altOffset: 3
  }
];

export const DEFAULT_SCENARIO_PRESETS: ScenarioPreset[] = RAW_DEFAULT_SCENARIO_PRESETS.map(normalizeScenarioPreset);

export const SCENARIO_PRESETS = DEFAULT_SCENARIO_PRESETS;

export function presetSupportsContext(preset: ScenarioPreset, context: ScenarioPresetContext): boolean {
  const supportedContexts = preset.supportedContexts ?? inferScenarioPresetContexts(preset);
  return supportedContexts.includes(context);
}

export function findDefaultScenarioPreset(presetId: string): ScenarioPreset | undefined {
  return DEFAULT_SCENARIO_PRESETS.find((preset) => preset.id === presetId);
}

export function applyScenarioPresetConfig(
  preset: ScenarioPreset,
  config?: ScenarioPresetConfigRecord | null
): ScenarioPreset {
  if (!config) {
    return { ...preset, customized: false };
  }

  let maneuverParams = preset.maneuverParams;
  if (typeof config.maneuverJson === "string" && config.maneuverJson.length > 0) {
    try {
      const parsed = JSON.parse(config.maneuverJson) as Record<string, unknown>;
      maneuverParams = parsed;
    } catch {
      maneuverParams = preset.maneuverParams;
    }
  }

  return {
    ...preset,
    formation: config.formation as FormationName,
    spacing: config.spacing,
    headingDeg: config.headingDeg,
    altOffset: config.altOffset,
    maneuverParams,
    customized: true
  };
}

export function applyScenarioPresetConfigs(
  presets: ScenarioPreset[],
  configs: ScenarioPresetConfigRecord[]
): ScenarioPreset[] {
  const configById = new Map(configs.map((config) => [config.presetId, config]));
  return presets.map((preset) => applyScenarioPresetConfig(preset, configById.get(preset.id)));
}
