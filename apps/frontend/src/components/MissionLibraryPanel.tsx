import { useMemo } from "react";
import clsx from "clsx";
import type { DroneRecord, MissionRecord } from "../types/domain";
import type { SwarmGroup } from "../store/useGroundControlStore";

interface MissionLibraryPanelProps {
  missions: MissionRecord[];
  drones: DroneRecord[];
  swarmGroups: SwarmGroup[];
  selectedMissionId: string | null;
  onSelectMission: (missionId: string) => void;
  onCreateNew: () => void;
  onEditMission: (missionId: string) => void;
  onExecuteMission: (missionId: string) => void;
  onDeleteMission: (missionId: string) => void;
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

function estimateDistanceMeters(mission: MissionRecord): number {
  if (typeof mission.estimatedDistanceMeters === "number") {
    return mission.estimatedDistanceMeters;
  }

  let total = 0;
  for (let i = 1; i < mission.waypoints.length; i += 1) {
    total += haversineMeters(
      mission.waypoints[i - 1].lat,
      mission.waypoints[i - 1].lon,
      mission.waypoints[i].lat,
      mission.waypoints[i].lon
    );
  }
  return total;
}

function formatMeters(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 m";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} km`;
  return `${Math.round(value)} m`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString();
}

function statusTone(status: string): string {
  switch (status) {
    case "executing":
      return "border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan";
    case "completed":
      return "border-accent-green/30 bg-accent-green/10 text-accent-green";
    case "aborted":
      return "border-accent-red/30 bg-accent-red/10 text-accent-red";
    default:
      return "border-cyan-300/18 bg-bg-900/60 text-cyan-100/55";
  }
}

export function MissionLibraryPanel({
  missions,
  drones,
  swarmGroups,
  selectedMissionId,
  onSelectMission,
  onCreateNew,
  onEditMission,
  onExecuteMission,
  onDeleteMission
}: MissionLibraryPanelProps): JSX.Element {
  const selectedMission = useMemo(
    () => missions.find((mission) => mission.id === selectedMissionId) ?? missions[0],
    [missions, selectedMissionId]
  );

  const droneNameById = useMemo(
    () => new Map(drones.map((drone) => [drone.id, drone.name])),
    [drones]
  );

  const swarmNameById = useMemo(
    () => new Map(swarmGroups.map((group) => [group.id, group.name])),
    [swarmGroups]
  );

  const selectedMissionSwarmNames = useMemo(() => {
    if (!selectedMission) return [];
    const ids = selectedMission.swarmGroupIds
      ?? [...new Set(
        selectedMission.waypoints
          .map((waypoint) => waypoint.swarmTrigger?.groupId)
          .filter((groupId): groupId is string => Boolean(groupId))
      )];

    return ids.map((id) => swarmNameById.get(id) ?? id);
  }, [selectedMission, swarmNameById]);

  return (
    <div className="grid h-full min-h-0 gap-2 lg:grid-cols-[300px_minmax(0,1fr)]">
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-cyan-300/15 px-3 py-2">
          <div>
            <h2 className="panel-title text-[11px]">Mission Library</h2>
            <div className="mt-0.5 text-[10px] text-cyan-100/45">{missions.length} saved mission{missions.length === 1 ? "" : "s"}</div>
          </div>
          <button className="btn-primary text-[10px]" onClick={onCreateNew}>
            New Mission
          </button>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-auto p-2">
          {missions.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <div className="text-[13px] text-cyan-100/50">No missions saved</div>
              <div className="max-w-[220px] text-[11px] text-cyan-100/35">
                Upload missions from Mission Planner and they will appear here for later edit, execute, and review.
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {missions.map((mission) => {
                const distanceMeters = estimateDistanceMeters(mission);
                const curveWaypointCount =
                  mission.curveWaypointCount ?? mission.waypoints.filter((waypoint) => (waypoint.curveSize ?? 0) > 0).length;
                return (
                  <button
                    key={mission.id}
                    type="button"
                    onClick={() => onSelectMission(mission.id)}
                    className={clsx(
                      "w-full rounded border px-3 py-2 text-left transition",
                      selectedMission?.id === mission.id
                        ? "border-accent-cyan/40 bg-accent-cyan/8"
                        : "border-cyan-300/12 bg-bg-900/45 hover:border-cyan-300/25"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-white">{mission.name}</div>
                        <div className="mt-0.5 text-[10px] text-cyan-100/45">
                          {droneNameById.get(mission.droneId) ?? mission.droneId}
                        </div>
                      </div>
                      <span className={clsx("rounded border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.12em]", statusTone(mission.status))}>
                        {mission.status}
                      </span>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-1 text-[9px] text-cyan-100/50">
                      <span>{mission.waypointCount ?? mission.waypoints.length} WP</span>
                      <span>{formatMeters(distanceMeters)}</span>
                      <span>{curveWaypointCount} curves</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="panel flex min-h-0 flex-col overflow-hidden">
        {selectedMission ? (
          <>
            <div className="flex items-center justify-between border-b border-cyan-300/15 px-3 py-2">
              <div>
                <h2 className="panel-title text-[11px]">{selectedMission.name}</h2>
                <div className="mt-0.5 text-[10px] text-cyan-100/45">
                  {droneNameById.get(selectedMission.droneId) ?? selectedMission.droneId}
                </div>
              </div>
              <span className={clsx("rounded border px-2 py-1 text-[9px] uppercase tracking-[0.12em]", statusTone(selectedMission.status))}>
                {selectedMission.status}
              </span>
            </div>

            <div className="grid gap-2 border-b border-cyan-300/15 p-3 md:grid-cols-2">
              <div className="rounded border border-cyan-300/12 bg-bg-900/55 px-2 py-2">
                <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Waypoints</div>
                <div className="mt-1 text-[16px] font-semibold text-accent-cyan">{selectedMission.waypointCount ?? selectedMission.waypoints.length}</div>
              </div>
              <div className="rounded border border-cyan-300/12 bg-bg-900/55 px-2 py-2">
                <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Distance</div>
                <div className="mt-1 text-[16px] font-semibold text-white">{formatMeters(estimateDistanceMeters(selectedMission))}</div>
              </div>
              <div className="rounded border border-cyan-300/12 bg-bg-900/55 px-2 py-2">
                <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Curved Turns</div>
                <div className="mt-1 text-[16px] font-semibold text-accent-amber">
                  {selectedMission.curveWaypointCount ?? selectedMission.waypoints.filter((waypoint) => (waypoint.curveSize ?? 0) > 0).length}
                </div>
              </div>
              <div className="rounded border border-cyan-300/12 bg-bg-900/55 px-2 py-2">
                <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Swarm Groups</div>
                <div className="mt-1 text-[16px] font-semibold text-accent-green">{selectedMissionSwarmNames.length}</div>
              </div>
              <div className="rounded border border-cyan-300/12 bg-bg-900/55 px-2 py-2">
                <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Executions</div>
                <div className="mt-1 text-[16px] font-semibold text-white">{selectedMission.executionCount ?? 0}</div>
              </div>
              <div className="rounded border border-cyan-300/12 bg-bg-900/55 px-2 py-2">
                <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Last Run</div>
                <div className="mt-1 text-[11px] font-semibold text-cyan-100/70">{formatDateTime(selectedMission.lastExecutedAt)}</div>
              </div>
            </div>

            <div className="grid gap-2 border-b border-cyan-300/15 px-3 py-2 md:grid-cols-3">
              <button className="btn-primary text-[10px]" onClick={() => onEditMission(selectedMission.id)}>
                Edit In Planner
              </button>
              <button className="btn-secondary text-[10px]" onClick={() => onExecuteMission(selectedMission.id)}>
                Execute Mission
              </button>
              <button className="btn-danger text-[10px]" onClick={() => onDeleteMission(selectedMission.id)}>
                Delete Mission
              </button>
            </div>

            <div className="border-b border-cyan-300/15 px-3 py-2">
              <div className="text-[9px] uppercase tracking-[0.12em] text-cyan-100/45">Swarm Groups Used</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedMissionSwarmNames.length > 0 ? selectedMissionSwarmNames.map((name) => (
                  <span key={name} className="rounded border border-accent-cyan/18 bg-accent-cyan/8 px-2 py-1 text-[10px] text-accent-cyan">
                    {name}
                  </span>
                )) : (
                  <span className="text-[11px] text-cyan-100/35">No swarm events assigned.</span>
                )}
              </div>
            </div>

            <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
              <table className="w-full text-left text-[10px]">
                <thead className="sticky top-0 z-10 bg-bg-900/95 text-cyan-100/55">
                  <tr>
                    <th className="px-3 py-2">WP</th>
                    <th className="px-3 py-2">Lat</th>
                    <th className="px-3 py-2">Lon</th>
                    <th className="px-3 py-2">Alt</th>
                    <th className="px-3 py-2">Hover</th>
                    <th className="px-3 py-2">Curve</th>
                    <th className="px-3 py-2">Swarm</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedMission.waypoints.map((waypoint, index) => (
                    <tr key={`${selectedMission.id}-${index}`} className="border-t border-cyan-300/8">
                      <td className="px-3 py-2 text-accent-amber">WP-{index + 1}</td>
                      <td className="px-3 py-2 font-mono text-cyan-100/75">{waypoint.lat.toFixed(5)}</td>
                      <td className="px-3 py-2 font-mono text-cyan-100/75">{waypoint.lon.toFixed(5)}</td>
                      <td className="px-3 py-2">{Math.round(waypoint.alt)}m</td>
                      <td className="px-3 py-2">{Math.round(waypoint.hover)}s</td>
                      <td className="px-3 py-2">{Math.round(waypoint.curveSize ?? 0)}m</td>
                      <td className="px-3 py-2">
                        {waypoint.swarmTrigger?.groupId
                          ? (swarmNameById.get(waypoint.swarmTrigger.groupId) ?? waypoint.swarmTrigger.groupId)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[12px] text-cyan-100/40">
            Select a mission to inspect its stats and actions.
          </div>
        )}
      </section>
    </div>
  );
}
