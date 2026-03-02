import { useEffect, useMemo, useRef } from "react";
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
import type { DroneRecord, DroneTelemetry, GeofenceRecord, MissionRecord, MissionWaypoint } from "../types/domain";
import type { SwarmGroup } from "../store/useGroundControlStore";
import { DroneEntityManager } from "./DroneEntityManager";
import { computeFormationOffsets, type FormationName } from "../components/swarm/FormationPicker";

interface GlobeViewerProps {
  drones: DroneRecord[];
  telemetryByDrone: Record<string, DroneTelemetry>;
  telemetryHistoryByDrone: Record<string, DroneTelemetry[]>;
  geofences: GeofenceRecord[];
  missions: MissionRecord[];
  selectedDroneId: string | null;
  plannerEnabled: boolean;
  plannerWaypoints: MissionWaypoint[];
  selectedPlannerWaypointIndex?: number | null;
  cameraMode: "global" | "follow" | "fpv" | "cinematic";
  fpvPitchDeg?: number;
  trailResetToken?: number;
  swarmGroups?: SwarmGroup[];
  onAddWaypoint: (wp: MissionWaypoint) => void;
  onUpdateWaypoint: (index: number, patch: Partial<MissionWaypoint>) => void;
  onSelectPlannerWaypoint?: (index: number | null) => void;
  onSelectDrone: (droneId: string | null) => void;
}

const defaultModelUri =
  import.meta.env.VITE_DRONE_MODEL_URI ??
  "https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumDrone/CesiumDrone.glb";
const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;
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
  missions,
  selectedDroneId,
  plannerEnabled,
  plannerWaypoints,
  selectedPlannerWaypointIndex = null,
  cameraMode,
  fpvPitchDeg = 0,
  trailResetToken = 0,
  swarmGroups = [],
  onAddWaypoint,
  onUpdateWaypoint,
  onSelectPlannerWaypoint,
  onSelectDrone
}: GlobeViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const handlerRef = useRef<ScreenSpaceEventHandler | null>(null);
  const geofenceEntitiesRef = useRef<Entity[]>([]);
  const plannerEntitiesRef = useRef<Entity[]>([]);
  const missionEntitiesRef = useRef<Entity[]>([]);
  const managerRef = useRef<DroneEntityManager | null>(null);
  const dronesById = useMemo(() => new Map(drones.map((d) => [d.id, d])), [drones]);
  const selectedTelemetryMode = selectedDroneId ? telemetryByDrone[selectedDroneId]?.mode ?? "" : "";
  const plannerEnabledRef = useRef(plannerEnabled);
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
  const lastSelectedForCameraRef = useRef<string | null>(null);
  const cinematicAngleRef = useRef(0);
  const fpvPitchRef = useRef(0); // FPV camera pitch in degrees, controlled by user
  const fpvSmoothedHeadingRef = useRef<number | null>(null); // smoothed heading for FPV

  useEffect(() => {
    plannerEnabledRef.current = plannerEnabled;
  }, [plannerEnabled]);

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

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    const cameraController = viewer.scene.screenSpaceCameraController;

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

    return () => {
      try {
        setCameraInteraction(true);
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

      if (plannerEnabledRef.current) {
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
  }, [cameraMode, selectedDroneId, drones]);

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

    for (const entity of plannerEntitiesRef.current) {
      viewer.entities.remove(entity);
    }
    plannerEntitiesRef.current = [];

    const plannerWaypointEntries = plannerWaypoints
      .map((wp, index) => ({ wp, index }))
      .filter(({ wp }) => isValidGeoPoint(wp.lat, wp.lon, wp.alt));
    const positions = plannerWaypointEntries.map(({ wp }) =>
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

    for (const entity of missionEntitiesRef.current) {
      viewer.entities.remove(entity);
    }
    missionEntitiesRef.current = [];

    if (plannerWaypoints.length > 0 || !selectedDroneId) {
      return;
    }

    const latestMission = missions
      .filter((mission) => mission.droneId === selectedDroneId && mission.waypoints.length > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!latestMission || latestMission.waypoints.length === 0) {
      return;
    }

    const missionWaypointEntries = latestMission.waypoints
      .map((wp, index) => ({ wp, index }))
      .filter(({ wp }) => isValidGeoPoint(wp.lat, wp.lon, wp.alt));
    const positions = missionWaypointEntries.map(({ wp }) =>
      Cartesian3.fromDegrees(wp.lon, wp.lat, resolveAbsoluteAltitude(viewer, wp.lat, wp.lon, wp.alt))
    );
    const match = /mission-wp-(\d+)\/\d+/i.exec(selectedTelemetryMode);
    const currentWpIndex = match ? Math.max(0, Number(match[1]) - 1) : -1;

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
          id: `mission-wp-${latestMission.id}-${index}`,
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
  }, [missions, plannerWaypoints, selectedDroneId, selectedTelemetryMode]);

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
