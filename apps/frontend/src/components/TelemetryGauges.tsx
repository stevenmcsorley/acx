import type { DroneTelemetry } from "../types/domain";
import { useGroundControlStore } from "../store/useGroundControlStore";

interface TelemetryGaugesProps {
  selectedDroneId: string | null;
  telemetryByDrone: Record<string, DroneTelemetry>;
}

function RadialGauge({
  label,
  value,
  max,
  unit,
  color,
  warningThreshold,
  invertWarning,
  precision = 0
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  color: string;
  warningThreshold?: number;
  invertWarning?: boolean;
  precision?: number;
}): JSX.Element {
  const pct = Math.min(value / max, 1);
  const isWarning = warningThreshold !== undefined
    ? invertWarning
      ? value < warningThreshold
      : value > warningThreshold
    : false;

  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75;
  const dashOffset = arcLength - arcLength * pct;
  const strokeColor = isWarning ? "#ff4863" : color;

  return (
    <div className="gauge-container flex flex-col items-center">
      <svg width="80" height="66" viewBox="0 0 80 72" className="gauge-svg">
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="rgba(61,224,255,0.1)"
          strokeWidth="5"
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset="0"
          strokeLinecap="round"
          transform="rotate(135 40 40)"
        />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="5"
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(135 40 40)"
          className="gauge-arc"
          style={{ filter: `drop-shadow(0 0 4px ${strokeColor}40)` }}
        />
        <text x="40" y="38" textAnchor="middle" className="fill-white text-[13px] font-semibold" fontFamily="Orbitron">
          {precision > 0 ? value.toFixed(precision) : Math.round(value)}
        </text>
        <text x="40" y="50" textAnchor="middle" className="fill-cyan-100/50 text-[8px]" fontFamily="Rajdhani">
          {unit}
        </text>
      </svg>
      <div className="mt-[-4px] text-[9px] uppercase tracking-[0.12em] text-cyan-100/60">{label}</div>
    </div>
  );
}

export function TelemetryGauges({ selectedDroneId, telemetryByDrone }: TelemetryGaugesProps): JSX.Element {
  // Subscribe directly to the store for guaranteed live updates.
  const liveTelemetry = useGroundControlStore((s) =>
    selectedDroneId ? s.telemetryByDrone[selectedDroneId] : undefined
  );
  const visualAltitude = useGroundControlStore((s) =>
    selectedDroneId ? s.visualAltitudeByDrone[selectedDroneId] : undefined
  );
  const telemetry = liveTelemetry ?? (selectedDroneId ? telemetryByDrone[selectedDroneId] : undefined);

  return (
    <div className="panel flex flex-col overflow-hidden p-2">
      <h3 className="panel-title mb-1 px-1 text-[11px]">Telemetry Overview</h3>
      <div className="grid flex-1 grid-cols-2 grid-rows-2 place-items-center gap-1">
        <RadialGauge
          label="Battery"
          value={telemetry?.batteryPct ?? 0}
          max={100}
          unit="%"
          color="#5af58c"
          warningThreshold={20}
          invertWarning
        />
        <RadialGauge
          label="Signal"
          value={telemetry?.signalPct ?? 0}
          max={100}
          unit="%"
          color="#3de0ff"
          warningThreshold={15}
          invertWarning
        />
        <RadialGauge
          label="Altitude"
          value={visualAltitude ?? telemetry?.position.alt ?? 0}
          max={500}
          unit="m"
          color="#f5b14a"
          precision={1}
        />
        <RadialGauge
          label="Speed"
          value={telemetry?.velocity.speed ?? 0}
          max={30}
          unit="m/s"
          color="#3de0ff"
          precision={1}
        />
      </div>
    </div>
  );
}
