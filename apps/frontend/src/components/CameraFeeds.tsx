import type { DroneRecord, DroneTelemetry } from "../types/domain";
import { useGroundControlStore } from "../store/useGroundControlStore";
import { formatSpeedMph } from "../lib/speedUnits";

interface CameraFeedsProps {
  drones: DroneRecord[];
  telemetryByDrone: Record<string, DroneTelemetry>;
  selectedDroneId: string | null;
}

export function CameraFeeds({ drones, telemetryByDrone, selectedDroneId }: CameraFeedsProps): JSX.Element {
  const visualAltitudeByDrone = useGroundControlStore((s) => s.visualAltitudeByDrone);
  const activeDrones = drones.filter((d) => {
    const t = telemetryByDrone[d.id];
    return t && ["airborne", "taking_off", "rtl", "landing"].includes(t.flightState);
  });

  const feedDrones = activeDrones.length > 0
    ? activeDrones.slice(0, 4)
    : drones.slice(0, 4);

  while (feedDrones.length < 4) {
    feedDrones.push(undefined as unknown as DroneRecord);
  }

  return (
    <div className="panel flex flex-col overflow-hidden p-2">
      <h3 className="panel-title mb-2 px-1 text-[11px]">Camera Feeds</h3>
	      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1.5">
	        {feedDrones.slice(0, 4).map((drone, idx) => {
	          const tel = drone ? telemetryByDrone[drone.id] : undefined;
            const visualAltitude = drone ? visualAltitudeByDrone[drone.id] : undefined;
	          const isSelected = drone?.id === selectedDroneId;

          return (
            <div
              key={drone?.id ?? `empty-${idx}`}
              className={`camera-feed relative flex items-center justify-center overflow-hidden rounded border ${
                isSelected
                  ? "border-accent-amber/60"
                  : "border-cyan-300/15"
              } bg-bg-900/80`}
            >
	              {drone ? (
	                <>
	                  <div className="absolute inset-0 flex items-center justify-center">
	                    <div className="text-center">
	                      <div className="camera-scanline text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/30">
	                        NO SIGNAL
	                      </div>
	                      <div className="mt-1 text-[9px] text-cyan-100/20">WebRTC Ready</div>
	                    </div>
	                  </div>
	                  <div className="absolute left-1.5 top-1.5 flex items-center gap-1.5">
	                    <span
	                      className={`status-dot ${
	                        tel && ["airborne", "taking_off"].includes(tel.flightState)
	                          ? "status-dot-pulse bg-accent-green"
                          : tel?.flightState === "emergency"
                            ? "status-dot-pulse bg-accent-red"
                            : "bg-cyan-100/40"
                      }`}
	                    />
	                    <span className="text-[10px] font-semibold text-white">{drone.name}</span>
	                  </div>
	                  <div className="absolute right-1.5 top-1.5 rounded border border-cyan-300/15 bg-bg-950/80 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.1em] text-accent-green">
	                    {tel ? "Live" : "Idle"}
	                  </div>
	                  <div className="absolute bottom-1.5 left-1.5 right-1.5 rounded border border-cyan-300/15 bg-bg-950/82 px-2 py-1.5">
	                    <div className="grid grid-cols-2 gap-x-2.5 gap-y-1 text-[7px] uppercase tracking-[0.08em] text-cyan-100/48">
	                      <span className="whitespace-nowrap">
	                        Bat{" "}
	                        <strong className="whitespace-nowrap font-semibold text-cyan-100/85">
	                          {tel ? `${Math.round(tel.batteryPct)}%` : "--"}
	                        </strong>
	                      </span>
	                      <span className="whitespace-nowrap">
	                        Sig{" "}
	                        <strong className="whitespace-nowrap font-semibold text-cyan-100/85">
	                          {tel ? `${Math.round(tel.signalPct)}%` : "--"}
	                        </strong>
	                      </span>
	                      <span className="whitespace-nowrap">
	                        Alt{" "}
	                        <strong className="whitespace-nowrap font-semibold text-cyan-100/85">
	                          {tel ? `${Math.round(visualAltitude ?? tel.position.alt)}m` : "--"}
	                        </strong>
	                      </span>
	                      <span className="whitespace-nowrap">
	                        Spd{" "}
	                        <strong className="whitespace-nowrap font-semibold text-cyan-100/85">
	                          {tel ? formatSpeedMph(tel.velocity.speed, 0) : "--"}
	                        </strong>
	                      </span>
	                    </div>
	                  </div>
	                </>
	              ) : (
	                <div className="text-[10px] text-cyan-100/20">OFFLINE</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
