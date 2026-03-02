import { useRef, useState } from "react";
import type { MissionWaypoint, CameraViewMode } from "../types/domain";
import type { WaypointDefaults } from "../store/useGroundControlStore";
import {
  detectFormat,
  parseLitchiCsv,
  parseKml,
  exportLitchiCsv,
  exportKml,
} from "../utils/missionFileParser";

type FormationPreset = "triangle" | "arrowhead" | "v_wedge" | "diamond" | "grid" | "circle";

interface MissionPlannerPanelProps {
  plannerEnabled: boolean;
  waypoints: MissionWaypoint[];
  selectedMissionName?: string;
  selectedWaypointIndex?: number | null;
  canExecuteMission: boolean;
  embedded?: boolean;
  missionOutcome?: { type: "success" | "aborted"; title: string } | null;
  missionName?: string;
  onMissionNameChange?: (name: string) => void;
  onTogglePlanner: (enabled: boolean) => void;
  onClear: () => void;
  onCompleteMission?: () => void;
  waypointDefaults?: WaypointDefaults;
  onWaypointDefaultsChange?: (partial: Partial<WaypointDefaults>) => void;
  onApplyDefaultsToAll?: () => void;
  onImportFile: (waypoints: MissionWaypoint[], name: string) => void;
  onUpload: () => void;
  onExecuteMission: () => void;
}

const FORMATION_PRESETS: Array<{ id: FormationPreset; label: string; icon: string }> = [
  { id: "triangle", label: "Triangle", icon: "△" },
  { id: "arrowhead", label: "Arrow", icon: "▶" },
  { id: "v_wedge", label: "V-Wedge", icon: "∨" },
  { id: "diamond", label: "Diamond", icon: "◇" },
  { id: "grid", label: "Grid", icon: "⊞" },
  { id: "circle", label: "Circle", icon: "○" }
];

export function MissionPlannerPanel({
  plannerEnabled,
  waypoints,
  selectedMissionName,
  selectedWaypointIndex = null,
  canExecuteMission,
  embedded = false,
  missionOutcome,
  missionName = "",
  onMissionNameChange,
  waypointDefaults,
  onWaypointDefaultsChange,
  onApplyDefaultsToAll,
  onTogglePlanner,
  onImportFile,
  onClear,
  onCompleteMission,
  onUpload,
  onExecuteMission
}: MissionPlannerPanelProps): JSX.Element {
  const [selectedFormation, setSelectedFormation] = useState<FormationPreset>("triangle");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showDefaults, setShowDefaults] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileImport = (file: File) => {
    setImportError(null);
    const format = detectFormat(file.name);
    if (!format) {
      setImportError("Unsupported file type. Use .csv or .kml");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const parsed =
          format === "litchi-csv"
            ? parseLitchiCsv(text, file.name)
            : parseKml(text, file.name);
        onImportFile(parsed.waypoints, parsed.name);
      } catch (err) {
        setImportError((err as Error).message);
      }
    };
    reader.onerror = () => setImportError("Failed to read file");
    reader.readAsText(file);
  };

  const triggerDownload = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csv = exportLitchiCsv(waypoints);
    triggerDownload(csv, "mission.csv", "text/csv");
    setShowExportMenu(false);
  };

  const handleExportKml = () => {
    const kml = exportKml(waypoints, "Mission");
    triggerDownload(kml, "mission.kml", "application/vnd.google-earth.kml+xml");
    setShowExportMenu(false);
  };

  return (
    <section className={embedded ? "flex h-full min-h-0 flex-col overflow-hidden" : "panel flex h-full min-h-0 flex-col overflow-hidden"}>
      {!embedded ? (
        <div className="flex items-center justify-between border-b border-cyan-300/15 px-3 py-2">
          <h2 className="panel-title text-[11px]">Mission Planner</h2>
          <label className="flex items-center gap-1.5 text-[10px] text-cyan-100/60">
            <input
              type="checkbox"
              checked={plannerEnabled}
              onChange={(event) => onTogglePlanner(event.target.checked)}
              className="accent-accent-amber"
            />
            Click-to-place
          </label>
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 border-b border-cyan-300/15 px-3 py-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.kml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileImport(file);
            e.target.value = "";
          }}
        />
        <button
          className="btn-secondary text-[10px]"
          onClick={() => fileInputRef.current?.click()}
        >
          Import
        </button>
        {waypoints.length > 0 && (
          <div className="relative">
            <button
              className="btn-secondary text-[10px]"
              onClick={() => setShowExportMenu((v) => !v)}
              onBlur={() => setTimeout(() => setShowExportMenu(false), 150)}
            >
              Export ▾
            </button>
            {showExportMenu && (
              <div className="absolute left-0 top-full z-30 mt-1 rounded border border-cyan-300/20 bg-bg-900 py-0.5 shadow-lg">
                <button
                  className="block w-full whitespace-nowrap px-3 py-1 text-left text-[10px] text-cyan-100/70 hover:bg-cyan-300/10"
                  onMouseDown={handleExportCsv}
                >
                  Export as Litchi CSV
                </button>
                <button
                  className="block w-full whitespace-nowrap px-3 py-1 text-left text-[10px] text-cyan-100/70 hover:bg-cyan-300/10"
                  onMouseDown={handleExportKml}
                >
                  Export as KML
                </button>
              </div>
            )}
          </div>
        )}
        {importError && (
          <span className="text-[10px] text-accent-red">{importError}</span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-[10px] text-cyan-100/60">
          <input
            type="checkbox"
            checked={plannerEnabled}
            onChange={(event) => onTogglePlanner(event.target.checked)}
            className="accent-accent-amber"
          />
          Click-to-place
        </label>
      </div>

      <div className="px-3 py-2">
        <div className="mb-2 rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1.5">
          <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Mission Name</div>
          <input
            type="text"
            className="input mt-1 text-[11px]"
            placeholder="Unnamed Mission"
            value={missionName}
            onChange={(event) => onMissionNameChange?.(event.target.value)}
          />
        </div>
        <div className="mb-1 text-[9px] uppercase tracking-[0.1em] text-cyan-100/50">Formation Preset</div>
        <div className="grid grid-cols-6 gap-1">
          {FORMATION_PRESETS.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedFormation(f.id)}
              className={`rounded border px-1 py-1 text-center text-[10px] transition ${
                selectedFormation === f.id
                  ? "border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan"
                  : "border-cyan-300/15 text-cyan-100/50 hover:border-cyan-300/30"
              }`}
            >
              <div className="text-sm">{f.icon}</div>
              <div className="text-[8px]">{f.label}</div>
            </button>
          ))}
        </div>
      </div>

      {waypointDefaults && (
        <div className="border-b border-cyan-300/15 px-3 py-2">
          <button
            type="button"
            className="flex w-full items-center justify-between text-[9px] uppercase tracking-[0.1em] text-cyan-100/50"
            onClick={() => setShowDefaults((v) => !v)}
          >
            <span>Waypoint Defaults</span>
            <span>{showDefaults ? "▲" : "▼"}</span>
          </button>
          {showDefaults && (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Alt (m)</div>
                  <input type="number" min={5} max={500} className="input mt-0.5 text-[10px]" value={waypointDefaults.alt} onChange={(e) => onWaypointDefaultsChange?.({ alt: Number(e.target.value) })} />
                </div>
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Hover (s)</div>
                  <input type="number" min={0} max={120} className="input mt-0.5 text-[10px]" value={waypointDefaults.hover} onChange={(e) => onWaypointDefaultsChange?.({ hover: Number(e.target.value) })} />
                </div>
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Speed</div>
                  <input type="number" min={0} max={15} step={0.5} className="input mt-0.5 text-[10px]" value={waypointDefaults.speed} onChange={(e) => onWaypointDefaultsChange?.({ speed: Number(e.target.value) })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Cam Pitch</div>
                  <input type="number" min={-60} max={30} className="input mt-0.5 text-[10px]" value={waypointDefaults.cameraPitch} onChange={(e) => onWaypointDefaultsChange?.({ cameraPitch: Number(e.target.value) })} />
                </div>
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Heading</div>
                  <input type="number" min={0} max={359} className="input mt-0.5 text-[10px]" value={waypointDefaults.heading} onChange={(e) => onWaypointDefaultsChange?.({ heading: Number(e.target.value) })} />
                </div>
                <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">View Mode</div>
                  <select className="input mt-0.5 text-[10px]" value={waypointDefaults.cameraViewMode} onChange={(e) => onWaypointDefaultsChange?.({ cameraViewMode: e.target.value as CameraViewMode })}>
                    <option value="follow">Follow</option>
                    <option value="cinematic">Cinematic</option>
                    <option value="fpv">FPV</option>
                  </select>
                </div>
              </div>
              {waypointDefaults.cameraViewMode === "fpv" && (
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                    <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">FPV Pitch</div>
                    <input type="number" min={-60} max={30} className="input mt-0.5 text-[10px]" value={waypointDefaults.fpvPitch} onChange={(e) => onWaypointDefaultsChange?.({ fpvPitch: Number(e.target.value) })} />
                  </div>
                  <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                    <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">FPV Yaw</div>
                    <input type="number" min={-180} max={180} className="input mt-0.5 text-[10px]" value={waypointDefaults.fpvYaw} onChange={(e) => onWaypointDefaultsChange?.({ fpvYaw: Number(e.target.value) })} />
                  </div>
                  <div className="rounded border border-cyan-300/15 bg-bg-900/55 px-2 py-1">
                    <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">FPV Zoom</div>
                    <input type="number" min={0.5} max={5} step={0.1} className="input mt-0.5 text-[10px]" value={waypointDefaults.fpvZoom} onChange={(e) => onWaypointDefaultsChange?.({ fpvZoom: Number(e.target.value) })} />
                  </div>
                </div>
              )}
              <button
                type="button"
                className="btn-secondary w-full text-[10px]"
                onClick={onApplyDefaultsToAll}
                disabled={waypoints.length === 0}
              >
                Apply to All Waypoints
              </button>
            </div>
          )}
        </div>
      )}

      <div className="custom-scrollbar min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-2">
        <div className="grid grid-cols-3 gap-1.5">
          <div className="metric-card text-center">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Waypoints</div>
            <div className="font-display text-[18px] text-accent-cyan">{waypoints.length}</div>
          </div>
          <div className="metric-card text-center">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Planner</div>
            <div className={`font-display text-[18px] ${plannerEnabled ? "text-accent-green" : "text-cyan-100/45"}`}>
              {plannerEnabled ? "Armed" : "Off"}
            </div>
          </div>
          <div className="metric-card text-center">
            <div className="text-[8px] uppercase tracking-[0.12em] text-cyan-100/45">Selected</div>
            <div className="font-display text-[18px] text-accent-amber">
              {selectedWaypointIndex !== null && waypoints[selectedWaypointIndex] ? `WP-${selectedWaypointIndex + 1}` : "--"}
            </div>
          </div>
        </div>

        <div className="rounded border border-cyan-300/15 bg-bg-900/50 px-3 py-3 text-[11px] text-cyan-100/48">
          {waypoints.length === 0
            ? "Enable click-to-place and click the globe to add waypoints."
            : selectedWaypointIndex !== null && waypoints[selectedWaypointIndex]
              ? `Waypoint WP-${selectedWaypointIndex + 1} selected. Use the drawer on the map to edit altitude, hover time, camera pitch, and position.`
              : "Click any waypoint marker on the globe to open the waypoint editor. Drag markers to reposition them."}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-cyan-300/15 px-3 py-2">
        {missionOutcome ? (
          <div
            className={
              missionOutcome.type === "success"
                ? "rounded border border-accent-green/40 bg-accent-green/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-accent-green"
                : "rounded border border-accent-red/40 bg-accent-red/10 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-accent-red"
            }
          >
            {missionOutcome.title}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            className={missionOutcome ? "btn-primary text-[10px]" : "btn-secondary text-[10px]"}
            onClick={missionOutcome ? (onCompleteMission ?? onClear) : onClear}
          >
            {missionOutcome ? "Complete" : "Clear All"}
          </button>
          <button className="btn-primary text-[10px]" onClick={onUpload} disabled={waypoints.length === 0}>
            Upload Mission
          </button>
        </div>
        <button className="btn-secondary w-full text-[10px]" onClick={onExecuteMission} disabled={!canExecuteMission}>
          {selectedMissionName ? `Execute ${selectedMissionName}` : "Execute Mission"}
        </button>
      </div>
    </section>
  );
}
