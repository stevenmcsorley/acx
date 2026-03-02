import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import type { SwarmGroup } from "../store/useGroundControlStore";
import type { DroneRecord, DroneTelemetry } from "../types/domain";

interface FleetPanelProps {
  drones: DroneRecord[];
  telemetryByDrone: Record<string, DroneTelemetry>;
  selectedDroneId: string | null;
  swarmGroups: SwarmGroup[];
  embedded?: boolean;
  onSelectDrone: (droneId: string) => void;
  onRegisterDrone: (input: { id: string; name?: string; homeLat: number; homeLon: number; homeAlt?: number }) => void;
  onUpdateDroneHome: (droneId: string, input: { homeLat: number; homeLon: number; homeAlt?: number }) => void;
  onArchiveDrone: (droneId: string, archived: boolean) => void;
  onDeleteDrone: (droneId: string) => void;
}

function stateColor(flightState?: string): string {
  switch (flightState) {
    case "airborne":
    case "taking_off":
      return "bg-accent-green";
    case "armed":
      return "bg-accent-amber";
    case "emergency":
      return "bg-accent-red";
    case "rtl":
    case "landing":
      return "bg-accent-amber";
    default:
      return "bg-cyan-100/40";
  }
}

function stateLabel(flightState?: string): string {
  switch (flightState) {
    case "airborne": return "AIR";
    case "taking_off": return "T/O";
    case "armed": return "ARM";
    case "emergency": return "EMR";
    case "rtl": return "RTL";
    case "landing": return "LND";
    case "grounded": return "GND";
    default: return "OFF";
  }
}

export function FleetPanel({
  drones,
  telemetryByDrone,
  selectedDroneId,
  swarmGroups,
  embedded = false,
  onSelectDrone,
  onRegisterDrone,
  onUpdateDroneHome,
  onArchiveDrone,
  onDeleteDrone
}: FleetPanelProps): JSX.Element {
  const [search, setSearch] = useState("");
  const [newId, setNewId] = useState("");
  const [newLat, setNewLat] = useState("37.7749");
  const [newLon, setNewLon] = useState("-122.4194");
  const [newAlt, setNewAlt] = useState("0");
  const [showRegister, setShowRegister] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return drones.filter((d) => {
      if (!showArchived && d.archivedAt) return false;
      if (!query) return true;
      return d.id.toLowerCase().includes(query) || d.name.toLowerCase().includes(query);
    });
  }, [drones, search, showArchived]);

  const liveDrones = useMemo(() => drones.filter((drone) => !drone.archivedAt), [drones]);
  const archivedCount = drones.length - liveDrones.length;

  const activeCount = liveDrones.filter((d) => {
    const t = telemetryByDrone[d.id];
    return t && ["airborne", "rtl", "taking_off"].includes(t.flightState);
  }).length;

  const armedCount = liveDrones.filter((d) => {
    const t = telemetryByDrone[d.id];
    return t?.flightState === "armed";
  }).length;

  useEffect(() => {
    if (!selectedDroneId) return;
    const selectedDrone = drones.find((drone) => drone.id === selectedDroneId);
    if (!selectedDrone) return;
    setNewLat(String(selectedDrone.home.lat));
    setNewLon(String(selectedDrone.home.lon));
    setNewAlt(String(selectedDrone.home.alt));
  }, [selectedDroneId, drones]);

  return (
    <aside className={embedded ? "flex h-full min-h-0 flex-col overflow-hidden" : "panel flex h-full min-h-0 flex-col overflow-hidden"}>
      {!embedded ? (
        <div className="flex items-center justify-between border-b border-cyan-300/15 px-3 py-2">
          <h2 className="panel-title text-[11px]">Fleet Control</h2>
          <div className="text-[10px] text-cyan-100/50">
            {liveDrones.length} live{archivedCount > 0 ? ` | ${archivedCount} archived` : ""}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-1.5 px-3 py-2">
        <div className="metric-card text-center">
          <div className="text-[9px] uppercase text-cyan-100/50">Active</div>
          <strong className="text-sm text-accent-green">{activeCount}</strong>
        </div>
        <div className="metric-card text-center">
          <div className="text-[9px] uppercase text-cyan-100/50">Armed</div>
          <strong className="text-sm text-accent-amber">{armedCount}</strong>
        </div>
        <div className="metric-card text-center">
          <div className="text-[9px] uppercase text-cyan-100/50">Ground</div>
          <strong className="text-sm text-cyan-100/80">{liveDrones.length - activeCount - armedCount}</strong>
        </div>
      </div>

      <div className="space-y-2 px-3 pb-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search drones..."
          className="input text-[11px]"
        />
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-cyan-100/45">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
            className="h-3.5 w-3.5 rounded border border-cyan-300/20 bg-bg-900/80"
          />
          Show Archived
        </label>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-1 overflow-auto px-3 pb-2">
        {filtered.map((drone) => {
          const telemetry = telemetryByDrone[drone.id];
          const isSelected = selectedDroneId === drone.id;
          const swarmGroup = swarmGroups.find(
            (group) => group.leaderId === drone.id || group.followerIds.includes(drone.id)
          );
          const swarmRole = swarmGroup
            ? swarmGroup.leaderId === drone.id
              ? "Leader"
              : "Follower"
            : null;
          return (
            <div
              key={drone.id}
              className={clsx(
                "fleet-row group flex items-center",
                isSelected && !drone.archivedAt && "fleet-row-active",
                drone.archivedAt && "opacity-65"
              )}
            >
              <button
                type="button"
                disabled={Boolean(drone.archivedAt)}
                onClick={() => {
                  if (!drone.archivedAt) {
                    onSelectDrone(drone.id);
                  }
                }}
                className="flex w-full min-w-0 items-center gap-2 text-left"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-cyan-300/20 bg-bg-900/60">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-100/50">
                    <path d="M12 2L8 6H4v4l-4 4 4 4v4h4l4 4 4-4h4v-4l4-4-4-4V6h-4L12 2z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={clsx(
                        "status-dot",
                        drone.archivedAt ? "bg-cyan-100/20" : stateColor(telemetry?.flightState),
                        !drone.archivedAt && telemetry && ["airborne", "taking_off", "emergency"].includes(telemetry.flightState) && "status-dot-pulse"
                      )}
                    />
                    <span className="truncate text-[12px] font-semibold text-white">{drone.name}</span>
                    <span className="ml-auto rounded bg-bg-900/80 px-1 py-0.5 text-[8px] uppercase tracking-[0.1em] text-cyan-100/50">
                      {drone.archivedAt ? "ARCH" : stateLabel(telemetry?.flightState)}
                    </span>
                  </div>
                  <div className="mt-0.5 grid grid-cols-3 text-[10px] text-cyan-50/60">
                    <span>{drone.archivedAt ? "--" : `${Math.round(telemetry?.batteryPct ?? drone.lastKnown?.batteryPct ?? 100)}%`}</span>
                    <span>{drone.archivedAt ? "--" : `${Math.round(telemetry?.position.alt ?? drone.lastKnown?.alt ?? 0)}m`}</span>
                    <span>{drone.archivedAt ? "--" : `${Math.round(telemetry?.velocity.speed ?? 0)}m/s`}</span>
                  </div>
                  {swarmGroup ? (
                    <div className="mt-0.5 flex items-center gap-1 text-[9px] text-cyan-100/48">
                      <span className="rounded border border-cyan-300/18 bg-bg-900/55 px-1 py-0.5 uppercase tracking-[0.08em]">
                        {swarmRole}
                      </span>
                      <span className="truncate">{swarmGroup.name}</span>
                    </div>
                  ) : null}
                </div>
              </button>
              <div className="ml-2 flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="rounded border border-cyan-300/18 bg-bg-900/80 p-1 text-cyan-100/60 transition hover:border-cyan-300/40 hover:text-cyan-100"
                  title={drone.archivedAt ? "Restore drone" : "Archive drone"}
                  onClick={() => onArchiveDrone(drone.id, !drone.archivedAt)}
                >
                  {drone.archivedAt ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 19V5" />
                      <path d="m5 12 7-7 7 7" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 8v13H3V8" />
                      <path d="M1 3h22v5H1z" />
                      <path d="M10 12h4" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  className="rounded border border-accent-red/25 bg-bg-900/80 p-1 text-accent-red/70 transition hover:border-accent-red/60 hover:text-accent-red"
                  title="Delete drone"
                  onClick={() => onDeleteDrone(drone.id)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-cyan-300/15 px-3 py-2">
        <button
          className="btn-secondary w-full text-[10px]"
          onClick={() => setShowRegister(!showRegister)}
        >
          {showRegister ? "Hide" : "Register Drone"}
        </button>

        {showRegister && (
          <form
            className="mt-2 space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              const id = newId.trim();
              const homeLat = Number(newLat);
              const homeLon = Number(newLon);
              const homeAlt = Number(newAlt);
              if (!id) return;
              if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon) || !Number.isFinite(homeAlt)) return;
              onRegisterDrone({ id, name: id.toUpperCase(), homeLat, homeLon, homeAlt });
              setNewId("");
              setShowRegister(false);
            }}
          >
            <input className="input text-[11px]" placeholder="Drone ID" value={newId} onChange={(e) => setNewId(e.target.value)} />
            <div className="grid grid-cols-3 gap-1.5">
              <input className="input text-[11px]" placeholder="Lat" value={newLat} onChange={(e) => setNewLat(e.target.value)} />
              <input className="input text-[11px]" placeholder="Lon" value={newLon} onChange={(e) => setNewLon(e.target.value)} />
              <input className="input text-[11px]" placeholder="Alt" value={newAlt} onChange={(e) => setNewAlt(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button className="btn-primary w-full text-[10px]" type="submit">Register</button>
              <button
                className="btn-secondary w-full text-[10px]"
                type="button"
                disabled={!selectedDroneId}
                onClick={() => {
                  if (!selectedDroneId) return;
                  const homeLat = Number(newLat);
                  const homeLon = Number(newLon);
                  const homeAlt = Number(newAlt);
                  if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon) || !Number.isFinite(homeAlt)) return;
                  onUpdateDroneHome(selectedDroneId, { homeLat, homeLon, homeAlt });
                }}
              >
                Update Home
              </button>
            </div>
            <button
              className="btn-danger w-full text-[10px]"
              type="button"
              disabled={!selectedDroneId}
              onClick={() => {
                if (!selectedDroneId) return;
                onArchiveDrone(selectedDroneId, true);
              }}
            >
              Archive Drone
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}
