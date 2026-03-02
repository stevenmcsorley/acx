import { useState } from "react";
import type { DroneTelemetry } from "../types/domain";

interface CommandPanelProps {
  selectedDroneId: string | null;
  telemetry?: DroneTelemetry;
  cameraMode?: "global" | "follow" | "fpv" | "cinematic";
  fpvPitchDeg?: number;
  onFpvPitchChange?: (deg: number) => void;
  onCommand: (type: "arm" | "disarm" | "takeoff" | "land" | "rtl", params?: Record<string, unknown>) => void;
}

export function CommandPanel({ selectedDroneId, telemetry, cameraMode, fpvPitchDeg = 0, onFpvPitchChange, onCommand }: CommandPanelProps): JSX.Element {
  const [takeoffAlt, setTakeoffAlt] = useState(60);

  return (
    <section className="panel flex flex-col gap-2 p-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="panel-title text-[11px]">Drone Command</div>
        <div className="max-w-[55%] truncate text-[10px] text-cyan-100/60">{selectedDroneId ?? "No drone"}</div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <button className="btn-primary cmd-btn min-w-0 w-full whitespace-nowrap" disabled={!selectedDroneId} onClick={() => onCommand("arm")}>
          Arm
        </button>
        <button className="btn-secondary cmd-btn min-w-0 w-full whitespace-nowrap" disabled={!selectedDroneId} onClick={() => onCommand("disarm")}>
          Disarm
        </button>
        <button
          className="btn-primary cmd-btn min-w-0 w-full whitespace-nowrap"
          disabled={!selectedDroneId}
          onClick={() => onCommand("takeoff", { altitude: takeoffAlt })}
        >
          Takeoff
        </button>
        <button className="btn-secondary cmd-btn min-w-0 w-full whitespace-nowrap" disabled={!selectedDroneId} onClick={() => onCommand("land")}>
          Land
        </button>
        <button className="btn-danger cmd-btn col-span-2 min-w-0 w-full whitespace-nowrap" disabled={!selectedDroneId} onClick={() => onCommand("rtl")}>
          RTL
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-cyan-300/15 bg-bg-900/60 p-2">
          <div className="mb-1 text-[9px] uppercase tracking-[0.1em] text-cyan-100/50">Takeoff Alt</div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={10}
              max={200}
              value={takeoffAlt}
              onChange={(e) => setTakeoffAlt(Number(e.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-cyan-300/20 accent-accent-cyan"
            />
            <span className="w-10 text-right font-mono text-[11px] text-white">{takeoffAlt}m</span>
          </div>
        </div>
        <div className="rounded border border-cyan-300/15 bg-bg-900/60 p-2">
          <div className="mb-1 text-[9px] uppercase tracking-[0.1em] text-cyan-100/50">Heading</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-white">{Math.round(telemetry?.heading ?? 0)}°</span>
            <span className="text-[10px] text-cyan-100/50">
              {telemetry?.flightState ?? "offline"}
            </span>
          </div>
        </div>
      </div>

      {cameraMode === "fpv" && onFpvPitchChange && (
        <div className="rounded border border-cyan-300/15 bg-bg-900/60 p-2">
          <div className="mb-1 text-[9px] uppercase tracking-[0.1em] text-cyan-100/50">FPV Camera Pitch</div>
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-cyan-300/25 bg-bg-900/70 px-1.5 py-0.5 text-[10px] text-cyan-100/70 hover:text-white"
              onClick={() => onFpvPitchChange(Math.max(-60, fpvPitchDeg - 5))}
            >
              Down
            </button>
            <input
              type="range"
              min={-60}
              max={30}
              value={fpvPitchDeg}
              onChange={(e) => onFpvPitchChange(Number(e.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-cyan-300/20 accent-accent-cyan"
            />
            <button
              className="rounded border border-cyan-300/25 bg-bg-900/70 px-1.5 py-0.5 text-[10px] text-cyan-100/70 hover:text-white"
              onClick={() => onFpvPitchChange(Math.min(30, fpvPitchDeg + 5))}
            >
              Up
            </button>
            <span className="w-12 text-right font-mono text-[11px] text-white">{fpvPitchDeg}°</span>
          </div>
          <button
            className="mt-1 text-[9px] text-cyan-100/40 hover:text-cyan-100/70"
            onClick={() => onFpvPitchChange(0)}
          >
            Reset to level
          </button>
        </div>
      )}

      <div className="text-[9px] text-cyan-100/40">
        Arm powers motors. Uploaded missions require explicit Execute.
      </div>
    </section>
  );
}
