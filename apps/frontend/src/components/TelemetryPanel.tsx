import type { AlertEvent, DroneTelemetry } from "../types/domain";
import { formatSpeedMph } from "../lib/speedUnits";

interface TelemetryPanelProps {
  selectedDroneId: string | null;
  telemetryByDrone: Record<string, DroneTelemetry>;
  alerts: AlertEvent[];
}

export function TelemetryPanel({ selectedDroneId, telemetryByDrone, alerts }: TelemetryPanelProps): JSX.Element {
  const telemetry = selectedDroneId ? telemetryByDrone[selectedDroneId] : undefined;

  return (
    <aside className="panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-cyan-300/15 px-3 py-2">
        <h2 className="panel-title text-[11px]">Telemetry Detail</h2>
      </div>

      <div className="grid grid-cols-2 gap-1.5 px-3 py-2">
        <div className="metric-card">
          <div className="text-[9px] uppercase text-cyan-100/50">Battery</div>
          <strong className={telemetry && telemetry.batteryPct < 20 ? "text-accent-red" : "text-accent-green"}>
            {telemetry ? `${Math.round(telemetry.batteryPct)}%` : "--"}
          </strong>
        </div>
        <div className="metric-card">
          <div className="text-[9px] uppercase text-cyan-100/50">Signal</div>
          <strong>{telemetry ? `${Math.round(telemetry.signalPct)}%` : "--"}</strong>
        </div>
        <div className="metric-card">
          <div className="text-[9px] uppercase text-cyan-100/50">Velocity</div>
          <strong>{telemetry ? formatSpeedMph(telemetry.velocity.speed, 1) : "--"}</strong>
        </div>
        <div className="metric-card">
          <div className="text-[9px] uppercase text-cyan-100/50">Heading</div>
          <strong>{telemetry ? `${Math.round(telemetry.heading)}°` : "--"}</strong>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="rounded border border-cyan-300/15 bg-bg-900/60 p-2 text-[11px]">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <div className="text-cyan-100/50">State</div>
            <div className="text-white">{telemetry?.flightState ?? "offline"}</div>
            <div className="text-cyan-100/50">Mode</div>
            <div className="text-white">{telemetry?.mode ?? "--"}</div>
            <div className="text-cyan-100/50">Wind</div>
            <div className="text-white">{telemetry ? formatSpeedMph(telemetry.wind.speed, 1) : "--"}</div>
            <div className="text-cyan-100/50">Collision</div>
            <div className={telemetry?.collisionFlag ? "text-accent-red" : "text-white"}>
              {telemetry?.collisionFlag ? "DETECTED" : "Clear"}
            </div>
            <div className="text-cyan-100/50">Geofence</div>
            <div className={telemetry?.geofenceViolation ? "text-accent-red" : "text-white"}>
              {telemetry?.geofenceViolation ? "VIOLATION" : "OK"}
            </div>
            <div className="text-cyan-100/50">Position</div>
            <div className="text-white">
              {telemetry ? `${telemetry.position.lat.toFixed(5)}, ${telemetry.position.lon.toFixed(5)}` : "--"}
            </div>
            <div className="text-cyan-100/50">Altitude</div>
            <div className="text-white">{telemetry ? `${telemetry.position.alt.toFixed(1)}m AGL` : "--"}</div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-t border-cyan-300/15 px-3 py-2">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/60">Live Alerts</div>
        <div className="custom-scrollbar space-y-1">
          {alerts.slice(0, 15).map((alert, idx) => (
            <div
              key={`${alert.timestamp}-${alert.droneId}-${idx}`}
              className={`rounded border px-2 py-1 text-[10px] ${
                alert.severity === "critical"
                  ? "border-accent-red/40 text-red-200"
                  : alert.severity === "warning"
                    ? "border-accent-amber/40 text-amber-200"
                    : "border-cyan-300/25 text-cyan-100/80"
              }`}
            >
              <div className="font-semibold">{alert.droneId}</div>
              <div className="truncate">{alert.message}</div>
            </div>
          ))}
          {alerts.length === 0 && <div className="text-[10px] text-cyan-100/40">No alerts</div>}
        </div>
      </div>
    </aside>
  );
}
