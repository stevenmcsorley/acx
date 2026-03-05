import type { MissionRecord } from "../types/domain";

function parseIsoTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

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

export function getLatestSavedMissionForDrone(
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

  return droneMissions.sort((a, b) => {
    const bTime = Math.max(parseIsoTimestamp(b.updatedAt), parseIsoTimestamp(b.createdAt));
    const aTime = Math.max(parseIsoTimestamp(a.updatedAt), parseIsoTimestamp(a.createdAt));
    return bTime - aTime;
  })[0];
}
