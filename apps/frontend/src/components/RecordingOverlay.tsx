import { useState } from "react";
import clsx from "clsx";

type CameraMode = "global" | "follow" | "fpv" | "cinematic";

interface RecordingOverlayProps {
  recording: boolean;
  activeRecordings: Map<string, { cameraMode: string; elapsedSec: number }>;
  cameraMode: CameraMode;
  selectedDroneId: string | null;
  onStartRecording: (name: string, droneId: string | null, cameraMode: string) => void;
  onStopRecording: (sessionId: string) => void;
  onStopAll: () => void;
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecordingOverlay({
  recording,
  activeRecordings,
  cameraMode,
  selectedDroneId,
  onStartRecording,
  onStopRecording,
  onStopAll,
}: RecordingOverlayProps): JSX.Element {
  const [selectedCamera, setSelectedCamera] = useState<CameraMode>(cameraMode);

  const handleStart = () => {
    const timestamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    const name = `REC-${selectedCamera.toUpperCase()}-${timestamp}`;
    onStartRecording(name, selectedDroneId, selectedCamera);
  };

  return (
    <div data-recording-ignore className="absolute right-14 top-[252px] z-30 flex flex-col items-end gap-1.5">
      {/* Start recording controls */}
      <div className="flex items-center gap-1.5 rounded border border-cyan-300/15 bg-bg-900/85 px-2 py-1.5 backdrop-blur-sm">
        <select
          value={selectedCamera}
          onChange={(e) => setSelectedCamera(e.target.value as CameraMode)}
          className="rounded border border-cyan-300/15 bg-bg-800 px-1.5 py-0.5 text-[9px] uppercase text-cyan-100/70 outline-none"
        >
          <option value="global">Global</option>
          <option value="follow">Follow</option>
          <option value="fpv">FPV</option>
          <option value="cinematic">Cinematic</option>
        </select>

        <button
          onClick={handleStart}
          className="flex items-center gap-1.5 rounded bg-accent-red/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-accent-red transition hover:bg-accent-red/30"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-accent-red" />
          Rec
        </button>
      </div>

      {/* Active recordings list */}
      {recording && (
        <div className="flex flex-col gap-1 rounded border border-accent-red/30 bg-bg-900/85 px-2 py-1.5 backdrop-blur-sm">
          {Array.from(activeRecordings.entries()).map(([id, info]) => (
            <div key={id} className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-red" />
              <span className="text-[9px] uppercase text-cyan-100/60">{info.cameraMode}</span>
              <span className="font-mono text-[10px] text-accent-red">{formatElapsed(info.elapsedSec)}</span>
              <button
                onClick={() => onStopRecording(id)}
                className="rounded bg-accent-red/20 px-1.5 py-px text-[8px] uppercase text-accent-red hover:bg-accent-red/30"
              >
                Stop
              </button>
            </div>
          ))}
          {activeRecordings.size > 1 && (
            <button
              onClick={onStopAll}
              className={clsx(
                "mt-0.5 rounded bg-accent-red/15 px-2 py-0.5 text-[8px] uppercase tracking-[0.1em] text-accent-red/80 hover:bg-accent-red/25"
              )}
            >
              Stop All
            </button>
          )}
        </div>
      )}
    </div>
  );
}
