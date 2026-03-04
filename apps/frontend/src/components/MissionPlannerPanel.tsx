import { useEffect, useMemo, useRef, useState } from "react";
import type { MissionWaypoint, CameraViewMode, DroneTelemetry, MissionRecord, ScenarioPreset } from "../types/domain";
import type { SwarmGroup } from "../store/useGroundControlStore";
import type { WaypointDefaults } from "../store/useGroundControlStore";
import { MAX_CUSTOM_DRONE_SPEED_MPH, mphToMps, mpsToMph } from "../lib/speedUnits";
import { numericParam } from "../lib/swarmPresets";
import { findScenarioPreset } from "../lib/swarmPresetLookup";
import {
  detectFormat,
  parseLitchiCsv,
  parseKml,
  exportLitchiCsv,
  exportKml,
} from "../utils/missionFileParser";

interface MissionPlannerPanelProps {
  plannerEnabled: boolean;
  waypoints: MissionWaypoint[];
  selectedDroneId?: string | null;
  selectedTelemetry?: DroneTelemetry;
  latestMission?: MissionRecord | null;
  swarmGroups?: SwarmGroup[];
  swarmPresets?: ScenarioPreset[];
  ghostPreviewOptions?: {
    enabled: boolean;
    showArea: boolean;
    showTracks: boolean;
    showMarkers: boolean;
  };
  selectedMissionName?: string;
  editingMissionName?: string | null;
  selectedWaypointIndex?: number | null;
  canExecuteMission: boolean;
  embedded?: boolean;
  missionOutcome?: { type: "success" | "aborted"; title: string } | null;
  missionName?: string;
  onMissionNameChange?: (name: string) => void;
  onTogglePlanner: (enabled: boolean) => void;
  onClear: () => void;
  onCompleteMission?: () => void;
  waypointDefaults?: WaypointDefaults;
  onWaypointDefaultsChange?: (partial: Partial<WaypointDefaults>) => void;
  onApplyDefaultsToAll?: () => void;
  onImportFile: (waypoints: MissionWaypoint[], name: string) => void;
  onUpload: () => void;
  onExecuteMission: () => void;
  onGhostPreviewOptionsChange?: (
    patch: Partial<{
      enabled: boolean;
      showArea: boolean;
      showTracks: boolean;
      showMarkers: boolean;
    }>
  ) => void;
}

const MISSION_WP_REGEX = /mission-wp-(\d+)\/(\d+)/i;
const DEFAULT_ESTIMATE_SPEED_MPS = mphToMps(25);

function buildSearchGridLanePlan(width: number, spacing: number, droneCount: number): { laneCount: number; laneStride: number } {
  const effectiveDroneCount = Math.max(droneCount, 1);
  const desiredLaneSpacing = Math.max(spacing, 10);
  const minimumLaneCount = Math.max(effectiveDroneCount, Math.floor(width / desiredLaneSpacing) + 1);
  const laneCount = Math.max(effectiveDroneCount, Math.ceil(minimumLaneCount / effectiveDroneCount) * effectiveDroneCount);
  const actualLaneSpacing = laneCount > 1 ? width / (laneCount - 1) : 0;
  return { laneCount, laneStride: actualLaneSpacing * effectiveDroneCount };
}

function estimateSearchGridPathMeters(width: number, height: number, spacing: number, droneCount: number): number {
  const effectiveDroneCount = Math.max(droneCount, 1);
  const { laneCount, laneStride } = buildSearchGridLanePlan(width, spacing, effectiveDroneCount);
  const bandCount = laneCount / effectiveDroneCount;
  return bandCount * height + Math.max(0, bandCount - 1) * laneStride;
}

function estimateSearchSpiralPathMeters(maxRadius: number, spacing: number): number {
  const spiralRate = Math.max((spacing * 1.5) / (2 * Math.PI), 2);
  const maxTheta = Math.max(maxRadius / Math.max(spiralRate, 0.1), Math.PI * 2);
  const steps = 96;
  let total = 0;
  let prevX = 0;
  let prevY = 0;
  for (let step = 1; step <= steps; step += 1) {
    const theta = (step / steps) * maxTheta;
    const radius = Math.min(spiralRate * theta, maxRadius);
    const x = Math.cos(theta) * radius;
    const y = Math.sin(theta) * radius;
    total += Math.hypot(x - prevX, y - prevY);
    prevX = x;
    prevY = y;
  }
  return total;
}

function estimateExpandingSquarePathMeters(maxRadius: number, legSpacing: number): number {
  let total = 0;
  let maxExtent = 0;
  let segmentIndex = 0;
  while (maxExtent < maxRadius + legSpacing) {
    const length = Math.ceil((segmentIndex + 1) / 2) * legSpacing;
    total += length;
    maxExtent = Math.max(maxExtent, length);
    segmentIndex += 1;
  }
  return total;
}

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

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "--";
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function progressFromMode(mode: string): { index: number; total: number } | null {
  const match = MISSION_WP_REGEX.exec(mode);
  if (!match) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return null;
  return { index: Math.max(1, index), total };
}

function humanizeMode(mode: string): string {
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
    case "route-complete-rtl":
      return "Route Complete RTL";
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

function humanizeManeuver(maneuver?: string): string {
  if (!maneuver) return "--";
  return maneuver
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeTriggerMode(triggerMode?: string): string {
  return triggerMode === "mission_start" ? "Mission Start" : "On Reach Waypoint";
}

function humanizeEventMode(eventMode?: string): string {
  return eventMode === "final_destination" ? "Final Destination" : "Transit Event";
}

function humanizeStopRule(stopRule?: string): string {
  return stopRule === "manual_confirm" ? "Manual Stop" : "Timed";
}

export function MissionPlannerPanel({
  plannerEnabled,
  waypoints,
  selectedDroneId = null,
  selectedTelemetry,
  latestMission = null,
  swarmGroups = [],
  swarmPresets = [],
  ghostPreviewOptions = { enabled: true, showArea: true, showTracks: true, showMarkers: true },
  selectedMissionName,
  editingMissionName = null,
  selectedWaypointIndex = null,
  canExecuteMission,
  embedded = false,
  missionOutcome,
  missionName = "",
  onMissionNameChange,
  waypointDefaults,
  onWaypointDefaultsChange,
  onApplyDefaultsToAll,
  onTogglePlanner,
  onImportFile,
  onClear,
  onCompleteMission,
  onUpload,
  onExecuteMission,
  onGhostPreviewOptionsChange
}: MissionPlannerPanelProps): JSX.Element {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showLiveIntel, setShowLiveIntel] = useState(true);
  const [showDefaults, setShowDefaults] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const liveMissionProgress = useMemo(
    () => (selectedTelemetry ? progressFromMode(selectedTelemetry.mode) : null),
    [selectedTelemetry]
  );
  const selectedTelemetryModeLower = (selectedTelemetry?.mode ?? "").toLowerCase();
  const suppressSwarmLiveIntel =
    selectedTelemetryModeLower.includes("rtl") ||
    selectedTelemetryModeLower.includes("route-complete") ||
    selectedTelemetryModeLower.includes("mission-complete") ||
    selectedTelemetryModeLower.includes("landing") ||
    latestMission?.status === "completed" ||
    latestMission?.status === "aborted";
  const lastMissionProgressRef = useRef<{ index: number; total: number } | null>(null);
  useEffect(() => {
    if (liveMissionProgress) {
      lastMissionProgressRef.current = liveMissionProgress;
      return;
    }
    if (latestMission?.status !== "executing") {
      lastMissionProgressRef.current = null;
    }
  }, [liveMissionProgress, latestMission?.status, selectedDroneId]);
  const missionProgress =
    liveMissionProgress ??
    (latestMission?.status === "executing" ? lastMissionProgressRef.current : null);
  const activeSwarmGroup = useMemo(
    () =>
      selectedDroneId
        ? swarmGroups.find(
            (group) =>
              group.state !== "DISBANDING" &&
              (group.leaderId === selectedDroneId || group.followerIds.includes(selectedDroneId))
          )
        : undefined,
    [selectedDroneId, swarmGroups]
  );
  const visibleSwarmGroup = suppressSwarmLiveIntel ? undefined : activeSwarmGroup;
  const currentMissionWaypoint = useMemo(() => {
    if (!latestMission || !missionProgress) return undefined;
    return latestMission.waypoints[Math.min(Math.max(missionProgress.index - 1, 0), latestMission.waypoints.length - 1)];
  }, [latestMission, missionProgress]);
  const activeTriggerPreset = useMemo(() => {
    const presetId = currentMissionWaypoint?.swarmTrigger?.presetId;
    return presetId ? findScenarioPreset(swarmPresets, presetId) : undefined;
  }, [currentMissionWaypoint, swarmPresets]);
  const selectedDraftWaypoint = selectedWaypointIndex !== null ? waypoints[selectedWaypointIndex] : undefined;
  const selectedDraftPreset = useMemo(() => {
    const presetId = selectedDraftWaypoint?.swarmTrigger?.presetId;
    return presetId ? findScenarioPreset(swarmPresets, presetId) : undefined;
  }, [selectedDraftWaypoint, swarmPresets]);
  const nextMissionSwarmWaypoint = useMemo(() => {
    const sourceWaypoints = latestMission?.waypoints ?? [];
    if (sourceWaypoints.length === 0) return undefined;
    const startIndex = missionProgress ? Math.max(missionProgress.index - 1, 0) : 0;
    return sourceWaypoints.slice(startIndex).find((waypoint) => waypoint.swarmTrigger);
  }, [latestMission, missionProgress]);
  const nextMissionSwarmPreset = useMemo(() => {
    const presetId = nextMissionSwarmWaypoint?.swarmTrigger?.presetId;
    return presetId ? findScenarioPreset(swarmPresets, presetId) : undefined;
  }, [nextMissionSwarmWaypoint, swarmPresets]);
  const routeStats = useMemo(() => {
    const sourceWaypoints = latestMission?.waypoints?.length ? latestMission.waypoints : waypoints;
    if (sourceWaypoints.length === 0) {
      return {
        singleWaypoint: false,
        waypointReached: false,
        totalMeters: 0,
        remainingMeters: 0,
        traveledMeters: 0,
        toNextMeters: 0
      };
    }

    if (sourceWaypoints.length === 1) {
      const currentWp = sourceWaypoints[0];
      const toNextMeters = selectedTelemetry
        ? haversineMeters(
            selectedTelemetry.position.lat,
            selectedTelemetry.position.lon,
            currentWp.lat,
            currentWp.lon
          )
        : 0;
      const waypointReached =
        (visibleSwarmGroup?.state === "MANEUVERING" || visibleSwarmGroup?.state === "IN_FORMATION") &&
        latestMission?.status === "executing"
          ? true
          : toNextMeters <= 20;
      return {
        singleWaypoint: true,
        waypointReached,
        totalMeters: Math.max(toNextMeters, 1),
        remainingMeters: waypointReached ? 0 : toNextMeters,
        traveledMeters: waypointReached ? Math.max(toNextMeters, 1) : 0,
        toNextMeters: waypointReached ? 0 : toNextMeters
      };
    }

    const cumulative: number[] = [0];
    const legDistances: number[] = [];
    for (let i = 1; i < sourceWaypoints.length; i += 1) {
      const d = haversineMeters(
        sourceWaypoints[i - 1].lat,
        sourceWaypoints[i - 1].lon,
        sourceWaypoints[i].lat,
        sourceWaypoints[i].lon
      );
      legDistances.push(d);
      cumulative.push(cumulative[cumulative.length - 1] + d);
    }

    const totalMeters = cumulative[cumulative.length - 1] ?? 0;
    if (!selectedTelemetry || !missionProgress) {
      return {
        singleWaypoint: false,
        waypointReached: false,
        totalMeters,
        remainingMeters: totalMeters,
        traveledMeters: 0,
        toNextMeters: sourceWaypoints.length > 0 ? totalMeters : 0
      };
    }

    const currentIdx = Math.min(Math.max(missionProgress.index - 1, 0), sourceWaypoints.length - 1);
    const prevIdx = Math.max(currentIdx - 1, 0);
    const currentWp = sourceWaypoints[currentIdx];
    const toNextMeters = haversineMeters(
      selectedTelemetry.position.lat,
      selectedTelemetry.position.lon,
      currentWp.lat,
      currentWp.lon
    );

    let traveledMeters = cumulative[Math.min(prevIdx, cumulative.length - 1)] ?? 0;
    if (currentIdx > 0) {
      const segLength = legDistances[currentIdx - 1] ?? 0;
      const distFromPrev = haversineMeters(
        sourceWaypoints[prevIdx].lat,
        sourceWaypoints[prevIdx].lon,
        selectedTelemetry.position.lat,
        selectedTelemetry.position.lon
      );
      traveledMeters = Math.min(totalMeters, (cumulative[prevIdx] ?? 0) + Math.min(segLength, distFromPrev));
    }

    const remainingMeters = Math.max(totalMeters - traveledMeters, 0);
    return { singleWaypoint: false, waypointReached: false, totalMeters, remainingMeters, traveledMeters, toNextMeters };
  }, [visibleSwarmGroup?.state, latestMission, missionProgress, selectedTelemetry, waypoints]);
  const missionCompletionPct = routeStats.totalMeters > 0
    ? Math.min(100, Math.max(0, (routeStats.traveledMeters / routeStats.totalMeters) * 100))
    : 0;
  const draftStats = useMemo(() => {
    if (waypoints.length === 0) {
      return {
        totalMeters: 0,
        estimatedSeconds: 0,
        swarmEventCount: 0,
        curveCount: 0
      };
    }

    let totalMeters = 0;
    let estimatedSeconds = 0;
    let swarmEventCount = 0;
    let curveCount = 0;

    for (let index = 0; index < waypoints.length; index += 1) {
      const waypoint = waypoints[index];
      if (waypoint.swarmTrigger) {
        swarmEventCount += 1;
      }
      if ((waypoint.curveSize ?? 0) > 0) {
        curveCount += 1;
      }
      estimatedSeconds += Math.max(waypoint.hover ?? 0, 0);
      if (index === 0) {
        continue;
      }
      const previous = waypoints[index - 1];
      const segmentMeters = haversineMeters(previous.lat, previous.lon, waypoint.lat, waypoint.lon);
      totalMeters += segmentMeters;
      const speedMps = waypoint.speed && waypoint.speed > 0 ? waypoint.speed : DEFAULT_ESTIMATE_SPEED_MPS;
      estimatedSeconds += segmentMeters / Math.max(speedMps, 0.1);
    }

    return { totalMeters, estimatedSeconds, swarmEventCount, curveCount };
  }, [waypoints]);
  const activeManeuverRemainingSeconds = useMemo(() => {
    if (
      visibleSwarmGroup?.state !== "MANEUVERING" ||
      typeof visibleSwarmGroup.maneuverProgress !== "number" ||
      !currentMissionWaypoint?.swarmTrigger ||
      (currentMissionWaypoint.swarmTrigger.stopRule ?? "timer") !== "timer" ||
      typeof currentMissionWaypoint.swarmTrigger.durationSec !== "number"
    ) {
      return null;
    }
    return Math.max(currentMissionWaypoint.swarmTrigger.durationSec * (1 - visibleSwarmGroup.maneuverProgress), 0);
  }, [visibleSwarmGroup, currentMissionWaypoint]);
  const activeManeuverEstimate = useMemo(() => {
    if (
      visibleSwarmGroup?.state !== "MANEUVERING" ||
      typeof visibleSwarmGroup.maneuverProgress !== "number" ||
      !activeTriggerPreset?.maneuver
    ) {
      return null;
    }

    const params = {
      ...(activeTriggerPreset.maneuverParams ?? {}),
      ...(currentMissionWaypoint?.swarmTrigger?.maneuverOverrides ?? {})
    };
    const droneCount = visibleSwarmGroup.followerIds.length + 1;
    const speedMps = Math.max(
      numericParam(params, "speed", selectedTelemetry?.velocity.speed ?? DEFAULT_ESTIMATE_SPEED_MPS),
      0.1
    );

    let totalMeters: number | null = null;
    switch (activeTriggerPreset.maneuver) {
      case "search_grid":
        totalMeters = estimateSearchGridPathMeters(
          numericParam(params, "width", 400),
          numericParam(params, "height", 400),
          Math.max(numericParam(params, "laneSpacing", activeTriggerPreset.spacing ?? 25), 10),
          droneCount
        );
        break;
      case "search_spiral":
        totalMeters = estimateSearchSpiralPathMeters(
          numericParam(params, "maxRadius", 500),
          Math.max(activeTriggerPreset.spacing ?? 20, 10)
        );
        break;
      case "search_expanding_square":
        totalMeters = estimateExpandingSquarePathMeters(
          numericParam(params, "maxRadius", 420),
          Math.max(numericParam(params, "legSpacing", Math.max((activeTriggerPreset.spacing ?? 20) * 2, 40)), 20)
        );
        break;
      default:
        totalMeters = null;
        break;
    }

    if (!totalMeters || !Number.isFinite(totalMeters) || totalMeters <= 0) {
      return null;
    }

    const remainingMeters = Math.max(totalMeters * (1 - visibleSwarmGroup.maneuverProgress), 0);
    return {
      totalMeters,
      remainingMeters,
      etaSeconds: remainingMeters / speedMps
    };
  }, [visibleSwarmGroup, activeTriggerPreset, currentMissionWaypoint, selectedTelemetry]);
  const etaSeconds =
    activeManeuverEstimate?.etaSeconds ??
    activeManeuverRemainingSeconds ??
    (selectedTelemetry && selectedTelemetry.velocity.speed > 0.5
      ? routeStats.remainingMeters / selectedTelemetry.velocity.speed
      : null);
  const displayMissionCompletionPct =
    visibleSwarmGroup?.state === "MANEUVERING" &&
    latestMission?.status === "executing" &&
    currentMissionWaypoint?.swarmTrigger &&
    typeof visibleSwarmGroup.maneuverProgress === "number" &&
    missionProgress
      ? Math.min(
          100,
          Math.max(
            0,
            ((Math.max(missionProgress.index - 1, 0) + visibleSwarmGroup.maneuverProgress) / missionProgress.total) * 100
          )
        )
      : missionCompletionPct;
  const displayRemainingMeters =
    visibleSwarmGroup?.state === "MANEUVERING" &&
    currentMissionWaypoint?.swarmTrigger &&
    activeManeuverEstimate
      ? activeManeuverEstimate.remainingMeters
      : activeManeuverRemainingSeconds !== null && selectedTelemetry?.velocity.speed
        ? selectedTelemetry.velocity.speed * activeManeuverRemainingSeconds
      : routeStats.remainingMeters;
  const displayToNextMeters =
    visibleSwarmGroup?.state === "MANEUVERING" && currentMissionWaypoint?.swarmTrigger
      ? 0
      : routeStats.toNextMeters;

  const handleFileImport = (file: File) => {
    setImportError(null);
    const format = detectFormat(file.name);
    if (!format) {
      setImportError("Unsupported file type. Use .csv or .kml");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const parsed =
          format === "litchi-csv"
            ? parseLitchiCsv(text, file.name)
            : parseKml(text, file.name);
        onImportFile(parsed.waypoints, parsed.name);
      } catch (err) {
        setImportError((err as Error).message);
      }
    };
    reader.onerror = () => setImportError("Failed to read file");
    reader.readAsText(file);
  };

  const triggerDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csv = exportLitchiCsv(waypoints);
    triggerDownload(csv, "mission.csv", "text/csv");
    setShowExportMenu(false);
  };

  const handleExportKml = () => {
    const kml = exportKml(waypoints, "Mission");
    triggerDownload(kml, "mission.kml", "application/vnd.google-earth.kml+xml");
    setShowExportMenu(false);
  };

  return (
    <section className={embedded ? "flex h-full min-h-0 flex-col overflow-hidden" : "panel flex h-full min-h-0 flex-col overflow-hidden"}>
      {!embedded ? (
        <div className="flex items-center justify-between border-b border-cyan-300/15 px-3 py-2">
          <h2 className="panel-title text-[11px]">Mission Planner</h2>
          <label className="flex items-center gap-1.5 text-[10px] text-cyan-100/60">
            <input
              type="checkbox"
              checked={plannerEnabled}
              onChange={(event) => onTogglePlanner(event.target.checked)}
              className="accent-accent-amber"
            />
            Click-to-place
          </label>
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 border-b border-cyan-300/15 px-3 py-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.kml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileImport(file);
            e.target.value = "";
          }}
        />
        <button
          className="btn-secondary text-[10px]"
          onClick={() => fileInputRef.current?.click()}
        >
          Import
        </button>
        {waypoints.length > 0 && (
          <div className="relative">
            <button
              className="btn-secondary text-[10px]"
              onClick={() => setShowExportMenu((v) => !v)}
              onBlur={() => setTimeout(() => setShowExportMenu(false), 150)}
            >
              Export ▾
            </button>
            {showExportMenu && (
              <div className="absolute left-0 top-full z-30 mt-1 rounded border border-cyan-300/20 bg-bg-900 py-0.5 shadow-lg">
                <button
                  className="block w-full whitespace-nowrap px-3 py-1 text-left text-[10px] text-cyan-100/70 hover:bg-cyan-300/10"
                  onMouseDown={handleExportCsv}
                >
                  Export as Litchi CSV
                </button>
                <button
                  className="block w-full whitespace-nowrap px-3 py-1 text-left text-[10px] text-cyan-100/70 hover:bg-cyan-300/10"
                  onMouseDown={handleExportKml}
                >
                  Export as KML
                </button>
              </div>
            )}
          </div>
        )}
        {importError && (
          <span className="text-[10px] text-accent-red">{importError}</span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-[10px] text-cyan-100/60">
          <input
            type="checkbox"
            checked={plannerEnabled}
            onChange={(event) => onTogglePlanner(event.target.checked)}
            className="accent-accent-amber"
          />
          Click-to-place
        </label>
      </div>

      <div className="px-3 py-2">
        <div className="mb-2 rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
          <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Mission Name</div>
          <input
            type="text"
            className="input mt-1 text-[11px]"
            placeholder="Unnamed Mission"
            value={missionName}
            onChange={(event) => onMissionNameChange?.(event.target.value)}
          />
        </div>
        {editingMissionName ? (
          <div className="rounded border border-accent-cyan/20 bg-accent-cyan/8 px-2 py-1.5 text-[10px] text-cyan-100/70">
            Editing saved mission: <span className="text-accent-cyan">{editingMissionName}</span>
          </div>
        ) : null}
        <div className="mt-2 rounded border border-cyan-300/15 bg-bg-900/45 px-2 py-2">
          <button
            type="button"
            className="mb-2 flex w-full items-center justify-between gap-2 text-left"
            onClick={() => setShowLiveIntel((value) => !value)}
          >
            <div className="text-[9px] uppercase tracking-[0.1em] text-cyan-100/50">Live Mission Intel</div>
            <div className="text-[9px] uppercase tracking-[0.1em] text-cyan-100/45">
              {showLiveIntel ? "▲" : "▼"}
            </div>
          </button>
          {showLiveIntel ? (
            <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[8px] uppercase tracking-[0.1em] text-cyan-100/38">
              {latestMission?.status === "executing" ? "Executing" : "Planner / Draft"}
            </div>
            <label className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.1em] text-cyan-100/45">
              <input
                type="checkbox"
                checked={ghostPreviewOptions.enabled}
                onChange={(event) => onGhostPreviewOptionsChange?.({ enabled: event.target.checked })}
                className="accent-accent-cyan"
              />
              Ghost Overlay
            </label>
          </div>
          <div className="mb-2 flex flex-wrap gap-3 text-[9px] uppercase tracking-[0.1em] text-cyan-100/42">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={ghostPreviewOptions.showArea}
                disabled={!ghostPreviewOptions.enabled}
                onChange={(event) => onGhostPreviewOptionsChange?.({ showArea: event.target.checked })}
                className="accent-accent-cyan"
              />
              Search Area
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={ghostPreviewOptions.showTracks}
                disabled={!ghostPreviewOptions.enabled}
                onChange={(event) => onGhostPreviewOptionsChange?.({ showTracks: event.target.checked })}
                className="accent-accent-cyan"
              />
              Search Tracks
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={ghostPreviewOptions.showMarkers}
                disabled={!ghostPreviewOptions.enabled}
                onChange={(event) => onGhostPreviewOptionsChange?.({ showMarkers: event.target.checked })}
                className="accent-accent-cyan"
              />
              Start And Labels
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Mission State</div>
              <div className="mt-0.5 text-[12px] font-semibold text-cyan-100">
                {selectedTelemetry ? humanizeMode(selectedTelemetry.mode) : "No telemetry"}
              </div>
            </div>
            <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Current WP</div>
              <div className="mt-0.5 text-[12px] font-semibold text-accent-amber">
                {missionProgress ? `${missionProgress.index}/${missionProgress.total}` : "--"}
              </div>
            </div>
            <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Route Done</div>
              <div className="mt-0.5 text-[12px] font-semibold text-accent-green">
                {Math.round(displayMissionCompletionPct)}%
              </div>
            </div>
            <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">ETA</div>
              <div className="mt-0.5 text-[12px] font-semibold text-cyan-100">
                {formatEta(etaSeconds)}
              </div>
            </div>
            <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Remaining</div>
              <div className="mt-0.5 text-[12px] font-semibold text-cyan-100">
                {formatMeters(displayRemainingMeters)}
              </div>
            </div>
            <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">To Next</div>
              <div className="mt-0.5 text-[12px] font-semibold text-cyan-100">
                {formatMeters(displayToNextMeters)}
              </div>
            </div>
            <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Swarm</div>
              <div className="mt-0.5 text-[12px] font-semibold text-cyan-100">
                {visibleSwarmGroup ? `${visibleSwarmGroup.name} · ${visibleSwarmGroup.state.replaceAll("_", " ")}` : "No active swarm"}
              </div>
            </div>
            <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Maneuver</div>
              <div className="mt-0.5 text-[12px] font-semibold text-cyan-100">
                {visibleSwarmGroup ? humanizeManeuver(visibleSwarmGroup.maneuver) : "--"}
              </div>
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            <div>
              <div className="mb-1 flex items-center justify-between text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">
                <span>Mission Progress</span>
                <span>{Math.round(displayMissionCompletionPct)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full border border-cyan-300/12 bg-bg-900/70">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-cyan/70 to-accent-green/70 transition-all duration-500"
                  style={{ width: `${displayMissionCompletionPct}%` }}
                />
              </div>
            </div>
            {visibleSwarmGroup?.state === "MANEUVERING" && typeof visibleSwarmGroup.maneuverProgress === "number" ? (
              <div>
                <div className="mb-1 flex items-center justify-between text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">
                  <span>Maneuver Progress</span>
                  <span>{Math.round(visibleSwarmGroup.maneuverProgress * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full border border-cyan-300/12 bg-bg-900/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent-amber/70 to-accent-cyan/70 transition-all duration-500"
                    style={{ width: `${Math.round(visibleSwarmGroup.maneuverProgress * 100)}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div className="mt-2 rounded border border-cyan-300/12 bg-bg-900/55 px-2 py-1.5 text-[10px] text-cyan-100/62">
            {visibleSwarmGroup?.state === "MANEUVERING" ? (
              <>
                <span className="font-semibold text-accent-cyan">
                  {activeTriggerPreset?.name ?? humanizeManeuver(visibleSwarmGroup.maneuver)}
                </span>
                {typeof visibleSwarmGroup.maneuverProgress === "number" ? (
                  <span>{` · ${Math.round(visibleSwarmGroup.maneuverProgress * 100)}% complete`}</span>
                ) : null}
                {activeManeuverRemainingSeconds !== null ? (
                  <span>{` · est ${formatEta(activeManeuverRemainingSeconds)} remaining`}</span>
                ) : null}
                {typeof visibleSwarmGroup?.formationQuality === "number" ? (
                  <span>{` · formation ${visibleSwarmGroup.formationQuality}%`}</span>
                ) : null}
              </>
            ) : nextMissionSwarmWaypoint?.swarmTrigger ? (
              <>
                Upcoming swarm event:
                {" "}
                <span className="font-semibold text-accent-cyan">
                  {nextMissionSwarmPreset?.name ?? nextMissionSwarmWaypoint.swarmTrigger.presetId}
                </span>
                {" "}
                on route
              </>
            ) : selectedTelemetry ? (
              <>Live mission telemetry active. Use the waypoint drawer for path editing and swarm triggers.</>
            ) : (
              <>No live mission is running. Upload a mission or use click-to-place to build a new route.</>
            )}
          </div>
          {(visibleSwarmGroup?.state === "MANEUVERING" && currentMissionWaypoint?.swarmTrigger) || selectedDraftWaypoint?.swarmTrigger ? (
            <div className="mt-2 rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-2">
              <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">
                {visibleSwarmGroup?.state === "MANEUVERING" ? "Active Swarm Event" : "Selected Waypoint Event"}
              </div>
              {(() => {
                const trigger = visibleSwarmGroup?.state === "MANEUVERING"
                  ? currentMissionWaypoint?.swarmTrigger
                  : selectedDraftWaypoint?.swarmTrigger;
                const preset = visibleSwarmGroup?.state === "MANEUVERING"
                  ? activeTriggerPreset
                  : selectedDraftPreset;
                if (!trigger) return null;
                return (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] text-cyan-100/70">
                    <div>
                      <div className="text-cyan-100/40">Preset</div>
                      <div className="font-semibold text-cyan-100">{preset?.name ?? trigger.presetId}</div>
                    </div>
                    <div>
                      <div className="text-cyan-100/40">Group</div>
                      <div className="font-semibold text-cyan-100">
                        {swarmGroups.find((group) => group.id === trigger.groupId)?.name ?? trigger.groupId}
                      </div>
                    </div>
                    <div>
                      <div className="text-cyan-100/40">Trigger</div>
                      <div>{humanizeTriggerMode(trigger.triggerMode)}</div>
                    </div>
                    <div>
                      <div className="text-cyan-100/40">Mode</div>
                      <div>{humanizeEventMode(trigger.eventMode)}</div>
                    </div>
                    <div>
                      <div className="text-cyan-100/40">Stop</div>
                      <div>{humanizeStopRule(trigger.stopRule)}</div>
                    </div>
                    <div>
                      <div className="text-cyan-100/40">Duration</div>
                      <div>{typeof trigger.durationSec === "number" ? formatEta(trigger.durationSec) : "--"}</div>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : null}
            </>
          ) : null}
        </div>
      </div>

      {waypointDefaults && (
        <div className="border-b border-cyan-300/15 px-3 py-2">
          <button
            type="button"
            className="flex w-full items-center justify-between text-[9px] uppercase tracking-[0.1em] text-cyan-100/50"
            onClick={() => setShowDefaults((v) => !v)}
          >
            <span>Waypoint Defaults</span>
            <span>{showDefaults ? "▲" : "▼"}</span>
          </button>
          {showDefaults && (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Alt (m)</div>
                  <input type="number" min={5} max={500} className="input mt-0.5 text-[10px]" value={waypointDefaults.alt} onChange={(e) => onWaypointDefaultsChange?.({ alt: Number(e.target.value) })} />
                </div>
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Hover (s)</div>
                  <input type="number" min={0} max={120} className="input mt-0.5 text-[10px]" value={waypointDefaults.hover} onChange={(e) => onWaypointDefaultsChange?.({ hover: Number(e.target.value) })} />
                </div>
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Speed (mph)</div>
                  <input
                    type="number"
                    min={0}
                    max={MAX_CUSTOM_DRONE_SPEED_MPH}
                    step={1}
                    className="input mt-0.5 text-[10px]"
                    value={Math.round(mpsToMph(waypointDefaults.speed))}
                    onChange={(e) => onWaypointDefaultsChange?.({ speed: mphToMps(Number(e.target.value)) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Cam Pitch</div>
                  <input type="number" min={-60} max={30} className="input mt-0.5 text-[10px]" value={waypointDefaults.cameraPitch} onChange={(e) => onWaypointDefaultsChange?.({ cameraPitch: Number(e.target.value) })} />
                </div>
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Heading</div>
                  <input type="number" min={0} max={359} className="input mt-0.5 text-[10px]" value={waypointDefaults.heading} onChange={(e) => onWaypointDefaultsChange?.({ heading: Number(e.target.value) })} />
                </div>
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">View Mode</div>
                  <select className="input mt-0.5 text-[10px]" value={waypointDefaults.cameraViewMode} onChange={(e) => onWaypointDefaultsChange?.({ cameraViewMode: e.target.value as CameraViewMode })}>
                    <option value="follow">Follow</option>
                    <option value="cinematic">Cinematic</option>
                    <option value="fpv">FPV</option>
                  </select>
                </div>
              </div>
              {waypointDefaults.cameraViewMode === "fpv" && (
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                    <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">FPV Pitch</div>
                    <input type="number" min={-60} max={30} className="input mt-0.5 text-[10px]" value={waypointDefaults.fpvPitch} onChange={(e) => onWaypointDefaultsChange?.({ fpvPitch: Number(e.target.value) })} />
                  </div>
                  <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                    <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">FPV Yaw</div>
                    <input type="number" min={-180} max={180} className="input mt-0.5 text-[10px]" value={waypointDefaults.fpvYaw} onChange={(e) => onWaypointDefaultsChange?.({ fpvYaw: Number(e.target.value) })} />
                  </div>
                  <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                    <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">FPV Zoom</div>
                    <input type="number" min={0.5} max={5} step={0.1} className="input mt-0.5 text-[10px]" value={waypointDefaults.fpvZoom} onChange={(e) => onWaypointDefaultsChange?.({ fpvZoom: Number(e.target.value) })} />
                  </div>
                </div>
              )}
              <button
                type="button"
                className="btn-secondary w-full text-[10px]"
                onClick={onApplyDefaultsToAll}
                disabled={waypoints.length === 0}
              >
                Apply to All Waypoints
              </button>
            </div>
          )}
        </div>
      )}

      <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-2">
        <div className="grid grid-cols-3 gap-1.5">
          <div className="metric-card text-center">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Waypoints</div>
            <div className="font-display text-[18px] text-accent-cyan">{waypoints.length}</div>
          </div>
          <div className="metric-card text-center">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Est Time</div>
            <div className="font-display text-[18px] text-accent-green">
              {formatEta(draftStats.estimatedSeconds)}
            </div>
          </div>
          <div className="metric-card text-center">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Selected</div>
            <div className="font-display text-[18px] text-accent-amber">
              {selectedWaypointIndex !== null && waypoints[selectedWaypointIndex] ? `WP-${selectedWaypointIndex + 1}` : "--"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5 text-center">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Distance</div>
            <div className="text-[13px] font-semibold text-cyan-100">{formatMeters(draftStats.totalMeters)}</div>
          </div>
          <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5 text-center">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Swarm Events</div>
            <div className="text-[13px] font-semibold text-accent-cyan">{draftStats.swarmEventCount}</div>
          </div>
          <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5 text-center">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Curved Turns</div>
            <div className="text-[13px] font-semibold text-accent-amber">{draftStats.curveCount}</div>
          </div>
        </div>

        <div className="rounded border border-cyan-300/15 bg-bg-900/50 px-3 py-3 text-[11px] text-cyan-100/48">
          {waypoints.length === 0
            ? "Enable click-to-place and click the globe to add waypoints."
            : selectedWaypointIndex !== null && waypoints[selectedWaypointIndex]
              ? `Waypoint WP-${selectedWaypointIndex + 1} selected. Use the drawer on the map to edit altitude, hover time, camera pitch, and position.`
              : "Click any waypoint marker on the globe to open the waypoint editor. Drag markers to reposition them."}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-cyan-300/15 px-3 py-2">
        {missionOutcome ? (
          <div
            className={
              missionOutcome.type === "success"
                ? "rounded border border-accent-green/40 bg-accent-green/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-accent-green"
                : "rounded border border-accent-red/40 bg-accent-red/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-accent-red"
            }
          >
            {missionOutcome.title}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            className={missionOutcome ? "btn-primary text-[10px]" : "btn-secondary text-[10px]"}
            onClick={missionOutcome ? (onCompleteMission ?? onClear) : onClear}
          >
            {missionOutcome ? "Complete" : editingMissionName ? "Clear Draft" : "Clear All"}
          </button>
          <button className="btn-primary text-[10px]" onClick={onUpload} disabled={waypoints.length === 0}>
            {editingMissionName ? "Update Mission" : "Upload Mission"}
          </button>
        </div>
        <button className="btn-secondary w-full text-[10px]" onClick={onExecuteMission} disabled={!canExecuteMission}>
          {selectedMissionName ? `Execute ${selectedMissionName}` : "Execute Mission"}
        </button>
      </div>
    </section>
  );
}
