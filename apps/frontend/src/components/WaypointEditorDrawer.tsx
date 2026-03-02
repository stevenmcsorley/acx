import { useState } from "react";
import type { MissionWaypoint, CameraViewMode, ScenarioPreset, SwarmEventMode, SwarmPostAction, SwarmTriggerMode } from "../types/domain";
import type { SwarmGroup } from "../store/useGroundControlStore";
import {
  defaultDurationForPreset,
  numericParam,
  presetContextForEventMode,
  presetSupportsContext,
  stringParam,
  supportsPresetStopRule
} from "../lib/swarmPresets";

interface WaypointEditorDrawerProps {
  waypoint: MissionWaypoint;
  waypointIndex: number;
  waypointCount: number;
  eligibleSwarmGroups: SwarmGroup[];
  swarmPresets: ScenarioPreset[];
  onUpdate: (patch: Partial<MissionWaypoint>) => void;
  onClose: () => void;
  onDelete: () => void;
  onSelectIndex: (index: number) => void;
}

export function WaypointEditorDrawer({
  waypoint,
  waypointIndex,
  waypointCount,
  eligibleSwarmGroups,
  swarmPresets,
  onUpdate,
  onClose,
  onDelete,
  onSelectIndex
}: WaypointEditorDrawerProps): JSX.Element {
  const previousDisabled = waypointIndex <= 0;
  const nextDisabled = waypointIndex >= waypointCount - 1;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const presetsForEventMode = (eventMode: SwarmEventMode) =>
    swarmPresets.filter((preset) => presetSupportsContext(preset, presetContextForEventMode(eventMode)));
  const swarmEventMode = waypoint.swarmTrigger?.eventMode ?? "transit";
  const supportedSwarmPresets = presetsForEventMode(swarmEventMode);
  const selectedPreset = waypoint.swarmTrigger
    ? swarmPresets.find((preset) => preset.id === waypoint.swarmTrigger?.presetId)
    : undefined;
  const selectedManeuver = selectedPreset?.maneuver ?? "hold";
  const stopRuleEnabled = supportsPresetStopRule(selectedPreset);
  const triggerDuration = waypoint.swarmTrigger?.durationSec ?? defaultDurationForPreset(selectedPreset);
  const updateSwarmTrigger = (patch: Partial<NonNullable<MissionWaypoint["swarmTrigger"]>>) => {
    if (!waypoint.swarmTrigger) {
      return;
    }

    onUpdate({
      swarmTrigger: {
        ...waypoint.swarmTrigger,
        ...patch
      }
    });
  };

  return (
    <aside className="absolute right-4 top-4 z-[16] flex h-[calc(100%-2rem)] w-[340px] max-w-[min(340px,calc(100%-2rem))] flex-col overflow-hidden rounded border border-cyan-300/25 bg-[linear-gradient(180deg,rgba(8,19,37,0.95),rgba(2,9,18,0.98))] shadow-[0_22px_60px_rgba(0,0,0,0.65)] backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-cyan-300/15 px-3 py-2">
        <div>
          <div className="panel-title text-[11px]">Waypoint Editor</div>
          <div className="mt-0.5 text-[10px] text-cyan-100/45">
            WP-{waypointIndex + 1} of {waypointCount}
          </div>
        </div>
        <button
          type="button"
          className="rounded border border-cyan-300/18 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-cyan-100/55 transition hover:border-cyan-300/35 hover:text-white"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="space-y-3 overflow-auto p-3">
        <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
          <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Name</div>
          <input
            type="text"
            className="input mt-1 text-[11px]"
            placeholder={`WP-${waypointIndex + 1}`}
            value={waypoint.name ?? ""}
            onChange={(event) => onUpdate({ name: event.target.value || undefined })}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Latitude</div>
            <input
              type="number"
              step="0.000001"
              className="input mt-1 text-[11px]"
              value={waypoint.lat}
              onChange={(event) => onUpdate({ lat: Number(event.target.value) })}
            />
          </div>
          <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Longitude</div>
            <input
              type="number"
              step="0.000001"
              className="input mt-1 text-[11px]"
              value={waypoint.lon}
              onChange={(event) => onUpdate({ lon: Number(event.target.value) })}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Altitude</div>
            <input
              type="number"
              min={5}
              max={500}
              className="input mt-1 text-[11px]"
              value={Math.round(waypoint.alt)}
              onChange={(event) => onUpdate({ alt: Number(event.target.value) })}
            />
            <div className="mt-1 text-[9px] text-cyan-100/35">meters</div>
          </div>
          <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Hover</div>
            <input
              type="number"
              min={0}
              max={120}
              className="input mt-1 text-[11px]"
              value={Math.round(waypoint.hover)}
              onChange={(event) => onUpdate({ hover: Number(event.target.value) })}
            />
            <div className="mt-1 text-[9px] text-cyan-100/35">seconds</div>
          </div>
          <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Camera Pitch</div>
            <input
              type="number"
              min={-60}
              max={30}
              className="input mt-1 text-[11px]"
              value={Math.round(waypoint.cameraPitch ?? 0)}
              onChange={(event) => onUpdate({ cameraPitch: Number(event.target.value) })}
            />
            <div className="mt-1 text-[9px] text-cyan-100/35">degrees</div>
          </div>
        </div>

        {/* Camera View Mode */}
        <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
          <div className="mb-1.5 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Camera View Mode</div>
          <div className="grid grid-cols-3 gap-1">
            {(["follow", "cinematic", "fpv"] as CameraViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`rounded border px-1.5 py-1 text-[10px] capitalize transition ${
                  (waypoint.cameraViewMode ?? "fpv") === mode
                    ? "border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan"
                    : "border-cyan-300/15 text-cyan-100/50 hover:border-cyan-300/30"
                }`}
                onClick={() => onUpdate({ cameraViewMode: mode })}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {/* FPV Controls */}
        {(waypoint.cameraViewMode ?? "fpv") === "fpv" && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">FPV Yaw</div>
              <input
                type="number"
                min={-180}
                max={180}
                className="input mt-1 text-[11px]"
                value={Math.round(waypoint.fpvYaw ?? 0)}
                onChange={(event) => onUpdate({ fpvYaw: Number(event.target.value) })}
              />
              <div className="mt-1 text-[9px] text-cyan-100/35">-180..180</div>
            </div>
            <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">FPV Pitch</div>
              <input
                type="number"
                min={-60}
                max={30}
                className="input mt-1 text-[11px]"
                value={Math.round(waypoint.fpvPitch ?? 0)}
                onChange={(event) => onUpdate({ fpvPitch: Number(event.target.value) })}
              />
              <div className="mt-1 text-[9px] text-cyan-100/35">-60..30</div>
            </div>
            <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
              <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">FPV Zoom</div>
              <input
                type="number"
                min={0.5}
                max={5}
                step={0.1}
                className="input mt-1 text-[11px]"
                value={waypoint.fpvZoom ?? 1.0}
                onChange={(event) => onUpdate({ fpvZoom: Number(event.target.value) })}
              />
              <div className="mt-1 text-[9px] text-cyan-100/35">0.5..5x</div>
            </div>
          </div>
        )}

        {/* Advanced / Extended Fields */}
        <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Swarm Trigger</div>
            <label className="flex items-center gap-1.5 text-[10px] text-cyan-100/60">
              <input
                type="checkbox"
                checked={Boolean(waypoint.swarmTrigger)}
                onChange={(event) => {
                  if (!event.target.checked) {
                    onUpdate({ swarmTrigger: undefined });
                    return;
                  }
                  const defaultGroupId = eligibleSwarmGroups[0]?.id;
                  const defaultPresetId = supportedSwarmPresets[0]?.id ?? swarmPresets[0]?.id;
                  const defaultPreset =
                    supportedSwarmPresets[0]
                    ?? swarmPresets[0];
                  if (defaultGroupId && defaultPresetId) {
                    onUpdate({
                      swarmTrigger: {
                        groupId: defaultGroupId,
                        presetId: defaultPresetId,
                        triggerMode: "waypoint_reached",
                        eventMode: "transit",
                        stopRule: supportsPresetStopRule(defaultPreset) ? "timer" : undefined,
                        postAction: "resume",
                        durationSec: defaultDurationForPreset(defaultPreset)
                      }
                    });
                  }
                }}
                disabled={eligibleSwarmGroups.length === 0 || supportedSwarmPresets.length === 0}
              />
              Enabled
            </label>
          </div>

          {waypoint.swarmTrigger ? (
            <div className="space-y-2">
              <div className="rounded border border-cyan-300/10 bg-bg-900/45 px-2 py-1.5 text-[10px] text-cyan-100/48">
                {waypoint.swarmTrigger.triggerMode === "mission_start"
                  ? `Trigger this swarm event as soon as the mission begins. WP-${waypointIndex + 1} is the mission-plan marker for that event.`
                  : `Trigger this swarm event when WP-${waypointIndex + 1} is reached.`}
              </div>
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Event Mode</div>
                  <div className="grid grid-cols-2 gap-1">
                    {([
                      { value: "transit", label: "Transit Event" },
                      { value: "final_destination", label: "Final Destination" }
                    ] as Array<{ value: SwarmEventMode; label: string }>).map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        className={`rounded border px-2 py-1 text-[10px] transition ${
                          swarmEventMode === mode.value
                            ? "border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan"
                            : "border-cyan-300/15 text-cyan-100/50 hover:border-cyan-300/30"
                        }`}
                        onClick={() => {
                          const nextContextPreset =
                            presetsForEventMode(mode.value).find((preset) =>
                              selectedPreset ? preset.id === selectedPreset.id : false
                            )
                            ?? presetsForEventMode(mode.value)[0]
                            ?? selectedPreset;
                          updateSwarmTrigger({
                            eventMode: mode.value,
                            presetId:
                              nextContextPreset && presetSupportsContext(nextContextPreset, presetContextForEventMode(mode.value))
                                ? nextContextPreset.id
                                : waypoint.swarmTrigger?.presetId,
                            postAction: mode.value === "final_destination" ? (waypoint.swarmTrigger?.postAction ?? "hold") : "resume",
                            stopRule: supportsPresetStopRule(nextContextPreset) ? (waypoint.swarmTrigger?.stopRule ?? "timer") : undefined,
                            durationSec: defaultDurationForPreset(nextContextPreset)
                          });
                        }}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {selectedPreset ? (
                <div className="rounded border border-accent-cyan/12 bg-accent-cyan/5 px-2 py-1.5">
                  <div className="text-[10px] text-accent-cyan">{selectedPreset.name}</div>
                  <div className="mt-0.5 text-[10px] leading-relaxed text-cyan-100/45">{selectedPreset.description}</div>
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Trigger Mode</div>
                  <select
                    className="input text-[11px]"
                    value={waypoint.swarmTrigger.triggerMode ?? "waypoint_reached"}
                    onChange={(event) => updateSwarmTrigger({ triggerMode: event.target.value as SwarmTriggerMode })}
                  >
                    <option value="waypoint_reached">On Reach Waypoint</option>
                    <option value="mission_start">On Mission Start</option>
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Swarm Group</div>
                  <select
                    className="input text-[11px]"
                    value={waypoint.swarmTrigger.groupId}
                    onChange={(event) => updateSwarmTrigger({ groupId: event.target.value })}
                  >
                    {eligibleSwarmGroups.map((group) => (
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
                    value={waypoint.swarmTrigger.presetId}
                    onChange={(event) => {
                      const nextPreset = supportedSwarmPresets.find((preset) => preset.id === event.target.value);
                      updateSwarmTrigger({
                        presetId: event.target.value,
                        stopRule: supportsPresetStopRule(nextPreset) ? (waypoint.swarmTrigger?.stopRule ?? "timer") : undefined,
                        durationSec: defaultDurationForPreset(nextPreset),
                        maneuverOverrides: undefined
                      });
                    }}
                  >
                    {supportedSwarmPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name} [{preset.category}]
                      </option>
                    ))}
                  </select>
                </div>
                {swarmEventMode === "final_destination" ? (
                  <div>
                    <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">After Event</div>
                    <select
                      className="input text-[11px]"
                      value={waypoint.swarmTrigger.postAction ?? "hold"}
                      onChange={(event) => updateSwarmTrigger({ postAction: event.target.value as SwarmPostAction })}
                    >
                      <option value="hold">Hold Position</option>
                      <option value="rtl">Return To Launch</option>
                      <option value="land">Land</option>
                      <option value="resume">Resume Route</option>
                    </select>
                  </div>
                ) : (
                  <div className="rounded border border-cyan-300/10 bg-bg-900/45 px-2 py-1.5 text-[10px] text-cyan-100/45">
                    Transit events resume the mission automatically after the swarm action ends.
                  </div>
                )}
                {stopRuleEnabled ? (
                  <>
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Stop Rule</div>
                      <select
                        className="input text-[11px]"
                        value={waypoint.swarmTrigger.stopRule ?? "timer"}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            stopRule: event.target.value as "timer" | "manual_confirm"
                          })
                        }
                      >
                        <option value="timer">Timer</option>
                        <option value="manual_confirm">Manual Confirm</option>
                      </select>
                    </div>
                    {(waypoint.swarmTrigger.stopRule ?? "timer") === "timer" ? (
                      <div>
                        <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Duration</div>
                        <input
                          type="number"
                          min={1}
                          max={600}
                          className="input text-[11px]"
                          value={Math.round(triggerDuration ?? 18)}
                          onChange={(event) => updateSwarmTrigger({ durationSec: Number(event.target.value) })}
                        />
                      </div>
                    ) : (
                      <div className="rounded border border-amber-300/15 bg-amber-300/6 px-2 py-1.5 text-[10px] text-cyan-100/55">
                        Mission resumes when you press <span className="text-white">Stop Maneuver</span> for this swarm.
                      </div>
                    )}
                  </>
                ) : null}
              </div>
              <div className="space-y-2 rounded border border-cyan-300/10 bg-bg-900/35 p-2">
                <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Waypoint Overrides</div>
                {!selectedPreset?.maneuver ? (
                  <div className="text-[10px] text-cyan-100/45">
                    Formation-only preset. The swarm holds this formation at the trigger point using the selected stop rule.
                  </div>
                ) : null}

                {selectedManeuver === "orbit" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Radius</div>
                      <input
                        type="number"
                        min={10}
                        max={500}
                        className="input text-[11px]"
                        value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "radius", numericParam(selectedPreset?.maneuverParams, "radius", 120))}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            maneuverOverrides: {
                              ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                              radius: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Speed</div>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        step={0.5}
                        className="input text-[11px]"
                        value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "speed", numericParam(selectedPreset?.maneuverParams, "speed", 6))}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            maneuverOverrides: {
                              ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                              speed: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {selectedManeuver === "perimeter" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Radius</div>
                      <input
                        type="number"
                        min={10}
                        max={500}
                        className="input text-[11px]"
                        value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "radius", numericParam(selectedPreset?.maneuverParams, "radius", 100))}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            maneuverOverrides: {
                              ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                              radius: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Speed</div>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        step={0.5}
                        className="input text-[11px]"
                        value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "speed", numericParam(selectedPreset?.maneuverParams, "speed", 4))}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            maneuverOverrides: {
                              ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                              speed: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {selectedManeuver === "search_grid" ? (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Width</div>
                      <input
                        type="number"
                        min={50}
                        max={2000}
                        className="input text-[11px]"
                        value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "width", numericParam(selectedPreset?.maneuverParams, "width", 400))}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            maneuverOverrides: {
                              ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                              width: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Height</div>
                      <input
                        type="number"
                        min={50}
                        max={2000}
                        className="input text-[11px]"
                        value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "height", numericParam(selectedPreset?.maneuverParams, "height", 400))}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            maneuverOverrides: {
                              ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                              height: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Speed</div>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        step={0.5}
                        className="input text-[11px]"
                        value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "speed", numericParam(selectedPreset?.maneuverParams, "speed", 5))}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            maneuverOverrides: {
                              ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                              speed: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {selectedManeuver === "search_spiral" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Max Radius</div>
                      <input
                        type="number"
                        min={50}
                        max={2000}
                        className="input text-[11px]"
                        value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "maxRadius", numericParam(selectedPreset?.maneuverParams, "maxRadius", 500))}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            maneuverOverrides: {
                              ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                              maxRadius: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Speed</div>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        step={0.5}
                        className="input text-[11px]"
                        value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "speed", numericParam(selectedPreset?.maneuverParams, "speed", 5))}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            maneuverOverrides: {
                              ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                              speed: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {selectedManeuver === "escort" ? (
                  <div className="text-[10px] text-cyan-100/45">
                    Uses the leader as the tracked subject. Duration is controlled by the stop rule above.
                  </div>
                ) : null}

                {(selectedManeuver === "expand" || selectedManeuver === "contract") ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Target Spacing</div>
                      <input
                        type="number"
                        min={5}
                        max={200}
                        className="input text-[11px]"
                        value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "targetSpacing", numericParam(selectedPreset?.maneuverParams, "targetSpacing", 50))}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            maneuverOverrides: {
                              ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                              targetSpacing: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Duration</div>
                      <input
                        type="number"
                        min={1}
                        max={180}
                        className="input text-[11px]"
                        value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "duration", numericParam(selectedPreset?.maneuverParams, "duration", 15))}
                        onChange={(event) =>
                          updateSwarmTrigger({
                            maneuverOverrides: {
                              ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                              duration: Number(event.target.value)
                            }
                          })
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {selectedManeuver === "corridor" ? (
                  <div>
                    <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Width</div>
                    <input
                      type="number"
                      min={5}
                      max={500}
                      className="input text-[11px]"
                      value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "width", numericParam(selectedPreset?.maneuverParams, "width", 40))}
                      onChange={(event) =>
                        updateSwarmTrigger({
                          maneuverOverrides: {
                            ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                            width: Number(event.target.value)
                          }
                        })
                      }
                    />
                  </div>
                ) : null}

                {selectedManeuver === "rotate" ? (
                  <div>
                    <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Rotation Speed</div>
                    <input
                      type="number"
                      min={1}
                      max={180}
                      className="input text-[11px]"
                      value={numericParam(waypoint.swarmTrigger?.maneuverOverrides, "rotationSpeed", numericParam(selectedPreset?.maneuverParams, "rotationSpeed", 15))}
                      onChange={(event) =>
                        updateSwarmTrigger({
                          maneuverOverrides: {
                            ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                            rotationSpeed: Number(event.target.value)
                          }
                        })
                      }
                    />
                  </div>
                ) : null}

                {selectedManeuver === "orbit" ? (
                  <div>
                    <div className="mb-1 text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Direction</div>
                    <select
                      className="input text-[11px]"
                      value={stringParam(waypoint.swarmTrigger?.maneuverOverrides, "direction", stringParam(selectedPreset?.maneuverParams, "direction", "cw"))}
                      onChange={(event) =>
                        updateSwarmTrigger({
                          maneuverOverrides: {
                            ...(waypoint.swarmTrigger?.maneuverOverrides ?? {}),
                            direction: event.target.value
                          }
                        })
                      }
                    >
                      <option value="cw">Clockwise</option>
                      <option value="ccw">Counter-Clockwise</option>
                    </select>
                  </div>
                ) : null}
              </div>
            </div>
          ) : eligibleSwarmGroups.length === 0 ? (
            <div className="rounded border border-cyan-300/10 bg-bg-900/45 px-2 py-1.5 text-[10px] text-cyan-100/45">
              No swarm groups led by this mission drone. Create a swarm group first, then assign a preset here.
            </div>
          ) : swarmPresets.length === 0 ? (
            <div className="rounded border border-cyan-300/10 bg-bg-900/45 px-2 py-1.5 text-[10px] text-cyan-100/45">
              Swarm presets are loading.
            </div>
          ) : (
            <div className="rounded border border-cyan-300/10 bg-bg-900/45 px-2 py-1.5 text-[10px] text-cyan-100/45">
              Enable to bind a swarm preset to this waypoint.
            </div>
          )}
        </div>

        <button
          type="button"
          className="flex w-full items-center justify-between rounded border border-cyan-300/15 bg-bg-900/45 px-3 py-1.5 text-[10px] text-cyan-100/55"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          <span>Advanced</span>
          <span>{showAdvanced ? "▲" : "▼"}</span>
        </button>
        {showAdvanced && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
                <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Heading</div>
                <input
                  type="number"
                  min={0}
                  max={359}
                  className="input mt-1 text-[11px]"
                  value={Math.round(waypoint.heading ?? 0)}
                  onChange={(event) => onUpdate({ heading: Number(event.target.value) })}
                />
              </div>
              <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
                <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Speed (m/s)</div>
                <input
                  type="number"
                  min={0}
                  max={15}
                  step={0.5}
                  className="input mt-1 text-[11px]"
                  value={waypoint.speed ?? 0}
                  onChange={(event) => onUpdate({ speed: Number(event.target.value) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
                <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Curve Size (m)</div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  className="input mt-1 text-[11px]"
                  value={waypoint.curveSize ?? 0.2}
                  onChange={(event) => onUpdate({ curveSize: Number(event.target.value) })}
                />
              </div>
              <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
                <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Alt Mode</div>
                <select
                  className="input mt-1 text-[11px]"
                  value={waypoint.altitudeMode ?? 1}
                  onChange={(event) => onUpdate({ altitudeMode: Number(event.target.value) })}
                >
                  <option value={0}>AGL</option>
                  <option value={1}>MSL</option>
                </select>
              </div>
            </div>
          </div>
        )}

        <div className="rounded border border-cyan-300/15 bg-bg-900/45 px-3 py-2 text-[11px] text-cyan-100/55">
          Drag waypoint markers on the globe to reposition. Click another marker to switch the editor focus.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 border-t border-cyan-300/15 p-3">
        <button
          type="button"
          className="btn-secondary text-[10px]"
          disabled={previousDisabled}
          onClick={() => onSelectIndex(Math.max(0, waypointIndex - 1))}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary text-[10px]"
          disabled={nextDisabled}
          onClick={() => onSelectIndex(Math.min(waypointCount - 1, waypointIndex + 1))}
        >
          Next
        </button>
        <button
          type="button"
          className="btn-danger text-[10px]"
          onClick={onDelete}
        >
          Delete Waypoint
        </button>
        <button
          type="button"
          className="btn-primary text-[10px]"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </aside>
  );
}
