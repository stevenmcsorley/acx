import clsx from "clsx";
import type {
  MissionWaypoint,
  ScenarioPreset,
  SwarmEventMode,
  SwarmPostAction,
  SwarmTriggerMode
} from "../types/domain";
import type { SwarmGroup } from "../store/useGroundControlStore";
import {
  defaultDurationForPreset,
  presetContextForEventMode,
  presetSupportsContext,
  supportsPresetStopRule
} from "../lib/swarmPresets";

type GroupCommand = "arm" | "disarm" | "takeoff" | "land" | "rtl";

interface SwarmGroupOpsProps {
  swarmGroups: SwarmGroup[];
  selectedDroneId: string | null;
  selectedWaypoint?: MissionWaypoint;
  selectedWaypointIndex?: number | null;
  eligibleMissionGroups: SwarmGroup[];
  swarmPresets: ScenarioPreset[];
  onUpdateSelectedWaypoint?: (patch: Partial<MissionWaypoint>) => void;
  onGroupCommand: (groupId: string, command: GroupCommand, params?: Record<string, unknown>) => void;
  onEngage: (groupId: string) => void;
  onDisengage: (groupId: string) => void;
}

function modeButtonClass(active: boolean): string {
  return active
    ? "border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan"
    : "border-cyan-300/15 text-cyan-100/50 hover:border-cyan-300/30";
}

export function SwarmGroupOps({
  swarmGroups,
  selectedDroneId,
  selectedWaypoint,
  selectedWaypointIndex = null,
  eligibleMissionGroups,
  swarmPresets,
  onUpdateSelectedWaypoint,
  onGroupCommand,
  onEngage,
  onDisengage
}: SwarmGroupOpsProps) {
  const activeGroups = swarmGroups.filter((group) => group.state !== "DISBANDING");
  const selectedEventMode = selectedWaypoint?.swarmTrigger?.eventMode ?? "transit";
  const presetContext = presetContextForEventMode(selectedEventMode);
  const eligiblePresets = swarmPresets.filter((preset) => presetSupportsContext(preset, presetContext));
  const selectedPreset = selectedWaypoint?.swarmTrigger
    ? swarmPresets.find((preset) => preset.id === selectedWaypoint.swarmTrigger?.presetId)
    : undefined;

  const updateSwarmTrigger = (patch: Partial<NonNullable<MissionWaypoint["swarmTrigger"]>>) => {
    if (!selectedWaypoint?.swarmTrigger || !onUpdateSelectedWaypoint) {
      return;
    }

    onUpdateSelectedWaypoint({
      swarmTrigger: {
        ...selectedWaypoint.swarmTrigger,
        ...patch
      }
    });
  };

  const enableSwarmTrigger = () => {
    if (!onUpdateSelectedWaypoint) {
      return;
    }

    const defaultGroup = eligibleMissionGroups[0];
    const defaultPreset = eligiblePresets[0];
    if (!defaultGroup || !defaultPreset) {
      return;
    }

    onUpdateSelectedWaypoint({
      swarmTrigger: {
        groupId: defaultGroup.id,
        presetId: defaultPreset.id,
        triggerMode: "waypoint_reached",
        eventMode: "transit",
        stopRule: supportsPresetStopRule(defaultPreset) ? "timer" : undefined,
        postAction: "resume",
        durationSec: defaultDurationForPreset(defaultPreset)
      }
    });
  };

  const setEventMode = (eventMode: SwarmEventMode) => {
    if (!selectedWaypoint?.swarmTrigger) {
      return;
    }

    const presetsForMode = swarmPresets.filter((preset) =>
      presetSupportsContext(preset, presetContextForEventMode(eventMode))
    );
    const nextPreset =
      selectedPreset && presetSupportsContext(selectedPreset, presetContextForEventMode(eventMode))
        ? selectedPreset
        : presetsForMode[0];

    updateSwarmTrigger({
      eventMode,
      presetId: nextPreset?.id ?? selectedWaypoint.swarmTrigger.presetId,
      stopRule: supportsPresetStopRule(nextPreset) ? (selectedWaypoint.swarmTrigger.stopRule ?? "timer") : undefined,
      postAction: eventMode === "final_destination" ? (selectedWaypoint.swarmTrigger.postAction ?? "hold") : "resume",
      durationSec: defaultDurationForPreset(nextPreset),
      maneuverOverrides: nextPreset?.id === selectedPreset?.id ? selectedWaypoint.swarmTrigger.maneuverOverrides : undefined
    });
  };

  return (
    <div className="space-y-3">
      <div className="rounded border border-cyan-300/12 bg-[rgba(5,18,33,0.82)] p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-[Orbitron] text-[10px] uppercase tracking-[0.12em] text-cyan-100/45">
              Mission Swarm Event
            </div>
            <div className="mt-1 text-[12px] text-white">
              {selectedWaypointIndex !== null && selectedWaypoint
                ? `WP-${selectedWaypointIndex + 1}${selectedWaypoint.name ? ` · ${selectedWaypoint.name}` : ""}`
                : "Select a mission waypoint"}
            </div>
          </div>
          {selectedWaypoint ? (
            <button
              type="button"
              className={clsx(
                "rounded border px-2 py-1 text-[10px] uppercase tracking-[0.12em] transition",
                selectedWaypoint.swarmTrigger
                  ? "border-accent-cyan/45 bg-accent-cyan/10 text-accent-cyan"
                  : "border-cyan-300/15 text-cyan-100/50 hover:border-cyan-300/30"
              )}
              onClick={() => {
                if (selectedWaypoint.swarmTrigger) {
                  onUpdateSelectedWaypoint?.({ swarmTrigger: undefined });
                } else {
                  enableSwarmTrigger();
                }
              }}
              disabled={!selectedWaypoint || !onUpdateSelectedWaypoint || (!selectedWaypoint.swarmTrigger && (eligibleMissionGroups.length === 0 || eligiblePresets.length === 0))}
            >
              {selectedWaypoint.swarmTrigger ? "Assigned" : "Enable"}
            </button>
          ) : null}
        </div>

        {!selectedWaypoint ? (
          <div className="mt-2 text-[10px] text-cyan-100/45">
            Select a waypoint in Mission Planner to bind a swarm event or destination action.
          </div>
        ) : !selectedDroneId ? (
          <div className="mt-2 text-[10px] text-cyan-100/45">
            Select the mission drone first so swarm groups can be filtered against its leader role.
          </div>
        ) : eligibleMissionGroups.length === 0 ? (
          <div className="mt-2 text-[10px] text-cyan-100/45">
            No swarm groups are led by this mission drone. Create a group before assigning a waypoint event.
          </div>
        ) : eligiblePresets.length === 0 ? (
          <div className="mt-2 text-[10px] text-cyan-100/45">
            No presets support this mission-event scenario yet.
          </div>
        ) : selectedWaypoint.swarmTrigger ? (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "transit", label: "Transit" },
                { value: "final_destination", label: "Destination" }
              ] as Array<{ value: SwarmEventMode; label: string }>).map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  className={clsx("rounded border px-2 py-1.5 text-[10px] transition", modeButtonClass(selectedEventMode === mode.value))}
                  onClick={() => setEventMode(mode.value)}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2">
              <div>
                <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Swarm Group</div>
                <select
                  className="input text-[11px]"
                  value={selectedWaypoint.swarmTrigger.groupId}
                  onChange={(event) => updateSwarmTrigger({ groupId: event.target.value })}
                >
                  {eligibleMissionGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.followerIds.length} followers)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Preset</div>
                <select
                  className="input text-[11px]"
                  value={selectedWaypoint.swarmTrigger.presetId}
                  onChange={(event) => {
                    const nextPreset = eligiblePresets.find((preset) => preset.id === event.target.value);
                    updateSwarmTrigger({
                      presetId: event.target.value,
                      stopRule: supportsPresetStopRule(nextPreset) ? (selectedWaypoint.swarmTrigger?.stopRule ?? "timer") : undefined,
                      durationSec: defaultDurationForPreset(nextPreset),
                      maneuverOverrides: undefined
                    });
                  }}
                >
                  {eligiblePresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name} [{preset.category}]
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Trigger</div>
                  <select
                    className="input text-[11px]"
                    value={selectedWaypoint.swarmTrigger.triggerMode ?? "waypoint_reached"}
                    onChange={(event) => updateSwarmTrigger({ triggerMode: event.target.value as SwarmTriggerMode })}
                  >
                    <option value="waypoint_reached">On Reach Waypoint</option>
                    <option value="mission_start">On Mission Start</option>
                  </select>
                </div>

                {selectedEventMode === "final_destination" ? (
                  <div>
                    <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">After Event</div>
                    <select
                      className="input text-[11px]"
                      value={selectedWaypoint.swarmTrigger.postAction ?? "hold"}
                      onChange={(event) => updateSwarmTrigger({ postAction: event.target.value as SwarmPostAction })}
                    >
                      <option value="hold">Hold Position</option>
                      <option value="rtl">Return To Launch</option>
                      <option value="land">Land</option>
                      <option value="resume">Resume Route</option>
                    </select>
                  </div>
                ) : (
                  <div className="rounded border border-cyan-300/10 bg-bg-900/40 px-2 py-2 text-[10px] text-cyan-100/45">
                    Transit events resume route flow after the swarm action completes.
                  </div>
                )}
              </div>

              {supportsPresetStopRule(selectedPreset) ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Stop Rule</div>
                    <select
                      className="input text-[11px]"
                      value={selectedWaypoint.swarmTrigger.stopRule ?? "timer"}
                      onChange={(event) => updateSwarmTrigger({ stopRule: event.target.value as "timer" | "manual_confirm" })}
                    >
                      <option value="timer">Timer</option>
                      <option value="manual_confirm">Manual Confirm</option>
                    </select>
                  </div>

                  {(selectedWaypoint.swarmTrigger.stopRule ?? "timer") === "timer" ? (
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Duration</div>
                      <input
                        type="number"
                        min={1}
                        max={600}
                        className="input text-[11px]"
                        value={Math.round(selectedWaypoint.swarmTrigger.durationSec ?? defaultDurationForPreset(selectedPreset) ?? 18)}
                        onChange={(event) => updateSwarmTrigger({ durationSec: Number(event.target.value) })}
                      />
                    </div>
                  ) : (
                    <div className="rounded border border-amber-300/15 bg-amber-300/6 px-2 py-2 text-[10px] text-cyan-100/55">
                      Event holds until you stop the maneuver from swarm group controls.
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded border border-cyan-300/10 bg-bg-900/40 px-2 py-2 text-[10px] text-cyan-100/45">
                  This preset is formation-driven. It uses the swarm event duration and location instead of a separate timed maneuver.
                </div>
              )}

              {selectedPreset ? (
                <div className="rounded border border-accent-cyan/12 bg-accent-cyan/5 px-2 py-2">
                  <div className="text-[10px] text-accent-cyan">{selectedPreset.name}</div>
                  <div className="mt-0.5 text-[10px] leading-relaxed text-cyan-100/45">{selectedPreset.description}</div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-2 text-[10px] text-cyan-100/45">
            Enable this waypoint event to bind a swarm group and a scenario-compatible preset.
          </div>
        )}
      </div>

      {activeGroups.length === 0 ? (
        <div className="text-[10px] text-cyan-100/40">
          No swarm groups. Create a group from the Swarm Manager.
        </div>
      ) : (
        activeGroups.map((group) => {
          const isEngaged = group.state === "FORMING" || group.state === "IN_FORMATION" || group.state === "MANEUVERING";
          return (
            <div key={group.id} className="rounded border border-cyan-300/15 bg-bg-900/50 p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-[Orbitron] text-[10px] uppercase tracking-wider text-cyan-100/80">
                  {group.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] text-cyan-100/45">
                    {1 + group.followerIds.length} drones
                  </span>
                  <span
                    className={
                      group.state === "IN_FORMATION"
                        ? "rounded bg-accent-green/15 px-1.5 py-0.5 text-[8px] uppercase text-accent-green"
                        : group.state === "MANEUVERING"
                          ? "rounded bg-accent-amber/15 px-1.5 py-0.5 text-[8px] uppercase text-accent-amber"
                          : group.state === "IDLE"
                            ? "rounded bg-cyan-300/10 px-1.5 py-0.5 text-[8px] uppercase text-cyan-100/50"
                            : "rounded bg-accent-cyan/15 px-1.5 py-0.5 text-[8px] uppercase text-accent-cyan"
                    }
                  >
                    {group.state}
                  </span>
                </div>
              </div>

              <div className="mb-1.5 grid grid-cols-2 gap-1">
                {!isEngaged ? (
                  <button className="btn-primary col-span-2 py-1 text-[9px]" onClick={() => onEngage(group.id)}>
                    Engage Formation
                  </button>
                ) : (
                  <button className="btn-danger col-span-2 py-1 text-[9px]" onClick={() => onDisengage(group.id)}>
                    Disengage
                  </button>
                )}
              </div>

              {isEngaged && (
                <div className="grid grid-cols-3 gap-1">
                  <button className="btn-primary truncate px-1 py-1 text-[9px]" onClick={() => onGroupCommand(group.id, "arm")}>
                    Arm
                  </button>
                  <button className="btn-secondary truncate px-1 py-1 text-[9px]" onClick={() => onGroupCommand(group.id, "disarm")}>
                    Disarm
                  </button>
                  <button className="btn-primary truncate px-1 py-1 text-[9px]" onClick={() => onGroupCommand(group.id, "takeoff")}>
                    Takeoff
                  </button>
                  <button className="btn-secondary truncate px-1 py-1 text-[9px]" onClick={() => onGroupCommand(group.id, "land")}>
                    Land
                  </button>
                  <button className="btn-danger truncate px-1 py-1 text-[9px]" onClick={() => onGroupCommand(group.id, "rtl")}>
                    RTL
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
