import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient } from "./api/client";
import { GlobeViewer } from "./cesium/GlobeViewer";
import { MissionPreviewViewer } from "./cesium/MissionPreviewViewer";
import { AccordionSection } from "./components/AccordionSection";
import { CameraFeeds } from "./components/CameraFeeds";
import { CommandPanel } from "./components/CommandPanel";
import { FleetPanel } from "./components/FleetPanel";
import { FlightHud } from "./components/FlightHud";
import { GeofencePanel } from "./components/GeofencePanel";
import { ManualFlightPanel } from "./components/ManualFlightPanel";
import { MissionPlannerPanel } from "./components/MissionPlannerPanel";
import { MissionLibraryPanel } from "./components/MissionLibraryPanel";
import { RecordingOverlay } from "./components/RecordingOverlay";
import { RecordsPanel } from "./components/RecordsPanel";
import { SwarmManagerPanel } from "./components/SwarmManagerPanel";
import type { SwarmGroup } from "./store/useGroundControlStore";
import { TelemetryGauges } from "./components/TelemetryGauges";
import { TopBar } from "./components/TopBar";
import { WaypointOpsPanel } from "./components/WaypointOpsPanel";
import { SwarmGroupOps } from "./components/SwarmGroupOps";
import { WaypointEditorDrawer } from "./components/WaypointEditorDrawer";
import type { HomeBaseRecord, ScenarioPreset } from "./types/domain";
import { useFlightRecorder } from "./hooks/useFlightRecorder";
import { useVideoRecorder } from "./hooks/useVideoRecorder";
import { getLatestSavedMissionForDrone, getPreferredMissionForDrone } from "./lib/missionSelection";
import { useGroundControlStore } from "./store/useGroundControlStore";
import { useTelemetrySocket } from "./websocket/useTelemetrySocket";

type MissionOutcome = {
  type: "success" | "aborted";
  title: string;
  subtitle: string;
};

type RtlBanner = {
  title: string;
  subtitle: string;
  tone: "warning" | "danger";
};

function rtlBannerForMode(droneId: string, mode: string): RtlBanner | null {
  switch (mode) {
    case "rtl-low-signal":
      return {
        title: "AUTO RTL",
        subtitle: `${droneId}: low signal, returning to launch`,
        tone: "warning"
      };
    case "rtl-low-battery":
      return {
        title: "AUTO RTL",
        subtitle: `${droneId}: low battery, returning to launch`,
        tone: "warning"
      };
    case "rtl-mission-energy":
      return {
        title: "AUTO RTL",
        subtitle: `${droneId}: mission reserve insufficient, returning to launch`,
        tone: "danger"
      };
    case "rtl-geofence":
      return {
        title: "AUTO RTL",
        subtitle: `${droneId}: geofence breach, returning to launch`,
        tone: "danger"
      };
    default:
      return null;
  }
}

function rtlBannerForAlert(droneId: string, message: string): RtlBanner | null {
  const lower = message.toLowerCase();
  if (lower.includes("low signal")) {
    return {
      title: "AUTO RTL",
      subtitle: `${droneId}: low signal, returning to launch`,
      tone: "warning"
    };
  }

  if (lower.includes("low battery")) {
    return {
      title: "AUTO RTL",
      subtitle: `${droneId}: low battery, returning to launch`,
      tone: "warning"
    };
  }

  if (lower.includes("geofence breach")) {
    return {
      title: "AUTO RTL",
      subtitle: `${droneId}: geofence breach, returning to launch`,
      tone: "danger"
    };
  }

  if (lower.includes("aborting mission")) {
    return {
      title: "AUTO RTL",
      subtitle: `${droneId}: mission reserve insufficient, returning to launch`,
      tone: "danger"
    };
  }

  return null;
}

export default function App(): JSX.Element {
  const apiBaseUrl = useGroundControlStore((s) => s.apiBaseUrl);
  const wsBaseUrl = useGroundControlStore((s) => s.wsBaseUrl);
  const token = useGroundControlStore((s) => s.token);
  const user = useGroundControlStore((s) => s.user);
  const drones = useGroundControlStore((s) => s.drones);
  const telemetryByDrone = useGroundControlStore((s) => s.telemetryByDrone);
  const telemetryHistoryByDrone = useGroundControlStore((s) => s.telemetryHistoryByDrone);
  const alerts = useGroundControlStore((s) => s.alerts);
  const geofences = useGroundControlStore((s) => s.geofences);
  const missions = useGroundControlStore((s) => s.missions);
  const selectedDroneId = useGroundControlStore((s) => s.selectedDroneId);
  const plannerEnabled = useGroundControlStore((s) => s.plannerEnabled);
  const plannerWaypoints = useGroundControlStore((s) => s.plannerWaypoints);
  const cameraMode = useGroundControlStore((s) => s.cameraMode);
  const busy = useGroundControlStore((s) => s.busy);
  const activeTab = useGroundControlStore((s) => s.activeTab);
  const autoEngage = useGroundControlStore((s) => s.autoEngage);
  const swarmGroups = useGroundControlStore((s) => s.swarmGroups);
  const geofenceDrawing = useGroundControlStore((s) => s.geofenceDrawing);
  const geofenceDrawPoints = useGroundControlStore((s) => s.geofenceDrawPoints);

  const setSession = useGroundControlStore((s) => s.setSession);
  const clearSession = useGroundControlStore((s) => s.clearSession);
  const setDrones = useGroundControlStore((s) => s.setDrones);
  const setGeofences = useGroundControlStore((s) => s.setGeofences);
  const setMissions = useGroundControlStore((s) => s.setMissions);
  const setSelectedDrone = useGroundControlStore((s) => s.setSelectedDrone);
  const setPlannerEnabled = useGroundControlStore((s) => s.setPlannerEnabled);
  const addPlannerWaypoint = useGroundControlStore((s) => s.addPlannerWaypoint);
  const setPlannerWaypoints = useGroundControlStore((s) => s.setPlannerWaypoints);
  const removePlannerWaypoint = useGroundControlStore((s) => s.removePlannerWaypoint);
  const clearPlannerWaypoints = useGroundControlStore((s) => s.clearPlannerWaypoints);
  const updatePlannerWaypoint = useGroundControlStore((s) => s.updatePlannerWaypoint);
  const setCameraMode = useGroundControlStore((s) => s.setCameraMode);
  const setBusy = useGroundControlStore((s) => s.setBusy);
  const setActiveTab = useGroundControlStore((s) => s.setActiveTab);
  const setAutoEngage = useGroundControlStore((s) => s.setAutoEngage);
  const addSwarmGroup = useGroundControlStore((s) => s.addSwarmGroup);
  const removeSwarmGroup = useGroundControlStore((s) => s.removeSwarmGroup);
  const setSwarmGroups = useGroundControlStore((s) => s.setSwarmGroups);
  const updateSwarmGroup = useGroundControlStore((s) => s.updateSwarmGroup);
  const setSwarmGroupStatus = useGroundControlStore((s) => s.setSwarmGroupStatus);
  const setGeofenceDrawingState = useGroundControlStore((s) => s.setGeofenceDrawing);
  const clearGeofenceDrawPoints = useGroundControlStore((s) => s.clearGeofenceDrawPoints);
  const addGeofenceDrawPoint = useGroundControlStore((s) => s.addGeofenceDrawPoint);
  const plannerMissionName = useGroundControlStore((s) => s.plannerMissionName);
  const setPlannerMissionName = useGroundControlStore((s) => s.setPlannerMissionName);
  const waypointDefaults = useGroundControlStore((s) => s.waypointDefaults);
  const setWaypointDefaults = useGroundControlStore((s) => s.setWaypointDefaults);
  const applyDefaultsToAll = useGroundControlStore((s) => s.applyDefaultsToAll);

  const [status, setStatus] = useState<string>("");
  const [loginEmail, setLoginEmail] = useState("admin@sgcx.local");
  const [loginPassword, setLoginPassword] = useState("ChangeMe123!");
  const [trailResetToken, setTrailResetToken] = useState(0);
  const [missionOutcome, setMissionOutcome] = useState<MissionOutcome | null>(null);
  const [rtlBanner, setRtlBanner] = useState<RtlBanner | null>(null);
  const [missionRailOpen, setMissionRailOpen] = useState<"fleet" | "swarmops" | "mission" | "geofences" | null>("mission");
  const [selectedPlannerWaypointIndex, setSelectedPlannerWaypointIndex] = useState<number | null>(null);
  const [swarmPresets, setSwarmPresets] = useState<ScenarioPreset[]>([]);
  const [fpvPitchDeg, setFpvPitchDeg] = useState(0);
  const [editingMissionId, setEditingMissionId] = useState<string | null>(null);
  const [plannerExecuteMissionId, setPlannerExecuteMissionId] = useState<string | null>(null);
  const [selectedMissionLibraryId, setSelectedMissionLibraryId] = useState<string | null>(null);
  const [plannerFocusToken, setPlannerFocusToken] = useState(0);
  const [homeBases, setHomeBases] = useState<HomeBaseRecord[]>([]);
  const [areaDrawingKind, setAreaDrawingKind] = useState<"geofence" | "homeBase" | null>(null);
  const [ghostPreviewOptions, setGhostPreviewOptions] = useState({
    enabled: true,
    showArea: true,
    showTracks: true,
    showMarkers: true
  });

  const flightRecorder = useFlightRecorder();
  const videoRecorder = useVideoRecorder();
  const globeSectionRef = useRef<HTMLElement | null>(null);

  const handleStartVideoRecording = useCallback(
    (name: string, droneId: string | null, camMode: string) => {
      if (!globeSectionRef.current) return;
      videoRecorder.startRecording(globeSectionRef.current, name, droneId, camMode);
    },
    [videoRecorder.startRecording]
  );

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: apiBaseUrl,
        token: token ?? undefined
      }),
    [apiBaseUrl, token]
  );

  const activeDrones = useMemo(() => drones.filter((drone) => !drone.archivedAt), [drones]);

  const latestMissionForSelectedDrone = useMemo(() => {
    return getPreferredMissionForDrone(missions, selectedDroneId);
  }, [missions, selectedDroneId]);
  const latestSavedMissionForSelectedDrone = useMemo(() => {
    return getLatestSavedMissionForDrone(missions, selectedDroneId);
  }, [missions, selectedDroneId]);
  const plannerExecuteMission = useMemo(() => {
    if (!selectedDroneId) {
      return null;
    }

    if (plannerExecuteMissionId) {
      const explicitlySelected = missions.find((mission) => mission.id === plannerExecuteMissionId);
      if (explicitlySelected?.droneId === selectedDroneId) {
        return explicitlySelected;
      }
    }

    return latestSavedMissionForSelectedDrone ?? null;
  }, [latestSavedMissionForSelectedDrone, missions, plannerExecuteMissionId, selectedDroneId]);

  const selectedPlannerWaypoint =
    selectedPlannerWaypointIndex !== null ? plannerWaypoints[selectedPlannerWaypointIndex] : undefined;
  const editingMission = useMemo(
    () => missions.find((mission) => mission.id === editingMissionId) ?? null,
    [editingMissionId, missions]
  );
  const selectedMissionLibrary = useMemo(
    () => missions.find((mission) => mission.id === selectedMissionLibraryId) ?? missions[0] ?? null,
    [missions, selectedMissionLibraryId]
  );
  const eligibleTriggerSwarmGroups = useMemo(
    () => swarmGroups.filter((group) => group.leaderId === selectedDroneId && group.state !== "DISBANDING"),
    [selectedDroneId, swarmGroups]
  );

  const selectedTelemetry = selectedDroneId ? telemetryByDrone[selectedDroneId] : undefined;
  const manualSocketRef = useRef<WebSocket | null>(null);
  const manualReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rtlBannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousSelectedModeRef = useRef("");
  const lastSelectedAlertRef = useRef("");

  useTelemetrySocket();

  useEffect(() => {
    if (missions.length === 0) {
      if (selectedMissionLibraryId !== null) {
        setSelectedMissionLibraryId(null);
      }
      return;
    }

    if (!selectedMissionLibraryId || !missions.some((mission) => mission.id === selectedMissionLibraryId)) {
      setSelectedMissionLibraryId(missions[0].id);
    }
  }, [missions, selectedMissionLibraryId]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const url = new URL(`${wsBaseUrl}/ws`);
    url.searchParams.set("token", token);

    let closedByUser = false;

    const connect = () => {
      const socket = new WebSocket(url.toString());
      manualSocketRef.current = socket;

      socket.onclose = () => {
        if (closedByUser) {
          return;
        }
        manualReconnectRef.current = setTimeout(connect, 1200);
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      closedByUser = true;
      if (manualReconnectRef.current) {
        clearTimeout(manualReconnectRef.current);
        manualReconnectRef.current = null;
      }
      manualSocketRef.current?.close();
      manualSocketRef.current = null;
    };
  }, [token, wsBaseUrl]);

  // Record telemetry for flight recorder
  useEffect(() => {
    if (selectedTelemetry && flightRecorder.recording) {
      flightRecorder.tick(selectedTelemetry);
    }
  }, [selectedTelemetry, flightRecorder]);

  useEffect(() => {
    return () => {
      if (rtlBannerTimeoutRef.current) {
        clearTimeout(rtlBannerTimeoutRef.current);
        rtlBannerTimeoutRef.current = null;
      }
    };
  }, []);

  const showRtlBanner = useCallback((banner: RtlBanner, timeoutMs = 6500) => {
    if (rtlBannerTimeoutRef.current) {
      clearTimeout(rtlBannerTimeoutRef.current);
    }

    setRtlBanner(banner);
    rtlBannerTimeoutRef.current = setTimeout(() => {
      setRtlBanner((current) =>
        current?.title === banner.title && current?.subtitle === banner.subtitle ? null : current
      );
      rtlBannerTimeoutRef.current = null;
    }, timeoutMs);
  }, []);

  useEffect(() => {
    previousSelectedModeRef.current = "";
    lastSelectedAlertRef.current = "";
    setMissionOutcome(null);
    setRtlBanner(null);
    setSelectedPlannerWaypointIndex(null);
    if (rtlBannerTimeoutRef.current) {
      clearTimeout(rtlBannerTimeoutRef.current);
      rtlBannerTimeoutRef.current = null;
    }
  }, [selectedDroneId]);

  useEffect(() => {
    if (selectedPlannerWaypointIndex === null) {
      return;
    }

    if (plannerWaypoints.length === 0) {
      setSelectedPlannerWaypointIndex(null);
      return;
    }

    if (!plannerWaypoints[selectedPlannerWaypointIndex]) {
      setSelectedPlannerWaypointIndex(Math.min(selectedPlannerWaypointIndex, plannerWaypoints.length - 1));
    }
  }, [plannerWaypoints, selectedPlannerWaypointIndex]);

  useEffect(() => {
    if (!token || swarmPresets.length > 0) {
      return;
    }

    api
      .fetchScenarioPresets()
      .then((result) => {
        setSwarmPresets(result.presets as ScenarioPreset[]);
      })
      .catch(() => {
        // Keep UI usable even if preset fetch fails.
      });
  }, [api, swarmPresets.length, token]);

  const resetMissionWorkspace = useCallback(
    (message?: string) => {
      setSelectedPlannerWaypointIndex(null);
      clearPlannerWaypoints();
      setPlannerEnabled(false);
      clearGeofenceDrawPoints();
      setTrailResetToken((value) => value + 1);
      if (message) {
        setStatus(message);
      }
    },
    [clearPlannerWaypoints, setPlannerEnabled, clearGeofenceDrawPoints]
  );

  const showMissionOutcome = useCallback((outcome: MissionOutcome, resetWorkspace = false) => {
    setMissionOutcome(outcome);
    if (resetWorkspace) {
      resetMissionWorkspace();
    }
  }, [resetMissionWorkspace]);

  const acknowledgeMissionOutcome = useCallback(() => {
    setMissionOutcome(null);
    resetMissionWorkspace("Mission workspace reset");
  }, [resetMissionWorkspace]);

  useEffect(() => {
    if (!selectedDroneId || !selectedTelemetry) {
      return;
    }

    const mode = selectedTelemetry.mode ?? "";
    const previousMode = previousSelectedModeRef.current;
    previousSelectedModeRef.current = mode;

    if (mode !== previousMode) {
      const banner = rtlBannerForMode(selectedDroneId, mode);
      if (banner) {
        showRtlBanner(banner);
        setStatus(banner.subtitle);
      }
    }

    if (mode.startsWith("route-complete") && !previousMode.startsWith("route-complete")) {
      setStatus(`${selectedDroneId}: route complete, returning to launch`);
      return;
    }

    if (
      (mode.startsWith("rtl-mission") || mode.startsWith("rtl-low-battery") || mode.startsWith("rtl-low-signal")) &&
      previousMode.startsWith("mission-wp-")
    ) {
      setStatus(`${selectedDroneId}: automatic RTL engaged`);
    }
  }, [selectedDroneId, selectedTelemetry, showMissionOutcome, showRtlBanner]);

  useEffect(() => {
    if (!selectedDroneId || alerts.length === 0) {
      return;
    }

    const latest = alerts.find((alert) => alert.droneId === selectedDroneId);
    if (!latest) {
      return;
    }

    const key = `${latest.timestamp}:${latest.message}`;
    if (lastSelectedAlertRef.current === key) {
      return;
    }
    lastSelectedAlertRef.current = key;

    const message = latest.message.toLowerCase();
    if (message.includes("mission successful")) {
      showMissionOutcome(
        {
          type: "success",
          title: "MISSION SUCCESSFUL",
          subtitle: `${selectedDroneId} completed route and landed at home`
        },
        false
      );
      setStatus(`${selectedDroneId}: mission successful`);
      return;
    }

    if (message.includes("route complete")) {
      setStatus(`${selectedDroneId}: route complete, returning to launch`);
      return;
    }

    if (message.includes("swarm")) {
      setStatus(latest.message);
    }

    const banner = rtlBannerForAlert(selectedDroneId, latest.message);
    if (banner) {
      showRtlBanner(banner);
      setStatus(latest.message);
    }
  }, [alerts, selectedDroneId, showMissionOutcome, showRtlBanner]);

  const refresh = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const [dronesResponse, missionsResponse, geofenceResponse, swarmResponse, homeBaseResponse] = await Promise.all([
        api.fetchDrones(),
        api.fetchMissions(),
        api.fetchGeofences(),
        api.fetchSwarmGroups(),
        api.fetchHomeBases()
      ]);
      setDrones(dronesResponse.drones);
      setMissions(missionsResponse.missions);
      setGeofences(geofenceResponse.geofences);
      setSwarmGroups(swarmResponse.groups as SwarmGroup[]);
      setHomeBases(homeBaseResponse.homeBases);
      const liveCount = dronesResponse.drones.filter((drone) => !drone.archivedAt).length;
      const archivedCount = dronesResponse.drones.length - liveCount;
      setStatus(`Synced ${liveCount} live drones${archivedCount > 0 ? ` | ${archivedCount} archived` : ""}`);
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }, [api, token, setBusy, setDrones, setMissions, setGeofences, setSwarmGroups]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendManualControl = useCallback(
    (input: { forward: number; right: number; up: number; yawRate: number; nowMs: number }) => {
      if (!selectedDroneId) {
        return;
      }

      const socket = manualSocketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "manual-control",
            droneId: selectedDroneId,
            ...input
          })
        );
        return;
      }

      // Fallback path in case WS has not connected yet.
      api.commandDrone(selectedDroneId, "manualControl", input).catch(() => {
        // no-op
      });
    },
    [api, selectedDroneId]
  );

  const handleRegisterDrone = useCallback(
    (input: { id: string; name?: string; homeLat: number; homeLon: number; homeAlt?: number; homeBaseId?: string }) => {
      run(async () => {
        await api.registerDrone({ ...input, adapter: "mock" });
        let assignmentError = "";
        if (input.homeBaseId) {
          try {
            await api.assignDroneToHomeBase(input.homeBaseId, input.id);
          } catch (error) {
            assignmentError = error instanceof Error ? error.message : "home base assignment failed";
          }
        }
        await refresh();
        setSelectedDrone(input.id);
        setStatus(
          input.homeBaseId
            ? assignmentError
              ? `Drone ${input.id} registered, but home base assignment failed: ${assignmentError}`
              : `Drone ${input.id} registered and assigned to a home base`
            : `Drone ${input.id} registered`
        );
      }).catch(() => {});
    },
    [api, refresh, setSelectedDrone]
  );

  const handleUpdateDroneHome = useCallback(
    (droneId: string, input: { homeLat: number; homeLon: number; homeAlt?: number }) => {
      run(async () => {
        await api.updateDroneHome(droneId, input);
        await refresh();
        setStatus(`Home updated for ${droneId}`);
      }).catch(() => {});
    },
    [api, refresh]
  );

  const handleDeleteDrone = useCallback(
    (droneId: string) => {
      if (!window.confirm(`Delete drone ${droneId}? This will remove its missions and telemetry history.`)) {
        return;
      }

      run(async () => {
        await api.deleteDrone(droneId);
        setSwarmGroups(
          swarmGroups.filter(
            (group) => group.leaderId !== droneId && !group.followerIds.includes(droneId)
          )
        );
        if (selectedDroneId === droneId) {
          setSelectedDrone(null);
        }
        await refresh();
        setStatus(`Drone ${droneId} deleted`);
      }).catch(() => {});
    },
    [api, refresh, selectedDroneId, setSelectedDrone, setSwarmGroups, swarmGroups]
  );

  const handleArchiveDrone = useCallback(
    (droneId: string, archived: boolean) => {
      if (
        !window.confirm(
          archived ? `Archive drone ${droneId}? It will be removed from live ops.` : `Restore drone ${droneId} to live ops?`
        )
      ) {
        return;
      }

      run(async () => {
        await api.setDroneArchived(droneId, archived);
        if (archived) {
          setSwarmGroups(
            swarmGroups.filter(
              (group) => group.leaderId !== droneId && !group.followerIds.includes(droneId)
            )
          );
          if (selectedDroneId === droneId) {
            setSelectedDrone(null);
          }
        }
        await refresh();
        setStatus(`Drone ${droneId} ${archived ? "archived" : "restored"}`);
      }).catch(() => {});
    },
    [api, refresh, selectedDroneId, setSelectedDrone, setSwarmGroups, swarmGroups]
  );

  const handleCreateGeofence = useCallback(
    (name: string, polygon: Array<{ lat: number; lon: number }>) => {
      run(async () => {
        await api.createGeofence({ name, polygon, isActive: true });
        clearGeofenceDrawPoints();
        setAreaDrawingKind(null);
        await refresh();
        setStatus(`Geofence "${name}" created`);
      }).catch(() => {});
    },
    [api, clearGeofenceDrawPoints, refresh]
  );

  const handleCreateHomeBase = useCallback(
    (name: string, polygon: Array<{ lat: number; lon: number }>, swarmGroupId?: string, homeAlt = 0) => {
      run(async () => {
        const result = await api.createHomeBase({ name, polygon, swarmGroupId, homeAlt });
        clearGeofenceDrawPoints();
        setAreaDrawingKind(null);
        await refresh();
        const assignedCount = result.assignedDroneIds.length;
        setStatus(
          assignedCount > 0
            ? `Home base "${name}" created and assigned ${assignedCount} drone${assignedCount === 1 ? "" : "s"}`
            : `Home base "${name}" created`
        );
      }).catch(() => {});
    },
    [api, clearGeofenceDrawPoints, refresh]
  );

  const handleUpdateHomeBase = useCallback(
    (
      homeBaseId: string,
      patch: Partial<{
        name: string;
        polygon: Array<{ lat: number; lon: number }>;
        swarmGroupId: string | null;
        homeAlt: number;
        slots: import("./types/domain").HomeBaseSlot[] | null;
      }>
    ) => {
      run(async () => {
        const result = await api.updateHomeBase(homeBaseId, patch);
        await refresh();
        const assignedCount = result.assignedDroneIds.length;
        setStatus(
          assignedCount > 0
            ? `Home base updated and assigned ${assignedCount} drone${assignedCount === 1 ? "" : "s"}`
            : "Home base updated"
        );
      }).catch(() => {});
    },
    [api, refresh]
  );

  const handleDeleteHomeBase = useCallback(
    (homeBaseId: string) => {
      const base = homeBases.find((item) => item.id === homeBaseId);
      if (!base) {
        return;
      }
      if (!window.confirm(`Delete home base "${base.name}"?`)) {
        return;
      }
      run(async () => {
        await api.deleteHomeBase(homeBaseId);
        await refresh();
        setStatus(`Home base "${base.name}" deleted`);
      }).catch(() => {});
    },
    [api, homeBases, refresh]
  );

  const handleToggleAreaDrawing = useCallback(
    (kind: "geofence" | "homeBase" | null) => {
      setAreaDrawingKind(kind);
      setGeofenceDrawingState(kind !== null);
      if (kind === null) {
        clearGeofenceDrawPoints();
      }
    },
    [clearGeofenceDrawPoints, setGeofenceDrawingState]
  );

  const handleImportMission = useCallback(
    (waypoints: import("./types/domain").MissionWaypoint[], name: string) => {
      setEditingMissionId(null);
      setPlannerWaypoints(waypoints);
      setPlannerMissionName(name);
      setPlannerEnabled(true);
      setSelectedPlannerWaypointIndex(waypoints.length > 0 ? 0 : null);
      setMissionRailOpen("mission");
      setPlannerFocusToken((value) => value + 1);
      setStatus(`Imported ${waypoints.length} waypoints from "${name}"`);
    },
    [setPlannerMissionName, setPlannerWaypoints, setPlannerEnabled]
  );

  const handleAddPlannerWaypoint = useCallback(
    (waypoint: import("./types/domain").MissionWaypoint) => {
      addPlannerWaypoint({
        ...waypoint,
        alt: waypointDefaults.alt,
        hover: waypointDefaults.hover,
        cameraPitch: waypointDefaults.cameraPitch,
        speed: waypointDefaults.speed,
        heading: waypointDefaults.heading,
        cameraViewMode: waypointDefaults.cameraViewMode,
        fpvPitch: waypointDefaults.fpvPitch,
        fpvYaw: waypointDefaults.fpvYaw,
        fpvZoom: waypointDefaults.fpvZoom,
      });
    },
    [addPlannerWaypoint, waypointDefaults]
  );

  const handleSelectPlannerWaypoint = useCallback((index: number | null) => {
    setSelectedPlannerWaypointIndex(index);
    if (index !== null) {
      setMissionRailOpen("mission");
    }
  }, []);

  const handleClearPlanner = useCallback(() => {
    setEditingMissionId(null);
    setPlannerMissionName("");
    setSelectedPlannerWaypointIndex(null);
    clearPlannerWaypoints();
  }, [clearPlannerWaypoints, setPlannerMissionName]);

  const handleRemovePlannerWaypoint = useCallback(() => {
    if (selectedPlannerWaypointIndex === null) {
      return;
    }

    const removedIndex = selectedPlannerWaypointIndex;
    removePlannerWaypoint(removedIndex);
    if (plannerWaypoints.length <= 1) {
      setSelectedPlannerWaypointIndex(null);
      return;
    }

    setSelectedPlannerWaypointIndex(Math.max(0, removedIndex - 1));
  }, [plannerWaypoints.length, removePlannerWaypoint, selectedPlannerWaypointIndex]);

  const handleMissionUpload = useCallback(() => {
    if (!selectedDroneId || plannerWaypoints.length === 0) {
      setStatus("Select a drone and add waypoints");
      return;
    }
    run(async () => {
      setMissionOutcome(null);
      const missionName = plannerMissionName || `Mission-${new Date().toISOString()}`;
      const waypointCount = plannerWaypoints.length;
      let savedMissionId = "";
      if (editingMissionId) {
        const result = await api.updateMission(editingMissionId, {
          droneId: selectedDroneId,
          name: missionName,
          waypoints: plannerWaypoints
        });
        savedMissionId = result.mission.id;
      } else {
        const result = await api.createMission({
          droneId: selectedDroneId,
          name: missionName,
          waypoints: plannerWaypoints
        });
        savedMissionId = result.mission.id;
      }
      setPlannerExecuteMissionId(savedMissionId);
      setEditingMissionId(null);
      setPlannerMissionName("");
      setSelectedPlannerWaypointIndex(null);
      clearPlannerWaypoints();
      setPlannerEnabled(false);
      await refresh();
      setStatus(`${editingMissionId ? "Mission updated" : "Mission uploaded"}: ${missionName} (${waypointCount} waypoints)`);
    }).catch(() => {});
  }, [api, clearPlannerWaypoints, editingMissionId, plannerMissionName, plannerWaypoints, refresh, selectedDroneId, setPlannerEnabled, setPlannerMissionName]);

  const handleMissionExecute = useCallback(() => {
    if (!selectedDroneId || !plannerExecuteMission) {
      setStatus("No uploaded mission found for selected drone");
      return;
    }
    run(async () => {
      setMissionOutcome(null);
      await api.executeMission(plannerExecuteMission.id);
      await refresh();
      setStatus(`Mission execution started: ${plannerExecuteMission.name}`);
    }).catch(() => {});
  }, [api, plannerExecuteMission, refresh, selectedDroneId]);

  const handleLoadMissionIntoPlanner = useCallback((missionId: string) => {
    const mission = missions.find((candidate) => candidate.id === missionId);
    if (!mission) {
      setStatus("Mission not found");
      return;
    }

    setEditingMissionId(mission.id);
    setSelectedDrone(mission.droneId);
    setPlannerMissionName(mission.name);
    setPlannerWaypoints(mission.waypoints);
    setSelectedPlannerWaypointIndex(mission.waypoints.length > 0 ? 0 : null);
    setPlannerEnabled(false);
    setMissionOutcome(null);
    setMissionRailOpen("mission");
    setActiveTab("mission");
    setPlannerExecuteMissionId(mission.id);
    setPlannerFocusToken((value) => value + 1);
    setStatus(`Loaded mission "${mission.name}" into planner`);
  }, [missions, setActiveTab, setPlannerEnabled, setPlannerMissionName, setPlannerWaypoints, setSelectedDrone]);

  const handleDeleteMission = useCallback((missionId: string) => {
    const mission = missions.find((candidate) => candidate.id === missionId);
    if (!mission) {
      return;
    }
    if (!window.confirm(`Delete mission "${mission.name}"?`)) {
      return;
    }

    run(async () => {
      await api.deleteMission(missionId);
      if (selectedMissionLibraryId === missionId) {
        setSelectedMissionLibraryId(null);
      }
      if (plannerExecuteMissionId === missionId) {
        setPlannerExecuteMissionId(null);
      }
      if (editingMissionId === missionId) {
        setEditingMissionId(null);
        setPlannerMissionName("");
      }
      await refresh();
      setStatus(`Mission "${mission.name}" deleted`);
    }).catch(() => {});
  }, [api, editingMissionId, missions, plannerExecuteMissionId, refresh, selectedMissionLibraryId, setPlannerMissionName]);

  const handleExecuteMissionById = useCallback((missionId: string) => {
    const mission = missions.find((candidate) => candidate.id === missionId);
    if (!mission) {
      return;
    }

    run(async () => {
      setMissionOutcome(null);
      await api.executeMission(missionId);
      setPlannerExecuteMissionId(missionId);
      await refresh();
      setStatus(`Mission execution started: ${mission.name}`);
    }).catch(() => {});
  }, [api, missions, refresh]);

  const handleCreateMissionDraft = useCallback(() => {
    setEditingMissionId(null);
    setPlannerMissionName("");
    setPlannerWaypoints([]);
    setSelectedPlannerWaypointIndex(null);
    setPlannerEnabled(true);
    setMissionOutcome(null);
    setMissionRailOpen("mission");
    setActiveTab("mission");
  }, [setActiveTab, setPlannerEnabled, setPlannerMissionName, setPlannerWaypoints]);

  // ----- Login screen -----
  if (!token || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-grid px-4">
        <div className="panel w-full max-w-md p-6">
          <h1 className="font-display text-2xl tracking-[0.16em] text-white">SPAXELS GROUND CONTROL X</h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-cyan-100/50">SGC-X Authenticated Control Channel</p>

          <form
            className="mt-5 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                const response = await api.login(loginEmail, loginPassword);
                setSession(response.token, response.user);
                setStatus("Authentication successful");
              }).catch(() => {});
            }}
          >
            <input
              className="input"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              placeholder="Email"
            />
            <input
              className="input"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="Password"
              type="password"
            />
            <button className="btn-primary w-full" type="submit" disabled={busy}>
              {busy ? "Authorizing..." : "Enter Control Core"}
            </button>
          </form>

          <div className="mt-3 text-[10px] text-cyan-100/40">Default admin credentials are loaded from API environment.</div>
          {status ? <div className="mt-2 text-xs text-accent-amber">{status}</div> : null}
        </div>
      </div>
    );
  }

  // ----- Main application -----
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-grid">
      <TopBar
        user={user}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        cameraMode={cameraMode}
        onCameraMode={setCameraMode}
        onLogout={clearSession}
        autoEngage={autoEngage}
        onAutoEngageToggle={setAutoEngage}
        onKillSwitch={
          user.role === "ADMIN"
            ? () => {
                run(async () => {
                  await api.setKillSwitch(true);
                  setStatus("Kill switch engaged");
                }).catch(() => {});
              }
            : undefined
        }
      />

      {activeTab === "swarm" ? (
        <div className="min-h-0 flex-1">
          <SwarmManagerPanel
            drones={activeDrones}
            telemetryByDrone={telemetryByDrone}
            swarmGroups={swarmGroups}
            onCreateGroup={async (input) => {
              setBusy(true);
              try {
                const result = await api.createSwarmGroup(input);
                const created = result.group as SwarmGroup;
                addSwarmGroup(created);
                setStatus(`Swarm group "${input.name}" created`);
                return created;
              } catch (error) {
                setStatus((error as Error).message);
                throw error;
              } finally {
                setBusy(false);
              }
            }}
            onDeleteGroup={(groupId) => {
              run(async () => {
                await api.disbandSwarmGroup(groupId);
                removeSwarmGroup(groupId);
                setStatus("Swarm group disbanded");
              }).catch(() => {});
            }}
            onDisengageGroup={(groupId) => {
              run(async () => {
                await api.disengageSwarmGroup(groupId);
                updateSwarmGroup(groupId, { state: "IDLE", maneuver: undefined });
                setStatus("Swarm group disengaged");
              }).catch(() => {});
            }}
            onEngageGroup={(groupId) => {
              const group = swarmGroups.find((g) => g.id === groupId);
              if (!group) return;
              setSelectedDrone(group.leaderId);
              run(async () => {
                const leaderTel = telemetryByDrone[group.leaderId];
                const result = await api.engageSwarmGroup(groupId, leaderTel?.position);
                updateSwarmGroup(groupId, { state: "FORMING" });
                const launchedCount = result.launchedDroneIds?.length ?? 0;
                setStatus(
                  launchedCount > 0
                    ? `Swarm "${group.name}" launching ${launchedCount} grounded drone${launchedCount === 1 ? "" : "s"} and forming up`
                    : `Swarm "${group.name}" engaged — followers tracking leader in ${group.formation} formation`
                );
              }).catch(() => {});
            }}
            onUpdateGroup={(groupId, patch) => {
              run(async () => {
                await api.updateSwarmGroup(groupId, patch);
                updateSwarmGroup(groupId, patch);
              }).catch(() => {});
            }}
            onStartManeuver={(groupId, type, params) => {
              run(async () => {
                await api.startManeuver(groupId, type, params);
                updateSwarmGroup(groupId, { state: "MANEUVERING", maneuver: type });
                setStatus(`Maneuver ${type} started`);
              }).catch(() => {});
            }}
            onStopManeuver={(groupId) => {
              run(async () => {
                await api.stopManeuver(groupId);
                setStatus("Maneuver stop requested");
              }).catch(() => {});
            }}
            onFetchPresets={async () => {
              const result = await api.fetchScenarioPresets();
              setSwarmPresets(result.presets as ScenarioPreset[]);
              return result.presets as never;
            }}
            onUpdatePreset={async (presetId, patch) => {
              const result = await api.updateScenarioPresetDefaults(presetId, patch);
              const updated = result.preset as ScenarioPreset;
              setSwarmPresets((current) =>
                current.some((preset) => preset.id === updated.id)
                  ? current.map((preset) => (preset.id === updated.id ? updated : preset))
                  : [...current, updated]
              );
              return updated;
            }}
            onResetPreset={async (presetId) => {
              const result = await api.resetScenarioPresetDefaults(presetId);
              const resetPreset = result.preset as ScenarioPreset;
              setSwarmPresets((current) =>
                current.some((preset) => preset.id === resetPreset.id)
                  ? current.map((preset) => (preset.id === resetPreset.id ? resetPreset : preset))
                  : [...current, resetPreset]
              );
              return resetPreset;
            }}
          />
        </div>
      ) : activeTab === "records" ? (
        <div className="min-h-0 flex-1">
          <RecordsPanel
            sessions={videoRecorder.sessions}
            onDeleteSession={videoRecorder.deleteSession}
            onClearAll={videoRecorder.clearAllSessions}
          />
        </div>
      ) : activeTab === "missions" ? (
        <>
          <main className="grid min-h-0 flex-1 gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_700px]">
            <section className="panel relative min-h-0 overflow-hidden">
              <MissionPreviewViewer mission={selectedMissionLibrary} />
            </section>

            <MissionLibraryPanel
              missions={missions}
              drones={drones}
              swarmGroups={swarmGroups}
              selectedMissionId={selectedMissionLibrary?.id ?? null}
              onSelectMission={setSelectedMissionLibraryId}
              onCreateNew={handleCreateMissionDraft}
              onEditMission={handleLoadMissionIntoPlanner}
              onExecuteMission={handleExecuteMissionById}
              onDeleteMission={handleDeleteMission}
            />
          </main>

          <div className="px-2 pb-2">
            <div className="panel flex items-center px-3 py-1.5 text-[11px] text-cyan-100/60">
              {status || `Mission library | ${missions.length} saved missions`}
            </div>
          </div>
        </>
      ) : activeTab === "mission" ? (
        <>
          <main className="grid min-h-0 flex-1 gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_420px]">
            <section ref={globeSectionRef} className="panel relative min-h-0 overflow-hidden">
              <GlobeViewer
                drones={activeDrones}
                telemetryByDrone={telemetryByDrone}
                telemetryHistoryByDrone={telemetryHistoryByDrone}
                geofences={geofences}
                homeBases={homeBases}
                missions={missions}
                selectedDroneId={selectedDroneId}
                plannerEnabled={plannerEnabled}
                plannerWaypoints={plannerWaypoints}
                selectedPlannerWaypointIndex={selectedPlannerWaypointIndex}
                cameraMode={cameraMode}
                fpvPitchDeg={fpvPitchDeg}
                trailResetToken={trailResetToken}
                focusPathKey={editingMissionId ? `${editingMissionId}:${plannerFocusToken}` : null}
                areaDrawingMode={areaDrawingKind}
                areaDrawPoints={geofenceDrawPoints}
                onAddAreaDrawPoint={addGeofenceDrawPoint}
                onAddWaypoint={handleAddPlannerWaypoint}
                onUpdateWaypoint={updatePlannerWaypoint}
                onSelectPlannerWaypoint={handleSelectPlannerWaypoint}
                swarmGroups={swarmGroups}
                swarmPresets={swarmPresets}
                ghostPreviewOptions={ghostPreviewOptions}
                onSelectDrone={setSelectedDrone}
              />
	              <RecordingOverlay
	                recording={videoRecorder.recording}
	                activeRecordings={videoRecorder.activeRecordings}
	                cameraMode={cameraMode}
	                selectedDroneId={selectedDroneId}
	                onStartRecording={handleStartVideoRecording}
	                onStopRecording={videoRecorder.stopRecording}
	                onStopAll={videoRecorder.stopAllRecordings}
	              />
	              <FlightHud
	                drones={activeDrones}
	                telemetryByDrone={telemetryByDrone}
	                telemetryHistoryByDrone={telemetryHistoryByDrone}
	                missions={missions}
	                swarmGroups={swarmGroups}
	                selectedDroneId={selectedDroneId}
	                cameraMode={cameraMode}
	              />
                {selectedPlannerWaypoint && selectedPlannerWaypointIndex !== null ? (
                  <WaypointEditorDrawer
                    waypoint={selectedPlannerWaypoint}
                    waypointIndex={selectedPlannerWaypointIndex}
                    waypointCount={plannerWaypoints.length}
                    eligibleSwarmGroups={eligibleTriggerSwarmGroups}
                    swarmPresets={swarmPresets}
                    onUpdate={(patch) => updatePlannerWaypoint(selectedPlannerWaypointIndex, patch)}
                    onClose={() => setSelectedPlannerWaypointIndex(null)}
                    onDelete={handleRemovePlannerWaypoint}
                    onSelectIndex={setSelectedPlannerWaypointIndex}
                  />
                ) : null}
	              {rtlBanner ? (
	                <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
	                  <div
	                    className={
	                      rtlBanner.tone === "danger"
	                        ? "rounded border border-accent-red/70 bg-black/85 px-5 py-2.5 text-center shadow-[0_0_24px_rgba(255,72,99,0.28)]"
	                        : "rounded border border-amber-300/60 bg-black/85 px-5 py-2.5 text-center shadow-[0_0_24px_rgba(245,188,66,0.25)]"
	                    }
	                  >
	                    <div
	                      className={
	                        rtlBanner.tone === "danger"
	                          ? "font-display text-[18px] tracking-[0.16em] text-accent-red"
	                          : "font-display text-[18px] tracking-[0.16em] text-amber-300"
	                      }
	                    >
	                      {rtlBanner.title}
	                    </div>
	                    <div className="mt-1 text-[11px] tracking-[0.12em] text-cyan-100/75">{rtlBanner.subtitle}</div>
	                  </div>
	                </div>
	              ) : null}
	              {missionOutcome ? (
	                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/20">
                  <div
                    className={
                      missionOutcome.type === "success"
                        ? "rounded border border-accent-green/60 bg-black/80 px-8 py-6 text-center shadow-[0_0_36px_rgba(90,245,140,0.35)]"
                        : "rounded border border-accent-red/60 bg-black/80 px-8 py-6 text-center shadow-[0_0_36px_rgba(255,72,99,0.35)]"
                    }
                  >
                    <div
                      className={
                        missionOutcome.type === "success"
                          ? "font-display text-3xl tracking-[0.18em] text-accent-green"
                          : "font-display text-3xl tracking-[0.18em] text-accent-red"
                      }
                    >
                      {missionOutcome.title}
                    </div>
                    <div className="mt-2 text-[12px] tracking-[0.12em] text-cyan-100/75">{missionOutcome.subtitle}</div>
                  </div>
                </div>
              ) : null}
            </section>

            <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
              <AccordionSection
                title="Fleet Control"
                subtitle={`${activeDrones.length} live drones`}
                open={missionRailOpen === "fleet"}
                onToggle={() => setMissionRailOpen((current) => (current === "fleet" ? null : "fleet"))}
              >
                <FleetPanel
                  embedded
                  drones={drones}
                  homeBases={homeBases}
                  telemetryByDrone={telemetryByDrone}
                  swarmGroups={swarmGroups}
                  selectedDroneId={selectedDroneId}
                  onSelectDrone={setSelectedDrone}
                  onRegisterDrone={handleRegisterDrone}
                  onUpdateDroneHome={handleUpdateDroneHome}
                  onArchiveDrone={handleArchiveDrone}
                  onDeleteDrone={handleDeleteDrone}
                />
              </AccordionSection>

              <AccordionSection
                title="Swarm Group Ops"
                subtitle={`${swarmGroups.filter((g) => g.state !== "DISBANDING").length} groups`}
                open={missionRailOpen === "swarmops"}
                onToggle={() => setMissionRailOpen((current) => (current === "swarmops" ? null : "swarmops"))}
              >
                <div className="min-h-0 overflow-auto p-2">
                  <SwarmGroupOps
                    swarmGroups={swarmGroups}
                    selectedDroneId={selectedDroneId}
                    selectedWaypoint={selectedPlannerWaypoint}
                    selectedWaypointIndex={selectedPlannerWaypointIndex}
                    eligibleMissionGroups={eligibleTriggerSwarmGroups}
                    swarmPresets={swarmPresets}
                    onUpdateSelectedWaypoint={
                      selectedPlannerWaypointIndex !== null
                        ? (patch) => updatePlannerWaypoint(selectedPlannerWaypointIndex, patch)
                        : undefined
                    }
                    onGroupCommand={(groupId, command, params) => {
                      const group = swarmGroups.find((g) => g.id === groupId);
                      if (!group) return;
                      const allDroneIds = [group.leaderId, ...group.followerIds];
                      run(async () => {
                        await Promise.all(
                          allDroneIds.map((droneId) =>
                            api.commandDrone(
                              droneId,
                              command,
                              params ?? (command === "takeoff" ? { altitude: 60 } : undefined)
                            )
                          )
                        );
                        setStatus(`Group command ${command} sent to ${group.name} (${allDroneIds.length} drones)`);
                      }).catch(() => {});
                    }}
                    onEngage={(groupId) => {
                      const group = swarmGroups.find((g) => g.id === groupId);
                      if (!group) return;
                      setSelectedDrone(group.leaderId);
                      run(async () => {
                        const leaderTel = telemetryByDrone[group.leaderId];
                        const result = await api.engageSwarmGroup(groupId, leaderTel?.position);
                        updateSwarmGroup(groupId, { state: "FORMING" });
                        const launchedCount = result.launchedDroneIds?.length ?? 0;
                        setStatus(
                          launchedCount > 0
                            ? `Swarm "${group.name}" launching ${launchedCount} grounded drone${launchedCount === 1 ? "" : "s"} and forming up`
                            : `Swarm "${group.name}" engaged — followers tracking leader in ${group.formation} formation`
                        );
                      }).catch(() => {});
                    }}
                    onDisengage={(groupId) => {
                      run(async () => {
                        await api.disengageSwarmGroup(groupId);
                        updateSwarmGroup(groupId, { state: "IDLE", maneuver: undefined });
                        setStatus("Swarm group disengaged");
                      }).catch(() => {});
                    }}
                  />
                </div>
              </AccordionSection>

              <AccordionSection
                title="Mission Planner"
                subtitle={`${plannerWaypoints.length} waypoint${plannerWaypoints.length === 1 ? "" : "s"}`}
                open={missionRailOpen === "mission"}
                onToggle={() => setMissionRailOpen((current) => (current === "mission" ? null : "mission"))}
              >
                <MissionPlannerPanel
                  embedded
                  plannerEnabled={plannerEnabled}
                  waypoints={plannerWaypoints}
                  selectedDroneId={selectedDroneId}
                  selectedTelemetry={selectedTelemetry}
                  latestMission={latestMissionForSelectedDrone ?? null}
                  swarmGroups={swarmGroups}
                  swarmPresets={swarmPresets}
                  ghostPreviewOptions={ghostPreviewOptions}
                  selectedMissionName={plannerExecuteMission?.name}
                  editingMissionName={editingMission?.name ?? null}
                  selectedWaypointIndex={selectedPlannerWaypointIndex}
                  canExecuteMission={Boolean(selectedDroneId && plannerExecuteMission)}
                  missionOutcome={missionOutcome}
                  missionName={plannerMissionName}
                  onMissionNameChange={setPlannerMissionName}
                  waypointDefaults={waypointDefaults}
                  onWaypointDefaultsChange={setWaypointDefaults}
                  onApplyDefaultsToAll={applyDefaultsToAll}
                  onTogglePlanner={setPlannerEnabled}
                  onImportFile={handleImportMission}
                  onClear={handleClearPlanner}
                  onCompleteMission={acknowledgeMissionOutcome}
                  onUpload={handleMissionUpload}
                  onExecuteMission={handleMissionExecute}
                  onGhostPreviewOptionsChange={(patch) =>
                    setGhostPreviewOptions((current) => ({ ...current, ...patch }))
                  }
                />
              </AccordionSection>

              <AccordionSection
                title="Geofences"
                subtitle={`${geofences.length} defined`}
                open={missionRailOpen === "geofences"}
                onToggle={() => setMissionRailOpen((current) => (current === "geofences" ? null : "geofences"))}
              >
                <GeofencePanel
                  embedded
                  geofences={geofences}
                  homeBases={homeBases}
                  drones={drones}
                  swarmGroups={swarmGroups}
                  onCreateGeofence={handleCreateGeofence}
                  onCreateHomeBase={handleCreateHomeBase}
                  onToggleGeofence={(id, isActive) => {
                    run(async () => {
                      await api.updateGeofence(id, { isActive });
                      await refresh();
                      setStatus(`Geofence ${id} ${isActive ? "activated" : "deactivated"}`);
                    }).catch(() => {});
                  }}
                  onDeleteGeofence={(id) => {
                    run(async () => {
                      await api.deleteGeofence(id);
                      await refresh();
                      setStatus(`Geofence ${id} deleted`);
                    }).catch(() => {});
                  }}
                  onUpdateHomeBase={handleUpdateHomeBase}
                  onDeleteHomeBase={handleDeleteHomeBase}
                  drawingMode={geofenceDrawing}
                  drawingKind={areaDrawingKind}
                  onToggleDrawing={handleToggleAreaDrawing}
                  drawPoints={geofenceDrawPoints}
                />
              </AccordionSection>
            </div>
          </main>

          <div className="px-2 pb-2">
	            <div className="panel flex items-center px-3 py-1.5 text-[11px] text-cyan-100/60">
	              {status || `Planner ready | Fleet ${activeDrones.length} live | Missions ${missions.length}`}
	            </div>
          </div>

        </>
      ) : (
        <>
          <main className="grid min-h-0 flex-1 gap-2 p-2 lg:grid-cols-[280px_minmax(0,1fr)_260px] lg:grid-rows-[minmax(0,1fr)_300px]">
            {/* Left column: Fleet */}
	            <FleetPanel
		              drones={drones}
                  homeBases={homeBases}
		              telemetryByDrone={telemetryByDrone}
                  swarmGroups={swarmGroups}
		              selectedDroneId={selectedDroneId}
		              onSelectDrone={setSelectedDrone}
		              onRegisterDrone={handleRegisterDrone}
		              onUpdateDroneHome={handleUpdateDroneHome}
                  onArchiveDrone={handleArchiveDrone}
                onDeleteDrone={handleDeleteDrone}
	            />

            {/* Center: Globe */}
            <section ref={globeSectionRef} className="panel relative min-h-0 overflow-hidden">
              <GlobeViewer
                drones={activeDrones}
                telemetryByDrone={telemetryByDrone}
                telemetryHistoryByDrone={telemetryHistoryByDrone}
                geofences={geofences}
                homeBases={homeBases}
                missions={missions}
                selectedDroneId={selectedDroneId}
                plannerEnabled={plannerEnabled}
                plannerWaypoints={plannerWaypoints}
                selectedPlannerWaypointIndex={selectedPlannerWaypointIndex}
                cameraMode={cameraMode}
                fpvPitchDeg={fpvPitchDeg}
                trailResetToken={trailResetToken}
                areaDrawingMode={areaDrawingKind}
                areaDrawPoints={geofenceDrawPoints}
                onAddAreaDrawPoint={addGeofenceDrawPoint}
                onAddWaypoint={handleAddPlannerWaypoint}
                onUpdateWaypoint={updatePlannerWaypoint}
                onSelectPlannerWaypoint={handleSelectPlannerWaypoint}
                swarmGroups={swarmGroups}
                swarmPresets={swarmPresets}
                ghostPreviewOptions={ghostPreviewOptions}
                onSelectDrone={setSelectedDrone}
              />
	              <RecordingOverlay
	                recording={videoRecorder.recording}
	                activeRecordings={videoRecorder.activeRecordings}
	                cameraMode={cameraMode}
	                selectedDroneId={selectedDroneId}
	                onStartRecording={handleStartVideoRecording}
	                onStopRecording={videoRecorder.stopRecording}
	                onStopAll={videoRecorder.stopAllRecordings}
	              />
	              <FlightHud
	                drones={activeDrones}
	                telemetryByDrone={telemetryByDrone}
	                telemetryHistoryByDrone={telemetryHistoryByDrone}
	                missions={missions}
	                swarmGroups={swarmGroups}
	                selectedDroneId={selectedDroneId}
	                cameraMode={cameraMode}
	              />
	              {rtlBanner ? (
	                <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
	                  <div
	                    className={
	                      rtlBanner.tone === "danger"
	                        ? "rounded border border-accent-red/70 bg-black/85 px-5 py-2.5 text-center shadow-[0_0_24px_rgba(255,72,99,0.28)]"
	                        : "rounded border border-amber-300/60 bg-black/85 px-5 py-2.5 text-center shadow-[0_0_24px_rgba(245,188,66,0.25)]"
	                    }
	                  >
	                    <div
	                      className={
	                        rtlBanner.tone === "danger"
	                          ? "font-display text-[18px] tracking-[0.16em] text-accent-red"
	                          : "font-display text-[18px] tracking-[0.16em] text-amber-300"
	                      }
	                    >
	                      {rtlBanner.title}
	                    </div>
	                    <div className="mt-1 text-[11px] tracking-[0.12em] text-cyan-100/75">{rtlBanner.subtitle}</div>
	                  </div>
	                </div>
	              ) : null}
	              {missionOutcome ? (
	                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/20">
                  <div
                    className={
                      missionOutcome.type === "success"
                        ? "rounded border border-accent-green/60 bg-black/80 px-8 py-6 text-center shadow-[0_0_36px_rgba(90,245,140,0.35)]"
                        : "rounded border border-accent-red/60 bg-black/80 px-8 py-6 text-center shadow-[0_0_36px_rgba(255,72,99,0.35)]"
                    }
                  >
                    <div
                      className={
                        missionOutcome.type === "success"
                          ? "font-display text-3xl tracking-[0.18em] text-accent-green"
                          : "font-display text-3xl tracking-[0.18em] text-accent-red"
                      }
                    >
                      {missionOutcome.title}
                    </div>
                    <div className="mt-2 text-[12px] tracking-[0.12em] text-cyan-100/75">{missionOutcome.subtitle}</div>
                  </div>
                </div>
              ) : null}
            </section>

            {/* Right column: Gauges + Camera feeds */}
            <div className="flex min-h-0 flex-col gap-2">
              <TelemetryGauges
                selectedDroneId={selectedDroneId}
                telemetryByDrone={telemetryByDrone}
              />
              <CameraFeeds
                drones={activeDrones}
                telemetryByDrone={telemetryByDrone}
                selectedDroneId={selectedDroneId}
              />
            </div>

            {/* Bottom left: Command + Manual Flight */}
            <div className="min-h-0 space-y-2 overflow-auto">
              <CommandPanel
                selectedDroneId={selectedDroneId}
                telemetry={selectedTelemetry}
                cameraMode={cameraMode}
                fpvPitchDeg={fpvPitchDeg}
                onFpvPitchChange={setFpvPitchDeg}
                onCommand={(type, params) => {
                  if (!selectedDroneId) return;
                  const missionWasRunning = Boolean(selectedTelemetry?.mode?.startsWith("mission-wp-"));
                  run(async () => {
                    await api.commandDrone(
                      selectedDroneId,
                      type,
                      params ?? (type === "takeoff" ? { altitude: 60 } : undefined)
                    );
                    if (type === "rtl" && missionWasRunning) {
                      showMissionOutcome(
                        {
                          type: "aborted",
                          title: "MISSION ABORTED",
                          subtitle: `${selectedDroneId} returning to launch`
                        },
                        true
                      );
                    }
                    setStatus(`Command ${type} sent to ${selectedDroneId}`);
                  }).catch(() => {});
                }}
              />
              {activeTab === "fleet" && (
                <ManualFlightPanel
                  selectedDroneId={selectedDroneId}
                  onManualControl={sendManualControl}
                  recording={flightRecorder.recording}
                  onToggleRecording={flightRecorder.toggleRecording}
                  onSaveRecording={() => {
                    const waypoints = flightRecorder.saveAsWaypoints();
                    if (waypoints.length === 0 || !selectedDroneId) return;
                    run(async () => {
                      const missionName = `Recorded-${new Date().toISOString().slice(0, 19)}`;
                      await api.createMission({
                        droneId: selectedDroneId,
                        name: missionName,
                        waypoints
                      });
                      flightRecorder.clear();
                      await refresh();
                      setStatus(`Recorded path saved as mission: ${missionName} (${waypoints.length} waypoints)`);
                    }).catch(() => {});
                  }}
                  recordedPoints={flightRecorder.recordedPoints}
                />
              )}
            </div>

            {/* Bottom center: Waypoint Viewer */}
            <div className="panel min-h-0 overflow-auto p-2">
              <WaypointOpsPanel
                drones={activeDrones}
                telemetryByDrone={telemetryByDrone}
                missions={missions}
                selectedDroneId={selectedDroneId}
                missionOutcome={missionOutcome}
                onCompleteMission={acknowledgeMissionOutcome}
              />
            </div>

            {/* Bottom right: Status */}
            <div className="panel flex items-center px-3 py-1.5 text-[11px] text-cyan-100/60">
              {status || `Fleet ${activeDrones.length} live | Alerts ${alerts.length} | Missions ${missions.length}`}
            </div>
          </main>
        </>
      )}
    </div>
  );
}
