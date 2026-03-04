import { useEffect, useState } from "react";
import clsx from "clsx";
import type { DroneRecord, DroneTelemetry, ScenarioPreset } from "../types/domain";
import type { SwarmGroup, SwarmState } from "../store/useGroundControlStore";
import { MAX_MANEUVER_SPEED_MPH, mphToMps, mpsToMph } from "../lib/speedUnits";
import { FormationPicker, type FormationName } from "./swarm/FormationPicker";
import { ManeuverControls, type ManeuverType } from "./swarm/ManeuverControls";

export type { SwarmGroup };

type PanelTab = "groups" | "create" | "presets";

interface SwarmManagerPanelProps {
  drones: DroneRecord[];
  telemetryByDrone: Record<string, DroneTelemetry>;
  swarmGroups: SwarmGroup[];
  onCreateGroup: (group: {
    name: string;
    leaderId: string;
    followerIds: string[];
    formation: string;
    spacing: number;
    headingDeg: number;
    altOffset: number;
  }) => Promise<SwarmGroup | void>;
  onDeleteGroup: (groupId: string) => void;
  onDisengageGroup: (groupId: string) => void;
  onEngageGroup: (groupId: string) => void;
  onUpdateGroup: (groupId: string, patch: { formation?: string; spacing?: number; headingDeg?: number; altOffset?: number }) => void;
  onStartManeuver: (groupId: string, type: string, params: Record<string, unknown>) => void;
  onStopManeuver: (groupId: string) => void;
  onFetchPresets: () => Promise<ScenarioPreset[]>;
  onUpdatePreset: (
    presetId: string,
    patch: {
      formation: string;
      spacing: number;
      headingDeg: number;
      altOffset: number;
      maneuverParams?: Record<string, unknown>;
    }
  ) => Promise<ScenarioPreset>;
  onResetPreset: (presetId: string) => Promise<ScenarioPreset>;
}

const STATE_CONFIG: Record<SwarmState, { label: string; color: string; bg: string; dot: string }> = {
  IDLE: { label: "IDLE", color: "text-cyan-100/60", bg: "bg-cyan-100/8 border-cyan-300/15", dot: "bg-cyan-100/40" },
  FORMING: { label: "FORMING", color: "text-amber-400", bg: "bg-amber-400/8 border-amber-400/25", dot: "bg-amber-400" },
  IN_FORMATION: { label: "IN FORMATION", color: "text-accent-green", bg: "bg-accent-green/8 border-accent-green/25", dot: "bg-accent-green" },
  MANEUVERING: { label: "MANEUVERING", color: "text-accent-cyan", bg: "bg-accent-cyan/8 border-accent-cyan/25", dot: "bg-accent-cyan" },
  DISBANDING: { label: "DISBANDING", color: "text-red-400", bg: "bg-red-400/8 border-red-400/25", dot: "bg-red-400" }
};

const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  military: "Military",
  sar: "SAR",
  film: "Film",
  security: "Security",
  mapping: "Mapping",
  geometric: "Geometric",
  cinematic: "Cinematic",
  "3d": "3D"
};

function QualityBar({ quality }: { quality: number }) {
  const color = quality >= 80 ? "from-accent-green/60 to-accent-green" :
                quality >= 50 ? "from-amber-400/60 to-amber-400" :
                "from-red-400/60 to-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-900/60">
        <div
          className={clsx("h-full rounded-full bg-gradient-to-r transition-all duration-500", color)}
          style={{ width: `${quality}%` }}
        />
      </div>
      <span className={clsx(
        "font-mono text-[11px] font-semibold",
        quality >= 80 ? "text-accent-green" : quality >= 50 ? "text-amber-400" : "text-red-400"
      )}>
        {quality}%
      </span>
    </div>
  );
}

function SliderControl({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[11px] text-cyan-100/60">{label}</span>
      <div className="flex flex-1 items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(+e.target.value)}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-cyan-300/10 accent-accent-cyan
                     [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-cyan
                     [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(61,224,255,0.4)]"
        />
        <span className="w-14 text-right font-mono text-[11px] text-white">{value}{unit}</span>
      </div>
    </div>
  );
}

function numericParam(params: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const raw = params?.[key];
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function stringParam(params: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const raw = params?.[key];
  return typeof raw === "string" && raw.length > 0 ? raw : fallback;
}

export function SwarmManagerPanel({
  drones,
  telemetryByDrone,
  swarmGroups,
  onCreateGroup,
  onDeleteGroup,
  onDisengageGroup,
  onEngageGroup,
  onUpdateGroup,
  onStartManeuver,
  onStopManeuver,
  onFetchPresets,
  onUpdatePreset,
  onResetPreset
}: SwarmManagerPanelProps): JSX.Element {
  const [tab, setTab] = useState<PanelTab>("groups");
  const [groupName, setGroupName] = useState("Alpha Group");
  const [leaderId, setLeaderId] = useState("");
  const [selectedFollowers, setSelectedFollowers] = useState<Set<string>>(new Set());
  const [formation, setFormation] = useState<FormationName>("triangle");
  const [spacing, setSpacing] = useState(15);
  const [headingDeg, setHeadingDeg] = useState(0);
  const [altOffset, setAltOffset] = useState(0);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [presets, setPresets] = useState<ScenarioPreset[]>([]);
  const [presetCategory, setPresetCategory] = useState<string>("all");
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetDraft, setPresetDraft] = useState<ScenarioPreset | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  const [createError, setCreateError] = useState<string>("");

  useEffect(() => {
    if (tab === "presets" && presets.length === 0) {
      onFetchPresets().then(setPresets).catch(() => {});
    }
  }, [tab, presets.length, onFetchPresets]);

  const availableDrones = drones.filter((d) => {
    const inGroup = swarmGroups.some(
      (g) => g.leaderId === d.id || g.followerIds.includes(d.id)
    );
    return !inGroup;
  });

  const toggleFollower = (droneId: string) => {
    const next = new Set(selectedFollowers);
    if (next.has(droneId)) next.delete(droneId);
    else next.add(droneId);
    setSelectedFollowers(next);
  };

  const selectAllFollowers = () => {
    const all = new Set(
      availableDrones.filter((d) => d.id !== leaderId).map((d) => d.id)
    );
    setSelectedFollowers(all);
  };

  const deselectAllFollowers = () => {
    setSelectedFollowers(new Set());
  };

  const handleCreate = async (engage: boolean) => {
    const normalizedName = groupName.trim();
    const normalizedLeaderId = leaderId.trim();
    const normalizedFollowerIds = [...selectedFollowers].filter((id) => id && id !== normalizedLeaderId);
    const normalizedSpacing = Number.isFinite(spacing) ? Math.max(3, Math.min(200, spacing)) : 15;
    const normalizedHeadingDeg = Number.isFinite(headingDeg) ? Math.max(0, Math.min(360, headingDeg)) : 0;
    const normalizedAltOffset = Number.isFinite(altOffset) ? Math.max(-50, Math.min(50, altOffset)) : 0;

    if (!normalizedName) {
      setCreateError("Group name is required");
      return;
    }
    if (!normalizedLeaderId) {
      setCreateError("Select a leader drone");
      return;
    }
    if (normalizedFollowerIds.length === 0) {
      setCreateError("Select at least one follower drone");
      return;
    }

    setCreateError("");

    try {
      const created = await onCreateGroup({
        name: normalizedName,
        leaderId: normalizedLeaderId,
        followerIds: normalizedFollowerIds,
        formation,
        spacing: normalizedSpacing,
        headingDeg: normalizedHeadingDeg,
        altOffset: normalizedAltOffset
      });
      if (engage && created?.id) {
        onEngageGroup(created.id);
      }
      setGroupName(`Group ${swarmGroups.length + 2}`);
      setLeaderId("");
      setSelectedFollowers(new Set());
      setTab("groups");
    } catch (error) {
      setCreateError((error as Error).message);
    }
  };

  const filteredPresets = presetCategory === "all"
    ? presets
    : presets.filter((p) => p.category === presetCategory);

  const categories = ["all", ...new Set(presets.map((p) => p.category))];

  const startPresetEdit = (preset: ScenarioPreset) => {
    setEditingPresetId(preset.id);
    setPresetDraft({
      ...preset,
      maneuverParams: preset.maneuverParams ? { ...preset.maneuverParams } : undefined
    });
  };

  const updatePresetDraft = (patch: Partial<ScenarioPreset>) => {
    setPresetDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const updatePresetDraftManeuver = (key: string, value: unknown) => {
    setPresetDraft((current) =>
      current
        ? {
            ...current,
            maneuverParams: {
              ...(current.maneuverParams ?? {}),
              [key]: value
            }
          }
        : current
    );
  };

  const savePresetDraft = async () => {
    if (!presetDraft) {
      return;
    }

    setPresetBusy(true);
    try {
      const updated = await onUpdatePreset(presetDraft.id, {
        formation: presetDraft.formation,
        spacing: presetDraft.spacing,
        headingDeg: presetDraft.headingDeg,
        altOffset: presetDraft.altOffset,
        maneuverParams: presetDraft.maneuverParams
      });
      setPresets((current) => current.map((preset) => (preset.id === updated.id ? updated : preset)));
      setPresetDraft(updated);
    } finally {
      setPresetBusy(false);
    }
  };

  const resetPresetDraft = async (presetId: string) => {
    setPresetBusy(true);
    try {
      const resetPreset = await onResetPreset(presetId);
      setPresets((current) => current.map((preset) => (preset.id === resetPreset.id ? resetPreset : preset)));
      setEditingPresetId(presetId);
      setPresetDraft({
        ...resetPreset,
        maneuverParams: resetPreset.maneuverParams ? { ...resetPreset.maneuverParams } : undefined
      });
    } finally {
      setPresetBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* ── Tab Bar ── */}
      <div className="flex shrink-0 border-b border-cyan-300/15 bg-bg-900/40">
        {(["groups", "create", "presets"] as PanelTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "relative flex-1 px-4 py-2.5 font-[Orbitron] text-[11px] uppercase tracking-[0.14em] transition",
              tab === t
                ? "text-accent-cyan"
                : "text-cyan-100/40 hover:text-cyan-100/70"
            )}
          >
            {t === "groups" ? "Groups" : t === "create" ? "Create" : "Presets"}
            {tab === t && (
              <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-accent-cyan shadow-[0_0_8px_rgba(61,224,255,0.4)]" />
            )}
            {t === "groups" && swarmGroups.length > 0 && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent-cyan/15 text-[9px] text-accent-cyan">
                {swarmGroups.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="custom-scrollbar min-h-0 flex-1 overflow-auto p-4">

        {/* ════════════ GROUPS TAB ════════════ */}
        {tab === "groups" && (
          <div className="space-y-2.5">
            {swarmGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-cyan-300/15 bg-bg-900/60 text-2xl text-cyan-100/20">
                  ⬡
                </div>
                <div className="text-center">
                  <div className="text-[13px] text-cyan-100/50">No swarm groups</div>
                  <div className="mt-1 text-[11px] text-cyan-100/30">
                    Create a group to coordinate drone formations
                  </div>
                </div>
                <button className="btn-secondary mt-1" onClick={() => setTab("create")}>
                  Create Group
                </button>
              </div>
            ) : (
              swarmGroups.map((group) => {
                const leaderDrone = drones.find((d) => d.id === group.leaderId);
                const isExpanded = expandedGroupId === group.id;
                const isActive = group.state === "IN_FORMATION" || group.state === "MANEUVERING";
                const stateConfig = STATE_CONFIG[group.state];

                return (
                  <div
                    key={group.id}
                    className={clsx(
                      "rounded border transition",
                      isExpanded
                        ? "border-cyan-300/25 bg-[rgba(8,19,37,0.82)]"
                        : "border-cyan-300/12 bg-[rgba(5,18,33,0.82)] hover:border-cyan-300/20"
                    )}
                  >
                    {/* Group header */}
                    <button
                      className="flex w-full items-center gap-3 p-3 text-left"
                      onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
                    >
                      {/* State indicator dot */}
                      <div className={clsx(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        stateConfig.dot,
                        (group.state === "FORMING" || group.state === "MANEUVERING") && "animate-pulse"
                      )} />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-white">{group.name}</span>
                          <span className={clsx(
                            "shrink-0 rounded border px-1.5 py-0.5 font-[Orbitron] text-[8px] uppercase tracking-wider",
                            stateConfig.color, stateConfig.bg
                          )}>
                            {stateConfig.label}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-cyan-100/50">
                          <span className="text-accent-amber">{leaderDrone?.name ?? group.leaderId}</span>
                          <span className="text-cyan-100/20">+</span>
                          <span>{group.followerIds.length} followers</span>
                          <span className="text-cyan-100/15">|</span>
                          <span className="font-[Orbitron] text-[9px] uppercase tracking-wider text-cyan-100/40">{group.formation}</span>
                        </div>
                      </div>

                      {/* Quality indicator (compact) */}
                      {group.formationQuality !== undefined && group.state !== "IDLE" && (
                        <div className="shrink-0 text-right">
                          <span className={clsx(
                            "font-mono text-[14px] font-bold",
                            group.formationQuality >= 80 ? "text-accent-green" :
                            group.formationQuality >= 50 ? "text-amber-400" : "text-red-400"
                          )}>
                            {group.formationQuality}
                          </span>
                          <span className="text-[9px] text-cyan-100/30">%</span>
                        </div>
                      )}

                      {/* Chevron */}
                      <svg className={clsx("h-4 w-4 shrink-0 text-cyan-100/30 transition", isExpanded && "rotate-180")} viewBox="0 0 16 16">
                        <path d="M3 5.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t border-cyan-300/10 p-3 space-y-3">

                        {/* Formation quality bar */}
                        {group.formationQuality !== undefined && group.state !== "IDLE" && (
                          <div>
                            <div className="mb-1.5 font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/40">
                              Formation Quality
                            </div>
                            <QualityBar quality={group.formationQuality} />
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          {group.state === "IDLE" && (
                            <>
                              <button className="btn-primary flex-1" onClick={() => onEngageGroup(group.id)}>
                                Engage
                              </button>
                              <button className="btn-danger flex-1" onClick={() => onDeleteGroup(group.id)}>
                                Delete
                              </button>
                            </>
                          )}
                          {group.state === "FORMING" && (
                            <button className="btn-danger flex-1" onClick={() => onDisengageGroup(group.id)}>
                              Disengage
                            </button>
                          )}
                          {isActive && (
                            <button className="btn-danger flex-1" onClick={() => onDisengageGroup(group.id)}>
                              Disengage
                            </button>
                          )}
                        </div>

                        {/* Live formation controls */}
                        {isActive && (
                          <div className="space-y-2">
                            <div className="font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/40">
                              Live Controls
                            </div>
                            <div className="rounded border border-cyan-300/10 bg-[rgba(4,15,28,0.75)] p-3 space-y-2.5">
                              <SliderControl label="Spacing" value={group.spacing} onChange={(v) => onUpdateGroup(group.id, { spacing: v })} min={3} max={200} unit="m" />
                              <SliderControl label="Heading" value={group.headingDeg} onChange={(v) => onUpdateGroup(group.id, { headingDeg: v })} min={0} max={360} unit="°" />
                            </div>
                          </div>
                        )}

                        {/* Maneuver controls */}
                        {group.state === "IN_FORMATION" && (
                          <div>
                            <div className="mb-2 font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/40">
                              Maneuvers
                            </div>
                            <ManeuverControls
                              onStartManeuver={(type, params) => onStartManeuver(group.id, type, params)}
                              onStopManeuver={() => onStopManeuver(group.id)}
                            />
                          </div>
                        )}

                        {group.state === "MANEUVERING" && group.maneuver && (
                          <div>
                            <div className="mb-2 font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/40">
                              Active Maneuver
                            </div>
                            <ManeuverControls
                              activeManeuver={group.maneuver}
                              maneuverProgress={undefined}
                              onStartManeuver={(type, params) => onStartManeuver(group.id, type, params)}
                              onStopManeuver={() => onStopManeuver(group.id)}
                            />
                          </div>
                        )}

                        {/* Follower list */}
                        <div>
                          <div className="mb-1.5 font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/40">
                            Followers ({group.followerIds.length})
                          </div>
                          <div className="rounded border border-cyan-300/8 bg-[rgba(4,15,28,0.5)] divide-y divide-cyan-300/6">
                            {group.followerIds.map((fid) => {
                              const d = drones.find((dr) => dr.id === fid);
                              const t = telemetryByDrone[fid];
                              const state = t?.flightState ?? "offline";
                              const stateColor = state === "airborne" ? "text-accent-green" :
                                                 state === "grounded" ? "text-cyan-100/40" :
                                                 state === "taking_off" ? "text-amber-400" : "text-cyan-100/30";
                              return (
                                <div key={fid} className="flex items-center justify-between px-3 py-1.5">
                                  <div className="flex items-center gap-2">
                                    <div className={clsx("h-1.5 w-1.5 rounded-full", stateColor.replace("text-", "bg-"))} />
                                    <span className="text-[12px] text-white">{d?.name ?? fid}</span>
                                  </div>
                                  <span className={clsx("text-[10px] uppercase", stateColor)}>{state}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ════════════ CREATE TAB ════════════ */}
        {tab === "create" && (
          <div className="space-y-4">
            <div className="rounded border border-cyan-300/10 bg-[rgba(4,15,28,0.72)] px-3 py-2 text-[11px] leading-relaxed text-cyan-100/55">
              Create the swarm group here. Then assign that group plus a preset to a mission waypoint in the waypoint editor so the swarm event triggers at a real location.
            </div>
            {createError ? (
              <div className="rounded border border-red-400/20 bg-red-400/8 px-3 py-2 text-[11px] text-red-200">
                {createError}
              </div>
            ) : null}

            {/* Group name */}
            <div>
              <label className="mb-1.5 block font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/50">
                Group Name
              </label>
              <input
                className="input"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Alpha Group"
              />
            </div>

            {/* Leader drone */}
            <div>
              <label className="mb-1.5 block font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/50">
                Leader Drone
              </label>
              <select
                className="input"
                value={leaderId}
                onChange={(e) => {
                  setLeaderId(e.target.value);
                  selectedFollowers.delete(e.target.value);
                  setSelectedFollowers(new Set(selectedFollowers));
                }}
              >
                <option value="">Select leader drone...</option>
                {availableDrones.map((d) => {
                  const t = telemetryByDrone[d.id];
                  const state = t?.flightState ?? "offline";
                  return (
                    <option key={d.id} value={d.id}>
                      {d.name} — {state}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Follower drones */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/50">
                  Followers ({selectedFollowers.size} selected)
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={selectAllFollowers}
                    className="text-[10px] text-accent-cyan hover:text-accent-cyan/80 transition"
                  >
                    Select All
                  </button>
                  <span className="text-cyan-100/15">|</span>
                  <button
                    onClick={deselectAllFollowers}
                    className="text-[10px] text-cyan-100/40 hover:text-cyan-100/60 transition"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="max-h-[180px] overflow-auto rounded border border-cyan-300/15 bg-[rgba(2,11,22,0.88)] divide-y divide-cyan-300/6">
                {availableDrones
                  .filter((d) => d.id !== leaderId)
                  .map((d) => {
                    const t = telemetryByDrone[d.id];
                    const state = t?.flightState ?? "offline";
                    const isChecked = selectedFollowers.has(d.id);
                    return (
                      <button
                        key={d.id}
                        onClick={() => toggleFollower(d.id)}
                        className={clsx(
                          "flex w-full items-center gap-3 px-3 py-2 text-left transition",
                          isChecked
                            ? "bg-accent-cyan/5"
                            : "hover:bg-cyan-300/3"
                        )}
                      >
                        {/* Custom checkbox */}
                        <div className={clsx(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition",
                          isChecked
                            ? "border-accent-cyan bg-accent-cyan/20"
                            : "border-cyan-300/25 bg-transparent"
                        )}>
                          {isChecked && (
                            <svg className="h-3 w-3 text-accent-cyan" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-[12px] font-medium text-white">{d.name}</span>
                        </div>
                        <span className={clsx(
                          "shrink-0 text-[10px] uppercase",
                          state === "airborne" ? "text-accent-green" :
                          state === "grounded" ? "text-cyan-100/40" : "text-cyan-100/30"
                        )}>
                          {state}
                        </span>
                      </button>
                    );
                  })}
                {availableDrones.filter((d) => d.id !== leaderId).length === 0 && (
                  <div className="px-3 py-4 text-center text-[11px] text-cyan-100/30">
                    {leaderId ? "No additional drones available" : "Select a leader first"}
                  </div>
                )}
              </div>
            </div>

            {/* Formation picker */}
            <div>
              <label className="mb-1.5 block font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/50">
                Formation
              </label>
              <FormationPicker
                value={formation}
                onChange={setFormation}
                droneCount={selectedFollowers.size}
                spacing={spacing}
              />
            </div>

            {/* Parameter sliders */}
            <div>
              <label className="mb-1.5 block font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/50">
                Parameters
              </label>
              <div className="rounded border border-cyan-300/10 bg-[rgba(4,15,28,0.75)] p-3 space-y-2.5">
                <SliderControl label="Spacing" value={spacing} onChange={setSpacing} min={3} max={200} unit="m" />
                <SliderControl label="Heading" value={headingDeg} onChange={setHeadingDeg} min={0} max={360} unit="°" />
                <SliderControl label="Alt Offset" value={altOffset} onChange={setAltOffset} min={-50} max={50} unit="m" />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <button
                className="btn-primary flex-1"
                onClick={() => {
                  handleCreate(true).catch(() => {});
                }}
                disabled={!leaderId || selectedFollowers.size === 0}
              >
                Create & Engage
              </button>
              <button
                className="btn-secondary flex-1"
                onClick={() => {
                  handleCreate(false).catch(() => {});
                }}
                disabled={!leaderId || selectedFollowers.size === 0}
              >
                Create Only
              </button>
            </div>
          </div>
        )}

        {/* ════════════ PRESETS TAB ════════════ */}
        {tab === "presets" && (
          <div className="space-y-3">
            <div className="rounded border border-accent-cyan/15 bg-accent-cyan/5 px-3 py-2 text-[11px] leading-relaxed text-cyan-100/58">
              Presets are templates, not auto-deploy actions. Pick one to prefill formation settings, create or choose the right swarm group, then bind that preset to a mission waypoint trigger.
            </div>

            {/* Category filter pills */}
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setPresetCategory(cat)}
                  className={clsx(
                    "rounded-full border px-3 py-1 font-[Orbitron] text-[9px] uppercase tracking-wider transition",
                    presetCategory === cat
                      ? "border-accent-cyan/40 bg-accent-cyan/12 text-accent-cyan shadow-[0_0_8px_rgba(61,224,255,0.1)]"
                      : "border-cyan-300/12 bg-transparent text-cyan-100/35 hover:border-cyan-300/25 hover:text-cyan-100/60"
                  )}
                >
                  {CATEGORY_LABELS[cat] ?? cat}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {filteredPresets.map((preset) => {
                const isEditing = editingPresetId === preset.id && presetDraft?.id === preset.id;
                const draft = isEditing ? presetDraft : null;

                return (
                  <div
                    key={preset.id}
                    className="rounded border border-cyan-300/12 bg-[rgba(5,18,33,0.82)] p-3 transition hover:border-cyan-300/20"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="text-[13px] font-semibold text-white">{preset.name}</div>
                          {preset.customized && (
                            <span className="rounded border border-amber-400/20 bg-amber-400/8 px-1.5 py-0.5 font-[Orbitron] text-[8px] uppercase tracking-wider text-amber-300">
                              Customized
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-relaxed text-cyan-100/50">{preset.description}</div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <span className="rounded border border-cyan-300/10 bg-bg-900/60 px-1.5 py-0.5 font-[Orbitron] text-[8px] uppercase tracking-wider text-cyan-100/40">
                            {preset.formation}
                          </span>
                          <span className="rounded border border-cyan-300/10 bg-bg-900/60 px-1.5 py-0.5 font-mono text-[9px] text-cyan-100/40">
                            {preset.spacing}m
                          </span>
                          <span className="rounded border border-cyan-300/10 bg-bg-900/60 px-1.5 py-0.5 font-mono text-[9px] text-cyan-100/40">
                            {preset.headingDeg}°
                          </span>
                          <span className="rounded border border-cyan-300/10 bg-bg-900/60 px-1.5 py-0.5 font-mono text-[9px] text-cyan-100/40">
                            alt {preset.altOffset}m
                          </span>
                          {preset.maneuver && (
                            <span className="rounded border border-accent-cyan/15 bg-accent-cyan/5 px-1.5 py-0.5 font-[Orbitron] text-[8px] uppercase tracking-wider text-accent-cyan/70">
                              {preset.maneuver}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          className="btn-secondary"
                          onClick={() => startPresetEdit(preset)}
                        >
                          Edit Defaults
                        </button>
                        <button
                          className="btn-primary"
                          onClick={() => {
                            setGroupName(preset.name);
                            setFormation(preset.formation as FormationName);
                            setSpacing(preset.spacing);
                            setHeadingDeg(preset.headingDeg);
                            setAltOffset(preset.altOffset);
                            setTab("create");
                          }}
                        >
                          Use Template
                        </button>
                      </div>
                    </div>

                    {isEditing && draft && (
                      <div className="mt-3 space-y-3 border-t border-cyan-300/10 pt-3">
                        <div className="font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/40">
                          Default Formation
                        </div>
                        <FormationPicker
                          value={draft.formation as FormationName}
                          onChange={(value) => updatePresetDraft({ formation: value })}
                          droneCount={4}
                          spacing={draft.spacing}
                        />

                        <div className="rounded border border-cyan-300/10 bg-[rgba(4,15,28,0.75)] p-3 space-y-2.5">
                          <SliderControl label="Spacing" value={draft.spacing} onChange={(value) => updatePresetDraft({ spacing: value })} min={3} max={200} unit="m" />
                          <SliderControl label="Heading" value={draft.headingDeg} onChange={(value) => updatePresetDraft({ headingDeg: value })} min={0} max={360} unit="°" />
                          <SliderControl label="Alt Offset" value={draft.altOffset} onChange={(value) => updatePresetDraft({ altOffset: value })} min={-50} max={50} unit="m" />
                        </div>

                        {draft.maneuver ? (
                          <div className="space-y-2">
                            <div className="font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/40">
                              Default Maneuver Params
                            </div>
                            <div className="rounded border border-cyan-300/10 bg-[rgba(4,15,28,0.75)] p-3 space-y-2.5">
                              {draft.maneuver === "orbit" && (
                                <>
                                  <SliderControl
                                    label="Radius"
                                    value={numericParam(draft.maneuverParams, "radius", 120)}
                                    onChange={(value) => updatePresetDraftManeuver("radius", value)}
                                    min={20}
                                    max={300}
                                    unit="m"
                                  />
                                  <SliderControl
                                    label="Speed"
                                    value={Math.round(mpsToMph(numericParam(draft.maneuverParams, "speed", 6)))}
                                    onChange={(value) => updatePresetDraftManeuver("speed", mphToMps(value))}
                                    min={5}
                                    max={MAX_MANEUVER_SPEED_MPH}
                                    unit="mph"
                                  />
                                  <SliderControl
                                    label="Duration"
                                    value={numericParam(draft.maneuverParams, "durationSec", 18)}
                                    onChange={(value) => updatePresetDraftManeuver("durationSec", value)}
                                    min={5}
                                    max={120}
                                    unit="s"
                                  />
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="shrink-0 text-[11px] text-cyan-100/60">Direction</span>
                                    <select
                                      className="input max-w-[150px] text-[11px]"
                                      value={stringParam(draft.maneuverParams, "direction", "cw")}
                                      onChange={(event) => updatePresetDraftManeuver("direction", event.target.value)}
                                    >
                                      <option value="cw">Clockwise</option>
                                      <option value="ccw">Counter-Clockwise</option>
                                    </select>
                                  </div>
                                </>
                              )}

                              {draft.maneuver === "fibonacci_orbit" && (
                                <>
                                  <SliderControl
                                    label="Max Radius"
                                    value={numericParam(draft.maneuverParams, "maxRadius", 110)}
                                    onChange={(value) => updatePresetDraftManeuver("maxRadius", value)}
                                    min={30}
                                    max={300}
                                    unit="m"
                                  />
                                  <SliderControl
                                    label="Speed"
                                    value={Math.round(mpsToMph(numericParam(draft.maneuverParams, "speed", 4)))}
                                    onChange={(value) => updatePresetDraftManeuver("speed", mphToMps(value))}
                                    min={5}
                                    max={MAX_MANEUVER_SPEED_MPH}
                                    unit="mph"
                                  />
                                  <SliderControl
                                    label="Duration"
                                    value={numericParam(draft.maneuverParams, "durationSec", 22)}
                                    onChange={(value) => updatePresetDraftManeuver("durationSec", value)}
                                    min={5}
                                    max={120}
                                    unit="s"
                                  />
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="shrink-0 text-[11px] text-cyan-100/60">Direction</span>
                                    <select
                                      className="input max-w-[150px] text-[11px]"
                                      value={stringParam(draft.maneuverParams, "direction", "cw")}
                                      onChange={(event) => updatePresetDraftManeuver("direction", event.target.value)}
                                    >
                                      <option value="cw">Clockwise</option>
                                      <option value="ccw">Counter-Clockwise</option>
                                    </select>
                                  </div>
                                </>
                              )}

                              {draft.maneuver === "perimeter" && (
                                <>
                                  <SliderControl
                                    label="Radius"
                                    value={numericParam(draft.maneuverParams, "radius", 100)}
                                    onChange={(value) => updatePresetDraftManeuver("radius", value)}
                                    min={20}
                                    max={400}
                                    unit="m"
                                  />
                                  <SliderControl
                                    label="Speed"
                                    value={Math.round(mpsToMph(numericParam(draft.maneuverParams, "speed", 4)))}
                                    onChange={(value) => updatePresetDraftManeuver("speed", mphToMps(value))}
                                    min={5}
                                    max={MAX_MANEUVER_SPEED_MPH}
                                    unit="mph"
                                  />
                                  <SliderControl
                                    label="Duration"
                                    value={numericParam(draft.maneuverParams, "durationSec", 24)}
                                    onChange={(value) => updatePresetDraftManeuver("durationSec", value)}
                                    min={5}
                                    max={180}
                                    unit="s"
                                  />
                                </>
                              )}

                              {draft.maneuver === "search_grid" && (
                                <>
                                  <SliderControl
                                    label="Width"
                                    value={numericParam(draft.maneuverParams, "width", 400)}
                                    onChange={(value) => updatePresetDraftManeuver("width", value)}
                                    min={50}
                                    max={1000}
                                    step={10}
                                    unit="m"
                                  />
                                  <SliderControl
                                    label="Height"
                                    value={numericParam(draft.maneuverParams, "height", 400)}
                                    onChange={(value) => updatePresetDraftManeuver("height", value)}
                                    min={50}
                                    max={1000}
                                    step={10}
                                    unit="m"
                                  />
                                  <SliderControl
                                    label="Speed"
                                    value={Math.round(mpsToMph(numericParam(draft.maneuverParams, "speed", 5)))}
                                    onChange={(value) => updatePresetDraftManeuver("speed", mphToMps(value))}
                                    min={5}
                                    max={MAX_MANEUVER_SPEED_MPH}
                                    unit="mph"
                                  />
                                </>
                              )}

                              {draft.maneuver === "search_spiral" && (
                                <>
                                  <SliderControl
                                    label="Max Radius"
                                    value={numericParam(draft.maneuverParams, "maxRadius", 500)}
                                    onChange={(value) => updatePresetDraftManeuver("maxRadius", value)}
                                    min={50}
                                    max={1000}
                                    step={10}
                                    unit="m"
                                  />
                                  <SliderControl
                                    label="Speed"
                                    value={Math.round(mpsToMph(numericParam(draft.maneuverParams, "speed", 5)))}
                                    onChange={(value) => updatePresetDraftManeuver("speed", mphToMps(value))}
                                    min={5}
                                    max={MAX_MANEUVER_SPEED_MPH}
                                    unit="mph"
                                  />
                                </>
                              )}

                              {draft.maneuver === "search_expanding_square" && (
                                <>
                                  <SliderControl
                                    label="Max Radius"
                                    value={numericParam(draft.maneuverParams, "maxRadius", 420)}
                                    onChange={(value) => updatePresetDraftManeuver("maxRadius", value)}
                                    min={50}
                                    max={1000}
                                    step={10}
                                    unit="m"
                                  />
                                  <SliderControl
                                    label="Leg Step"
                                    value={numericParam(draft.maneuverParams, "legSpacing", 90)}
                                    onChange={(value) => updatePresetDraftManeuver("legSpacing", value)}
                                    min={20}
                                    max={300}
                                    step={10}
                                    unit="m"
                                  />
                                  <SliderControl
                                    label="Speed"
                                    value={Math.round(mpsToMph(numericParam(draft.maneuverParams, "speed", 5)))}
                                    onChange={(value) => updatePresetDraftManeuver("speed", mphToMps(value))}
                                    min={5}
                                    max={MAX_MANEUVER_SPEED_MPH}
                                    unit="mph"
                                  />
                                </>
                              )}

                              {(draft.maneuver === "escort") && (
                                <SliderControl
                                  label="Duration"
                                  value={numericParam(draft.maneuverParams, "durationSec", 20)}
                                  onChange={(value) => updatePresetDraftManeuver("durationSec", value)}
                                  min={5}
                                  max={120}
                                  unit="s"
                                />
                              )}

                              {(draft.maneuver === "expand" || draft.maneuver === "contract") && (
                                <>
                                  <SliderControl
                                    label="Target"
                                    value={numericParam(draft.maneuverParams, "targetSpacing", 50)}
                                    onChange={(value) => updatePresetDraftManeuver("targetSpacing", value)}
                                    min={5}
                                    max={120}
                                    unit="m"
                                  />
                                  <SliderControl
                                    label="Duration"
                                    value={numericParam(draft.maneuverParams, "duration", 15)}
                                    onChange={(value) => updatePresetDraftManeuver("duration", value)}
                                    min={3}
                                    max={60}
                                    unit="s"
                                  />
                                </>
                              )}

                              {draft.maneuver === "corridor" && (
                                <>
                                  <SliderControl
                                    label="Width"
                                    value={numericParam(draft.maneuverParams, "width", 40)}
                                    onChange={(value) => updatePresetDraftManeuver("width", value)}
                                    min={10}
                                    max={200}
                                    unit="m"
                                  />
                                  <SliderControl
                                    label="Duration"
                                    value={numericParam(draft.maneuverParams, "durationSec", 20)}
                                    onChange={(value) => updatePresetDraftManeuver("durationSec", value)}
                                    min={5}
                                    max={120}
                                    unit="s"
                                  />
                                </>
                              )}

                              {draft.maneuver === "rotate" && (
                                <>
                                  <SliderControl
                                    label="Rot Speed"
                                    value={numericParam(draft.maneuverParams, "rotationSpeed", 30)}
                                    onChange={(value) => updatePresetDraftManeuver("rotationSpeed", value)}
                                    min={5}
                                    max={90}
                                    unit="d/s"
                                  />
                                  <SliderControl
                                    label="Duration"
                                    value={numericParam(draft.maneuverParams, "durationSec", 20)}
                                    onChange={(value) => updatePresetDraftManeuver("durationSec", value)}
                                    min={5}
                                    max={120}
                                    unit="s"
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="font-[Orbitron] text-[9px] uppercase tracking-[0.12em] text-cyan-100/40">
                              Trigger Behavior
                            </div>
                            <div className="rounded border border-cyan-300/10 bg-[rgba(4,15,28,0.75)] p-3 space-y-2.5">
                              <div className="text-[10px] text-cyan-100/45">
                                Formation-only presets hold the full swarm at the trigger point before resuming the mission.
                              </div>
                              <SliderControl
                                label="Hold Time"
                                value={numericParam(draft.maneuverParams, "durationSec", 18)}
                                onChange={(value) => updatePresetDraftManeuver("durationSec", value)}
                                min={5}
                                max={180}
                                unit="s"
                              />
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            className="btn-primary flex-1"
                            disabled={presetBusy}
                            onClick={() => {
                              savePresetDraft().catch(() => {});
                            }}
                          >
                            Save Defaults
                          </button>
                          <button
                            className="btn-secondary flex-1"
                            disabled={presetBusy}
                            onClick={() => {
                              resetPresetDraft(preset.id).catch(() => {});
                            }}
                          >
                            Reset
                          </button>
                          <button
                            className="btn-secondary flex-1"
                            disabled={presetBusy}
                            onClick={() => {
                              setEditingPresetId(null);
                              setPresetDraft(null);
                            }}
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredPresets.length === 0 && (
                <div className="py-8 text-center text-[11px] text-cyan-100/30">
                  No presets in this category
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
