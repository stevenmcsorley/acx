import { useMemo } from "react";
import type { DroneRecord, DroneTelemetry, MissionRecord } from "../types/domain";

interface MissionOutcome {
  type: "success" | "aborted";
  title: string;
  subtitle: string;
}

interface WaypointOpsPanelProps {
  drones: DroneRecord[];
  telemetryByDrone: Record<string, DroneTelemetry>;
  missions: MissionRecord[];
  selectedDroneId: string | null;
  missionOutcome?: MissionOutcome | null;
  onCompleteMission?: () => void;
}

interface FleetMissionRow {
  droneId: string;
  droneName: string;
  mode: string;
  waypointIndex: number;
  waypointTotal: number;
  batteryPct: number;
  speed: number;
  lat: number;
  lon: number;
}

const MISSION_WP_REGEX = /mission-wp-(\d+)\/(\d+)/i;

function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const lat1 = aLat * toRad;
  const lat2 = bLat * toRad;
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * 6378137 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatMeters(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 m";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
  return `${Math.round(value)} m`;
}

function progressFromMode(mode: string): { index: number; total: number } | null {
  const match = MISSION_WP_REGEX.exec(mode);
  if (!match) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return null;
  return { index: Math.max(1, index), total };
}

function humanizeDroneMode(mode: string): string {
  const progress = progressFromMode(mode);
  if (progress) {
    return `Mission WP ${progress.index}/${progress.total}`;
  }

  switch (mode) {
    case "standby":
      return "Standby";
    case "armed":
      return "Armed";
    case "takeoff":
      return "Takeoff";
    case "loiter":
      return "Loiter";
    case "landing":
      return "Landing";
    case "rtl":
      return "RTL";
    case "rtl-low-signal":
      return "RTL Low Signal";
    case "rtl-low-battery":
      return "RTL Low Battery";
    case "rtl-mission-energy":
      return "RTL Energy Reserve";
    case "rtl-geofence":
      return "RTL Geofence";
    case "rtl-landing":
      return "RTL Landing";
    case "manual-stick":
      return "Manual Flight";
    case "manual-nav":
      return "Manual Nav";
    default:
      return mode
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

export function WaypointOpsPanel({
  drones,
  telemetryByDrone,
  missions,
  selectedDroneId,
  missionOutcome,
  onCompleteMission
}: WaypointOpsPanelProps): JSX.Element {
  const selectedTelemetry = selectedDroneId ? telemetryByDrone[selectedDroneId] : undefined;

  const latestMissionForSelectedDrone = useMemo(() => {
    if (!selectedDroneId) return undefined;
    return missions
      .filter((mission) => mission.droneId === selectedDroneId && mission.waypoints.length > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }, [missions, selectedDroneId]);

  const missionProgress = useMemo(() => {
    if (!selectedTelemetry) return null;
    return progressFromMode(selectedTelemetry.mode);
  }, [selectedTelemetry]);

  const routeStats = useMemo(() => {
    const waypoints = latestMissionForSelectedDrone?.waypoints ?? [];
    if (waypoints.length < 2) {
      return { totalMeters: 0, legDistances: [] as number[], cumulative: [] as number[], traveledMeters: 0, toNextMeters: 0 };
    }

    const legDistances: number[] = [];
    const cumulative: number[] = [0];
    for (let i = 1; i < waypoints.length; i += 1) {
      const d = haversineMeters(waypoints[i - 1].lat, waypoints[i - 1].lon, waypoints[i].lat, waypoints[i].lon);
      legDistances.push(d);
      cumulative.push(cumulative[cumulative.length - 1] + d);
    }
    const totalMeters = cumulative[cumulative.length - 1];

    let traveledMeters = 0;
    let toNextMeters = 0;
    if (missionProgress && selectedTelemetry && waypoints.length > 0) {
      const currentIdx = Math.min(Math.max(missionProgress.index - 1, 0), waypoints.length - 1);
      const previousIdx = Math.max(currentIdx - 1, 0);
      traveledMeters = cumulative[Math.min(previousIdx, cumulative.length - 1)] ?? 0;

      const currentWp = waypoints[currentIdx];
      toNextMeters = haversineMeters(
        selectedTelemetry.position.lat,
        selectedTelemetry.position.lon,
        currentWp.lat,
        currentWp.lon
      );

      if (currentIdx > 0) {
        const segLength = legDistances[currentIdx - 1] ?? 0;
        const distToPrev = haversineMeters(
          waypoints[previousIdx].lat,
          waypoints[previousIdx].lon,
          selectedTelemetry.position.lat,
          selectedTelemetry.position.lon
        );
        traveledMeters = Math.min(totalMeters, (cumulative[previousIdx] ?? 0) + Math.min(segLength, distToPrev));
      }
    }

    return { totalMeters, legDistances, cumulative, traveledMeters, toNextMeters };
  }, [latestMissionForSelectedDrone, missionProgress, selectedTelemetry]);

  const activeMissionFleet = useMemo<FleetMissionRow[]>(() => {
    const rows: FleetMissionRow[] = [];
    for (const drone of drones) {
      const telemetry = telemetryByDrone[drone.id];
      if (!telemetry) continue;
      const progress = progressFromMode(telemetry.mode);
      if (!progress) continue;
      rows.push({
        droneId: drone.id,
        droneName: drone.name,
        mode: telemetry.mode,
        waypointIndex: progress.index,
        waypointTotal: progress.total,
        batteryPct: telemetry.batteryPct,
        speed: telemetry.velocity.speed,
        lat: telemetry.position.lat,
        lon: telemetry.position.lon
      });
    }

    rows.sort((a, b) => a.droneName.localeCompare(b.droneName));
    return rows;
  }, [drones, telemetryByDrone]);

  const completionPct = routeStats.totalMeters > 0
    ? Math.min(100, Math.max(0, (routeStats.traveledMeters / routeStats.totalMeters) * 100))
    : 0;

  return (
    <div className="flex flex-col gap-2">
      {missionOutcome && (
        <div className="rounded border border-cyan-300/15 px-3 py-2">
          <div
            className={
              missionOutcome.type === "success"
                ? "rounded border border-accent-green/40 bg-accent-green/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-accent-green"
                : "rounded border border-accent-red/40 bg-accent-red/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-accent-red"
            }
          >
            {missionOutcome.title}
          </div>
          <button className="btn-primary mt-2 w-full text-[10px]" onClick={onCompleteMission}>
            Complete
          </button>
        </div>
      )}

      <div className="grid gap-1 grid-cols-[repeat(4,minmax(0,0.75fr))_minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,0.65fr)]">
        <div className="rounded border border-cyan-300/15 bg-bg-900/65 px-2 py-1 text-center">
          <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Mission Drones</div>
          <div className="text-[15px] font-semibold text-accent-cyan">{activeMissionFleet.length}</div>
        </div>
        <div className="rounded border border-cyan-300/15 bg-bg-900/65 px-2 py-1 text-center">
          <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Current WP</div>
          <div className="text-[15px] font-semibold text-accent-amber">
            {missionProgress ? `${missionProgress.index}/${missionProgress.total}` : "--"}
          </div>
        </div>
        <div className="rounded border border-cyan-300/15 bg-bg-900/65 px-2 py-1 text-center">
          <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">To Next</div>
          <div className="text-[15px] font-semibold text-cyan-100/90">{formatMeters(routeStats.toNextMeters)}</div>
        </div>
        <div className="rounded border border-cyan-300/15 bg-bg-900/65 px-2 py-1 text-center">
          <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Route Done</div>
          <div className="text-[15px] font-semibold text-accent-green">{Math.round(completionPct)}%</div>
        </div>
        <div className="rounded border border-cyan-300/15 bg-bg-900/65 px-2 py-1">
          <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Lat</div>
          <div className="truncate font-mono text-[12px] text-cyan-100">
            {selectedTelemetry ? selectedTelemetry.position.lat.toFixed(6) : "--"}
          </div>
        </div>
        <div className="rounded border border-cyan-300/15 bg-bg-900/65 px-2 py-1">
          <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Lon</div>
          <div className="truncate font-mono text-[12px] text-cyan-100">
            {selectedTelemetry ? selectedTelemetry.position.lon.toFixed(6) : "--"}
          </div>
        </div>
        <div className="rounded border border-cyan-300/15 bg-bg-900/65 px-2 py-1 text-center">
          <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Speed</div>
          <div className="text-[15px] font-semibold text-cyan-100/90">
            {selectedTelemetry ? `${Math.round(selectedTelemetry.velocity.speed)}` : "--"}
          </div>
          <div className="text-[8px] uppercase tracking-[0.08em] text-cyan-100/35">m/s</div>
        </div>
      </div>

      <div className="grid min-h-0 gap-2 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-hidden rounded border border-cyan-300/12 bg-bg-900/35">
          <div className="border-b border-cyan-300/12 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100/55">
            Fleet Mission Status
          </div>
          <div className="custom-scrollbar max-h-[180px] overflow-auto p-1.5">
            {activeMissionFleet.length === 0 ? (
              <div className="text-[11px] text-cyan-100/40">No drones currently executing missions.</div>
            ) : (
              <div className="space-y-1">
                {activeMissionFleet.map((row) => (
                  <div
                    key={row.droneId}
                    className="rounded border border-cyan-300/15 bg-bg-900/60 px-2 py-1.5 text-[10px] text-cyan-100/80"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{row.droneName}</span>
                      <span className="text-accent-amber">WP {row.waypointIndex}/{row.waypointTotal}</span>
                    </div>
                    <div className="mt-0.5 grid grid-cols-3 gap-1 text-[9px] text-cyan-100/55">
                      <span>{Math.round(row.batteryPct)}%</span>
                      <span>{Math.round(row.speed)} m/s</span>
                      <span className="truncate">{humanizeDroneMode(row.mode)}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[9px] text-cyan-100/45">
                      {row.lat.toFixed(5)}, {row.lon.toFixed(5)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 overflow-hidden rounded border border-cyan-300/12 bg-bg-900/35">
          <div className="flex items-center justify-between border-b border-cyan-300/12 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100/55">
            <span>Waypoint Stats</span>
            <span className="text-cyan-100/40">{latestMissionForSelectedDrone?.name ?? "No mission selected"}</span>
          </div>
          <div className="custom-scrollbar max-h-[180px] overflow-auto">
            {latestMissionForSelectedDrone?.waypoints?.length ? (
              <table className="w-full text-left text-[10px]">
                <thead className="sticky top-0 z-10 bg-bg-900/90 text-cyan-100/60">
                  <tr>
                    <th className="px-2 py-1">WP</th>
                    <th className="px-2 py-1">Lat</th>
                    <th className="px-2 py-1">Lon</th>
                    <th className="px-2 py-1">Alt</th>
                    <th className="px-2 py-1">Hover</th>
                    <th className="px-2 py-1">Leg</th>
                    <th className="px-2 py-1">Cum</th>
                    <th className="px-2 py-1">State</th>
                  </tr>
                </thead>
                <tbody>
                  {latestMissionForSelectedDrone.waypoints.map((wp, index) => {
                    const isCurrent = missionProgress ? index === missionProgress.index - 1 : false;
                    const isDone = missionProgress ? index < missionProgress.index - 1 : false;
                    const isPending = !isCurrent && !isDone;
                    const legDistance = index === 0 ? 0 : (routeStats.legDistances[index - 1] ?? 0);
                    const cumulative = index === 0 ? 0 : (routeStats.cumulative[index - 1] ?? 0);
                    return (
                      <tr
                        key={`${wp.lat}-${wp.lon}-${index}`}
                        className={
                          isCurrent
                            ? "border-b border-cyan-300/10 bg-accent-amber/12 shadow-[inset_3px_0_0_rgba(245,177,74,0.9)]"
                            : isDone
                              ? "border-b border-cyan-300/10 bg-accent-green/10 shadow-[inset_3px_0_0_rgba(90,245,140,0.85)]"
                              : "border-b border-cyan-300/10 bg-bg-900/15"
                        }
                      >
                        <td className="px-2 py-1 font-semibold">{index + 1}</td>
                        <td className="px-2 py-1 font-mono">{wp.lat.toFixed(5)}</td>
                        <td className="px-2 py-1 font-mono">{wp.lon.toFixed(5)}</td>
                        <td className="px-2 py-1">{Math.round(wp.alt)}m</td>
                        <td className="px-2 py-1">{Math.round(wp.hover)}s</td>
                        <td className="px-2 py-1">{formatMeters(legDistance)}</td>
                        <td className="px-2 py-1">{formatMeters(cumulative)}</td>
                        <td className="px-2 py-1">
                          {isCurrent ? (
                            <span className="rounded border border-accent-amber/50 bg-accent-amber/12 px-1.5 py-0.5 text-accent-amber">Current</span>
                          ) : isDone ? (
                            <span className="rounded border border-accent-green/50 bg-accent-green/12 px-1.5 py-0.5 text-accent-green">Done</span>
                          ) : (
                            <span className="rounded border border-cyan-300/18 bg-bg-900/45 px-1.5 py-0.5 text-cyan-100/45">
                              {isPending ? "Pending" : "--"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="p-3 text-[11px] text-cyan-100/40">
                No mission waypoints available for selected drone.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
