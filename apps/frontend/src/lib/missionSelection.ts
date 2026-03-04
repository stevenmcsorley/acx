import type { MissionRecord } from "../types/domain";

export function getPreferredMissionForDrone(
  missions: MissionRecord[],
  droneId: string | null | undefined
): MissionRecord | undefined {
  if (!droneId) {
    return undefined;
  }

  const droneMissions = missions.filter((mission) => mission.droneId === droneId && mission.waypoints.length > 0);
  if (droneMissions.length === 0) {
    return undefined;
  }

  const executing = droneMissions
    .filter((mission) => mission.status === "executing")
    .sort((a, b) => new Date(b.lastExecutedAt ?? b.updatedAt).getTime() - new Date(a.lastExecutedAt ?? a.updatedAt).getTime())[0];

  if (executing) {
    return executing;
  }

  return droneMissions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}
