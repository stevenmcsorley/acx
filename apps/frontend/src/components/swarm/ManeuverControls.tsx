import { useState } from "react";
import clsx from "clsx";

export type ManeuverType =
  | "orbit" | "expand" | "contract" | "rotate"
  | "search_grid" | "search_spiral" | "escort"
  | "perimeter" | "corridor";

const MANEUVERS: Array<{ id: ManeuverType; label: string; icon: string; desc: string }> = [
  { id: "orbit", label: "Orbit", icon: "◎", desc: "Circle around a point of interest" },
  { id: "expand", label: "Expand", icon: "↔", desc: "Increase spacing between drones" },
  { id: "contract", label: "Contract", icon: "→←", desc: "Decrease spacing between drones" },
  { id: "rotate", label: "Rotate", icon: "↻", desc: "Rotate formation heading" },
  { id: "search_grid", label: "Grid Search", icon: "⊞", desc: "Lawnmower sweep pattern" },
  { id: "search_spiral", label: "Spiral", icon: "◌", desc: "Expanding spiral search" },
  { id: "escort", label: "Escort", icon: "▶", desc: "Track a moving target" },
  { id: "perimeter", label: "Perimeter", icon: "⬡", desc: "Patrol perimeter boundary" },
  { id: "corridor", label: "Corridor", icon: "▬", desc: "Guard a corridor path" }
];

function SliderControl({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[11px] text-cyan-100/60">{label}</span>
      <div className="flex flex-1 items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(+e.target.value)}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-cyan-300/10 accent-accent-cyan
                     [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-cyan
                     [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(61,224,255,0.4)]"
        />
        <span className="w-14 text-right font-mono text-[11px] text-white">{value}{unit}</span>
      </div>
    </div>
  );
}

interface ManeuverControlsProps {
  activeManeuver?: string;
  maneuverProgress?: number;
  onStartManeuver: (type: ManeuverType, params: Record<string, unknown>) => void;
  onStopManeuver: () => void;
}

export function ManeuverControls({
  activeManeuver,
  maneuverProgress,
  onStartManeuver,
  onStopManeuver
}: ManeuverControlsProps): JSX.Element {
  const [selectedType, setSelectedType] = useState<ManeuverType>("orbit");
  const [orbitRadius, setOrbitRadius] = useState(80);
  const [orbitSpeed, setOrbitSpeed] = useState(6);
  const [expandTarget, setExpandTarget] = useState(50);
  const [expandDuration, setExpandDuration] = useState(10);
  const [rotateSpeed, setRotateSpeed] = useState(30);
  const [searchWidth, setSearchWidth] = useState(200);
  const [searchHeight, setSearchHeight] = useState(200);
  const [perimeterRadius, setPerimeterRadius] = useState(100);
  const [corridorWidth, setCorridorWidth] = useState(50);

  const buildParams = (): Record<string, unknown> => {
    switch (selectedType) {
      case "orbit":
        return { radius: orbitRadius, speed: orbitSpeed };
      case "expand":
        return { targetSpacing: expandTarget, duration: expandDuration };
      case "contract":
        return { targetSpacing: Math.max(5, expandTarget * 0.5), duration: expandDuration };
      case "rotate":
        return { rotationSpeed: rotateSpeed };
      case "search_grid":
        return { width: searchWidth, height: searchHeight, speed: 5 };
      case "search_spiral":
        return { maxRadius: searchWidth, speed: 5 };
      case "escort":
        return {};
      case "perimeter":
        return { radius: perimeterRadius, speed: 3 };
      case "corridor":
        return { width: corridorWidth };
      default:
        return {};
    }
  };

  if (activeManeuver) {
    const maneuverMeta =
      MANEUVERS.find((m) => m.id === activeManeuver) ??
      (activeManeuver === "hold"
        ? { id: "orbit", label: "Hold Formation", icon: "◉", desc: "Maintain anchored formation" }
        : undefined);
    return (
      <div className="rounded border border-accent-cyan/25 bg-accent-cyan/5 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-accent-cyan/15 text-lg text-accent-cyan">
              {maneuverMeta?.icon ?? "◎"}
            </div>
            <div>
              <div className="font-[Orbitron] text-[11px] uppercase tracking-wider text-accent-cyan">
                {maneuverMeta?.label ?? activeManeuver}
              </div>
              <div className="text-[10px] text-cyan-100/50">Active maneuver</div>
            </div>
          </div>
          <button className="btn-danger" onClick={onStopManeuver}>
            Stop
          </button>
        </div>
        {maneuverProgress !== undefined && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[10px]">
              <span className="text-cyan-100/50">Progress</span>
              <span className="font-mono text-accent-cyan">{Math.round(maneuverProgress * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-900/60">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent-cyan/60 to-accent-cyan transition-all duration-300"
                style={{ width: `${Math.round(maneuverProgress * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  const selectedMeta = MANEUVERS.find((m) => m.id === selectedType);

  return (
    <div className="space-y-3">
      {/* Maneuver type grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {MANEUVERS.map((m) => (
          <button
            key={m.id}
            onClick={() => setSelectedType(m.id)}
            className={clsx(
              "flex flex-col items-center justify-center gap-1 rounded border px-1 py-2 text-center transition",
              selectedType === m.id
                ? "border-accent-cyan/50 bg-accent-cyan/10 shadow-[0_0_8px_rgba(61,224,255,0.12)]"
                : "border-cyan-300/12 bg-bg-900/30 hover:border-cyan-300/25 hover:bg-bg-900/50"
            )}
          >
            <span className={clsx("text-lg leading-none", selectedType === m.id ? "text-accent-cyan" : "text-cyan-100/35")}>
              {m.icon}
            </span>
            <span className={clsx(
              "font-[Orbitron] text-[8px] uppercase tracking-wider",
              selectedType === m.id ? "text-accent-cyan" : "text-cyan-100/45"
            )}>
              {m.label}
            </span>
          </button>
        ))}
      </div>

      {/* Parameter controls */}
      <div className="rounded border border-cyan-300/12 bg-[rgba(4,15,28,0.75)] p-3 space-y-2.5">
        <div className="text-[10px] text-cyan-100/50">
          {selectedMeta?.desc}
        </div>

        {selectedType === "orbit" && (
          <>
            <SliderControl label="Radius" value={orbitRadius} onChange={setOrbitRadius} min={20} max={300} unit="m" />
            <SliderControl label="Speed" value={orbitSpeed} onChange={setOrbitSpeed} min={1} max={15} unit="m/s" />
          </>
        )}

        {(selectedType === "expand" || selectedType === "contract") && (
          <>
            <SliderControl label="Target" value={expandTarget} onChange={setExpandTarget} min={5} max={100} unit="m" />
            <SliderControl label="Duration" value={expandDuration} onChange={setExpandDuration} min={3} max={30} unit="s" />
          </>
        )}

        {selectedType === "rotate" && (
          <SliderControl label="Speed" value={rotateSpeed} onChange={setRotateSpeed} min={5} max={90} unit="d/s" />
        )}

        {(selectedType === "search_grid" || selectedType === "search_spiral") && (
          <>
            <SliderControl label={selectedType === "search_spiral" ? "Max Radius" : "Width"} value={searchWidth} onChange={setSearchWidth} min={50} max={1000} step={10} unit="m" />
            {selectedType === "search_grid" && (
              <SliderControl label="Height" value={searchHeight} onChange={setSearchHeight} min={50} max={1000} step={10} unit="m" />
            )}
          </>
        )}

        {selectedType === "perimeter" && (
          <SliderControl label="Radius" value={perimeterRadius} onChange={setPerimeterRadius} min={20} max={500} unit="m" />
        )}

        {selectedType === "corridor" && (
          <SliderControl label="Width" value={corridorWidth} onChange={setCorridorWidth} min={10} max={200} unit="m" />
        )}
      </div>

      <button
        className="btn-primary w-full"
        onClick={() => onStartManeuver(selectedType, buildParams())}
      >
        Start {selectedMeta?.label}
      </button>
    </div>
  );
}
