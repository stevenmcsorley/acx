import { useEffect, useRef } from "react";
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Color,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  HeightReference,
  Ion,
  Math as CesiumMath,
  Viewer,
  createWorldTerrainAsync
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { MissionRecord, MissionWaypoint } from "../types/domain";
import { buildMissionDisplayPath } from "../lib/missionCurves";

interface MissionPreviewViewerProps {
  mission: MissionRecord | null;
}

const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN;

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);
const isValidGeoPoint = (lat: number, lon: number, alt = 0): boolean =>
  isFiniteNumber(lat) && isFiniteNumber(lon) && isFiniteNumber(alt) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

function safeResize(viewer: Viewer): void {
  try {
    if (viewer.isDestroyed()) {
      return;
    }
    viewer.resize();
    viewer.scene.requestRender();
  } catch {
    // no-op
  }
}

function buildLabel(index: number, waypoint: MissionWaypoint): string {
  if (!waypoint.swarmTrigger) {
    return `WP-${index + 1}`;
  }
  return waypoint.swarmTrigger.eventMode === "final_destination" ? `WP-${index + 1}\nDEST` : `WP-${index + 1}\nSWARM`;
}

export function MissionPreviewViewer({ mission }: MissionPreviewViewerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);

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
      shouldAnimate: false,
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true
        }
      }
    });

    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true;
    }

    createWorldTerrainAsync()
      .then((terrainProvider) => {
        if (!viewer.isDestroyed()) {
          viewer.terrainProvider = terrainProvider;
          viewer.scene.requestRender();
        }
      })
      .catch(() => {
        // fallback terrain is already in place
      });

    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(-96, 37.8, 3_000_000),
      duration: 0
    });

    const resizeObserver = new ResizeObserver(() => {
      safeResize(viewer);
    });
    resizeObserver.observe(containerRef.current);

    const resizeTimeouts = [
      window.setTimeout(() => safeResize(viewer), 0),
      window.setTimeout(() => safeResize(viewer), 120),
      window.setTimeout(() => safeResize(viewer), 360)
    ];

    viewerRef.current = viewer;

    return () => {
      resizeTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      try {
        resizeObserver.disconnect();
      } catch {
        // no-op
      }
      try {
        if (!viewer.isDestroyed()) {
          viewer.destroy();
        }
      } catch {
        // no-op
      }
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    viewer.entities.removeAll();

    if (!mission || mission.waypoints.length === 0) {
      safeResize(viewer);
      return;
    }

    const path = buildMissionDisplayPath(mission.waypoints).filter((waypoint) =>
      isValidGeoPoint(waypoint.lat, waypoint.lon, waypoint.alt)
    );
    const rawWaypoints = mission.waypoints.filter((waypoint) =>
      isValidGeoPoint(waypoint.lat, waypoint.lon, waypoint.alt)
    );

    const positions = path.map((waypoint) =>
      Cartesian3.fromDegrees(waypoint.lon, waypoint.lat, Math.max(waypoint.alt, 5))
    );

    if (positions.length >= 2) {
      viewer.entities.add({
        polyline: {
          positions,
          width: 4,
          material: Color.fromCssColorString("#3de0ff"),
          clampToGround: false
        }
      });
    }

    rawWaypoints.forEach((waypoint, index) => {
      viewer.entities.add({
        id: `mission-preview-wp-${mission.id}-${index}`,
        position: Cartesian3.fromDegrees(waypoint.lon, waypoint.lat, Math.max(waypoint.alt, 5)),
        point: {
          pixelSize: 9,
          color: Color.fromCssColorString("#f5b14a"),
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: buildLabel(index, waypoint),
          font: "11px Orbitron",
          fillColor: Color.fromCssColorString("#f5b14a"),
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#041225dd"),
          pixelOffset: new Cartesian2(0, -18),
          heightReference: HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
    });

    const fitPoints = positions.length > 0
      ? positions
      : rawWaypoints.map((waypoint) => Cartesian3.fromDegrees(waypoint.lon, waypoint.lat, Math.max(waypoint.alt, 5)));

    if (fitPoints.length === 0) {
      safeResize(viewer);
      return;
    }

    const fitMission = (): void => {
      safeResize(viewer);
      if (fitPoints.length === 1) {
        const only = rawWaypoints[0];
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(only.lon, only.lat, 1800),
          duration: 1
        });
        return;
      }
      const sphere = BoundingSphere.fromPoints(fitPoints);
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 1.2,
        offset: new HeadingPitchRange(0, CesiumMath.toRadians(-35), Math.max(2200, sphere.radius * 2.8))
      });
    };

    fitMission();
    const delayedFits = [
      window.setTimeout(fitMission, 120),
      window.setTimeout(fitMission, 360)
    ];

    return () => {
      delayedFits.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [mission]);

  return <div ref={containerRef} className="h-full w-full" />;
}
