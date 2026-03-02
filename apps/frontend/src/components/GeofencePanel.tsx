import { useState } from "react";
import type { GeofenceRecord } from "../types/domain";

interface GeofencePanelProps {
  geofences: GeofenceRecord[];
  embedded?: boolean;
  onCreateGeofence: (name: string, polygon: Array<{ lat: number; lon: number }>) => void;
  onToggleGeofence: (id: string, isActive: boolean) => void;
  onDeleteGeofence: (id: string) => void;
  drawingMode: boolean;
  onToggleDrawing: (enabled: boolean) => void;
  drawPoints: Array<{ lat: number; lon: number }>;
}

export function GeofencePanel({
  geofences,
  embedded = false,
  onCreateGeofence,
  onToggleGeofence,
  onDeleteGeofence,
  drawingMode,
  onToggleDrawing,
  drawPoints
}: GeofencePanelProps): JSX.Element {
  const [newName, setNewName] = useState("Geofence-1");

  return (
    <section className={embedded ? "flex h-full min-h-0 flex-col gap-2 overflow-hidden p-3" : "panel flex flex-col gap-2 overflow-hidden p-3"}>
      {!embedded ? (
        <div className="flex items-center justify-between">
          <h3 className="panel-title text-[11px]">Geofences</h3>
          <span className="text-[10px] text-cyan-100/50">{geofences.length} defined</span>
        </div>
      ) : null}

      <div className="custom-scrollbar max-h-[120px] min-h-0 space-y-1 overflow-auto">
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
          <div className="text-[11px] text-cyan-100/40">No geofences. Draw one on the globe.</div>
        )}
      </div>

      <div className="space-y-1.5 border-t border-cyan-300/15 pt-2">
        <input
          className="input text-[11px]"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Geofence name"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <button
            className={drawingMode ? "btn-danger text-[10px]" : "btn-secondary text-[10px]"}
            onClick={() => onToggleDrawing(!drawingMode)}
          >
            {drawingMode ? `Drawing (${drawPoints.length} pts)` : "Draw Geofence"}
          </button>
          <button
            className="btn-primary text-[10px]"
            disabled={drawPoints.length < 3}
            onClick={() => {
              onCreateGeofence(newName, drawPoints);
              setNewName(`Geofence-${geofences.length + 2}`);
            }}
          >
            Save Geofence
          </button>
        </div>
      </div>
    </section>
  );
}
