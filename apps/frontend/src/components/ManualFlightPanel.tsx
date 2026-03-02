import { useCallback, useEffect, useRef, useState } from "react";

interface ManualFlightPanelProps {
  selectedDroneId: string | null;
  onManualControl: (input: { forward: number; right: number; up: number; yawRate: number; nowMs: number }) => void;
  recording: boolean;
  onToggleRecording: () => void;
  onSaveRecording: () => void;
  recordedPoints: number;
}

const CONTROL_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "q",
  "e",
  "r",
  "f",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "pageup",
  "pagedown",
  " ",
  "shift"
]);

export function ManualFlightPanel({
  selectedDroneId,
  onManualControl,
  recording,
  onToggleRecording,
  onSaveRecording,
  recordedPoints
}: ManualFlightPanelProps): JSX.Element {
  const [speedLimit, setSpeedLimit] = useState(8);
  const [verticalRate, setVerticalRate] = useState(3);
  const [yawRate, setYawRate] = useState(90);

  const keysRef = useRef<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedDroneIdRef = useRef<string | null>(selectedDroneId);
  const onManualControlRef = useRef(onManualControl);
  const speedLimitRef = useRef(speedLimit);
  const verticalRateRef = useRef(verticalRate);
  const yawRateRef = useRef(yawRate);
  const wasActiveRef = useRef(false);

  // Smooth input ramping - current output values ramp toward target over time.
  const smoothRef = useRef({ forward: 0, right: 0, up: 0, yaw: 0 });
  const RAMP_UP = 0.25; // fraction of target reached per 50ms tick when pressing
  const RAMP_DOWN = 0.35; // fraction decayed per 50ms tick when released

  useEffect(() => {
    selectedDroneIdRef.current = selectedDroneId;
  }, [selectedDroneId]);

  useEffect(() => {
    onManualControlRef.current = onManualControl;
  }, [onManualControl]);

  useEffect(() => {
    speedLimitRef.current = speedLimit;
  }, [speedLimit]);

  useEffect(() => {
    verticalRateRef.current = verticalRate;
  }, [verticalRate]);

  useEffect(() => {
    yawRateRef.current = yawRate;
  }, [yawRate]);

  const sendManualControl = useCallback(() => {
    if (!selectedDroneIdRef.current) {
      return;
    }

    const keys = keysRef.current;
    const speed = speedLimitRef.current;
    const climb = verticalRateRef.current;
    const yaw = yawRateRef.current;

    // Compute raw target values from key state.
    const targetForward = (keys.has("w") || keys.has("arrowup") ? speed : 0) + (keys.has("s") || keys.has("arrowdown") ? -speed : 0);
    const targetRight = (keys.has("d") || keys.has("arrowright") ? speed : 0) + (keys.has("a") || keys.has("arrowleft") ? -speed : 0);
    const targetUp = (keys.has("r") || keys.has("pageup") || keys.has(" ") ? climb : 0) + (keys.has("f") || keys.has("pagedown") || keys.has("shift") ? -climb : 0);
    const targetYaw = (keys.has("e") ? yaw : 0) + (keys.has("q") ? -yaw : 0);

    // Smooth ramp: lerp current values toward targets.
    const s = smoothRef.current;
    const ramp = (current: number, target: number): number => {
      if (Math.abs(target) > Math.abs(current) || Math.sign(target) !== Math.sign(current) && target !== 0) {
        // Ramping up or reversing
        return current + (target - current) * RAMP_UP;
      }
      if (target === 0) {
        // Ramping down — decay toward zero
        return Math.abs(current) < 0.1 ? 0 : current * (1 - RAMP_DOWN);
      }
      return current + (target - current) * RAMP_UP;
    };

    s.forward = ramp(s.forward, targetForward);
    s.right = ramp(s.right, targetRight);
    s.up = ramp(s.up, targetUp);
    s.yaw = ramp(s.yaw, targetYaw);

    const isActive = Math.abs(s.forward) > 0.05 || Math.abs(s.right) > 0.05 || Math.abs(s.up) > 0.05 || Math.abs(s.yaw) > 0.5;

    if (isActive) {
      wasActiveRef.current = true;
      onManualControlRef.current({
        forward: s.forward,
        right: s.right,
        up: s.up,
        yawRate: s.yaw,
        nowMs: Date.now()
      });
      return;
    }

    if (wasActiveRef.current) {
      wasActiveRef.current = false;
      s.forward = 0;
      s.right = 0;
      s.up = 0;
      s.yaw = 0;
      onManualControlRef.current({
        forward: 0,
        right: 0,
        up: 0,
        yawRate: 0,
        nowMs: Date.now()
      });
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      if (tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable) {
        return;
      }

      const key = event.key.toLowerCase();
      if (CONTROL_KEYS.has(key)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        keysRef.current.add(key);
        sendManualControl();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (CONTROL_KEYS.has(key)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      }
      keysRef.current.delete(key);
      sendManualControl();
    };

    const onWindowBlur = () => {
      keysRef.current.clear();
      wasActiveRef.current = false;
      onManualControlRef.current({
        forward: 0,
        right: 0,
        up: 0,
        yawRate: 0,
        nowMs: Date.now()
      });
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    window.addEventListener("blur", onWindowBlur);
    intervalRef.current = setInterval(sendManualControl, 50);

    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
      window.removeEventListener("blur", onWindowBlur);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [sendManualControl]);

  return (
    <section className="panel flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="panel-title text-[11px]">Manual Flight</h3>
        <span className="text-[10px] text-cyan-100/50">{selectedDroneId ?? "No drone"}</span>
      </div>

      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <div className="flex justify-center"><div className="rounded border border-cyan-300/25 bg-bg-900/70 px-2 py-1 text-cyan-100/70">Q</div></div>
        <div className="flex justify-center"><div className="rounded border border-cyan-300/25 bg-bg-900/70 px-2 py-1 text-cyan-100/70">W</div></div>
        <div className="flex justify-center"><div className="rounded border border-cyan-300/25 bg-bg-900/70 px-2 py-1 text-cyan-100/70">E</div></div>
        <div className="flex justify-center"><div className="rounded border border-cyan-300/25 bg-bg-900/70 px-2 py-1 text-cyan-100/70">A</div></div>
        <div className="flex justify-center"><div className="rounded border border-cyan-300/25 bg-bg-900/70 px-2 py-1 text-cyan-100/70">S</div></div>
        <div className="flex justify-center"><div className="rounded border border-cyan-300/25 bg-bg-900/70 px-2 py-1 text-cyan-100/70">D</div></div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded border border-cyan-300/20 bg-bg-900/70 px-2 py-1 text-cyan-100/70">Up: R / PgUp / Space</div>
        <div className="rounded border border-cyan-300/20 bg-bg-900/70 px-2 py-1 text-cyan-100/70">Down: F / PgDn / Shift</div>
      </div>

      <div className="space-y-2">
        <div className="rounded border border-cyan-300/15 bg-bg-900/60 p-2">
          <div className="mb-1 text-[9px] uppercase tracking-[0.1em] text-cyan-100/50">Lateral Speed</div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={20}
              value={speedLimit}
              onChange={(event) => setSpeedLimit(Number(event.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-cyan-300/20 accent-accent-amber"
            />
            <span className="w-14 text-right font-mono text-[11px] text-white">{speedLimit} m/s</span>
          </div>
        </div>

        <div className="rounded border border-cyan-300/15 bg-bg-900/60 p-2">
          <div className="mb-1 text-[9px] uppercase tracking-[0.1em] text-cyan-100/50">Vertical Rate</div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={8}
              value={verticalRate}
              onChange={(event) => setVerticalRate(Number(event.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-cyan-300/20 accent-accent-cyan"
            />
            <span className="w-14 text-right font-mono text-[11px] text-white">{verticalRate} m/s</span>
          </div>
        </div>

        <div className="rounded border border-cyan-300/15 bg-bg-900/60 p-2">
          <div className="mb-1 text-[9px] uppercase tracking-[0.1em] text-cyan-100/50">Yaw Rate</div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={20}
              max={180}
              value={yawRate}
              onChange={(event) => setYawRate(Number(event.target.value))}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-cyan-300/20 accent-accent-cyan"
            />
            <span className="w-14 text-right font-mono text-[11px] text-white">{yawRate} deg/s</span>
          </div>
        </div>
      </div>

      <div className="flex gap-1.5">
        <button
          className={recording ? "btn-danger flex-1 text-[10px]" : "btn-secondary flex-1 text-[10px]"}
          onClick={onToggleRecording}
          disabled={!selectedDroneId}
        >
          {recording ? `Recording (${recordedPoints})` : "Record Path"}
        </button>
        <button className="btn-primary flex-1 text-[10px]" onClick={onSaveRecording} disabled={recordedPoints === 0}>
          Save as Mission
        </button>
      </div>

      <div className="text-[9px] text-cyan-100/40">Realtime stick control over WebSocket (20Hz).</div>
    </section>
  );
}
