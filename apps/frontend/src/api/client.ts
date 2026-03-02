import type {
  AlertEvent,
  DroneRecord,
  GeofenceRecord,
  MissionRecord,
  MissionWaypoint,
  UserInfo
} from "../types/domain";

interface ApiClientOptions {
  baseUrl: string;
  token?: string;
}

function buildHeaders(token?: string, includeJsonContentType = false): HeadersInit {
  const headers: HeadersInit = {};

  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { message?: string };
      if (payload?.message) {
        message = payload.message;
      }
    } catch {
      // no-op
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.token = options.token;
  }

  async login(email: string, password: string): Promise<{ token: string; user: UserInfo }> {
    const response = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: buildHeaders(undefined, true),
      body: JSON.stringify({ email, password })
    });

    return parseResponse(response);
  }

  async currentUser(): Promise<{ user: UserInfo }> {
    const response = await fetch(`${this.baseUrl}/api/auth/me`, {
      headers: buildHeaders(this.token)
    });

    return parseResponse(response);
  }

  async fetchDrones(): Promise<{ drones: DroneRecord[] }> {
    const response = await fetch(`${this.baseUrl}/api/drones`, {
      headers: buildHeaders(this.token)
    });
    return parseResponse(response);
  }

  async setDroneArchived(
    droneId: string,
    archived: boolean
  ): Promise<{ updated: boolean; drone: { id: string; archivedAt: string | null } }> {
    const response = await fetch(`${this.baseUrl}/api/drones/${droneId}/archive`, {
      method: "PATCH",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify({ archived })
    });

    return parseResponse(response);
  }

  async registerDrone(input: {
    id: string;
    name?: string;
    adapter: "mock" | "mavlink" | "dji" | "custom";
    homeLat: number;
    homeLon: number;
    homeAlt?: number;
  }): Promise<{ drone: DroneRecord }> {
    const response = await fetch(`${this.baseUrl}/api/drones`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify(input)
    });

    return parseResponse(response);
  }

  async updateDroneHome(
    droneId: string,
    input: {
      homeLat: number;
      homeLon: number;
      homeAlt?: number;
    }
  ): Promise<{ updated: boolean; drone: { id: string; home: { lat: number; lon: number; alt: number } } }> {
    const response = await fetch(`${this.baseUrl}/api/drones/${droneId}/home`, {
      method: "PATCH",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify(input)
    });

    return parseResponse(response);
  }

  async deleteDrone(droneId: string): Promise<{ removed: boolean; droneId: string }> {
    const response = await fetch(`${this.baseUrl}/api/drones/${droneId}`, {
      method: "DELETE",
      headers: buildHeaders(this.token)
    });

    return parseResponse(response);
  }

  async commandDrone(droneId: string, type: string, params?: Record<string, unknown>): Promise<{ accepted: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/drones/${droneId}/command`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify({ type, params })
    });

    return parseResponse(response);
  }

  async createMission(input: {
    droneId: string;
    name?: string;
    geofenceId?: string;
    waypoints: MissionWaypoint[];
  }): Promise<{ mission: MissionRecord }> {
    const response = await fetch(`${this.baseUrl}/api/missions`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify(input)
    });

    return parseResponse(response);
  }

  async executeMission(missionId: string): Promise<{ accepted: boolean; mission: MissionRecord }> {
    const response = await fetch(`${this.baseUrl}/api/missions/${missionId}/execute`, {
      method: "POST",
      headers: buildHeaders(this.token)
    });

    return parseResponse(response);
  }

  async fetchMissions(droneId?: string): Promise<{ missions: MissionRecord[] }> {
    const query = droneId ? `?droneId=${encodeURIComponent(droneId)}` : "";
    const response = await fetch(`${this.baseUrl}/api/missions${query}`, {
      headers: buildHeaders(this.token)
    });

    return parseResponse(response);
  }

  async fetchGeofences(): Promise<{ geofences: GeofenceRecord[] }> {
    const response = await fetch(`${this.baseUrl}/api/geofences`, {
      headers: buildHeaders(this.token)
    });
    return parseResponse(response);
  }

  async setKillSwitch(enabled: boolean): Promise<{ accepted: boolean; enabled: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/admin/kill-switch`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify({ enabled })
    });

    return parseResponse(response);
  }

  async fetchAudit(limit = 100): Promise<{ logs: AlertEvent[] }> {
    const response = await fetch(`${this.baseUrl}/api/admin/audit?limit=${limit}`, {
      headers: buildHeaders(this.token)
    });
    return parseResponse(response);
  }

  // Swarm operations
  async createSwarmGroup(input: {
    name: string;
    leaderId: string;
    followerIds: string[];
    formation: string;
    spacing?: number;
    headingDeg?: number;
    altOffset?: number;
  }): Promise<{ group: unknown }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/groups`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify(input)
    });
    return parseResponse(response);
  }

  async fetchSwarmGroups(): Promise<{ groups: unknown[] }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/groups`, {
      headers: buildHeaders(this.token)
    });
    return parseResponse(response);
  }

  async engageSwarmGroup(groupId: string, leaderPosition?: { lat: number; lon: number; alt: number }): Promise<{ engaged: boolean; targets: unknown[] }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/groups/${groupId}/engage`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify({ leaderPosition })
    });
    return parseResponse(response);
  }

  async updateSwarmGroup(groupId: string, input: {
    formation?: string;
    spacing?: number;
    headingDeg?: number;
    altOffset?: number;
  }): Promise<{ group: unknown }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/groups/${groupId}`, {
      method: "PATCH",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify(input)
    });
    return parseResponse(response);
  }

  async startManeuver(groupId: string, type: string, params: Record<string, unknown> = {}): Promise<{ group: unknown }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/groups/${groupId}/maneuver`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify({ type, params })
    });
    return parseResponse(response);
  }

  async stopManeuver(groupId: string): Promise<{ group: unknown }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/groups/${groupId}/stop-maneuver`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify({})
    });
    return parseResponse(response);
  }

  async disengageSwarmGroup(groupId: string): Promise<{ group: unknown; disengaged: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/groups/${groupId}/disengage`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify({})
    });
    return parseResponse(response);
  }

  async disbandSwarmGroup(groupId: string): Promise<{ disbanded: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/groups/${groupId}`, {
      method: "DELETE",
      headers: buildHeaders(this.token)
    });
    return parseResponse(response);
  }

  async fetchScenarioPresets(): Promise<{ presets: unknown[]; grouped: Record<string, unknown[]> }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/presets`, {
      headers: buildHeaders(this.token)
    });
    return parseResponse(response);
  }

  async updateScenarioPresetDefaults(
    presetId: string,
    input: {
      formation: string;
      spacing: number;
      headingDeg: number;
      altOffset: number;
      maneuverParams?: Record<string, unknown>;
    }
  ): Promise<{ preset: unknown }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/presets/${presetId}`, {
      method: "PATCH",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify(input)
    });
    return parseResponse(response);
  }

  async resetScenarioPresetDefaults(presetId: string): Promise<{ preset: unknown; reset: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/presets/${presetId}`, {
      method: "DELETE",
      headers: buildHeaders(this.token)
    });
    return parseResponse(response);
  }

  async createSwarmFromPreset(
    presetId: string,
    name: string,
    leaderId: string,
    followerIds: string[],
    overrides?: { spacing?: number; headingDeg?: number; altOffset?: number }
  ): Promise<{ group: unknown; preset: unknown }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/groups/from-preset`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify({ presetId, name, leaderId, followerIds, overrides })
    });
    return parseResponse(response);
  }

  async getFormationPreview(input: {
    leader: { lat: number; lon: number; alt: number };
    followerDroneIds: string[];
    formation: string;
    spacing?: number;
    headingDeg?: number;
    altOffset?: number;
  }): Promise<{ targets: Array<{ droneId: string; lat: number; lon: number; alt: number }> }> {
    const response = await fetch(`${this.baseUrl}/api/swarm/formation/preview`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify(input)
    });
    return parseResponse(response);
  }

  // Video operations
  async createVideoSession(droneId: string, codec: string = "h264"): Promise<{ session: unknown }> {
    const response = await fetch(`${this.baseUrl}/api/video/session`, {
      method: "POST",
      headers: buildHeaders(this.token, true),
      body: JSON.stringify({ droneId, codec })
    });
    return parseResponse(response);
  }
}
