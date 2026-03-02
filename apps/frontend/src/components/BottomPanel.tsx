import { useState, type ReactNode } from "react";
import clsx from "clsx";

interface BottomPanelProps {
  children: ReactNode;
  statusText: string;
}

export function BottomPanel({ children, statusText }: BottomPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="col-span-full flex flex-col gap-0.5">
      {/* Master toggle bar — always visible */}
      <div className="panel flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 transition hover:bg-bg-900/30"
        >
          <svg
            className={clsx(
              "h-3 w-3 text-cyan-100/50 transition-transform",
              expanded ? "rotate-180" : ""
            )}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 8l4-4 4 4" />
          </svg>
          <span className="font-[Orbitron] text-[9px] uppercase tracking-[0.14em] text-cyan-100/55">
            Operations
          </span>
        </button>
        <div className="px-3 py-1.5 text-[10px] text-cyan-100/50">{statusText}</div>
      </div>

      {/* Collapsible accordion body */}
      {expanded && (
        <div className="flex min-h-0 max-h-[360px] flex-col gap-1 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}
