import dgram from "dgram";
import type { DroneAdapter, AdapterDroneRegistration } from "./DroneAdapter";
import type { DroneCommandType, DroneTelemetry, MissionWaypoint, AdapterType } from "@sgcx/shared-types";

// MAVLink message IDs
const MAVLINK_MSG_ID_HEARTBEAT = 0;
const MAVLINK_MSG_ID_SYS_STATUS = 1;
const MAVLINK_MSG_ID_GPS_RAW_INT = 24;
const MAVLINK_MSG_ID_ATTITUDE = 30;
const MAVLINK_MSG_ID_GLOBAL_POSITION_INT = 33;
const MAVLINK_MSG_ID_BATTERY_STATUS = 147;
const MAVLINK_MSG_ID_COMMAND_LONG = 76;
const MAVLINK_MSG_ID_SET_POSITION_TARGET_GLOBAL_INT = 86;
const MAVLINK_MSG_ID_MISSION_COUNT = 44;
const MAVLINK_MSG_ID_MISSION_ITEM_INT = 73;

// MAVLink commands
const MAV_CMD_COMPONENT_ARM_DISARM = 400;
const MAV_CMD_NAV_TAKEOFF = 22;
const MAV_CMD_NAV_LAND = 21;
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;

// MAVLink enums
const MAV_FRAME_GLOBAL_INT = 5;

interface MAVLinkDroneState {
  id: string;
  name: string;
  homeLat: number;
  homeLon: number;
  homeAlt: number;
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  vx: number;
  vy: number;
  vz: number;
  batteryPct: number;
  signalPct: number;
  flightState: DroneTelemetry["flightState"];
  lastHeartbeat: number;
  connected: boolean;
  systemId: number;
  componentId: number;
  remoteAddress?: string;
  remotePort?: number;
}

interface MAVLinkConfig {
  connectionString: string; // e.g., "udp:14550" or "serial:/dev/ttyACM0:57600"
}

export class MAVLinkAdapter implements DroneAdapter {
  readonly adapterType: AdapterType = "mavlink";

  private enabled = false;
  private socket: dgram.Socket | null = null;
  private drones = new Map<string, MAVLinkDroneState>();
  private systemIdToDroneId = new Map<number, string>();
  private pendingAlerts: Array<{ droneId: string; severity: "info" | "warning" | "critical"; message: string; timestamp: string }> = [];
  private killSwitchEnabled = false;
  private geofences: Array<{ id: string; polygon: Array<{ lat: number; lon: number }>; isActive: boolean }> = [];
  private sequenceNumber = 0;
  private config: MAVLinkConfig;

  constructor(config?: MAVLinkConfig) {
    this.config = config ?? { connectionString: "udp:14550" };

    if (this.config.connectionString.startsWith("udp:")) {
      this.initUdp();
    }
  }

  private initUdp(): void {
    const port = parseInt(this.config.connectionString.split(":")[1] ?? "14550", 10);

    try {
      this.socket = dgram.createSocket("udp4");

      this.socket.on("message", (msg, rinfo) => {
        this.parseMAVLinkMessage(msg, rinfo.address, rinfo.port);
      });

      this.socket.on("error", (err) => {
        console.error("MAVLink UDP error:", err.message);
      });

      this.socket.bind(port, () => {
        console.log(`MAVLink adapter listening on UDP port ${port}`);
        this.enabled = true;
      });
    } catch (err) {
      console.error("Failed to initialize MAVLink UDP:", err);
    }
  }

  private parseMAVLinkMessage(buffer: Buffer, address: string, port: number): void {
    if (buffer.length < 8) return;

    // MAVLink v1 header: 0xFE
    // MAVLink v2 header: 0xFD
    const magic = buffer[0];
    if (magic !== 0xfe && magic !== 0xfd) return;

    const isV2 = magic === 0xfd;
    const headerLength = isV2 ? 10 : 6;
    if (buffer.length < headerLength) return;

    let payloadLength: number;
    let sequenceNumber: number;
    let systemId: number;
    let componentId: number;
    let messageId: number;
    let payloadOffset: number;

    if (isV2) {
      payloadLength = buffer[1];
      sequenceNumber = buffer[4];
      systemId = buffer[5];
      componentId = buffer[6];
      messageId = buffer[7] | (buffer[8] << 8) | (buffer[9] << 16);
      payloadOffset = 10;
    } else {
      payloadLength = buffer[1];
      sequenceNumber = buffer[2];
      systemId = buffer[3];
      componentId = buffer[4];
      messageId = buffer[5];
      payloadOffset = 6;
    }

    if (buffer.length < payloadOffset + payloadLength) return;

    const payload = buffer.subarray(payloadOffset, payloadOffset + payloadLength);

    // Map system ID to drone
    const droneId = this.systemIdToDroneId.get(systemId);
    if (!droneId) return;

    const drone = this.drones.get(droneId);
    if (!drone) return;

    drone.remoteAddress = address;
    drone.remotePort = port;
    drone.systemId = systemId;
    drone.componentId = componentId;

    switch (messageId) {
      case MAVLINK_MSG_ID_HEARTBEAT:
        this.handleHeartbeat(drone, payload);
        break;
      case MAVLINK_MSG_ID_GLOBAL_POSITION_INT:
        this.handleGlobalPositionInt(drone, payload);
        break;
      case MAVLINK_MSG_ID_SYS_STATUS:
        this.handleSysStatus(drone, payload);
        break;
      case MAVLINK_MSG_ID_ATTITUDE:
        this.handleAttitude(drone, payload);
        break;
      case MAVLINK_MSG_ID_GPS_RAW_INT:
        // GPS data handled via GLOBAL_POSITION_INT
        break;
      case MAVLINK_MSG_ID_BATTERY_STATUS:
        this.handleBatteryStatus(drone, payload);
        break;
    }
  }

  private handleHeartbeat(drone: MAVLinkDroneState, payload: Buffer): void {
    if (payload.length < 9) return;

    const customMode = payload.readUInt32LE(0);
    const type = payload[4];
    const autopilot = payload[5];
    const baseMode = payload[6];
    const systemStatus = payload[7];

    drone.lastHeartbeat = Date.now();
    drone.connected = true;

    // Determine flight state from base_mode and system_status
    const armed = (baseMode & 0x80) !== 0;

    if (systemStatus === 6) { // MAV_STATE_EMERGENCY
      drone.flightState = "emergency";
    } else if (!armed) {
      drone.flightState = "grounded";
    } else if (drone.alt > 2) {
      drone.flightState = "airborne";
    } else {
      drone.flightState = "armed";
    }

    drone.signalPct = 100;
  }

  private handleGlobalPositionInt(drone: MAVLinkDroneState, payload: Buffer): void {
    if (payload.length < 28) return;

    const timeBootMs = payload.readUInt32LE(0);
    const lat = payload.readInt32LE(4) / 1e7;
    const lon = payload.readInt32LE(8) / 1e7;
    const alt = payload.readInt32LE(12) / 1000; // mm to m
    const relativeAlt = payload.readInt32LE(16) / 1000;
    const vx = payload.readInt16LE(20) / 100; // cm/s to m/s
    const vy = payload.readInt16LE(22) / 100;
    const vz = payload.readInt16LE(24) / 100;
    const hdg = payload.readUInt16LE(26) / 100; // cdeg to deg

    drone.lat = lat;
    drone.lon = lon;
    drone.alt = relativeAlt;
    drone.heading = hdg;
    drone.vx = vx;
    drone.vy = vy;
    drone.vz = vz;
  }

  private handleSysStatus(drone: MAVLinkDroneState, payload: Buffer): void {
    if (payload.length < 31) return;

    const batteryRemaining = payload[30]; // percent 0-100, or -1 if unavailable
    if (batteryRemaining >= 0 && batteryRemaining <= 100) {
      drone.batteryPct = batteryRemaining;
    }
  }

  private handleAttitude(drone: MAVLinkDroneState, payload: Buffer): void {
    if (payload.length < 28) return;
    // Attitude data available but heading already extracted from GLOBAL_POSITION_INT
  }

  private handleBatteryStatus(drone: MAVLinkDroneState, payload: Buffer): void {
    if (payload.length < 36) return;
    const batteryRemaining = payload[35]; // percent, -1 if unavailable
    if (batteryRemaining >= 0 && batteryRemaining <= 100) {
      drone.batteryPct = batteryRemaining;
    }
  }

  registerDrone(drone: AdapterDroneRegistration): void {
    if (!this.enabled) {
      throw new Error("MAVLink adapter is not enabled. Set MAVLINK_ENABLED=true and MAVLINK_CONNECTION_STRING in environment.");
    }

    // Assign a system ID based on registration order
    const systemId = this.drones.size + 1;

    const state: MAVLinkDroneState = {
      id: drone.id,
      name: drone.name,
      homeLat: drone.homeLat,
      homeLon: drone.homeLon,
      homeAlt: drone.homeAlt,
      lat: drone.homeLat,
      lon: drone.homeLon,
      alt: 0,
      heading: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      batteryPct: 100,
      signalPct: 0,
      flightState: "grounded",
      lastHeartbeat: 0,
      connected: false,
      systemId,
      componentId: 1
    };

    this.drones.set(drone.id, state);
    this.systemIdToDroneId.set(systemId, drone.id);
  }

  removeDrone(droneId: string): void {
    const drone = this.drones.get(droneId);
    if (!drone) {
      throw new Error(`MAVLink drone ${droneId} not found`);
    }

    this.systemIdToDroneId.delete(drone.systemId);
    this.drones.delete(droneId);
  }

  updateHome(droneId: string, homeLat: number, homeLon: number, homeAlt: number): void {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`MAVLink drone ${droneId} not found`);
    drone.homeLat = homeLat;
    drone.homeLon = homeLon;
    drone.homeAlt = homeAlt;
  }

  sendCommand(droneId: string, type: DroneCommandType, params?: Record<string, unknown>): void {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`MAVLink drone ${droneId} not found`);

    switch (type) {
      case "arm":
        this.sendCommandLong(drone, MAV_CMD_COMPONENT_ARM_DISARM, [1, 0, 0, 0, 0, 0, 0]);
        break;
      case "disarm":
        this.sendCommandLong(drone, MAV_CMD_COMPONENT_ARM_DISARM, [0, 0, 0, 0, 0, 0, 0]);
        break;
      case "takeoff": {
        const alt = (params?.altitude as number) ?? 20;
        this.sendCommandLong(drone, MAV_CMD_NAV_TAKEOFF, [0, 0, 0, 0, drone.lat, drone.lon, alt]);
        break;
      }
      case "land":
        this.sendCommandLong(drone, MAV_CMD_NAV_LAND, [0, 0, 0, 0, drone.lat, drone.lon, 0]);
        break;
      case "rtl":
        this.sendCommandLong(drone, MAV_CMD_NAV_RETURN_TO_LAUNCH, [0, 0, 0, 0, 0, 0, 0]);
        break;
      case "setWaypoint":
      case "setSwarmTarget": {
        const lat = params?.lat as number;
        const lon = params?.lon as number;
        const alt = (params?.alt as number) ?? drone.alt;
        this.sendPositionTarget(drone, lat, lon, alt);
        break;
      }
      case "clearSwarmTarget":
        // Native mission-resume behavior depends on the autopilot. The
        // simulator supports this explicitly; MAVLink can no-op here.
        break;
      case "uploadMission":
        // Mission upload handled via uploadMission method
        break;
    }
  }

  uploadMission(droneId: string, missionId: string, name: string, waypoints: MissionWaypoint[]): void {
    const drone = this.drones.get(droneId);
    if (!drone) throw new Error(`MAVLink drone ${droneId} not found`);

    // Send MISSION_COUNT then MISSION_ITEM_INT for each waypoint
    this.sendMissionCount(drone, waypoints.length);

    waypoints.forEach((wp, index) => {
      // Small delay between items would be needed in production
      this.sendMissionItemInt(drone, index, wp);
    });

    this.pendingAlerts.push({
      droneId,
      severity: "info",
      message: `Mission "${name}" (${waypoints.length} WPs) uploaded via MAVLink`,
      timestamp: new Date().toISOString()
    });
  }

  setKillSwitch(enabled: boolean): void {
    this.killSwitchEnabled = enabled;
    if (enabled) {
      // Emergency disarm all MAVLink drones
      for (const drone of this.drones.values()) {
        this.sendCommandLong(drone, MAV_CMD_COMPONENT_ARM_DISARM, [0, 21196, 0, 0, 0, 0, 0]); // Force disarm
      }
    }
  }

  setGeofences(geofences: Array<{ id: string; polygon: Array<{ lat: number; lon: number }>; isActive: boolean }>): void {
    this.geofences = geofences;
  }

  tick(dtSeconds: number, nowMs: number): {
    telemetry: Array<{ droneId: string; payload: DroneTelemetry }>;
    alerts: Array<{ droneId: string; severity: "info" | "warning" | "critical"; message: string; timestamp: string }>;
  } {
    const telemetry: Array<{ droneId: string; payload: DroneTelemetry }> = [];
    const alerts = [...this.pendingAlerts];
    this.pendingAlerts = [];

    for (const drone of this.drones.values()) {
      // Check heartbeat timeout
      if (drone.lastHeartbeat > 0 && nowMs - drone.lastHeartbeat > 5000) {
        drone.connected = false;
        drone.signalPct = 0;
      }

      const speed = Math.sqrt(drone.vx * drone.vx + drone.vy * drone.vy + drone.vz * drone.vz);

      telemetry.push({
        droneId: drone.id,
        payload: {
          timestamp: new Date(nowMs).toISOString(),
          position: { lat: drone.lat, lon: drone.lon, alt: drone.alt },
          heading: drone.heading,
          velocity: { x: drone.vx, y: drone.vy, z: drone.vz, speed },
          batteryPct: drone.batteryPct,
          signalPct: drone.signalPct,
          flightState: drone.flightState,
          wind: { x: 0, y: 0, z: 0, speed: 0 },
          collisionFlag: false,
          geofenceViolation: false,
          mode: drone.connected ? "mavlink" : "disconnected"
        }
      });
    }

    return { telemetry, alerts };
  }

  private sendCommandLong(drone: MAVLinkDroneState, command: number, params: number[]): void {
    if (!this.socket || !drone.remoteAddress || !drone.remotePort) return;

    // Build MAVLink v1 COMMAND_LONG message
    const payloadLength = 33;
    const buf = Buffer.alloc(6 + payloadLength + 2); // header + payload + checksum

    buf[0] = 0xfe; // Magic byte (v1)
    buf[1] = payloadLength;
    buf[2] = this.nextSequence();
    buf[3] = 255; // Our system ID (GCS)
    buf[4] = 0;   // Our component ID
    buf[5] = MAVLINK_MSG_ID_COMMAND_LONG;

    // Payload
    let offset = 6;
    buf.writeFloatLE(params[0] ?? 0, offset); offset += 4;
    buf.writeFloatLE(params[1] ?? 0, offset); offset += 4;
    buf.writeFloatLE(params[2] ?? 0, offset); offset += 4;
    buf.writeFloatLE(params[3] ?? 0, offset); offset += 4;
    buf.writeFloatLE(params[4] ?? 0, offset); offset += 4;
    buf.writeFloatLE(params[5] ?? 0, offset); offset += 4;
    buf.writeFloatLE(params[6] ?? 0, offset); offset += 4;
    buf.writeUInt16LE(command, offset); offset += 2;
    buf[offset] = drone.systemId; offset += 1;
    buf[offset] = drone.componentId; offset += 1;
    buf[offset] = 0; // confirmation

    // Simplified checksum (real implementation would use X.25 CRC)
    const checksum = this.crc16(buf, 1, 6 + payloadLength);
    buf.writeUInt16LE(checksum, 6 + payloadLength);

    this.socket.send(buf, drone.remotePort, drone.remoteAddress);
  }

  private sendPositionTarget(drone: MAVLinkDroneState, lat: number, lon: number, alt: number): void {
    if (!this.socket || !drone.remoteAddress || !drone.remotePort) return;

    const payloadLength = 53;
    const buf = Buffer.alloc(6 + payloadLength + 2);

    buf[0] = 0xfe;
    buf[1] = payloadLength;
    buf[2] = this.nextSequence();
    buf[3] = 255;
    buf[4] = 0;
    buf[5] = MAVLINK_MSG_ID_SET_POSITION_TARGET_GLOBAL_INT;

    let offset = 6;
    buf.writeUInt32LE(0, offset); offset += 4; // time_boot_ms
    buf.writeInt32LE(Math.round(lat * 1e7), offset); offset += 4;
    buf.writeInt32LE(Math.round(lon * 1e7), offset); offset += 4;
    buf.writeFloatLE(alt, offset); offset += 4;
    // remaining fields zeroed

    const checksum = this.crc16(buf, 1, 6 + payloadLength);
    buf.writeUInt16LE(checksum, 6 + payloadLength);

    this.socket.send(buf, drone.remotePort, drone.remoteAddress);
  }

  private sendMissionCount(drone: MAVLinkDroneState, count: number): void {
    if (!this.socket || !drone.remoteAddress || !drone.remotePort) return;

    const payloadLength = 4;
    const buf = Buffer.alloc(6 + payloadLength + 2);

    buf[0] = 0xfe;
    buf[1] = payloadLength;
    buf[2] = this.nextSequence();
    buf[3] = 255;
    buf[4] = 0;
    buf[5] = MAVLINK_MSG_ID_MISSION_COUNT;

    let offset = 6;
    buf.writeUInt16LE(count, offset); offset += 2;
    buf[offset] = drone.systemId; offset += 1;
    buf[offset] = drone.componentId;

    const checksum = this.crc16(buf, 1, 6 + payloadLength);
    buf.writeUInt16LE(checksum, 6 + payloadLength);

    this.socket.send(buf, drone.remotePort, drone.remoteAddress);
  }

  private sendMissionItemInt(drone: MAVLinkDroneState, seq: number, wp: MissionWaypoint): void {
    if (!this.socket || !drone.remoteAddress || !drone.remotePort) return;

    const payloadLength = 37;
    const buf = Buffer.alloc(6 + payloadLength + 2);

    buf[0] = 0xfe;
    buf[1] = payloadLength;
    buf[2] = this.nextSequence();
    buf[3] = 255;
    buf[4] = 0;
    buf[5] = MAVLINK_MSG_ID_MISSION_ITEM_INT;

    let offset = 6;
    buf.writeFloatLE(wp.hover ?? 0, offset); offset += 4; // param1 (hold time)
    buf.writeFloatLE(0, offset); offset += 4; // param2
    buf.writeFloatLE(0, offset); offset += 4; // param3
    buf.writeFloatLE(0, offset); offset += 4; // param4 (yaw)
    buf.writeInt32LE(Math.round(wp.lat * 1e7), offset); offset += 4; // x (lat)
    buf.writeInt32LE(Math.round(wp.lon * 1e7), offset); offset += 4; // y (lon)
    buf.writeFloatLE(wp.alt, offset); offset += 4; // z (alt)
    buf.writeUInt16LE(seq, offset); offset += 2;
    buf.writeUInt16LE(16, offset); offset += 2; // MAV_CMD_NAV_WAYPOINT
    buf[offset] = drone.systemId; offset += 1;
    buf[offset] = drone.componentId; offset += 1;
    buf[offset] = MAV_FRAME_GLOBAL_INT;

    const checksum = this.crc16(buf, 1, 6 + payloadLength);
    buf.writeUInt16LE(checksum, 6 + payloadLength);

    this.socket.send(buf, drone.remotePort, drone.remoteAddress);
  }

  private nextSequence(): number {
    this.sequenceNumber = (this.sequenceNumber + 1) & 0xff;
    return this.sequenceNumber;
  }

  private crc16(buffer: Buffer, start: number, end: number): number {
    // X.25 CRC used by MAVLink
    let crc = 0xffff;
    for (let i = start; i < end; i++) {
      let tmp = buffer[i] ^ (crc & 0xff);
      tmp ^= (tmp << 4) & 0xff;
      crc = (crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4);
      crc &= 0xffff;
    }
    return crc;
  }
}
