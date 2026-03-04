import { useEffect, useMemo, useRef, useState } from "react";
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ConstantProperty,
  Ellipsoid,
  EllipsoidTerrainProvider,
  Entity,
  HeadingPitchRange,
  HeightReference,
  Ion,
  Math as CesiumMath,
  Matrix4,
  PolygonHierarchy,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
  createWorldTerrainAsync
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { DroneRecord, DroneTelemetry, GeofenceRecord, HomeBaseRecord, MissionRecord, MissionWaypoint } from "../types/domain";
import type { ScenarioPreset } from "../types/domain";
import type { SwarmGroup } from "../store/useGroundControlStore";
import { buildMissionDisplayPath } from "../lib/missionCurves";
import { getPreferredMissionForDrone } from "../lib/missionSelection";
import { buildScenarioPresetLookup } from "../lib/swarmPresetLookup";
import { DroneEntityManager } from "./DroneEntityManager";
import { computeFormationOffsets, type FormationName } from "../components/swarm/FormationPicker";
import { numericParam } from "../lib/swarmPresets";

interface GlobeViewerProps {
  drones: DroneRecord[];
  telemetryByDrone: Record<string, DroneTelemetry>;
  telemetryHistoryByDrone: Record<string, DroneTelemetry[]>;
  geofences: GeofenceRecord[];
  homeBases?: HomeBaseRecord[];
  missions: MissionRecord[];
  selectedDroneId: string | null;
  plannerEnabled: boolean;
  plannerWaypoints: MissionWaypoint[];
  selectedPlannerWaypointIndex?: number | null;
  cameraMode: "global" | "follow" | "fpv" | "cinematic";
  fpvPitchDeg?: number;
  trailResetToken?: number;
  focusPathKey?: string | null;
  areaDrawingMode?: "geofence" | "homeBase" | null;
  areaDrawPoints?: Array<{ lat: number; lon: number }>;
  onAddAreaDrawPoint?: (point: { lat: number; lon: number }) => void;
  swarmGroups?: SwarmGroup[];
  swarmPresets?: ScenarioPreset[];
  ghostPreviewOptions?: {
    enabled: boolean;
    showArea: boolean;
    showTracks: boolean;
    showMarkers: boolean;
  };
  onAddWaypoint: (wp: MissionWaypoint) => void;
  onUpdateWaypoint: (index: number, patch: Partial<MissionWaypoint>) => void;
  onSelectPlannerWaypoint?: (index: number | null) => void;
  onSelectDrone: (droneId: string | null) => void;
}

const defaultModelUri =
  import.meta.env.VITE_DRONE_MODEL_URI ??
  "https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumDrone/CesiumDrone.glb";
const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TWO_PI = Math.PI * 2;
const isFiniteNumber = (value: number): boolean => Number.isFinite(value);
const isValidScreenPosition = (position: Cartesian2 | undefined | null): position is Cartesian2 =>
  Boolean(position && isFiniteNumber(position.x) && isFiniteNumber(position.y));
const isValidGeoPoint = (lat: number, lon: number, alt = 0): boolean =>
  isFiniteNumber(lat) && isFiniteNumber(lon) && isFiniteNumber(alt) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const isValidCartesian3 = (value: Cartesian3 | undefined): value is Cartesian3 =>
  Boolean(value && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z));
const isViewerAlive = (viewer: Viewer): boolean => {
  try {
    return !viewer.isDestroyed();
  } catch {
    return false;
  }
};
const METERS_PER_DEG_LAT = 111320;
const offsetLatLonMeters = (lat: number, lon: number, northMeters: number, eastMeters: number): { lat: number; lon: number } => {
  const dLat = northMeters / METERS_PER_DEG_LAT;
  const lonScale = METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const dLon = lonScale === 0 ? 0 : eastMeters / lonScale;
  return {
    lat: lat + dLat,
    lon: lon + dLon
  };
};
const resolveAbsoluteAltitude = (viewer: Viewer, lat: number, lon: number, aglAltitude: number): number => {
  const terrainHeight = viewer.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat));
  return (typeof terrainHeight === "number" && Number.isFinite(terrainHeight) ? terrainHeight : 0) + Math.max(aglAltitude, 0.5);
};
const resizeViewer = (viewer: Viewer): void => {
  try {
    if (!isViewerAlive(viewer)) {
      return;
    }
    viewer.resize();
    viewer.scene.requestRender();
  } catch {
    // no-op
  }
};
const rotateMeters = (north: number, east: number, headingDeg: number): { north: number; east: number } => {
  if (!headingDeg) {
    return { north, east };
  }
  const headingRad = CesiumMath.toRadians(headingDeg);
  const cos = Math.cos(headingRad);
  const sin = Math.sin(headingRad);
  return {
    north: north * cos - east * sin,
    east: north * sin + east * cos
  };
};
const toGroundCartesian = (lat: number, lon: number, height = 2): Cartesian3 =>
  Cartesian3.fromDegrees(lon, lat, height);
const buildRectPoints = (
  centerLat: number,
  centerLon: number,
  width: number,
  height: number,
  headingDeg: number
): Array<{ lat: number; lon: number }> => {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corners = [
    { north: -halfHeight, east: -halfWidth },
    { north: halfHeight, east: -halfWidth },
    { north: halfHeight, east: halfWidth },
    { north: -halfHeight, east: halfWidth },
    { north: -halfHeight, east: -halfWidth }
  ];
  return corners.map((corner) => {
    const rotated = rotateMeters(corner.north, corner.east, headingDeg);
    return offsetLatLonMeters(centerLat, centerLon, rotated.north, rotated.east);
  });
};
const buildSearchGridLanePlan = (width: number, spacing: number, droneCount: number): { laneCount: number; laneOffsets: number[] } => {
  const effectiveDroneCount = Math.max(droneCount, 1);
  const desiredLaneSpacing = Math.max(spacing, 10);
  const minimumLaneCount = Math.max(effectiveDroneCount, Math.floor(width / desiredLaneSpacing) + 1);
  const laneCount = Math.max(effectiveDroneCount, Math.ceil(minimumLaneCount / effectiveDroneCount) * effectiveDroneCount);
  const actualLaneSpacing = laneCount > 1 ? width / (laneCount - 1) : 0;
  const laneOffsets = Array.from({ length: laneCount }, (_, index) =>
    laneCount === 1 ? 0 : -width / 2 + index * actualLaneSpacing
  );
  return { laneCount, laneOffsets };
};
const buildSearchGridDronePaths = (
  centerLat: number,
  centerLon: number,
  width: number,
  height: number,
  headingDeg: number,
  droneCount: number,
  spacing: number
): Cartesian3[][] => {
  const effectiveDroneCount = Math.max(droneCount, 1);
  const { laneCount, laneOffsets } = buildSearchGridLanePlan(width, spacing, effectiveDroneCount);
  const bandCount = laneCount / effectiveDroneCount;
  const paths: Cartesian3[][] = [];

  for (let droneIndex = 0; droneIndex < effectiveDroneCount; droneIndex += 1) {
    const path: Cartesian3[] = [];
    for (let band = 0; band < bandCount; band += 1) {
      const laneIndex = band * effectiveDroneCount + droneIndex;
      const east = laneOffsets[laneIndex];
      const passSouthToNorth = band % 2 === 0;
      const startNorth = passSouthToNorth ? -height / 2 : height / 2;
      const endNorth = -startNorth;

      const start = rotateMeters(startNorth, east, headingDeg);
      const end = rotateMeters(endNorth, east, headingDeg);
      const startPoint = offsetLatLonMeters(centerLat, centerLon, start.north, start.east);
      const endPoint = offsetLatLonMeters(centerLat, centerLon, end.north, end.east);

      if (band === 0) {
        path.push(toGroundCartesian(startPoint.lat, startPoint.lon));
      }
      path.push(toGroundCartesian(endPoint.lat, endPoint.lon));

      if (band < bandCount - 1) {
        const nextEast = laneOffsets[(band + 1) * effectiveDroneCount + droneIndex];
        const shift = rotateMeters(endNorth, nextEast, headingDeg);
        const shiftPoint = offsetLatLonMeters(centerLat, centerLon, shift.north, shift.east);
        path.push(toGroundCartesian(shiftPoint.lat, shiftPoint.lon));
      }
    }
    paths.push(path);
  }

  return paths;
};
const buildSearchSpiralPoints = (
  centerLat: number,
  centerLon: number,
  maxRadius: number,
  spacing: number
): Cartesian3[] => {
  const spiralRate = Math.max((spacing * 1.5) / (2 * Math.PI), 2);
  const maxTheta = Math.max(maxRadius / Math.max(spiralRate, 0.1), Math.PI * 2);
  const steps = 96;
  const points: Cartesian3[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const theta = (step / steps) * maxTheta;
    const radius = Math.min(spiralRate * theta, maxRadius);
    const point = offsetLatLonMeters(
      centerLat,
      centerLon,
      Math.cos(theta) * radius,
      Math.sin(theta) * radius
    );
    points.push(toGroundCartesian(point.lat, point.lon));
  }
  return points;
};
const buildCirclePoints = (centerLat: number, centerLon: number, radius: number, steps = 64): Cartesian3[] => {
  const points: Cartesian3[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    const point = offsetLatLonMeters(
      centerLat,
      centerLon,
      Math.cos(angle) * radius,
      Math.sin(angle) * radius
    );
    points.push(toGroundCartesian(point.lat, point.lon));
  }
  return points;
};
const buildArcPoints = (
  centerLat: number,
  centerLon: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  steps = 18
): Cartesian3[] => {
  const points: Cartesian3[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const angle = startAngle + (endAngle - startAngle) * t;
    const point = offsetLatLonMeters(
      centerLat,
      centerLon,
      Math.cos(angle) * radius,
      Math.sin(angle) * radius
    );
    points.push(toGroundCartesian(point.lat, point.lon));
  }
  return points;
};
const buildOrbitSamplePoints = (
  centerLat: number,
  centerLon: number,
  radius: number,
  droneCount: number,
  headingDeg: number
): Array<{ lat: number; lon: number }> => {
  const effectiveCount = Math.max(droneCount, 1);
  const headingRad = CesiumMath.toRadians(headingDeg);
  return Array.from({ length: effectiveCount }, (_, index) => {
    const angle = headingRad + (TWO_PI * index) / effectiveCount;
    return offsetLatLonMeters(
      centerLat,
      centerLon,
      Math.cos(angle) * radius,
      Math.sin(angle) * radius
    );
  });
};
const buildGuideLine = (
  centerLat: number,
  centerLon: number,
  startNorth: number,
  startEast: number,
  endNorth: number,
  endEast: number,
  headingDeg: number
): Cartesian3[] => {
  const start = rotateMeters(startNorth, startEast, headingDeg);
  const end = rotateMeters(endNorth, endEast, headingDeg);
  const startPoint = offsetLatLonMeters(centerLat, centerLon, start.north, start.east);
  const endPoint = offsetLatLonMeters(centerLat, centerLon, end.north, end.east);
  return [
    toGroundCartesian(startPoint.lat, startPoint.lon),
    toGroundCartesian(endPoint.lat, endPoint.lon)
  ];
};
const buildExpandingSquarePoints = (
  centerLat: number,
  centerLon: number,
  maxRadius: number,
  legSpacing: number
): Cartesian3[] => {
  const points: Cartesian3[] = [toGroundCartesian(centerLat, centerLon)];
  const directions = [
    { north: 0, east: 1 },
    { north: 1, east: 0 },
    { north: 0, east: -1 },
    { north: -1, east: 0 }
  ];
  let north = 0;
  let east = 0;
  let maxExtent = 0;
  let segmentIndex = 0;

  while (maxExtent < maxRadius + legSpacing) {
    const length = Math.ceil((segmentIndex + 1) / 2) * legSpacing;
    const direction = directions[segmentIndex % directions.length];
    north += direction.north * length;
    east += direction.east * length;
    maxExtent = Math.max(maxExtent, Math.abs(north), Math.abs(east));
    const point = offsetLatLonMeters(centerLat, centerLon, north, east);
    points.push(toGroundCartesian(point.lat, point.lon));
    segmentIndex += 1;
  }

  return points;
};
const buildFibonacciOrbitSamplePoints = (
  centerLat: number,
  centerLon: number,
  maxRadius: number,
  droneCount: number,
  headingDeg: number
): Array<{ lat: number; lon: number; radius: number }> => {
  const effectiveCount = Math.max(droneCount, 1);
  const headingRad = CesiumMath.toRadians(headingDeg);
  return Array.from({ length: effectiveCount }, (_, index) => {
    const sampleIndex = index + 1;
    const radius = maxRadius * Math.sqrt(sampleIndex / effectiveCount);
    const angle = headingRad + sampleIndex * GOLDEN_ANGLE;
    const point = offsetLatLonMeters(
      centerLat,
      centerLon,
      Math.cos(angle) * radius,
      Math.sin(angle) * radius
    );
    return { ...point, radius };
  });
};
type SearchPreviewSpec =
  | { kind: "orbit"; radius: number; headingDeg: number; direction: "cw" | "ccw" }
  | { kind: "grid"; width: number; height: number; headingDeg: number; spacing: number }
  | { kind: "spiral"; maxRadius: number; spacing: number }
  | { kind: "expanding_square"; maxRadius: number; legSpacing: number }
  | { kind: "fibonacci_orbit"; maxRadius: number; headingDeg: number; direction: "cw" | "ccw" };
const resolveSearchPreviewSpec = (
  waypoint: MissionWaypoint,
  preset: ScenarioPreset | undefined
): SearchPreviewSpec | null => {
  if (!waypoint.swarmTrigger || !preset || !preset.maneuver) {
    return null;
  }

  const params = {
    ...(preset.maneuverParams ?? {}),
    ...(waypoint.swarmTrigger.maneuverOverrides ?? {})
  };

  switch (preset.maneuver) {
    case "orbit":
      return {
        kind: "orbit",
        radius: numericParam(params, "radius", 120),
        headingDeg: numericParam(params, "headingDeg", preset.headingDeg ?? 0),
        direction: params.direction === "ccw" ? "ccw" : "cw"
      };
    case "search_grid":
      return {
        kind: "grid",
        width: numericParam(params, "width", 400),
        height: numericParam(params, "height", 400),
        headingDeg: numericParam(params, "headingDeg", preset.headingDeg ?? 0),
        spacing: Math.max(numericParam(params, "laneSpacing", preset.spacing ?? 25), 10)
      };
    case "search_spiral":
      return {
        kind: "spiral",
        maxRadius: numericParam(params, "maxRadius", 500),
        spacing: Math.max(preset.spacing ?? 20, 10)
      };
    case "search_expanding_square":
      return {
        kind: "expanding_square",
        maxRadius: numericParam(params, "maxRadius", 420),
        legSpacing: Math.max(numericParam(params, "legSpacing", Math.max((preset.spacing ?? 20) * 2, 40)), 20)
      };
    case "fibonacci_orbit":
      return {
        kind: "fibonacci_orbit",
        maxRadius: numericParam(params, "maxRadius", 110),
        headingDeg: numericParam(params, "headingDeg", preset.headingDeg ?? 0),
        direction: params.direction === "ccw" ? "ccw" : "cw"
      };
    default:
      return null;
  }
};

const buildWaypointLabelText = (baseLabel: string, waypoint: MissionWaypoint): string => {
  if (!waypoint.swarmTrigger) {
    return baseLabel;
  }

  const stopRule = waypoint.swarmTrigger.stopRule ?? "timer";
  const eventSuffix = waypoint.swarmTrigger.eventMode === "final_destination" ? " DEST" : "";
  const durationSuffix =
    stopRule === "timer" && typeof waypoint.swarmTrigger.durationSec === "number"
      ? ` ${Math.round(waypoint.swarmTrigger.durationSec)}s`
      : stopRule === "manual_confirm"
        ? " MANUAL"
        : "";

  return `${baseLabel}\nSWARM${eventSuffix}${durationSuffix}`;
};
export function GlobeViewer({
  drones,
  telemetryByDrone,
  telemetryHistoryByDrone,
  geofences,
  homeBases = [],
  missions,
  selectedDroneId,
  plannerEnabled,
  plannerWaypoints,
  selectedPlannerWaypointIndex = null,
  cameraMode,
  fpvPitchDeg = 0,
  trailResetToken = 0,
  focusPathKey = null,
  areaDrawingMode = null,
  areaDrawPoints = [],
  onAddAreaDrawPoint,
  swarmGroups = [],
  swarmPresets = [],
  ghostPreviewOptions = { enabled: true, showArea: true, showTracks: true, showMarkers: true },
  onAddWaypoint,
  onUpdateWaypoint,
  onSelectPlannerWaypoint,
  onSelectDrone
}: GlobeViewerProps): JSX.Element {
  const [orbitPreviewPhase, setOrbitPreviewPhase] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const geofenceEntitiesRef = useRef<Entity[]>([]);
  const homeBaseEntitiesRef = useRef<Entity[]>([]);
  const drawPreviewEntitiesRef = useRef<Entity[]>([]);
  const plannerEntitiesRef = useRef<Entity[]>([]);
  const searchPreviewEntitiesRef = useRef<Entity[]>([]);
  const missionEntitiesRef = useRef<Entity[]>([]);
  const managerRef = useRef<DroneEntityManager | null>(null);
  const dronesById = useMemo(() => new Map(drones.map((d) => [d.id, d])), [drones]);
  const swarmPresetsById = useMemo(() => buildScenarioPresetLookup(swarmPresets), [swarmPresets]);
  const swarmGroupsById = useMemo(() => new Map(swarmGroups.map((group) => [group.id, group])), [swarmGroups]);
  const selectedTelemetryMode = selectedDroneId ? telemetryByDrone[selectedDroneId]?.mode ?? "" : "";
  const selectedTelemetryModeLower = selectedTelemetryMode.toLowerCase();
  const suppressLiveMissionGhostPreview =
    selectedTelemetryModeLower.includes("rtl") ||
    selectedTelemetryModeLower.includes("route-complete") ||
    selectedTelemetryModeLower.includes("mission-complete") ||
    selectedTelemetryModeLower.includes("landing");
  const liveMissionWaypointIndex = useMemo(() => {
    const match = /mission-wp-(\d+)\/\d+/i.exec(selectedTelemetryMode);
    return match ? Math.max(0, Number(match[1]) - 1) : -1;
  }, [selectedTelemetryMode]);
  const latestMissionForSelectedDrone = useMemo(() => {
    return getPreferredMissionForDrone(missions, selectedDroneId) ?? null;
  }, [missions, selectedDroneId]);
  const lastActiveMissionWaypointIndexRef = useRef<number>(-1);
  useEffect(() => {
    if (suppressLiveMissionGhostPreview) {
      lastActiveMissionWaypointIndexRef.current = -1;
      return;
    }
    if (liveMissionWaypointIndex >= 0) {
      lastActiveMissionWaypointIndexRef.current = liveMissionWaypointIndex;
      return;
    }
    if (latestMissionForSelectedDrone?.status !== "executing") {
      lastActiveMissionWaypointIndexRef.current = -1;
    }
  }, [liveMissionWaypointIndex, latestMissionForSelectedDrone?.status, selectedDroneId, suppressLiveMissionGhostPreview]);
  const activeMissionWaypointIndex =
    suppressLiveMissionGhostPreview
      ? -1
      : liveMissionWaypointIndex >= 0
      ? liveMissionWaypointIndex
      : latestMissionForSelectedDrone?.status === "executing"
        ? lastActiveMissionWaypointIndexRef.current
        : -1;
  const plannerEnabledRef = useRef(plannerEnabled);
  const areaDrawingModeRef = useRef<"geofence" | "homeBase" | null>(areaDrawingMode);
  const dronesByIdRef = useRef(dronesById);
  const plannerWaypointsRef = useRef(plannerWaypoints);
  const onUpdateWaypointRef = useRef(onUpdateWaypoint);
  const onSelectPlannerWaypointRef = useRef(onSelectPlannerWaypoint);
  const telemetryByDroneRef = useRef(telemetryByDrone);
  const dragWaypointIndexRef = useRef<number | null>(null);
  const pendingPlannerClickRef = useRef<{ index: number; start: Cartesian2 } | null>(null);
  const suppressNextClickRef = useRef(false);
  const lastCameraModeRef = useRef<GlobeViewerProps["cameraMode"]>("global");
  const cameraModeRef = useRef<GlobeViewerProps["cameraMode"]>(cameraMode);
  const selectedDroneIdRef = useRef<string | null>(selectedDroneId);
  const lastGlobalFitSignatureRef = useRef("");
  const lastFocusedPathKeyRef = useRef<string | null>(null);
  const lastSelectedForCameraRef = useRef<string | null>(null);
  const cinematicAngleRef = useRef(0);
  const fpvPitchRef = useRef(0); // FPV camera pitch in degrees, controlled by user
  const fpvSmoothedHeadingRef = useRef<number | null>(null); // smoothed heading for FPV

  useEffect(() => {
    plannerEnabledRef.current = plannerEnabled;
  }, [plannerEnabled]);

  useEffect(() => {
    areaDrawingModeRef.current = areaDrawingMode;
  }, [areaDrawingMode]);

  useEffect(() => {
    dronesByIdRef.current = dronesById;
  }, [dronesById]);

  useEffect(() => {
    plannerWaypointsRef.current = plannerWaypoints;
  }, [plannerWaypoints]);

  useEffect(() => {
    onUpdateWaypointRef.current = onUpdateWaypoint;
  }, [onUpdateWaypoint]);

  useEffect(() => {
    onSelectPlannerWaypointRef.current = onSelectPlannerWaypoint;
  }, [onSelectPlannerWaypoint]);

  useEffect(() => {
    telemetryByDroneRef.current = telemetryByDrone;
  }, [telemetryByDrone]);

  useEffect(() => {
    cameraModeRef.current = cameraMode;
  }, [cameraMode]);

  useEffect(() => {
    fpvPitchRef.current = fpvPitchDeg;
  }, [fpvPitchDeg]);

  useEffect(() => {
    selectedDroneIdRef.current = selectedDroneId;
  }, [selectedDroneId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setOrbitPreviewPhase((current) => (current + 0.03) % 1);
    }, 120);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) {
      return;
    }

    if (ionToken) {
      Ion.defaultAccessToken = ionToken;
    }

    const viewer = new Viewer(containerRef.current, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      infoBox: false,
      selectionIndicator: false,
      terrainProvider: new EllipsoidTerrainProvider(),
      shouldAnimate: true,
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true,
        },
      },
    });

    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true;
    }
    viewer.scene.rethrowRenderErrors = false;
    const onRenderError = (_scene: unknown, error: unknown): void => {
      // Keep rendering alive even if one frame has invalid camera math.
      // eslint-disable-next-line no-console
      console.error("Cesium render error", error);
      viewer.scene.requestRender();
    };
    viewer.scene.renderError.addEventListener(onRenderError);

    createWorldTerrainAsync()
      .then((terrainProvider) => {
        viewer.terrainProvider = terrainProvider;
      })
      .catch(() => {
        // Terrain token may be unavailable; fallback already set.
      });

    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(-96, 37.8, 3_000_000),
      duration: 0
    });

    const manager = new DroneEntityManager(viewer, defaultModelUri);
    managerRef.current = manager;
    let disposed = false;

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    const cameraController = viewer.scene.screenSpaceCameraController;
    const safeResize = (): void => {
      if (disposed || viewerRef.current !== viewer || !isViewerAlive(viewer)) {
        return;
      }
      resizeViewer(viewer);
    };
    const resizeObserver = new ResizeObserver(() => {
      safeResize();
    });
    resizeObserver.observe(containerRef.current);

    const setCameraInteraction = (enabled: boolean): void => {
      if (!enabled) {
        cameraController.enableRotate = false;
        cameraController.enableTranslate = false;
        cameraController.enableZoom = false;
        cameraController.enableTilt = false;
        cameraController.enableLook = false;
        return;
      }

      if (cameraModeRef.current === "global") {
        cameraController.enableRotate = true;
        cameraController.enableTranslate = true;
        cameraController.enableZoom = true;
        cameraController.enableTilt = true;
        cameraController.enableLook = true;
        return;
      }

      if (cameraModeRef.current === "follow") {
        cameraController.enableRotate = true;
        cameraController.enableTranslate = false;
        cameraController.enableZoom = true;
        cameraController.enableTilt = true;
        cameraController.enableLook = true;
        return;
      }

      if (cameraModeRef.current === "fpv") {
        cameraController.enableRotate = false;
        cameraController.enableTranslate = false;
        cameraController.enableZoom = false;
        cameraController.enableTilt = false;
        cameraController.enableLook = false;
        return;
      }

      cameraController.enableRotate = false;
      cameraController.enableTranslate = false;
      cameraController.enableZoom = false;
      cameraController.enableTilt = false;
      cameraController.enableLook = false;
    };

    const pickCartesian = (position: Cartesian2 | undefined): Cartesian3 | undefined => {
      if (!isValidScreenPosition(position)) {
        return undefined;
      }

      try {
        return viewer.scene.pickPosition(position) ?? viewer.camera.pickEllipsoid(position) ?? undefined;
      } catch {
        return undefined;
      }
    };

    const pickId = (position: Cartesian2 | undefined): string | undefined => {
      if (!isValidScreenPosition(position)) {
        return undefined;
      }

      let picked: { id?: { id?: string } | string } | undefined;
      try {
        picked = viewer.scene.pick(position) as { id?: { id?: string } | string } | undefined;
      } catch {
        return undefined;
      }
      if (!picked?.id) {
        return undefined;
      }

      if (typeof picked.id === "string") {
        return picked.id;
      }

      if (typeof picked.id.id === "string") {
        return picked.id.id;
      }

      return undefined;
    };

    handler.setInputAction((down: { position: Cartesian2 }) => {
      if (areaDrawingModeRef.current) {
        const pickedPosition = pickCartesian(down.position);
        if (!pickedPosition) {
          return;
        }

        const cartographic = Cartographic.fromCartesian(pickedPosition);
        if (!isFiniteNumber(cartographic.latitude) || !isFiniteNumber(cartographic.longitude)) {
          return;
        }

        onAddAreaDrawPoint?.({
          lat: CesiumMath.toDegrees(cartographic.latitude),
          lon: CesiumMath.toDegrees(cartographic.longitude)
        });
        return;
      }

      if (!plannerEnabledRef.current) {
        return;
      }

      const pickedId = pickId(down.position);
      if (!pickedId?.startsWith("planner-wp-")) {
        return;
      }

      const index = Number(pickedId.slice("planner-wp-".length));
      if (!Number.isInteger(index) || !plannerWaypointsRef.current[index]) {
        return;
      }

      pendingPlannerClickRef.current = {
        index,
        start: Cartesian2.clone(down.position)
      };
    }, ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction((move: { endPosition: Cartesian2 }) => {
      if (dragWaypointIndexRef.current === null && pendingPlannerClickRef.current) {
        const pending = pendingPlannerClickRef.current;
        const dx = move.endPosition.x - pending.start.x;
        const dy = move.endPosition.y - pending.start.y;
        if (Math.hypot(dx, dy) > 6) {
          dragWaypointIndexRef.current = pending.index;
          pendingPlannerClickRef.current = null;
          suppressNextClickRef.current = true;
          setCameraInteraction(false);
        }
      }

      const draggingIndex = dragWaypointIndexRef.current;
      if (draggingIndex === null) {
        return;
      }

      const pickedPosition = pickCartesian(move.endPosition);
      if (!pickedPosition) {
        return;
      }

      const cartographic = Cartographic.fromCartesian(pickedPosition);
      if (!isFiniteNumber(cartographic.latitude) || !isFiniteNumber(cartographic.longitude)) {
        return;
      }
      onUpdateWaypointRef.current(draggingIndex, {
        lat: CesiumMath.toDegrees(cartographic.latitude),
        lon: CesiumMath.toDegrees(cartographic.longitude)
      });
    }, ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(() => {
      if (dragWaypointIndexRef.current !== null) {
        dragWaypointIndexRef.current = null;
        setCameraInteraction(true);
        pendingPlannerClickRef.current = null;
        return;
      }

      if (pendingPlannerClickRef.current) {
        const pending = pendingPlannerClickRef.current;
        pendingPlannerClickRef.current = null;
        suppressNextClickRef.current = true;
        onSelectPlannerWaypointRef.current?.(pending.index);
      }
    }, ScreenSpaceEventType.LEFT_UP);

    const onMouseLeave = (): void => {
      dragWaypointIndexRef.current = null;
      pendingPlannerClickRef.current = null;
      setCameraInteraction(true);
    };
    viewer.scene.canvas.addEventListener("mouseleave", onMouseLeave);

    handler.setInputAction((click: { position: Cartesian2 }) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }

      const pickedId = pickId(click.position);
      if (pickedId?.startsWith("planner-wp-")) {
        const index = Number(pickedId.slice("planner-wp-".length));
        if (Number.isInteger(index)) {
          onSelectPlannerWaypointRef.current?.(index);
        }
        return;
      }
      if (pickedId && dronesByIdRef.current.has(pickedId)) {
        onSelectDrone(pickedId);
      }

      if (!plannerEnabledRef.current) {
        return;
      }

      const pickedPosition = pickCartesian(click.position);
      if (!pickedPosition) {
        return;
      }

      const cartographic = Cartographic.fromCartesian(pickedPosition);
      if (
        !isFiniteNumber(cartographic.latitude) ||
        !isFiniteNumber(cartographic.longitude) ||
        !isFiniteNumber(cartographic.height)
      ) {
        return;
      }
      onAddWaypoint({
        lat: CesiumMath.toDegrees(cartographic.latitude),
        lon: CesiumMath.toDegrees(cartographic.longitude),
        alt: Math.max(20, cartographic.height + 10),
        hover: 2
      });
    }, ScreenSpaceEventType.LEFT_CLICK);

    handlerRef.current = handler;
    viewerRef.current = viewer;
    const resizeTimeouts = [
      window.setTimeout(safeResize, 0),
      window.setTimeout(safeResize, 120),
      window.setTimeout(safeResize, 360)
    ];
    requestAnimationFrame(() => {
      safeResize();
      requestAnimationFrame(() => {
        safeResize();
      });
    });

    return () => {
      disposed = true;
      try {
        setCameraInteraction(true);
      } catch {
        // no-op
      }
      try {
        resizeTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      } catch {
        // no-op
      }
      try {
        resizeObserver.disconnect();
      } catch {
        // no-op
      }
      try {
        viewer.scene.canvas.removeEventListener("mouseleave", onMouseLeave);
        viewer.scene.renderError.removeEventListener(onRenderError);
      } catch {
        // no-op
      }
      try {
        handler.destroy();
      } catch {
        // no-op
      }
      try {
        if (isViewerAlive(viewer)) {
          viewer.destroy();
        }
      } catch {
        // no-op
      }
      viewerRef.current = null;
      managerRef.current = null;
      handlerRef.current = null;
    };
  }, [onAddWaypoint, onSelectDrone]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const manager = managerRef.current;
    if (!viewer || !manager) {
      return;
    }

    for (const drone of drones) {
      manager.upsertDrone(
        drone,
        telemetryByDrone[drone.id],
        drone.id === selectedDroneId,
        telemetryHistoryByDrone[drone.id] ?? []
      );
    }
    manager.keepOnly(drones.map((d) => d.id));
  }, [drones, telemetryByDrone, telemetryHistoryByDrone, selectedDroneId]);

  useEffect(() => {
    if (!managerRef.current) {
      return;
    }
    managerRef.current.resetTrails();
  }, [trailResetToken]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const manager = managerRef.current;
    if (!viewer || !manager) {
      return;
    }

    const cameraController = viewer.scene.screenSpaceCameraController;
    const applyCameraControls = (mode: GlobeViewerProps["cameraMode"]): void => {
      cameraController.enableCollisionDetection = mode === "global";
      cameraController.minimumZoomDistance = 8;
      cameraController.maximumZoomDistance = 50_000_000;

      if (mode === "global") {
        cameraController.enableRotate = true;
        cameraController.enableTranslate = true;
        cameraController.enableZoom = true;
        cameraController.enableTilt = true;
        cameraController.enableLook = true;
        return;
      }

      if (mode === "follow") {
        cameraController.enableRotate = true;
        cameraController.enableTranslate = false;
        cameraController.enableZoom = true;
        cameraController.enableTilt = true;
        cameraController.enableLook = true;
        cameraController.minimumZoomDistance = 4;
        cameraController.maximumZoomDistance = 120;
        return;
      }

      if (mode === "fpv") {
        cameraController.enableRotate = false;
        cameraController.enableTranslate = false;
        cameraController.enableZoom = false;
        cameraController.enableTilt = false;
        cameraController.enableLook = false;
        cameraController.minimumZoomDistance = 1;
        cameraController.maximumZoomDistance = 1;
        return;
      }

      cameraController.enableRotate = false;
      cameraController.enableTranslate = false;
      cameraController.enableZoom = false;
      cameraController.enableTilt = false;
      cameraController.enableLook = false;
    };

    const fitFleetInGlobal = (): void => {
      if (drones.length === 0) {
        return;
      }

      const points = drones
        .filter((drone) => isValidGeoPoint(drone.home.lat, drone.home.lon, drone.home.alt))
        .map((drone) => Cartesian3.fromDegrees(drone.home.lon, drone.home.lat, Math.max(drone.home.alt, 5)));

      if (points.length === 0) {
        return;
      }

      if (points.length === 1) {
        const cartographic = Cartographic.fromCartesian(points[0]);
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(
            CesiumMath.toDegrees(cartographic.longitude),
            CesiumMath.toDegrees(cartographic.latitude),
            2200
          ),
          duration: 1.1
        });
        return;
      }

      const sphere = BoundingSphere.fromPoints(points);
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.2,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-32), Math.max(2_400, sphere.radius * 3.2))
      });
    };

    const modeChanged = lastCameraModeRef.current !== cameraMode;
    const selectedChanged = lastSelectedForCameraRef.current !== selectedDroneId;
    if (modeChanged) {
      lastCameraModeRef.current = cameraMode;
      if (cameraMode === "global") {
        lastGlobalFitSignatureRef.current = "";
      }
      if (cameraMode !== "cinematic") {
        cinematicAngleRef.current = 0;
      }
    }
    lastSelectedForCameraRef.current = selectedDroneId;

    if (cameraMode === "global") {
      applyCameraControls("global");
      viewer.trackedEntity = undefined;

      if (plannerEnabledRef.current || plannerWaypoints.length > 0) {
        return;
      }

      const homeSignature = drones
        .map((drone) => `${drone.id}:${drone.home.lat.toFixed(5)}:${drone.home.lon.toFixed(5)}:${drone.home.alt.toFixed(1)}`)
        .join("|");

      if (homeSignature && (modeChanged || homeSignature !== lastGlobalFitSignatureRef.current)) {
        lastGlobalFitSignatureRef.current = homeSignature;
        fitFleetInGlobal();
      }
      return;
    }

    const selectedEntity = manager.getEntity(selectedDroneId);
    if (!selectedEntity) {
      applyCameraControls(cameraMode);
      viewer.trackedEntity = undefined;
      return;
    }

    if (cameraMode === "follow") {
      applyCameraControls("follow");
      if (modeChanged || selectedChanged) {
        viewer.trackedEntity = undefined;
        selectedEntity.viewFrom = new ConstantProperty(new Cartesian3(-28, 0, 10));
        viewer.trackedEntity = selectedEntity;
        viewer.zoomTo(selectedEntity, new HeadingPitchRange(0, CesiumMath.toRadians(-16), 34));
      } else if (viewer.trackedEntity !== selectedEntity) {
        viewer.trackedEntity = selectedEntity;
      }
      return;
    }

    if (cameraMode === "fpv") {
      applyCameraControls("fpv");
      if (modeChanged || selectedChanged) {
        viewer.trackedEntity = undefined;
        viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      }
      return;
    }

    if (cameraMode === "cinematic") {
      applyCameraControls("cinematic");
      viewer.trackedEntity = undefined;
      if (modeChanged || selectedChanged) {
        cinematicAngleRef.current = 0;
        viewer.flyTo(selectedEntity, {
          duration: 0.9,
          offset: new HeadingPitchRange(CesiumMath.toRadians(18), CesiumMath.toRadians(-18), 360)
        });
      }
    }
  }, [cameraMode, selectedDroneId, drones, plannerWaypoints.length]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const manager = managerRef.current;
    if (!viewer || !manager) {
      return;
    }

    const onTick = (): void => {
      const mode = cameraModeRef.current;
      if (mode !== "follow" && mode !== "fpv") {
        return;
      }

      const droneId = selectedDroneIdRef.current;
      if (!droneId) {
        return;
      }

      const selectedEntity = manager.getEntity(droneId);
      if (!selectedEntity) {
        return;
      }

      if (viewer.trackedEntity !== selectedEntity) {
        viewer.trackedEntity = selectedEntity;
      }

      if (mode === "follow") {
        selectedEntity.viewFrom = new ConstantProperty(new Cartesian3(-28, 0, 10));
        const position = selectedEntity.position?.getValue(viewer.clock.currentTime);
        if (!isValidCartesian3(position)) {
          return;
        }
        const range = Cartesian3.distance(viewer.camera.positionWC, position);
        if (!Number.isFinite(range) || range > 220) {
          viewer.zoomTo(selectedEntity, new HeadingPitchRange(0, CesiumMath.toRadians(-16), 34));
        }
        return;
      }
    };

    viewer.clock.onTick.addEventListener(onTick);
    return () => {
      try {
        if (isViewerAlive(viewer)) {
          viewer.clock.onTick.removeEventListener(onTick);
        }
      } catch {
        // no-op
      }
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const manager = managerRef.current;
    if (!viewer || !manager) {
      return;
    }

    if (cameraMode !== "fpv" || !selectedDroneId) {
      // Restore model visibility when leaving FPV.
      if (selectedDroneId) {
        const entity = manager.getEntity(selectedDroneId);
        if (entity?.model) {
          entity.model.show = new ConstantProperty(true);
        }
      }
      fpvSmoothedHeadingRef.current = null;
      return;
    }

    // Hide the drone model in FPV so we don't see it.
    const selectedEntity = manager.getEntity(selectedDroneId);
    if (selectedEntity?.model) {
      selectedEntity.model.show = new ConstantProperty(false);
    }

    const onTick = (): void => {
      const droneId = selectedDroneIdRef.current;
      if (!droneId) {
        return;
      }

      const telemetry = telemetryByDroneRef.current[droneId];
      if (!telemetry || !isValidGeoPoint(telemetry.position.lat, telemetry.position.lon, telemetry.position.alt)) {
        return;
      }

      // Smooth heading to eliminate jitter during turns.
      const rawHeading = telemetry.heading;
      if (fpvSmoothedHeadingRef.current === null) {
        fpvSmoothedHeadingRef.current = rawHeading;
      } else {
        // Shortest-path angular interpolation.
        let delta = rawHeading - fpvSmoothedHeadingRef.current;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        fpvSmoothedHeadingRef.current = (fpvSmoothedHeadingRef.current + delta * 0.25 + 360) % 360;
      }

      const headingRad = CesiumMath.toRadians(fpvSmoothedHeadingRef.current);
      const pitchRad = CesiumMath.toRadians(fpvPitchRef.current);
      const baseAltitude = resolveAbsoluteAltitude(viewer, telemetry.position.lat, telemetry.position.lon, telemetry.position.alt);

      // Mount the camera slightly behind and above the drone center, looking forward.
      // Negative offset (behind) prevents the model from being visible.
      const mount = offsetLatLonMeters(
        telemetry.position.lat,
        telemetry.position.lon,
        Math.cos(headingRad) * -0.3,
        Math.sin(headingRad) * -0.3
      );
      const lookDistance = 60;
      const target = offsetLatLonMeters(
        telemetry.position.lat,
        telemetry.position.lon,
        Math.cos(headingRad) * lookDistance,
        Math.sin(headingRad) * lookDistance
      );

      const cameraAlt = baseAltitude + 0.8;
      // Apply pitch: positive pitch = look down, negative = look up.
      const targetAltDelta = Math.tan(pitchRad) * lookDistance;
      const cameraPosition = Cartesian3.fromDegrees(mount.lon, mount.lat, cameraAlt);
      const targetPosition = Cartesian3.fromDegrees(target.lon, target.lat, cameraAlt + targetAltDelta);
      const direction = Cartesian3.normalize(
        Cartesian3.subtract(targetPosition, cameraPosition, new Cartesian3()),
        new Cartesian3()
      );
      const surfaceUp = Ellipsoid.WGS84.geodeticSurfaceNormal(cameraPosition, new Cartesian3());
      const right = Cartesian3.normalize(Cartesian3.cross(direction, surfaceUp, new Cartesian3()), new Cartesian3());
      const up = Cartesian3.normalize(Cartesian3.cross(right, direction, new Cartesian3()), new Cartesian3());

      viewer.trackedEntity = undefined;
      viewer.camera.setView({
        destination: cameraPosition,
        orientation: {
          direction,
          up
        }
      });
    };

    viewer.clock.onTick.addEventListener(onTick);
    return () => {
      // Restore model visibility on cleanup.
      if (selectedDroneId) {
        const entity = manager.getEntity(selectedDroneId);
        if (entity?.model) {
          entity.model.show = new ConstantProperty(true);
        }
      }
      fpvSmoothedHeadingRef.current = null;
      try {
        if (isViewerAlive(viewer)) {
          viewer.clock.onTick.removeEventListener(onTick);
        }
      } catch {
        // no-op
      }
    };
  }, [cameraMode, selectedDroneId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const manager = managerRef.current;
    if (!viewer || !manager) {
      return;
    }
    if (cameraMode !== "cinematic" || !selectedDroneId) {
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      return;
    }

    const onTick = (): void => {
      const selectedEntity = manager.getEntity(selectedDroneId);
      const position = selectedEntity?.position?.getValue(viewer.clock.currentTime);
      if (!isValidCartesian3(position)) {
        return;
      }

      cinematicAngleRef.current += 0.01;
      if (cinematicAngleRef.current > CesiumMath.TWO_PI) {
        cinematicAngleRef.current -= CesiumMath.TWO_PI;
      }

      const offset = new Cartesian3(
        Math.sin(cinematicAngleRef.current) * 320,
        Math.cos(cinematicAngleRef.current) * 320,
        130
      );
      viewer.camera.lookAt(position, offset);
    };

    viewer.clock.onTick.addEventListener(onTick);
    return () => {
      try {
        if (isViewerAlive(viewer)) {
          viewer.camera.lookAtTransform(Matrix4.IDENTITY);
          viewer.clock.onTick.removeEventListener(onTick);
        }
      } catch {
        // no-op
      }
    };
  }, [cameraMode, selectedDroneId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    for (const entity of geofenceEntitiesRef.current) {
      viewer.entities.remove(entity);
    }
    geofenceEntitiesRef.current = [];

    for (const geofence of geofences) {
      const polygonPoints = geofence.polygon
        .filter((p) => isValidGeoPoint(p.lat, p.lon, 0))
        .map((p) => Cartesian3.fromDegrees(p.lon, p.lat, 0));
      if (polygonPoints.length < 3) {
        continue;
      }
      const entity = viewer.entities.add({
        polygon: {
          hierarchy: new PolygonHierarchy(polygonPoints),
          material: geofence.isActive
            ? Color.fromCssColorString("#5af58c55")
            : Color.fromCssColorString("#ff486355"),
          outline: true,
          outlineColor: geofence.isActive ? Color.LIME : Color.RED
        }
      });
      geofenceEntitiesRef.current.push(entity);
    }
  }, [geofences]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    for (const entity of homeBaseEntitiesRef.current) {
      viewer.entities.remove(entity);
    }
    homeBaseEntitiesRef.current = [];

    for (const base of homeBases) {
      const polygonPoints = base.polygon
        .filter((point) => isValidGeoPoint(point.lat, point.lon, 0))
        .map((point) => Cartesian3.fromDegrees(point.lon, point.lat, Math.max(base.homeAlt, 0)));
      if (polygonPoints.length < 3) {
        continue;
      }

      const centroid = base.polygon.reduce(
        (acc, point) => ({ lat: acc.lat + point.lat, lon: acc.lon + point.lon }),
        { lat: 0, lon: 0 }
      );
      centroid.lat /= base.polygon.length;
      centroid.lon /= base.polygon.length;

      homeBaseEntitiesRef.current.push(
        viewer.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(polygonPoints),
            material: Color.fromCssColorString("#ff486333"),
            outline: true,
            outlineColor: Color.fromCssColorString("#ff4863")
          }
        })
      );

      for (const slot of base.slots) {
        if (!isValidGeoPoint(slot.lat, slot.lon, base.homeAlt)) {
          continue;
        }
        const droneName = dronesById.get(slot.droneId)?.name ?? slot.droneId;
        homeBaseEntitiesRef.current.push(
          viewer.entities.add({
            position: Cartesian3.fromDegrees(slot.lon, slot.lat, Math.max(base.homeAlt, 1)),
            point: {
              pixelSize: 9,
              color: Color.fromCssColorString("#ff6b7f"),
              outlineColor: Color.fromCssColorString("#ffd5db"),
              outlineWidth: 1,
              heightReference: HeightReference.RELATIVE_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
              text: droneName,
              font: "10px Orbitron",
              fillColor: Color.fromCssColorString("#ffd5db"),
              showBackground: true,
              backgroundColor: Color.fromCssColorString("#2a0810dd"),
              pixelOffset: new Cartesian2(0, -14),
              heightReference: HeightReference.RELATIVE_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
          })
        );
      }

      if (isValidGeoPoint(centroid.lat, centroid.lon, base.homeAlt)) {
        homeBaseEntitiesRef.current.push(
          viewer.entities.add({
            position: Cartesian3.fromDegrees(centroid.lon, centroid.lat, Math.max(base.homeAlt, 2)),
            label: {
              text: `HOME BASE\n${base.name}`,
              font: "12px Orbitron",
              fillColor: Color.fromCssColorString("#ff8a96"),
              showBackground: true,
              backgroundColor: Color.fromCssColorString("#2a0810dd"),
              pixelOffset: new Cartesian2(0, -16),
              heightReference: HeightReference.RELATIVE_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
          })
        );
      }
    }
  }, [homeBases, dronesById]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    for (const entity of drawPreviewEntitiesRef.current) {
      viewer.entities.remove(entity);
    }
    drawPreviewEntitiesRef.current = [];

    if (!areaDrawingMode || areaDrawPoints.length === 0) {
      return;
    }

    const color = areaDrawingMode === "homeBase"
      ? Color.fromCssColorString("#ff4863")
      : Color.fromCssColorString("#5af58c");
    const positions = areaDrawPoints
      .filter((point) => isValidGeoPoint(point.lat, point.lon, 0))
      .map((point) => Cartesian3.fromDegrees(point.lon, point.lat, 2));

    areaDrawPoints.forEach((point, index) => {
      drawPreviewEntitiesRef.current.push(
        viewer.entities.add({
          position: Cartesian3.fromDegrees(point.lon, point.lat, 2),
          point: {
            pixelSize: 8,
            color,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            heightReference: HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: {
            text: `${index + 1}`,
            font: "10px Orbitron",
            fillColor: color,
            showBackground: true,
            backgroundColor: Color.fromCssColorString("#041225cc"),
            pixelOffset: new Cartesian2(0, -14),
            heightReference: HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
      );
    });

    if (positions.length >= 2) {
      drawPreviewEntitiesRef.current.push(
        viewer.entities.add({
          polyline: {
            positions: [...positions, positions[0]],
            width: 2.5,
            material: color
          }
        })
      );
    }

    if (positions.length >= 3) {
      drawPreviewEntitiesRef.current.push(
        viewer.entities.add({
          polygon: {
            hierarchy: new PolygonHierarchy(positions),
            material: areaDrawingMode === "homeBase"
              ? Color.fromCssColorString("#ff486322")
              : Color.fromCssColorString("#5af58c22"),
            outline: true,
            outlineColor: color
          }
        })
      );
    }
  }, [areaDrawingMode, areaDrawPoints]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    for (const entity of plannerEntitiesRef.current) {
      viewer.entities.remove(entity);
    }
    plannerEntitiesRef.current = [];

    const plannerWaypointEntries = plannerWaypoints
      .map((wp, index) => ({ wp, index }))
      .filter(({ wp }) => isValidGeoPoint(wp.lat, wp.lon, wp.alt));
    const displayPath = buildMissionDisplayPath(plannerWaypointEntries.map(({ wp }) => wp));
    const positions = displayPath.map((wp) =>
      Cartesian3.fromDegrees(wp.lon, wp.lat, resolveAbsoluteAltitude(viewer, wp.lat, wp.lon, wp.alt))
    );

    if (positions.length >= 2) {
      plannerEntitiesRef.current.push(
        viewer.entities.add({
          polyline: {
            positions,
            width: 3,
            material: Color.fromCssColorString("#f5b14a"),
            clampToGround: false
          }
        })
      );
    }

    plannerWaypointEntries.forEach(({ wp, index }, displayIndex) => {
      const isSelected = selectedPlannerWaypointIndex === index;
      plannerEntitiesRef.current.push(
        viewer.entities.add({
          id: `planner-wp-${index}`,
          position: Cartesian3.fromDegrees(wp.lon, wp.lat, wp.alt),
          point: {
            pixelSize: isSelected ? 12 : 9,
            color: isSelected ? Color.fromCssColorString("#3de0ff") : Color.fromCssColorString("#f5b14a"),
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            heightReference: HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: {
            text: buildWaypointLabelText(wp.name || `WP-${displayIndex + 1}`, wp),
            font: "12px Orbitron",
            fillColor: isSelected ? Color.fromCssColorString("#3de0ff") : Color.fromCssColorString("#f5b14a"),
            showBackground: true,
            backgroundColor: wp.swarmTrigger ? Color.fromCssColorString("#10253fd9") : Color.fromCssColorString("#041225dd"),
            pixelOffset: new Cartesian2(0, -20),
            heightReference: HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
      );
    });
  }, [plannerWaypoints, selectedPlannerWaypointIndex]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    for (const entity of searchPreviewEntitiesRef.current) {
      viewer.entities.remove(entity);
    }
    searchPreviewEntitiesRef.current = [];

    const shouldShowAnyGhostLayer =
      ghostPreviewOptions.enabled &&
      (ghostPreviewOptions.showArea || ghostPreviewOptions.showTracks || ghostPreviewOptions.showMarkers);
    if (!shouldShowAnyGhostLayer) {
      return;
    }

    const previewWaypoints =
      plannerWaypoints.length > 0
        ? plannerWaypoints
        : activeMissionWaypointIndex >= 0 && latestMissionForSelectedDrone
          ? latestMissionForSelectedDrone.waypoints
          : [];
    const previewSelectedIndex =
      plannerWaypoints.length > 0
        ? selectedPlannerWaypointIndex
        : activeMissionWaypointIndex >= 0
          ? Math.min(activeMissionWaypointIndex, Math.max(previewWaypoints.length - 1, 0))
          : null;

    const candidateEntries = previewWaypoints
      .map((waypoint, index) => ({ waypoint, index }))
      .filter(({ waypoint }) => isValidGeoPoint(waypoint.lat, waypoint.lon, waypoint.alt) && waypoint.swarmTrigger);

    candidateEntries.forEach(({ waypoint, index }) => {
      const preset = swarmPresetsById.get(waypoint.swarmTrigger?.presetId ?? "");
      const preview = resolveSearchPreviewSpec(waypoint, preset);
      if (!preview) {
        return;
      }

      const isSelected = previewSelectedIndex === index;
      const showDetailLabel = previewSelectedIndex === null || isSelected;
      const outlineColor = isSelected
        ? Color.fromCssColorString("#3de0ff")
        : Color.fromCssColorString("#3de0ff44");
      const fillColor = isSelected
        ? Color.fromCssColorString("#3de0ff18")
        : Color.fromCssColorString("#3de0ff08");
      const stripeColor = isSelected
        ? Color.fromCssColorString("#f5b14acc")
        : Color.fromCssColorString("#f5b14a3d");
      const labelColor = isSelected
        ? Color.fromCssColorString("#3de0ff")
        : Color.fromCssColorString("#82a9c4");
      const group = waypoint.swarmTrigger ? swarmGroupsById.get(waypoint.swarmTrigger.groupId) : undefined;
      const droneCount = group ? group.followerIds.length + 1 : 1;
      const animatedHeadingDeg =
        "headingDeg" in preview && "direction" in preview && isSelected
          ? preview.headingDeg + orbitPreviewPhase * 360 * (preview.direction === "ccw" ? -1 : 1)
          : "headingDeg" in preview
            ? preview.headingDeg
            : 0;

      if (preview.kind === "orbit") {
        const orbitCircle = buildCirclePoints(waypoint.lat, waypoint.lon, preview.radius);
        const orbitSamples = buildOrbitSamplePoints(
          waypoint.lat,
          waypoint.lon,
          preview.radius,
          droneCount,
          animatedHeadingDeg
        );
        const directionSign = preview.direction === "ccw" ? -1 : 1;
        const arrowArc = buildArcPoints(
          waypoint.lat,
          waypoint.lon,
          preview.radius,
          CesiumMath.toRadians(animatedHeadingDeg) - directionSign * 0.6,
          CesiumMath.toRadians(animatedHeadingDeg) + directionSign * 0.1
        );

        if (ghostPreviewOptions.showArea) {
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              polygon: {
                hierarchy: new PolygonHierarchy(orbitCircle.slice(0, -1)),
                material: fillColor,
                outline: true,
                outlineColor
              }
            })
          );
        }
        if (ghostPreviewOptions.showTracks) {
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              polyline: {
                positions: orbitCircle,
                width: isSelected ? 2.4 : 1.6,
                material: stripeColor,
                clampToGround: true
              }
            })
          );
        }
        if (ghostPreviewOptions.showMarkers) {
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              polyline: {
                positions: arrowArc,
                width: isSelected ? 2.4 : 1.4,
                material: labelColor,
                clampToGround: true
              }
            })
          );
          for (const sample of orbitSamples) {
            searchPreviewEntitiesRef.current.push(
              viewer.entities.add({
                position: toGroundCartesian(sample.lat, sample.lon, 4),
                point: {
                  pixelSize: isSelected ? 7 : 5,
                  color: stripeColor,
                  outlineColor,
                  outlineWidth: 1.5,
                  heightReference: HeightReference.RELATIVE_TO_GROUND,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY
                }
              })
            );
          }
          if (showDetailLabel) {
            const labelAnchor = offsetLatLonMeters(waypoint.lat, waypoint.lon, preview.radius + 24, 0);
            searchPreviewEntitiesRef.current.push(
              viewer.entities.add({
                position: toGroundCartesian(labelAnchor.lat, labelAnchor.lon, 4),
                label: {
                  text: `ORBIT ${preview.direction.toUpperCase()}\nR ${Math.round(preview.radius)}m`,
                  font: "11px Orbitron",
                  fillColor: Color.fromCssColorString("#e8fbff"),
                  outlineColor: Color.fromCssColorString("#041225"),
                  outlineWidth: 3,
                  showBackground: false,
                  pixelOffset: new Cartesian2(0, -12),
                  heightReference: HeightReference.RELATIVE_TO_GROUND,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY
                }
              })
            );
          }
        }
        return;
      }

      if (preview.kind === "grid") {
        const corners = buildRectPoints(waypoint.lat, waypoint.lon, preview.width, preview.height, preview.headingDeg);
        const cornerPositions = corners.map((point) => toGroundCartesian(point.lat, point.lon));
        if (ghostPreviewOptions.showArea) {
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              polygon: {
                hierarchy: new PolygonHierarchy(cornerPositions.slice(0, -1)),
                material: fillColor,
                outline: true,
                outlineColor
              }
            })
          );
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              polyline: {
                positions: cornerPositions,
                width: isSelected ? 2.6 : 1.8,
                material: outlineColor,
                clampToGround: true
              }
            })
          );
        }
        const guideToStart = buildGuideLine(
          waypoint.lat,
          waypoint.lon,
          0,
          0,
          -preview.height / 2,
          0,
          preview.headingDeg
        );
        const guideSweep = buildGuideLine(
          waypoint.lat,
          waypoint.lon,
          -preview.height / 2,
          0,
          -preview.height / 2 + Math.min(preview.height * 0.28, 80),
          0,
          preview.headingDeg
        );
        if (ghostPreviewOptions.showTracks) {
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              polyline: {
                positions: guideToStart,
                width: isSelected ? 2.2 : 1.4,
                material: outlineColor,
                clampToGround: true
              }
            })
          );
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              polyline: {
                positions: guideSweep,
                width: isSelected ? 3 : 1.8,
                material: stripeColor,
                clampToGround: true
              }
            })
          );
          for (const line of buildSearchGridDronePaths(
            waypoint.lat,
            waypoint.lon,
            preview.width,
            preview.height,
            preview.headingDeg,
            droneCount,
            preview.spacing
          )) {
            searchPreviewEntitiesRef.current.push(
              viewer.entities.add({
                polyline: {
                  positions: line,
                  width: 1.2,
                  material: stripeColor,
                  clampToGround: true
                }
              })
            );
          }
        }
        if (ghostPreviewOptions.showMarkers && showDetailLabel) {
          const labelAnchor = offsetLatLonMeters(waypoint.lat, waypoint.lon, preview.height / 2 + 24, 0);
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              position: toGroundCartesian(labelAnchor.lat, labelAnchor.lon, 4),
              label: {
                text: `SEARCH GRID\n${Math.round(preview.width)}m x ${Math.round(preview.height)}m`,
                font: "11px Orbitron",
                fillColor: Color.fromCssColorString("#e8fbff"),
                outlineColor: Color.fromCssColorString("#041225"),
                outlineWidth: 3,
                showBackground: false,
                pixelOffset: new Cartesian2(0, -12),
                heightReference: HeightReference.RELATIVE_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
              }
            })
          );
          const startMarker = buildGuideLine(
            waypoint.lat,
            waypoint.lon,
            -preview.height / 2,
            0,
            -preview.height / 2,
            0,
            preview.headingDeg
          )[0];
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              position: startMarker,
              label: {
                text: "START",
                font: "10px Orbitron",
                fillColor: Color.fromCssColorString("#f5d287"),
                outlineColor: Color.fromCssColorString("#041225"),
                outlineWidth: 3,
                showBackground: false,
                pixelOffset: new Cartesian2(0, -14),
                heightReference: HeightReference.RELATIVE_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
              }
            })
          );
        }
        return;
      }

      if (preview.kind === "spiral") {
        const path = buildSearchSpiralPoints(waypoint.lat, waypoint.lon, preview.maxRadius, preview.spacing);
        const circle = buildCirclePoints(waypoint.lat, waypoint.lon, preview.maxRadius);
        if (ghostPreviewOptions.showTracks) {
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              polyline: {
                positions: path,
                width: isSelected ? 2.5 : 1.8,
                material: outlineColor,
                clampToGround: true
              }
            })
          );
        }
        if (ghostPreviewOptions.showArea) {
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              polygon: {
                hierarchy: new PolygonHierarchy(circle.slice(0, -1)),
                material: fillColor,
                outline: true,
                outlineColor
              }
            })
          );
        }
        if (ghostPreviewOptions.showMarkers && showDetailLabel) {
          const labelAnchor = offsetLatLonMeters(waypoint.lat, waypoint.lon, preview.maxRadius + 24, 0);
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              position: toGroundCartesian(labelAnchor.lat, labelAnchor.lon, 4),
              label: {
                text: `SPIRAL SEARCH\nR ${Math.round(preview.maxRadius)}m`,
                font: "11px Orbitron",
                fillColor: Color.fromCssColorString("#e8fbff"),
                outlineColor: Color.fromCssColorString("#041225"),
                outlineWidth: 3,
                showBackground: false,
                pixelOffset: new Cartesian2(0, -12),
                heightReference: HeightReference.RELATIVE_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
              }
            })
          );
        }
        return;
      }

      if (preview.kind === "fibonacci_orbit") {
        const orbitSamples = buildFibonacciOrbitSamplePoints(
          waypoint.lat,
          waypoint.lon,
          preview.maxRadius,
          droneCount,
          animatedHeadingDeg
        );
        const directionSign = preview.direction === "ccw" ? -1 : 1;
        const arrowArc = buildArcPoints(
          waypoint.lat,
          waypoint.lon,
          preview.maxRadius,
          CesiumMath.toRadians(animatedHeadingDeg) - directionSign * 0.6,
          CesiumMath.toRadians(animatedHeadingDeg) + directionSign * 0.1
        );
        if (ghostPreviewOptions.showArea) {
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              polygon: {
                hierarchy: new PolygonHierarchy(buildCirclePoints(waypoint.lat, waypoint.lon, preview.maxRadius).slice(0, -1)),
                material: fillColor,
                outline: true,
                outlineColor
              }
            })
          );
        }
        if (ghostPreviewOptions.showTracks) {
          const seenRadii = new Set<string>();
          for (const sample of orbitSamples) {
            const key = sample.radius.toFixed(1);
            if (seenRadii.has(key)) {
              continue;
            }
            seenRadii.add(key);
            searchPreviewEntitiesRef.current.push(
              viewer.entities.add({
                polyline: {
                  positions: buildCirclePoints(waypoint.lat, waypoint.lon, sample.radius, 72),
                  width: isSelected ? 1.9 : 1.2,
                  material: stripeColor,
                  clampToGround: true
                }
              })
            );
          }
        }
        if (ghostPreviewOptions.showMarkers) {
          searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              polyline: {
                positions: arrowArc,
                width: isSelected ? 2.4 : 1.4,
                material: labelColor,
                clampToGround: true
              }
            })
          );
          for (const sample of orbitSamples) {
            searchPreviewEntitiesRef.current.push(
              viewer.entities.add({
                position: toGroundCartesian(sample.lat, sample.lon, 4),
                point: {
                  pixelSize: isSelected ? 7 : 5,
                  color: stripeColor,
                  outlineColor,
                  outlineWidth: 1.5,
                  heightReference: HeightReference.RELATIVE_TO_GROUND,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY
                }
              })
            );
          }

          if (showDetailLabel) {
            const labelAnchor = offsetLatLonMeters(waypoint.lat, waypoint.lon, preview.maxRadius + 24, 0);
            searchPreviewEntitiesRef.current.push(
            viewer.entities.add({
              position: toGroundCartesian(labelAnchor.lat, labelAnchor.lon, 4),
              label: {
                  text: `FIB ORBIT ${preview.direction.toUpperCase()}\nR ${Math.round(preview.maxRadius)}m`,
                  font: "11px Orbitron",
                  fillColor: Color.fromCssColorString("#e8fbff"),
                  outlineColor: Color.fromCssColorString("#041225"),
                  outlineWidth: 3,
                  showBackground: false,
                  pixelOffset: new Cartesian2(0, -12),
                  heightReference: HeightReference.RELATIVE_TO_GROUND,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY
                }
              })
            );
          }
        }
        return;
      }

      const path = buildExpandingSquarePoints(waypoint.lat, waypoint.lon, preview.maxRadius, preview.legSpacing);
      const bounds = buildRectPoints(waypoint.lat, waypoint.lon, preview.maxRadius * 2, preview.maxRadius * 2, 0);
      if (ghostPreviewOptions.showArea) {
        searchPreviewEntitiesRef.current.push(
          viewer.entities.add({
            polygon: {
              hierarchy: new PolygonHierarchy(bounds.slice(0, -1).map((point) => toGroundCartesian(point.lat, point.lon))),
              material: fillColor,
              outline: true,
              outlineColor
            }
          })
        );
      }
      if (ghostPreviewOptions.showTracks) {
        searchPreviewEntitiesRef.current.push(
          viewer.entities.add({
            polyline: {
              positions: path,
              width: isSelected ? 2.5 : 1.8,
              material: stripeColor,
              clampToGround: true
            }
          })
        );
      }
      if (ghostPreviewOptions.showMarkers && showDetailLabel) {
        const labelAnchor = offsetLatLonMeters(waypoint.lat, waypoint.lon, preview.maxRadius + 24, 0);
        searchPreviewEntitiesRef.current.push(
          viewer.entities.add({
            position: toGroundCartesian(labelAnchor.lat, labelAnchor.lon, 4),
            label: {
              text: `EXPANDING SQUARE\nR ${Math.round(preview.maxRadius)}m`,
              font: "11px Orbitron",
              fillColor: Color.fromCssColorString("#e8fbff"),
              outlineColor: Color.fromCssColorString("#041225"),
              outlineWidth: 3,
              showBackground: false,
              pixelOffset: new Cartesian2(0, -12),
              heightReference: HeightReference.RELATIVE_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
          })
        );
      }
    });
  }, [
    plannerWaypoints,
    selectedPlannerWaypointIndex,
    swarmPresetsById,
    swarmGroupsById,
    ghostPreviewOptions,
    activeMissionWaypointIndex,
    latestMissionForSelectedDrone,
    orbitPreviewPhase
  ]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    for (const entity of missionEntitiesRef.current) {
      viewer.entities.remove(entity);
    }
    missionEntitiesRef.current = [];

    if (plannerWaypoints.length > 0 || !selectedDroneId) {
      return;
    }

    if (!latestMissionForSelectedDrone || latestMissionForSelectedDrone.waypoints.length === 0) {
      return;
    }

    const missionWaypointEntries = latestMissionForSelectedDrone.waypoints
      .map((wp, index) => ({ wp, index }))
      .filter(({ wp }) => isValidGeoPoint(wp.lat, wp.lon, wp.alt));
    const displayPath = buildMissionDisplayPath(missionWaypointEntries.map(({ wp }) => wp));
    const positions = displayPath.map((wp) =>
      Cartesian3.fromDegrees(wp.lon, wp.lat, resolveAbsoluteAltitude(viewer, wp.lat, wp.lon, wp.alt))
    );
    const currentWpIndex = activeMissionWaypointIndex;

    // Only show mission track while a mission is actively executing.
    if (currentWpIndex < 0) {
      return;
    }

    if (positions.length >= 2) {
      missionEntitiesRef.current.push(
        viewer.entities.add({
          polyline: {
            positions,
            width: 2.5,
            material: Color.fromCssColorString("#3de0ffcc"),
            clampToGround: false
          }
        })
      );
    }

    missionWaypointEntries.forEach(({ wp, index }, displayIndex) => {
      const isCompleted = currentWpIndex >= 0 && index < currentWpIndex;
      const isCurrent = currentWpIndex === index;
      const pointColor = isCurrent
        ? Color.fromCssColorString("#f5b14a")
        : isCompleted
          ? Color.fromCssColorString("#5af58c")
          : Color.fromCssColorString("#3de0ff");

      missionEntitiesRef.current.push(
        viewer.entities.add({
          id: `mission-wp-${latestMissionForSelectedDrone.id}-${index}`,
          position: Cartesian3.fromDegrees(wp.lon, wp.lat, wp.alt),
          point: {
            pixelSize: isCurrent ? 10 : 8,
            color: pointColor,
            outlineColor: Color.BLACK,
            outlineWidth: 2,
            heightReference: HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: {
            text: buildWaypointLabelText(`WP-${displayIndex + 1}`, wp),
            font: "11px Orbitron",
            fillColor: pointColor,
            showBackground: true,
            backgroundColor: wp.swarmTrigger ? Color.fromCssColorString("#10253fd0") : Color.fromCssColorString("#041225d0"),
            pixelOffset: new Cartesian2(0, -18),
            heightReference: HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          }
        })
      );
    });
  }, [activeMissionWaypointIndex, latestMissionForSelectedDrone, plannerWaypoints, selectedDroneId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !focusPathKey || lastFocusedPathKeyRef.current === focusPathKey) {
      return;
    }
    let cancelled = false;
    const canUseViewer = (): boolean => !cancelled && viewerRef.current === viewer && isViewerAlive(viewer);

    const displayPath = buildMissionDisplayPath(plannerWaypoints);
    const points = displayPath
      .filter((waypoint) => isValidGeoPoint(waypoint.lat, waypoint.lon, waypoint.alt))
      .map((waypoint) =>
        Cartesian3.fromDegrees(
          waypoint.lon,
          waypoint.lat,
          resolveAbsoluteAltitude(viewer, waypoint.lat, waypoint.lon, waypoint.alt)
        )
      );

    if (points.length === 0) {
      return;
    }

    lastFocusedPathKeyRef.current = focusPathKey;
    if (!canUseViewer()) {
      return;
    }
    viewer.trackedEntity = undefined;
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    resizeViewer(viewer);

    const fitPath = (): void => {
      if (!canUseViewer()) {
        return;
      }
      resizeViewer(viewer);
      if (points.length === 1) {
        const cartographic = Cartographic.fromCartesian(points[0]);
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(
            CesiumMath.toDegrees(cartographic.longitude),
            CesiumMath.toDegrees(cartographic.latitude),
            1800
          ),
          duration: 1.1
        });
        return;
      }

      const sphere = BoundingSphere.fromPoints(points);
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.2,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-35), Math.max(2200, sphere.radius * 2.8))
      });
    };

    fitPath();
    const delayedFits = [
      window.setTimeout(fitPath, 120),
      window.setTimeout(fitPath, 360)
    ];

    return () => {
      cancelled = true;
      delayedFits.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [focusPathKey, plannerWaypoints]);

  // ── Swarm formation ghost entities ──
  const swarmEntitiesRef = useRef<Entity[]>([]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    for (const entity of swarmEntitiesRef.current) {
      viewer.entities.remove(entity);
    }
    swarmEntitiesRef.current = [];

    for (const group of swarmGroups) {
      if (group.state !== "FORMING" && group.state !== "IN_FORMATION" && group.state !== "MANEUVERING") {
        continue;
      }

      const leaderTel = telemetryByDrone[group.leaderId];
      if (!leaderTel || !isValidGeoPoint(leaderTel.position.lat, leaderTel.position.lon, leaderTel.position.alt)) {
        continue;
      }

      // Compute formation target positions using client-side geometry
      const offsets = computeFormationOffsets(
        group.formation as FormationName,
        group.followerIds.length,
        group.spacing
      );

      const quality = group.formationQuality ?? 0;
      const ghostColor = quality >= 80
        ? Color.fromCssColorString("#5af58c55")
        : quality >= 50
        ? Color.fromCssColorString("#f5b14a55")
        : Color.fromCssColorString("#ff486355");

      // Apply heading rotation
      const headingRad = (group.headingDeg ?? 0) * Math.PI / 180;
      const cosH = Math.cos(headingRad);
      const sinH = Math.sin(headingRad);

      for (let i = 0; i < offsets.length && i < group.followerIds.length; i++) {
        const raw = offsets[i];
        // Rotate by heading: x->east, y->north (canvas y is south)
        const north = -(raw.y * cosH - raw.x * sinH);
        const east = raw.y * sinH + raw.x * cosH;
        const pos = offsetLatLonMeters(leaderTel.position.lat, leaderTel.position.lon, north, east);

        if (!isValidGeoPoint(pos.lat, pos.lon, leaderTel.position.alt)) continue;

        const absAlt = resolveAbsoluteAltitude(viewer, pos.lat, pos.lon, leaderTel.position.alt + (group.altOffset ?? 0));

        swarmEntitiesRef.current.push(
          viewer.entities.add({
            position: Cartesian3.fromDegrees(pos.lon, pos.lat, absAlt),
            point: {
              pixelSize: 6,
              color: ghostColor,
              outlineColor: Color.fromCssColorString("#ffffff30"),
              outlineWidth: 1,
              heightReference: HeightReference.NONE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
          })
        );
      }
    }
  }, [swarmGroups, telemetryByDrone]);

  return <div ref={containerRef} className="h-full w-full" />;
}
