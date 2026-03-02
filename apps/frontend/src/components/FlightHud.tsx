import { useMemo } from "react";
import type { SwarmGroup } from "../store/useGroundControlStore";
import type { DroneRecord, DroneTelemetry, MissionRecord } from "../types/domain";
import { useGroundControlStore } from "../store/useGroundControlStore";

interface FlightHudProps {
  drones: DroneRecord[];
  telemetryByDrone: Record<string, DroneTelemetry>;
  telemetryHistoryByDrone: Record<string, DroneTelemetry[]>;
  missions: MissionRecord[];
  swarmGroups: SwarmGroup[];
  selectedDroneId: string | null;
  cameraMode: "global" | "follow" | "fpv" | "cinematic";
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

function formatCameraMode(mode: FlightHudProps["cameraMode"]): string {
  switch (mode) {
    case "global":
      return "Global View";
    case "follow":
      return "Follow View";
    case "fpv":
      return "FPV";
    case "cinematic":
      return "Cinematic";
    default:
      return mode;
  }
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
      return "Return To Launch";
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
    case "battery-depleted":
      return "Emergency Landing";
    default:
      return mode
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

function formatMeters(value: number, compact = false): string {
  if (!Number.isFinite(value) || value <= 0) {
    return compact ? "0m" : "0 m";
  }
  if (value >= 1000) {
    return compact ? `${(value / 1000).toFixed(2)}km` : `${(value / 1000).toFixed(2)} km`;
  }
  return compact ? `${Math.round(value)}m` : `${Math.round(value)} m`;
}

function progressFromMode(mode: string): { index: number; total: number } | null {
  const match = MISSION_WP_REGEX.exec(mode);
  if (!match) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return null;
  return { index: Math.max(1, index), total };
}

function HudMetric({
  label,
  value,
  accent = "text-cyan-100"
}: {
  label: string;
  value: string;
  accent?: string;
}): JSX.Element {
  return (
    <div className="rounded border border-cyan-300/18 bg-bg-950/78 px-3 py-2 shadow-[0_0_16px_rgba(0,0,0,0.28)] backdrop-blur-[2px]">
      <div className="text-[8px] uppercase tracking-[0.18em] text-cyan-100/45">{label}</div>
      <div className={`mt-1 font-display text-[18px] leading-none ${accent}`}>{value}</div>
    </div>
  );
}

function Pill({
  label,
  accent = "text-cyan-100/80"
}: {
  label: string;
  accent?: string;
}): JSX.Element {
  return (
    <div className={`rounded border border-cyan-300/18 bg-bg-950/78 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] ${accent}`}>
      {label}
    </div>
  );
}

function formatTelemetryStamp(timestamp: string | undefined): string {
  if (!timestamp) {
    return "--:--:--";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  return date.toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function FlightHud({
  drones,
  telemetryByDrone,
  telemetryHistoryByDrone,
  missions,
  swarmGroups,
  selectedDroneId,
  cameraMode
}: FlightHudProps): JSX.Element | null {
  const selectedDrone = selectedDroneId ? drones.find((drone) => drone.id === selectedDroneId) : undefined;
  // Subscribe directly to the store for the selected drone's telemetry to guarantee
  // live updates independent of parent re-render cycles and prop drilling.
  const liveTelemetry = useGroundControlStore((s) =>
    selectedDroneId ? s.telemetryByDrone[selectedDroneId] : undefined
  );
  const visualAltitude = useGroundControlStore((s) =>
    selectedDroneId ? s.visualAltitudeByDrone[selectedDroneId] : undefined
  );
  const telemetry = liveTelemetry ?? (selectedDroneId ? telemetryByDrone[selectedDroneId] : undefined);

  const latestMission = useMemo(() => {
    if (!selectedDroneId) return undefined;
    return missions
      .filter((mission) => mission.droneId === selectedDroneId && mission.waypoints.length > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }, [missions, selectedDroneId]);

  const missionProgress = useMemo(() => {
    if (!telemetry) return null;
    return progressFromMode(telemetry.mode);
  }, [telemetry]);

  const distanceTravelled = useMemo(() => {
    if (!selectedDroneId) return 0;
    const history = telemetryHistoryByDrone[selectedDroneId] ?? [];
    if (history.length < 2) return 0;

    let total = 0;
    for (let i = 1; i < history.length; i += 1) {
      const prev = history[i - 1];
      const next = history[i];
      total += haversineMeters(prev.position.lat, prev.position.lon, next.position.lat, next.position.lon);
    }
    return total;
  }, [selectedDroneId, telemetryHistoryByDrone]);

  const nextWaypointStats = useMemo(() => {
    if (!telemetry || !latestMission || !missionProgress) {
      return { currentWaypointLabel: "--", distanceToNext: 0 };
    }

    const waypointIndex = Math.min(Math.max(missionProgress.index - 1, 0), latestMission.waypoints.length - 1);
    const waypoint = latestMission.waypoints[waypointIndex];
    if (!waypoint) {
      return { currentWaypointLabel: "--", distanceToNext: 0 };
    }

    return {
      currentWaypointLabel: `WP ${missionProgress.index}/${missionProgress.total}`,
      distanceToNext: haversineMeters(
        telemetry.position.lat,
        telemetry.position.lon,
        waypoint.lat,
        waypoint.lon
      )
    };
  }, [latestMission, missionProgress, telemetry]);

  const swarmGroup = useMemo(() => {
    if (!selectedDroneId) return undefined;
    return swarmGroups.find(
      (group) => group.leaderId === selectedDroneId || group.followerIds.includes(selectedDroneId)
    );
  }, [selectedDroneId, swarmGroups]);

  if (!selectedDrone || !telemetry) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-[12]">
      <div className="absolute left-4 top-4 flex max-w-[56%] flex-wrap gap-2">
        <Pill label={selectedDrone.name} accent="text-white" />
        <Pill label={formatCameraMode(cameraMode)} accent="text-accent-cyan" />
        <Pill label={telemetry.flightState} accent="text-cyan-100/70" />
        <Pill label={humanizeDroneMode(telemetry.mode)} accent="text-cyan-100/55" />
        {swarmGroup ? <Pill label={`Swarm ${swarmGroup.name}`} accent="text-accent-amber" /> : null}
        <Pill label={`Live ${formatTelemetryStamp(telemetry.timestamp)}`} accent="text-accent-green" />
      </div>

      <div className="absolute right-14 top-4 grid w-[216px] grid-cols-2 gap-2">
        <HudMetric
          label="Battery"
          value={`${Math.round(telemetry.batteryPct)}%`}
          accent={telemetry.batteryPct < 20 ? "text-accent-red" : "text-accent-green"}
        />
        <HudMetric
          label="Signal"
          value={`${Math.round(telemetry.signalPct)}%`}
          accent={telemetry.signalPct < 15 ? "text-accent-red" : "text-accent-cyan"}
        />
        <HudMetric
          label="Alt"
          value={`${(visualAltitude ?? telemetry.position.alt).toFixed(1)}m`}
          accent="text-accent-amber"
        />
        <HudMetric label="Speed" value={`${telemetry.velocity.speed.toFixed(1)}m/s`} />
        <HudMetric label="Heading" value={`${Math.round(telemetry.heading)}°`} accent="text-accent-cyan" />
        <HudMetric label="Wind" value={`${telemetry.wind.speed.toFixed(1)}m/s`} accent="text-cyan-100/85" />
      </div>

      <div className="absolute bottom-11 left-4 right-16">
        <div className="grid max-w-[760px] gap-2 md:grid-cols-[1.1fr_1fr_1fr_1fr]">
          <div className="rounded border border-cyan-300/18 bg-bg-950/78 px-3 py-2 shadow-[0_0_16px_rgba(0,0,0,0.28)] backdrop-blur-[2px]">
            <div className="text-[8px] uppercase tracking-[0.18em] text-cyan-100/45">Mission</div>
            <div className="mt-1 truncate font-display text-[16px] text-white">{latestMission?.name ?? "No mission loaded"}</div>
          </div>
          <div className="rounded border border-cyan-300/18 bg-bg-950/78 px-3 py-2 shadow-[0_0_16px_rgba(0,0,0,0.28)] backdrop-blur-[2px]">
            <div className="text-[8px] uppercase tracking-[0.18em] text-cyan-100/45">Current Waypoint</div>
            <div className="mt-1 font-display text-[16px] text-accent-amber">{nextWaypointStats.currentWaypointLabel}</div>
          </div>
          <div className="rounded border border-cyan-300/18 bg-bg-950/78 px-3 py-2 shadow-[0_0_16px_rgba(0,0,0,0.28)] backdrop-blur-[2px]">
            <div className="text-[8px] uppercase tracking-[0.18em] text-cyan-100/45">To Next Waypoint</div>
            <div className="mt-1 font-display text-[16px] text-cyan-100">{formatMeters(nextWaypointStats.distanceToNext)}</div>
          </div>
          <div className="rounded border border-cyan-300/18 bg-bg-950/78 px-3 py-2 shadow-[0_0_16px_rgba(0,0,0,0.28)] backdrop-blur-[2px]">
            <div className="text-[8px] uppercase tracking-[0.18em] text-cyan-100/45">Distance Travelled</div>
            <div className="mt-1 font-display text-[16px] text-accent-cyan">{formatMeters(distanceTravelled)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
