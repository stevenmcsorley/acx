import { useCallback, useRef, useState } from "react";

export interface RecordingSession {
  id: string;
  name: string;
  droneId: string | null;
  cameraMode: string;
  startedAt: string;
  duration: number;
  blob: Blob;
  url: string;
  thumbnailUrl: string;
  sizeBytes: number;
}

interface ActiveRecording {
  recorder: MediaRecorder;
  chunks: Blob[];
  startMs: number;
  meta: { name: string; droneId: string | null; cameraMode: string };
  compositingCanvas: HTMLCanvasElement;
  rafId: number;
  thumbnailUrl?: string;
}

export interface UseVideoRecorder {
  recording: boolean;
  activeRecordings: Map<string, { cameraMode: string; elapsedSec: number }>;
  startRecording: (container: HTMLElement, name: string, droneId: string | null, cameraMode: string) => string;
  stopRecording: (sessionId: string) => void;
  stopAllRecordings: () => void;
  sessions: RecordingSession[];
  deleteSession: (id: string) => void;
  clearAllSessions: () => void;
}

function generateId(): string {
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickMimeType(): string {
  if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
    return "video/webm;codecs=vp9";
  }
  return "video/webm";
}

/** Find the Cesium WebGL canvas inside a container element. */
function findCesiumCanvas(container: HTMLElement): HTMLCanvasElement | null {
  return container.querySelector("canvas[data-engine]") ??
    container.querySelector("canvas") ??
    null;
}

/**
 * Read overlay text content from HUD DOM elements and paint them
 * directly onto the compositing canvas using the Canvas 2D API.
 * This avoids the fragile SVG foreignObject serialization approach.
 */
function paintOverlayFromDom(
  ctx: CanvasRenderingContext2D,
  container: HTMLElement,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const containerRect = container.getBoundingClientRect();
  if (containerRect.width === 0 || containerRect.height === 0) return;

  const scaleX = canvasWidth / containerRect.width;
  const scaleY = canvasHeight / containerRect.height;

  // Find overlay divs — skip the GlobeViewer (contains canvas) and recording controls
  const children = Array.from(container.children) as HTMLElement[];
  const overlays = children.filter(
    (el) =>
      el.tagName === "DIV" &&
      !el.querySelector("canvas") &&
      !el.hasAttribute("data-recording-ignore"),
  );

  for (const overlay of overlays) {
    paintElement(ctx, overlay, containerRect, scaleX, scaleY);
  }
}

function paintElement(
  ctx: CanvasRenderingContext2D,
  el: HTMLElement,
  containerRect: DOMRect,
  scaleX: number,
  scaleY: number,
): void {
  // Skip elements marked to be excluded from recording
  if (el.hasAttribute("data-recording-ignore")) return;

  const rect = el.getBoundingClientRect();

  // Skip elements outside the container or invisible
  if (rect.width === 0 || rect.height === 0) return;
  const computed = window.getComputedStyle(el);
  if (computed.display === "none" || computed.visibility === "hidden" || computed.opacity === "0") return;

  const x = (rect.left - containerRect.left) * scaleX;
  const y = (rect.top - containerRect.top) * scaleY;
  const w = rect.width * scaleX;
  const h = rect.height * scaleY;

  // Paint background if it has one
  const bg = computed.backgroundColor;
  if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
    ctx.fillStyle = bg;
    const radius = parseFloat(computed.borderRadius) * scaleX;
    if (radius > 0) {
      roundRect(ctx, x, y, w, h, radius);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
  }

  // Paint border if visible
  const borderWidth = parseFloat(computed.borderTopWidth);
  const borderColor = computed.borderTopColor;
  if (borderWidth > 0 && borderColor && borderColor !== "rgba(0, 0, 0, 0)") {
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = borderWidth * scaleX;
    const radius = parseFloat(computed.borderRadius) * scaleX;
    if (radius > 0) {
      roundRect(ctx, x, y, w, h, radius);
      ctx.stroke();
    } else {
      ctx.strokeRect(x, y, w, h);
    }
  }

  // If this element has direct text content (not just child elements), paint it
  const hasDirectText = Array.from(el.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent?.trim() ?? "").length > 0,
  );
  if (hasDirectText) {
    const text = el.textContent?.trim() ?? "";
    if (text) {
      const fontSize = parseFloat(computed.fontSize) * scaleX;
      const fontFamily = computed.fontFamily || "monospace";
      const fontWeight = computed.fontWeight || "normal";
      ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      ctx.fillStyle = computed.color || "white";
      ctx.textBaseline = "top";

      const textAlign = computed.textAlign;
      if (textAlign === "center") {
        ctx.textAlign = "center";
        ctx.fillText(text, x + w / 2, y + (h - fontSize) / 2, w);
      } else if (textAlign === "right") {
        ctx.textAlign = "right";
        ctx.fillText(text, x + w, y + (h - fontSize) / 2, w);
      } else {
        ctx.textAlign = "left";
        const px = parseFloat(computed.paddingLeft) * scaleX;
        ctx.fillText(text, x + px, y + (h - fontSize) / 2, w - px * 2);
      }
    }
  }

  // Recurse into children
  for (const child of Array.from(el.children) as HTMLElement[]) {
    paintElement(ctx, child, containerRect, scaleX, scaleY);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function useVideoRecorder(): UseVideoRecorder {
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [activeMap, setActiveMap] = useState<Map<string, { cameraMode: string; elapsedSec: number }>>(new Map());
  const recordingsRef = useRef<Map<string, ActiveRecording>>(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ensureTimer = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      const now = Date.now();
      setActiveMap((prev) => {
        const next = new Map<string, { cameraMode: string; elapsedSec: number }>();
        for (const [id, rec] of recordingsRef.current) {
          next.set(id, {
            cameraMode: rec.meta.cameraMode,
            elapsedSec: Math.floor((now - rec.startMs) / 1000),
          });
        }
        if (next.size === 0 && prev.size === 0) return prev;
        return next;
      });
    }, 1000);
  }, []);

  const clearTimerIfEmpty = useCallback(() => {
    if (recordingsRef.current.size === 0 && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setActiveMap(new Map());
    }
  }, []);

  const startRecording = useCallback(
    (container: HTMLElement, name: string, droneId: string | null, cameraMode: string): string => {
      const id = generateId();

      const cesiumCanvas = findCesiumCanvas(container);
      if (!cesiumCanvas) {
        throw new Error("No canvas found in container");
      }

      // Use the Cesium canvas dimensions for the recording
      const width = cesiumCanvas.width || container.clientWidth;
      const height = cesiumCanvas.height || container.clientHeight;

      // Create offscreen compositing canvas
      const compositingCanvas = document.createElement("canvas");
      compositingCanvas.width = width;
      compositingCanvas.height = height;

      // Separate offscreen canvas for caching the HUD overlay between repaints
      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.width = width;
      overlayCanvas.height = height;

      // Capture the compositing canvas stream
      const stream = compositingCanvas.captureStream(30);
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
      const chunks: Blob[] = [];

      let thumbnailCaptured = false;
      let stopped = false;
      // Throttle overlay painting to every ~200ms to reduce overhead
      let lastOverlayPaint = 0;
      const OVERLAY_PAINT_INTERVAL = 200;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        stopped = true;
        const active = recordingsRef.current.get(id);
        if (active) {
          cancelAnimationFrame(active.rafId);
          const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
          const url = URL.createObjectURL(blob);
          const duration = Math.floor((Date.now() - active.startMs) / 1000);

          const session: RecordingSession = {
            id,
            name: active.meta.name,
            droneId: active.meta.droneId,
            cameraMode: active.meta.cameraMode,
            startedAt: new Date(active.startMs).toISOString(),
            duration,
            blob,
            url,
            thumbnailUrl: active.thumbnailUrl ?? "",
            sizeBytes: blob.size,
          };

          recordingsRef.current.delete(id);
          setSessions((prev) => [session, ...prev]);
          clearTimerIfEmpty();
        }
      };

      // rAF compositing loop — draws each frame to the compositing canvas
      const drawFrame = (): void => {
        if (stopped) return;

        // Re-acquire context every frame to handle canvas resizes safely.
        // getContext("2d") returns the same context object but this ensures
        // we don't hold a stale reference after a width/height reset.
        const ctx = compositingCanvas.getContext("2d");
        if (!ctx) {
          // Context lost — schedule next attempt
          const active = recordingsRef.current.get(id);
          if (active) active.rafId = requestAnimationFrame(drawFrame);
          return;
        }

        // Resize canvases if source changed
        const cw = cesiumCanvas.width || cesiumCanvas.clientWidth;
        const ch = cesiumCanvas.height || cesiumCanvas.clientHeight;
        if (cw > 0 && ch > 0 && (compositingCanvas.width !== cw || compositingCanvas.height !== ch)) {
          compositingCanvas.width = cw;
          compositingCanvas.height = ch;
          overlayCanvas.width = cw;
          overlayCanvas.height = ch;
        }

        // Clear and draw the Cesium 3D canvas
        ctx.clearRect(0, 0, compositingCanvas.width, compositingCanvas.height);
        try {
          ctx.drawImage(cesiumCanvas, 0, 0, compositingCanvas.width, compositingCanvas.height);
        } catch {
          // WebGL context might be lost — skip this frame
        }

        // Periodically re-render HUD overlay into cached overlay canvas
        const now = Date.now();
        if (now - lastOverlayPaint > OVERLAY_PAINT_INTERVAL) {
          lastOverlayPaint = now;
          const oCtx = overlayCanvas.getContext("2d");
          if (oCtx) {
            oCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
            try {
              oCtx.save();
              paintOverlayFromDom(oCtx, container, overlayCanvas.width, overlayCanvas.height);
              oCtx.restore();
            } catch {
              // Non-fatal — overlay painting failed
            }
          }
        }

        // Composite the cached overlay on top every frame (no flicker)
        try {
          ctx.drawImage(overlayCanvas, 0, 0);
        } catch {
          // ignore
        }

        // Capture thumbnail on first frame
        if (!thumbnailCaptured) {
          thumbnailCaptured = true;
          try {
            const active = recordingsRef.current.get(id);
            if (active) {
              active.thumbnailUrl = compositingCanvas.toDataURL("image/png");
            }
          } catch {
            // ignore — tainted canvas etc.
          }
        }

        const active = recordingsRef.current.get(id);
        if (active) {
          active.rafId = requestAnimationFrame(drawFrame);
        }
      };

      const rafId = requestAnimationFrame(drawFrame);

      const activeRec: ActiveRecording = {
        recorder,
        chunks,
        startMs: Date.now(),
        meta: { name, droneId, cameraMode },
        compositingCanvas,
        rafId,
      };
      recordingsRef.current.set(id, activeRec);

      recorder.start(1000);
      ensureTimer();

      setActiveMap((prev) => {
        const next = new Map(prev);
        next.set(id, { cameraMode, elapsedSec: 0 });
        return next;
      });

      return id;
    },
    [ensureTimer, clearTimerIfEmpty]
  );

  const stopRecording = useCallback((sessionId: string) => {
    const active = recordingsRef.current.get(sessionId);
    if (!active) return;
    cancelAnimationFrame(active.rafId);
    if (active.recorder.state !== "inactive") {
      active.recorder.stop();
    }
  }, []);

  const stopAllRecordings = useCallback(() => {
    for (const [, active] of recordingsRef.current) {
      cancelAnimationFrame(active.rafId);
      if (active.recorder.state !== "inactive") {
        active.recorder.stop();
      }
    }
  }, []);

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const session = prev.find((s) => s.id === id);
      if (session) {
        URL.revokeObjectURL(session.url);
        if (session.thumbnailUrl && session.thumbnailUrl.startsWith("blob:")) {
          URL.revokeObjectURL(session.thumbnailUrl);
        }
      }
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const clearAllSessions = useCallback(() => {
    setSessions((prev) => {
      for (const session of prev) {
        URL.revokeObjectURL(session.url);
        if (session.thumbnailUrl && session.thumbnailUrl.startsWith("blob:")) {
          URL.revokeObjectURL(session.thumbnailUrl);
        }
      }
      return [];
    });
  }, []);

  return {
    recording: activeMap.size > 0,
    activeRecordings: activeMap,
    startRecording,
    stopRecording,
    stopAllRecordings,
    sessions,
    deleteSession,
    clearAllSessions,
  };
}
