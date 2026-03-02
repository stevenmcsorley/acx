import { useRef, useEffect } from "react";
import type { AlertEvent } from "../types/domain";

interface EventLogProps {
  alerts: AlertEvent[];
}

export function EventLog({ alerts }: EventLogProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
    }
  }, [alerts.length]);

  return (
    <div className="event-log panel flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-1.5">
        <h3 className="panel-title whitespace-nowrap text-[11px]">Event Log</h3>
        <div className="text-[10px] text-cyan-100/50">{alerts.length} events</div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="status-dot status-dot-pulse bg-accent-green" />
          <span className="text-[10px] text-cyan-100/50">LIVE</span>
        </div>
      </div>
      <div ref={scrollRef} className="custom-scrollbar min-h-0 flex-1 overflow-auto px-3 pb-1.5">
        {alerts.length === 0 ? (
          <div className="text-[11px] text-cyan-100/40">No events recorded.</div>
        ) : (
          <div className="space-y-0.5">
            {alerts.slice(0, 50).map((alert, idx) => (
              <div
                key={`${alert.timestamp}-${alert.droneId}-${idx}`}
                className="flex items-baseline gap-2 text-[11px]"
              >
                <span className="shrink-0 font-mono text-cyan-100/40">
                  {new Date(alert.timestamp).toISOString().slice(11, 23)}
                </span>
                <span
                  className={
                    alert.severity === "critical"
                      ? "shrink-0 font-semibold text-accent-red"
                      : alert.severity === "warning"
                        ? "shrink-0 font-semibold text-accent-amber"
                        : "shrink-0 text-accent-cyan"
                  }
                >
                  [{alert.severity.toUpperCase()}]
                </span>
                <span className="shrink-0 font-semibold text-white">{alert.droneId}</span>
                <span className="truncate text-cyan-100/70">{alert.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
