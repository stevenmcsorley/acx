import { useCallback, useRef, useState } from "react";
import clsx from "clsx";
import type { RecordingSession } from "../hooks/useVideoRecorder";

interface RecordsPanelProps {
  sessions: RecordingSession[];
  onDeleteSession: (id: string) => void;
  onClearAll: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function RecordsPanel({ sessions, onDeleteSession, onClearAll }: RecordsPanelProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  const handleDownload = useCallback(() => {
    if (!selected) return;
    const a = document.createElement("a");
    a.href = selected.url;
    a.download = `${selected.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [selected]);

  return (
    <div className="flex min-h-0 flex-1 gap-2 p-2">
      {/* Left column: Recording list */}
      <div className="panel flex w-80 shrink-0 flex-col">
        <div className="flex items-center justify-between border-b border-cyan-300/10 px-3 py-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/80">Recordings</h2>
          {sessions.length > 0 && (
            <button
              className="text-[9px] uppercase tracking-[0.1em] text-accent-red/70 hover:text-accent-red"
              onClick={onClearAll}
            >
              Clear All
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11px] text-cyan-100/40">
              No recordings yet. Use the recording overlay on the globe to capture video.
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => setSelectedId(session.id)}
                className={clsx(
                  "cursor-pointer border-b border-cyan-300/5 px-3 py-2 transition",
                  selectedId === session.id
                    ? "bg-accent-cyan/10"
                    : "hover:bg-white/5"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="truncate text-[11px] font-medium text-white">{session.name}</div>
                  <button
                    className="ml-2 shrink-0 text-[9px] text-accent-red/60 hover:text-accent-red"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (selectedId === session.id) setSelectedId(null);
                      onDeleteSession(session.id);
                    }}
                  >
                    DEL
                  </button>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[9px] text-cyan-100/50">
                  {session.droneId && <span>{session.droneId}</span>}
                  <span className="rounded bg-cyan-300/10 px-1 py-px uppercase">{session.cameraMode}</span>
                  <span>{formatDuration(session.duration)}</span>
                  <span>{formatSize(session.sizeBytes)}</span>
                </div>
                <div className="mt-0.5 text-[9px] text-cyan-100/30">{formatDate(session.startedAt)}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right column: Video player */}
      <div className="panel flex min-h-0 flex-1 flex-col">
        {selected ? (
          <>
            <div className="flex items-center justify-between border-b border-cyan-300/10 px-4 py-2">
              <div>
                <div className="text-[12px] font-medium text-white">{selected.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[9px] text-cyan-100/50">
                  {selected.droneId && <span>Drone: {selected.droneId}</span>}
                  <span>Camera: {selected.cameraMode.toUpperCase()}</span>
                  <span>Duration: {formatDuration(selected.duration)}</span>
                  <span>{formatDate(selected.startedAt)}</span>
                </div>
              </div>
              <button
                className="btn-primary text-[10px]"
                onClick={handleDownload}
              >
                Download
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
              <video
                ref={videoRef}
                key={selected.id}
                controls
                className="max-h-full max-w-full rounded"
                src={selected.url}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-[12px] text-cyan-100/30">
            Select a recording to play
          </div>
        )}
      </div>
    </div>
  );
}
