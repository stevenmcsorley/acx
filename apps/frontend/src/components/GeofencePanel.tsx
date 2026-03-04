import { useEffect, useMemo, useState } from "react";
import type { DroneRecord, GeofenceRecord, HomeBaseRecord, HomeBaseSlot } from "../types/domain";
import type { SwarmGroup } from "../store/useGroundControlStore";

interface GeofencePanelProps {
  geofences: GeofenceRecord[];
  homeBases: HomeBaseRecord[];
  drones: DroneRecord[];
  swarmGroups: SwarmGroup[];
  embedded?: boolean;
  onCreateGeofence: (name: string, polygon: Array<{ lat: number; lon: number }>) => void;
  onCreateHomeBase: (
    name: string,
    polygon: Array<{ lat: number; lon: number }>,
    swarmGroupId?: string,
    homeAlt?: number
  ) => void;
  onToggleGeofence: (id: string, isActive: boolean) => void;
  onDeleteGeofence: (id: string) => void;
  onUpdateHomeBase: (
    id: string,
    patch: Partial<{
      name: string;
      polygon: Array<{ lat: number; lon: number }>;
      swarmGroupId: string | null;
      homeAlt: number;
      slots: HomeBaseSlot[] | null;
    }>
  ) => void;
  onDeleteHomeBase: (id: string) => void;
  drawingMode: boolean;
  drawingKind: "geofence" | "homeBase" | null;
  onToggleDrawing: (kind: "geofence" | "homeBase" | null) => void;
  drawPoints: Array<{ lat: number; lon: number }>;
}

interface SlotDraftState {
  sourceKey: string;
  slots: HomeBaseSlot[];
}

const cloneSlots = (slots: HomeBaseSlot[]): HomeBaseSlot[] => slots.map((slot) => ({ ...slot }));

export function GeofencePanel({
  geofences,
  homeBases,
  drones,
  swarmGroups,
  embedded = false,
  onCreateGeofence,
  onCreateHomeBase,
  onToggleGeofence,
  onDeleteGeofence,
  onUpdateHomeBase,
  onDeleteHomeBase,
  drawingMode,
  drawingKind,
  onToggleDrawing,
  drawPoints
}: GeofencePanelProps): JSX.Element {
  const [newGeofenceName, setNewGeofenceName] = useState("Geofence-1");
  const [newHomeBaseName, setNewHomeBaseName] = useState("HomeBase-1");
  const [newHomeBaseGroupId, setNewHomeBaseGroupId] = useState("");
  const [newHomeBaseAlt, setNewHomeBaseAlt] = useState(0);
  const [slotDrafts, setSlotDrafts] = useState<Record<string, SlotDraftState>>({});

  const activeGroups = useMemo(
    () => swarmGroups.filter((group) => group.state !== "DISBANDING"),
    [swarmGroups]
  );
  const groupsById = useMemo(
    () => new Map(activeGroups.map((group) => [group.id, group])),
    [activeGroups]
  );
  const dronesById = useMemo(
    () => new Map(drones.map((drone) => [drone.id, drone])),
    [drones]
  );

  useEffect(() => {
    setSlotDrafts((current) => {
      const next: Record<string, SlotDraftState> = {};
      for (const base of homeBases) {
        const sourceKey = `${base.updatedAt ?? ""}:${JSON.stringify(base.slots)}`;
        const existing = current[base.id];
        next[base.id] = existing && existing.sourceKey === sourceKey
          ? existing
          : {
              sourceKey,
              slots: cloneSlots(base.slots)
            };
      }
      return next;
    });
  }, [homeBases]);

  const updateSlotDraft = (baseId: string, index: number, field: "lat" | "lon", value: number) => {
    setSlotDrafts((current) => {
      const existing = current[baseId];
      if (!existing) {
        return current;
      }
      const slots = cloneSlots(existing.slots);
      slots[index] = {
        ...slots[index],
        [field]: value
      };
      return {
        ...current,
        [baseId]: {
          ...existing,
          slots
        }
      };
    });
  };

  return (
    <section className={embedded ? "flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3" : "panel flex flex-col gap-3 overflow-hidden p-3"}>
      {!embedded ? (
        <div className="flex items-center justify-between">
          <h3 className="panel-title text-[11px]">Airspace Areas</h3>
          <span className="text-[10px] text-cyan-100/50">
            {geofences.length} geofences | {homeBases.length} home bases
          </span>
        </div>
      ) : null}

      <div className="custom-scrollbar max-h-[110px] min-h-0 space-y-1 overflow-auto">
        <div className="mb-1 text-[9px] uppercase tracking-[0.12em] text-cyan-100/45">Geofences</div>
        {geofences.map((gf) => (
          <div key={gf.id} className="flex items-center gap-2 rounded border border-cyan-300/15 bg-bg-900/60 px-2 py-1.5">
            <label className="flex items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={gf.isActive}
                onChange={(e) => onToggleGeofence(gf.id, e.target.checked)}
                className="accent-accent-green"
              />
              <span className={gf.isActive ? "text-white" : "text-cyan-100/50"}>{gf.name}</span>
            </label>
            <span className="ml-auto text-[9px] text-cyan-100/40">{gf.polygon.length} pts</span>
            <button
              className="text-[10px] text-accent-red/70 hover:text-accent-red"
              onClick={() => onDeleteGeofence(gf.id)}
            >
              ×
            </button>
          </div>
        ))}
        {geofences.length === 0 && (
          <div className="text-[11px] text-cyan-100/40">No geofences.</div>
        )}
      </div>

      <div className="rounded border border-cyan-300/12 bg-bg-900/45 p-2">
        <div className="mb-2 text-[9px] uppercase tracking-[0.12em] text-cyan-100/45">Create Geofence</div>
        <input
          className="input text-[11px]"
          value={newGeofenceName}
          onChange={(e) => setNewGeofenceName(e.target.value)}
          placeholder="Geofence name"
        />
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            className={drawingMode && drawingKind === "geofence" ? "btn-danger text-[10px]" : "btn-secondary text-[10px]"}
            onClick={() => onToggleDrawing(drawingMode && drawingKind === "geofence" ? null : "geofence")}
          >
            {drawingMode && drawingKind === "geofence" ? `Drawing (${drawPoints.length} pts)` : "Draw Geofence"}
          </button>
          <button
            className="btn-primary text-[10px]"
            disabled={drawPoints.length < 3 || drawingKind !== "geofence"}
            onClick={() => {
              onCreateGeofence(newGeofenceName, drawPoints);
              setNewGeofenceName(`Geofence-${geofences.length + 2}`);
            }}
          >
            Save Geofence
          </button>
        </div>
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-auto">
        <div className="mb-1 text-[9px] uppercase tracking-[0.12em] text-cyan-100/45">Home Bases</div>
        {homeBases.map((base) => {
          const group = base.swarmGroupId ? groupsById.get(base.swarmGroupId) : undefined;
          const draft = slotDrafts[base.id]?.slots ?? base.slots;
          const draftChanged = JSON.stringify(draft) !== JSON.stringify(base.slots);

          return (
            <div key={base.id} className="rounded border border-red-400/20 bg-[rgba(48,10,10,0.35)] px-2 py-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-white">{base.name}</span>
                <span className="rounded border border-red-300/20 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.12em] text-red-100/70">
                  {draft.length} slots
                </span>
                <span className="ml-auto text-[9px] text-cyan-100/40">{base.polygon.length} pts</span>
                <button
                  className="text-[10px] text-accent-red/70 hover:text-accent-red"
                  onClick={() => onDeleteHomeBase(base.id)}
                >
                  ×
                </button>
              </div>
              <div className="mt-1 text-[10px] text-red-100/60">
                {group ? `Assigned to ${group.name}` : "No swarm group assigned"}
              </div>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_72px] gap-1.5">
                <select
                  className="input text-[10px]"
                  value={base.swarmGroupId ?? ""}
                  onChange={(e) => onUpdateHomeBase(base.id, { swarmGroupId: e.target.value || null })}
                >
                  <option value="">Unassigned</option>
                  {activeGroups.map((activeGroup) => (
                    <option key={activeGroup.id} value={activeGroup.id}>
                      {activeGroup.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={-100}
                  max={10000}
                  className="input text-[10px]"
                  value={base.homeAlt}
                  onChange={(e) => onUpdateHomeBase(base.id, { homeAlt: Number(e.target.value) })}
                />
              </div>

              {draft.length > 0 ? (
                <div className="mt-2 rounded border border-red-300/12 bg-black/15 p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="text-[9px] uppercase tracking-[0.12em] text-red-100/55">Assigned Slots</div>
                    <div className="flex gap-1.5">
                      <button
                        className="btn-secondary px-2 py-1 text-[9px]"
                        onClick={() => onUpdateHomeBase(base.id, { slots: null })}
                      >
                        Auto Pack
                      </button>
                      <button
                        className="btn-primary px-2 py-1 text-[9px]"
                        disabled={!draftChanged}
                        onClick={() => onUpdateHomeBase(base.id, { slots: draft })}
                      >
                        Save Slots
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {draft.map((slot, index) => {
                      const drone = dronesById.get(slot.droneId);
                      return (
                        <div key={slot.droneId} className="grid grid-cols-[90px_minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
                          <div className="flex items-center text-[10px] text-white">
                            {drone?.name ?? slot.droneId}
                          </div>
                          <input
                            type="number"
                            step="0.000001"
                            className="input text-[10px]"
                            value={slot.lat}
                            onChange={(e) => updateSlotDraft(base.id, index, "lat", Number(e.target.value))}
                          />
                          <input
                            type="number"
                            step="0.000001"
                            className="input text-[10px]"
                            value={slot.lon}
                            onChange={(e) => updateSlotDraft(base.id, index, "lon", Number(e.target.value))}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : group ? (
                <div className="mt-2 rounded border border-red-300/12 bg-black/15 px-2 py-1.5 text-[10px] text-red-100/55">
                  No slots generated yet. Assigning or re-packing this home base will generate one slot per drone in the group.
                </div>
              ) : null}
            </div>
          );
        })}
        {homeBases.length === 0 && (
          <div className="text-[11px] text-cyan-100/40">No home bases.</div>
        )}
      </div>

      <div className="rounded border border-red-400/20 bg-[rgba(48,10,10,0.35)] p-2">
        <div className="mb-2 text-[9px] uppercase tracking-[0.12em] text-red-200/70">Create Home Base</div>
        <div className="space-y-2">
          <input
            className="input text-[11px]"
            value={newHomeBaseName}
            onChange={(e) => setNewHomeBaseName(e.target.value)}
            placeholder="Home base name"
          />
          <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-1.5">
            <select
              className="input text-[10px]"
              value={newHomeBaseGroupId}
              onChange={(e) => setNewHomeBaseGroupId(e.target.value)}
            >
              <option value="">Assign later</option>
              {activeGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={-100}
              max={10000}
              className="input text-[10px]"
              value={newHomeBaseAlt}
              onChange={(e) => setNewHomeBaseAlt(Number(e.target.value))}
            />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              className={drawingMode && drawingKind === "homeBase" ? "btn-danger text-[10px]" : "btn-secondary text-[10px]"}
              onClick={() => onToggleDrawing(drawingMode && drawingKind === "homeBase" ? null : "homeBase")}
            >
              {drawingMode && drawingKind === "homeBase" ? `Drawing (${drawPoints.length} pts)` : "Draw Home Base"}
            </button>
            <button
              className="btn-primary text-[10px]"
              disabled={drawPoints.length < 3 || drawingKind !== "homeBase"}
              onClick={() => {
                onCreateHomeBase(newHomeBaseName, drawPoints, newHomeBaseGroupId || undefined, newHomeBaseAlt);
                setNewHomeBaseName(`HomeBase-${homeBases.length + 2}`);
                setNewHomeBaseGroupId("");
              }}
            >
              Save Home Base
            </button>
          </div>
          <div className="text-[10px] text-red-100/55">
            Home bases render in red, keep one saved slot per assigned drone, and feed those distributed positions back into normal RTL behavior.
          </div>
        </div>
      </div>
    </section>
  );
}
