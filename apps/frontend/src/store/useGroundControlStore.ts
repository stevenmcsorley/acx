import { create } from "zustand";
import type {
  AlertEvent,
  CameraViewMode,
  DroneRecord,
  DroneTelemetry,
  GeofenceRecord,
  MissionRecord,
  MissionWaypoint,
  UserInfo
} from "../types/domain";
import type { NavTab } from "../components/TopBar";

export type SwarmState = "IDLE" | "FORMING" | "IN_FORMATION" | "MANEUVERING" | "DISBANDING";

export interface SwarmGroup {
  id: string;
  name: string;
  leaderId: string;
  followerIds: string[];
  formation: string;
  spacing: number;
  headingDeg: number;
  altOffset: number;
  state: SwarmState;
  maneuver?: string;
  formationQuality?: number;
}

type CameraMode = "global" | "follow" | "fpv" | "cinematic";

export interface WaypointDefaults {
  alt: number;
  hover: number;
  cameraPitch: number;
  speed: number;
  heading: number;
  cameraViewMode: CameraViewMode;
  fpvPitch: number;
  fpvYaw: number;
  fpvZoom: number;
}

const defaultWaypointDefaults: WaypointDefaults = {
  alt: 50,
  hover: 2,
  cameraPitch: -15,
  speed: 0,
  heading: 0,
  cameraViewMode: "fpv",
  fpvPitch: -10,
  fpvYaw: 0,
  fpvZoom: 1.0,
};

interface GroundControlState {
  apiBaseUrl: string;
  wsBaseUrl: string;
  token: string | null;
  user: UserInfo | null;
  drones: DroneRecord[];
  telemetryByDrone: Record<string, DroneTelemetry>;
  telemetryHistoryByDrone: Record<string, DroneTelemetry[]>;
  visualAltitudeByDrone: Record<string, number>;
  alerts: AlertEvent[];
  geofences: GeofenceRecord[];
  missions: MissionRecord[];
  selectedDroneId: string | null;
  plannerEnabled: boolean;
  plannerWaypoints: MissionWaypoint[];
  cameraMode: CameraMode;
  busy: boolean;

  // Navigation
  activeTab: NavTab;
  autoEngage: boolean;

  // Swarm
  swarmGroups: SwarmGroup[];

  // Geofence drawing
  geofenceDrawing: boolean;
  geofenceDrawPoints: Array<{ lat: number; lon: number }>;

  // Mission planner naming
  plannerMissionName: string;
  setPlannerMissionName: (name: string) => void;

  // Waypoint defaults
  waypointDefaults: WaypointDefaults;
  setWaypointDefaults: (partial: Partial<WaypointDefaults>) => void;
  applyDefaultsToAll: () => void;

  // Actions
  setBusy: (busy: boolean) => void;
  setSession: (token: string, user: UserInfo) => void;
  clearSession: () => void;
  setDrones: (drones: DroneRecord[]) => void;
  setGeofences: (geofences: GeofenceRecord[]) => void;
  setMissions: (missions: MissionRecord[]) => void;
  pushTelemetry: (droneId: string, telemetry: DroneTelemetry) => void;
  pushTelemetryBatch: (batch: Record<string, DroneTelemetry>) => void;
  setVisualAltitude: (droneId: string, altitude: number) => void;
  pushAlert: (alert: AlertEvent) => void;
  setSelectedDrone: (droneId: string | null) => void;
  setPlannerEnabled: (enabled: boolean) => void;
  addPlannerWaypoint: (waypoint: MissionWaypoint) => void;
  setPlannerWaypoints: (waypoints: MissionWaypoint[]) => void;
  removePlannerWaypoint: (index: number) => void;
  clearPlannerWaypoints: () => void;
  updatePlannerWaypoint: (index: number, patch: Partial<MissionWaypoint>) => void;
  setCameraMode: (mode: CameraMode) => void;
  setActiveTab: (tab: NavTab) => void;
  setAutoEngage: (enabled: boolean) => void;
  setSwarmGroups: (groups: SwarmGroup[]) => void;
  addSwarmGroup: (group: SwarmGroup) => void;
  removeSwarmGroup: (groupId: string) => void;
  updateSwarmGroup: (groupId: string, patch: Partial<SwarmGroup>) => void;
  setSwarmGroupStatus: (groupId: string, state: SwarmState, formationQuality?: number, maneuver?: string) => void;
  setGeofenceDrawing: (enabled: boolean) => void;
  addGeofenceDrawPoint: (point: { lat: number; lon: number }) => void;
  clearGeofenceDrawPoints: () => void;
}

const defaultApiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const defaultWsBase = import.meta.env.VITE_WS_BASE_URL ?? defaultApiBase.replace(/^http/, "ws");

const persistedToken = localStorage.getItem("sgcx.token");
const persistedUser = localStorage.getItem("sgcx.user");

export const useGroundControlStore = create<GroundControlState>((set) => ({
  apiBaseUrl: defaultApiBase,
  wsBaseUrl: defaultWsBase,
  token: persistedToken,
  user: persistedUser ? (JSON.parse(persistedUser) as UserInfo) : null,
  drones: [],
  telemetryByDrone: {},
  telemetryHistoryByDrone: {},
  visualAltitudeByDrone: {},
  alerts: [],
  geofences: [],
  missions: [],
  selectedDroneId: null,
  plannerEnabled: false,
  plannerWaypoints: [],
  cameraMode: "global",
  busy: false,
  activeTab: "fleet",
  autoEngage: false,
  swarmGroups: [],
  geofenceDrawing: false,
  geofenceDrawPoints: [],
  plannerMissionName: "",
  waypointDefaults: { ...defaultWaypointDefaults },

  setPlannerMissionName: (plannerMissionName) => set({ plannerMissionName }),

  setWaypointDefaults: (partial) =>
    set((state) => ({
      waypointDefaults: { ...state.waypointDefaults, ...partial }
    })),

  applyDefaultsToAll: () =>
    set((state) => ({
      plannerWaypoints: state.plannerWaypoints.map((wp) => ({
        ...wp,
        alt: state.waypointDefaults.alt,
        hover: state.waypointDefaults.hover,
        cameraPitch: state.waypointDefaults.cameraPitch,
        speed: state.waypointDefaults.speed,
        heading: state.waypointDefaults.heading,
        cameraViewMode: state.waypointDefaults.cameraViewMode,
        fpvPitch: state.waypointDefaults.fpvPitch,
        fpvYaw: state.waypointDefaults.fpvYaw,
        fpvZoom: state.waypointDefaults.fpvZoom,
      }))
    })),

  setBusy: (busy) => set({ busy }),

  setSession: (token, user) => {
    localStorage.setItem("sgcx.token", token);
    localStorage.setItem("sgcx.user", JSON.stringify(user));
    set({ token, user });
  },

  clearSession: () => {
    localStorage.removeItem("sgcx.token");
    localStorage.removeItem("sgcx.user");
    set({
      token: null,
      user: null,
      drones: [],
      telemetryByDrone: {},
      telemetryHistoryByDrone: {},
      visualAltitudeByDrone: {},
      alerts: [],
      missions: [],
      geofences: []
    });
  },

  setDrones: (drones) =>
    set((state) => {
      const activeIds = new Set(drones.filter((drone) => !drone.archivedAt).map((drone) => drone.id));
      return {
        drones,
        selectedDroneId:
          state.selectedDroneId && activeIds.has(state.selectedDroneId)
            ? state.selectedDroneId
            : drones.find((drone) => !drone.archivedAt)?.id ?? null,
        telemetryByDrone: Object.fromEntries(
          Object.entries(state.telemetryByDrone).filter(([droneId]) => activeIds.has(droneId))
        ),
        telemetryHistoryByDrone: Object.fromEntries(
          Object.entries(state.telemetryHistoryByDrone).filter(([droneId]) => activeIds.has(droneId))
        ),
        visualAltitudeByDrone: Object.fromEntries(
          Object.entries(state.visualAltitudeByDrone).filter(([droneId]) => activeIds.has(droneId))
        ),
        alerts: state.alerts.filter((alert) => activeIds.has(alert.droneId))
      };
    }),

  setGeofences: (geofences) => set({ geofences }),

  setMissions: (missions) => set({ missions }),

  pushTelemetry: (droneId, telemetry) =>
    set((state) => {
      const current = state.telemetryByDrone[droneId];
      if (current?.timestamp === telemetry.timestamp) {
        return state;
      }

      return {
        telemetryByDrone: {
          ...state.telemetryByDrone,
          [droneId]: telemetry
        },
        telemetryHistoryByDrone: {
          ...state.telemetryHistoryByDrone,
          [droneId]: [...(state.telemetryHistoryByDrone[droneId] ?? []), telemetry].slice(-3600)
        }
      };
    }),

  pushTelemetryBatch: (batch) =>
    set((state) => {
      const ids = Object.keys(batch);
      if (ids.length === 0) {
        return state;
      }

      let changed = false;
      const next = { ...state.telemetryByDrone };
      for (const droneId of ids) {
        const telemetry = batch[droneId];
        if (!telemetry) {
          continue;
        }
        if (state.telemetryByDrone[droneId]?.timestamp === telemetry.timestamp) {
          continue;
        }
        next[droneId] = telemetry;
        changed = true;
      }

      if (!changed) {
        return state;
      }

      return {
        telemetryByDrone: next,
        telemetryHistoryByDrone: ids.reduce<Record<string, DroneTelemetry[]>>((acc, droneId) => {
          const telemetry = batch[droneId];
          const existing = state.telemetryHistoryByDrone[droneId] ?? [];
          acc[droneId] = telemetry ? [...existing, telemetry].slice(-3600) : existing;
          return acc;
        }, { ...state.telemetryHistoryByDrone })
      };
    }),

  setVisualAltitude: (droneId, altitude) =>
    set((state) => {
      if (!Number.isFinite(altitude) || state.visualAltitudeByDrone[droneId] === altitude) {
        return state;
      }

      return {
        visualAltitudeByDrone: {
          ...state.visualAltitudeByDrone,
          [droneId]: altitude
        }
      };
    }),

  pushAlert: (alert) =>
    set((state) => ({
      alerts: [alert, ...state.alerts].slice(0, 200)
    })),

  setSelectedDrone: (selectedDroneId) => set({ selectedDroneId }),

  setPlannerEnabled: (plannerEnabled) => set({ plannerEnabled }),

  addPlannerWaypoint: (waypoint) =>
    set((state) => ({
      plannerWaypoints: [...state.plannerWaypoints, waypoint]
    })),

  setPlannerWaypoints: (plannerWaypoints) => set({ plannerWaypoints }),

  removePlannerWaypoint: (index) =>
    set((state) => ({
      plannerWaypoints: state.plannerWaypoints.filter((_, waypointIndex) => waypointIndex !== index)
    })),

  clearPlannerWaypoints: () => set({ plannerWaypoints: [], plannerMissionName: "" }),

  updatePlannerWaypoint: (index, patch) =>
    set((state) => ({
      plannerWaypoints: state.plannerWaypoints.map((wp, i) => (i === index ? { ...wp, ...patch } : wp))
    })),

  setCameraMode: (cameraMode) => set({ cameraMode }),

  setActiveTab: (activeTab) => set({ activeTab }),

  setAutoEngage: (autoEngage) => set({ autoEngage }),

  setSwarmGroups: (swarmGroups) => set({ swarmGroups }),

  addSwarmGroup: (group) =>
    set((state) => ({
      swarmGroups: [...state.swarmGroups, group]
    })),

  removeSwarmGroup: (groupId) =>
    set((state) => ({
      swarmGroups: state.swarmGroups.filter((g) => g.id !== groupId)
    })),

  updateSwarmGroup: (groupId, patch) =>
    set((state) => ({
      swarmGroups: state.swarmGroups.map((g) =>
        g.id === groupId ? { ...g, ...patch } : g
      )
    })),

  setSwarmGroupStatus: (groupId, state, formationQuality, maneuver) =>
    set((s) => ({
      swarmGroups: s.swarmGroups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              state,
              formationQuality: formationQuality ?? g.formationQuality,
              maneuver: maneuver !== undefined ? maneuver : g.maneuver
            }
          : g
      )
    })),

  setGeofenceDrawing: (geofenceDrawing) => set({ geofenceDrawing, geofenceDrawPoints: geofenceDrawing ? [] : [] }),

  addGeofenceDrawPoint: (point) =>
    set((state) => ({
      geofenceDrawPoints: [...state.geofenceDrawPoints, point]
    })),

  clearGeofenceDrawPoints: () => set({ geofenceDrawPoints: [], geofenceDrawing: false })
}));
