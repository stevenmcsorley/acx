import {
  Cartesian3,
  Cartographic,
  ColorBlendMode,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  Entity,
  ExtrapolationType,
  HeadingPitchRoll,
  HorizontalOrigin,
  JulianDate,
  Math as CesiumMath,
  SampledPositionProperty,
  Transforms,
  VerticalOrigin,
  Viewer,
  Cartesian2
} from "cesium";
import type { DroneRecord, DroneTelemetry } from "../types/domain";
import { useGroundControlStore } from "../store/useGroundControlStore";

const modelHeadingOffsetDeg = Number(import.meta.env.VITE_DRONE_MODEL_HEADING_OFFSET_DEG ?? 90);
const isFiniteNumber = (value: number): boolean => Number.isFinite(value);
const isValidGeo = (lat: number, lon: number, alt: number): boolean =>
  isFiniteNumber(lat) && isFiniteNumber(lon) && isFiniteNumber(alt) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

interface DroneVisual {
  entity: Entity;
  homeEntity: Entity;
  positionProperty: SampledPositionProperty;
  terrainHeight: number;
  terrainReady: boolean;
  lastSampleMs: number;
}

export class DroneEntityManager {
  private readonly droneVisuals = new Map<string, DroneVisual>();

  constructor(private readonly viewer: Viewer, private readonly droneModelUri: string) {}

  private isViewerAlive(): boolean {
    try {
      return !this.viewer.isDestroyed();
    } catch {
      return false;
    }
  }

  upsertDrone(
    drone: DroneRecord,
    telemetry: DroneTelemetry | undefined,
    selected: boolean,
    telemetryHistory: DroneTelemetry[] = []
  ): void {
    let visual = this.droneVisuals.get(drone.id);
    if (!visual) {
      const positionProperty = new SampledPositionProperty();
      positionProperty.backwardExtrapolationType = ExtrapolationType.HOLD;
      positionProperty.forwardExtrapolationType = ExtrapolationType.HOLD;
      positionProperty.forwardExtrapolationDuration = 2;
      const entity = this.viewer.entities.add({
        id: drone.id,
        position: positionProperty,
        model: {
          uri: this.droneModelUri,
          scale: 0.65,
          minimumPixelSize: 52,
          silhouetteColor: Color.CYAN,
          silhouetteSize: 0.6,
          colorBlendMode: ColorBlendMode.MIX
        },
        point: {
          pixelSize: 8,
          color: Color.CYAN,
          outlineColor: Color.BLACK,
          outlineWidth: 2
        },
        path: {
          show: true,
          width: 2.6,
          leadTime: 0,
          trailTime: 900,
          material: Color.CYAN.withAlpha(0.45)
        },
        label: {
          text: drone.name,
          font: "12px Orbitron",
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#031628cc"),
          pixelOffset: new Cartesian2(0, -34),
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.BOTTOM
        }
      });

      const homeEntity = this.viewer.entities.add({
        id: `${drone.id}::home`,
        position: Cartesian3.fromDegrees(drone.home.lon, drone.home.lat, Math.max(1, drone.home.alt + 1)),
        point: {
          pixelSize: 11,
          color: Color.fromCssColorString("#f5b14a"),
          outlineColor: Color.BLACK,
          outlineWidth: 2
        },
        label: {
          text: `${drone.name} HOME`,
          font: "11px Orbitron",
          fillColor: Color.fromCssColorString("#f5b14a"),
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#051222cc"),
          pixelOffset: new Cartesian2(0, -24),
          horizontalOrigin: HorizontalOrigin.CENTER,
          verticalOrigin: VerticalOrigin.BOTTOM
        }
      });

      visual = { entity, homeEntity, positionProperty, terrainHeight: 0, terrainReady: false, lastSampleMs: 0 };
      this.droneVisuals.set(drone.id, visual);

      // Replay historical telemetry for trail continuity across tab switches.
      // Downsample to one point every ~300ms to avoid flooding SampledPositionProperty.
      let lastReplayMs = 0;
      const REPLAY_INTERVAL_MS = 300;

      for (const historical of telemetryHistory) {
        if (
          !isValidGeo(historical.position.lat, historical.position.lon, historical.position.alt) ||
          !isFiniteNumber(historical.heading)
        ) {
          continue;
        }

        const historicalMs = new Date(historical.timestamp).getTime();
        if (!Number.isFinite(historicalMs) || historicalMs <= 0) {
          continue;
        }

        // Skip intermediate samples; always include the last one.
        if (historicalMs - lastReplayMs < REPLAY_INTERVAL_MS && historical !== telemetryHistory[telemetryHistory.length - 1]) {
          continue;
        }
        lastReplayMs = historicalMs;

        const historyCartographic = Cartographic.fromDegrees(historical.position.lon, historical.position.lat);
        const historyTerrainHeight = this.viewer.scene.globe.getHeight(historyCartographic);
        const absoluteHistoryAltitude =
          typeof historyTerrainHeight === "number" && Number.isFinite(historyTerrainHeight)
            ? Math.max(1, historyTerrainHeight + historical.position.alt)
            : Math.max(1, historical.position.alt);

        positionProperty.addSample(
          JulianDate.fromDate(new Date(historicalMs)),
          Cartesian3.fromDegrees(historical.position.lon, historical.position.lat, absoluteHistoryAltitude)
        );
        visual.lastSampleMs = historicalMs;
      }
    }

    if (!telemetry && drone.lastKnown) {
      telemetry = {
        timestamp: drone.lastKnown.timestamp,
        position: { lat: drone.lastKnown.lat, lon: drone.lastKnown.lon, alt: drone.lastKnown.alt },
        heading: 0,
        velocity: { x: 0, y: 0, z: 0, speed: 0 },
        batteryPct: drone.lastKnown.batteryPct,
        signalPct: drone.lastKnown.signalPct,
        flightState: "grounded",
        wind: { x: 0, y: 0, z: 0, speed: 0 },
        collisionFlag: false,
        geofenceViolation: false,
        mode: "bootstrap"
      };
    }

    if (!telemetry) {
      visual.homeEntity.position = new ConstantPositionProperty(
        Cartesian3.fromDegrees(drone.home.lon, drone.home.lat, Math.max(1, drone.home.alt + 1))
      );
      return;
    }

    if (
      !isValidGeo(telemetry.position.lat, telemetry.position.lon, telemetry.position.alt) ||
      !isFiniteNumber(telemetry.heading) ||
      !isFiniteNumber(telemetry.batteryPct)
    ) {
      return;
    }

    const sampleTimeMs = new Date(telemetry.timestamp).getTime();
    if (!Number.isFinite(sampleTimeMs) || sampleTimeMs <= 0) {
      return;
    }

    const sampleEveryMs = 80;
    const shouldAddSample = visual.lastSampleMs <= 0 || sampleTimeMs - visual.lastSampleMs >= sampleEveryMs;

    const time = JulianDate.fromDate(new Date(sampleTimeMs));
    const cartographic = Cartographic.fromDegrees(telemetry.position.lon, telemetry.position.lat);
    const sampledTerrainHeight = this.viewer.scene.globe.getHeight(cartographic);
    if (typeof sampledTerrainHeight === "number" && Number.isFinite(sampledTerrainHeight)) {
      visual.terrainHeight = sampledTerrainHeight;
      visual.terrainReady = true;
    }

    const absoluteAltitude = visual.terrainReady
      ? Math.max(1, visual.terrainHeight + telemetry.position.alt)
      : Math.max(1, telemetry.position.alt);
    useGroundControlStore.getState().setVisualAltitude(drone.id, absoluteAltitude);
    const position = Cartesian3.fromDegrees(telemetry.position.lon, telemetry.position.lat, absoluteAltitude);

    if (shouldAddSample) {
      visual.positionProperty.addSample(time, position);
      visual.lastSampleMs = sampleTimeMs;
    }

    visual.entity.orientation = new ConstantProperty(
      Transforms.headingPitchRollQuaternion(
        position,
        new HeadingPitchRoll(CesiumMath.toRadians(telemetry.heading + modelHeadingOffsetDeg), 0, 0)
      )
    );

    if (visual.entity.label) {
      visual.entity.label.text = new ConstantProperty(`${drone.name}  ${Math.round(telemetry.batteryPct)}%`);
    }

    if (visual.entity.path) {
      visual.entity.path.show = new ConstantProperty(visual.terrainReady);
      visual.entity.path.material = new ColorMaterialProperty(
        telemetry.collisionFlag
          ? Color.RED.withAlpha(0.72)
          : telemetry.geofenceViolation
            ? Color.ORANGE.withAlpha(0.72)
            : Color.CYAN.withAlpha(0.45)
      );
    }

    if (visual.entity.point) {
      visual.entity.point.color = new ConstantProperty(
        telemetry.collisionFlag
          ? Color.RED
          : telemetry.flightState === "airborne"
            ? Color.LIME
            : Color.CYAN
      );
    }

    if (visual.entity.model) {
      visual.entity.model.silhouetteColor = new ConstantProperty(
        selected ? Color.fromCssColorString("#f5b14a") : Color.CYAN
      );
      visual.entity.model.color = new ConstantProperty(
        telemetry.flightState === "emergency" ? Color.RED : Color.WHITE
      );
    }

    if (visual.homeEntity.point) {
      visual.homeEntity.point.color = new ConstantProperty(
        selected ? Color.fromCssColorString("#ffd084") : Color.fromCssColorString("#f5b14a")
      );
    }
    if (visual.homeEntity.label) {
      visual.homeEntity.label.text = new ConstantProperty(`${drone.name} HOME`);
    }
    visual.homeEntity.position = new ConstantPositionProperty(
      Cartesian3.fromDegrees(drone.home.lon, drone.home.lat, Math.max(1, drone.home.alt + 1))
    );
  }

  getEntity(droneId: string | null): Entity | undefined {
    if (!droneId) {
      return undefined;
    }
    return this.droneVisuals.get(droneId)?.entity;
  }

  keepOnly(droneIds: string[]): void {
    const existing = new Set(droneIds);
    for (const [id, visual] of this.droneVisuals.entries()) {
      if (!existing.has(id)) {
        this.viewer.entities.remove(visual.entity);
        this.viewer.entities.remove(visual.homeEntity);
        this.droneVisuals.delete(id);
      }
    }
  }

  resetTrails(droneId?: string | null): void {
    if (!this.isViewerAlive()) {
      return;
    }

    const ids = droneId ? [droneId] : [...this.droneVisuals.keys()];
    const now = this.viewer.clock.currentTime;

    for (const id of ids) {
      const visual = this.droneVisuals.get(id);
      if (!visual) {
        continue;
      }

      const nextProperty = new SampledPositionProperty();
      nextProperty.backwardExtrapolationType = ExtrapolationType.HOLD;
      nextProperty.forwardExtrapolationType = ExtrapolationType.HOLD;
      nextProperty.forwardExtrapolationDuration = 2;

      const currentPosition = visual.entity.position?.getValue(now);
      if (currentPosition) {
        nextProperty.addSample(now, currentPosition);
      }

      visual.positionProperty = nextProperty;
      visual.entity.position = nextProperty;
      visual.lastSampleMs = 0;
    }
  }
}
