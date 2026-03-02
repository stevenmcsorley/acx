import { useEffect, useState } from "react";
import clsx from "clsx";
import type { UserInfo } from "../types/domain";

export type NavTab = "fleet" | "swarm" | "mission" | "intel" | "records" | "settings";

interface TopBarProps {
  user: UserInfo;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  cameraMode: "global" | "follow" | "fpv" | "cinematic";
  onCameraMode: (mode: "global" | "follow" | "fpv" | "cinematic") => void;
  onLogout: () => void;
  onKillSwitch?: () => void;
  autoEngage: boolean;
  onAutoEngageToggle: (enabled: boolean) => void;
}

const NAV_TABS: Array<{ id: NavTab; label: string }> = [
  { id: "fleet", label: "Fleet" },
  { id: "swarm", label: "Swarm Mgr" },
  { id: "mission", label: "Mission Planner" },
  { id: "intel", label: "Intel" },
  { id: "records", label: "Records" },
  { id: "settings", label: "Settings" }
];

const CAMERA_MODES = ["global", "follow", "fpv", "cinematic"] as const;

function UtcClock(): JSX.Element {
  const [time, setTime] = useState(new Date().toISOString().slice(11, 19));

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toISOString().slice(11, 19));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="rounded border border-cyan-300/20 bg-bg-900/80 px-2 py-0.5 font-mono text-[11px] text-accent-cyan">
      {time} <span className="text-cyan-100/50">UTC</span>
    </div>
  );
}

export function TopBar({
  user,
  activeTab,
  onTabChange,
  cameraMode,
  onCameraMode,
  onLogout,
  onKillSwitch,
  autoEngage,
  onAutoEngageToggle
}: TopBarProps): JSX.Element {
  return (
    <header className="panel flex items-center gap-3 px-3 py-1.5">
      <div className="shrink-0">
        <div className="font-display text-[13px] tracking-[0.18em] text-white">SGC-X</div>
        <div className="text-[9px] uppercase tracking-[0.2em] text-cyan-200/50">Spaxels Ground Control</div>
      </div>

      <div className="mx-2 h-6 w-px bg-cyan-300/20" />

      <nav className="flex gap-0.5">
        {NAV_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={clsx(
              "rounded px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] transition",
              activeTab === tab.id
                ? "bg-accent-cyan/20 text-accent-cyan shadow-glow"
                : "text-cyan-100/60 hover:bg-white/5 hover:text-cyan-100/80"
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="mx-2 h-6 w-px bg-cyan-300/20" />

      <div className="flex gap-0.5 rounded border border-cyan-300/15 bg-bg-900/60 p-0.5">
        {CAMERA_MODES.map((mode) => (
          <button
            key={mode}
            onClick={() => onCameraMode(mode)}
            className={clsx(
              "rounded px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] transition",
              cameraMode === mode
                ? "bg-accent-cyan/20 text-accent-cyan"
                : "text-cyan-100/50 hover:bg-white/5"
            )}
          >
            {mode}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <UtcClock />

      <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-cyan-100/60">
        <div
          className={clsx(
            "relative h-4 w-8 cursor-pointer rounded-full transition",
            autoEngage ? "bg-accent-green/40" : "bg-bg-700"
          )}
          onClick={() => onAutoEngageToggle(!autoEngage)}
        >
          <div
            className={clsx(
              "absolute top-0.5 h-3 w-3 rounded-full transition-all",
              autoEngage ? "left-4 bg-accent-green" : "left-0.5 bg-cyan-100/40"
            )}
          />
        </div>
        Auto
      </label>

      <div className="rounded border border-cyan-300/20 bg-bg-900/70 px-2 py-0.5 text-right text-[10px]">
        <div className="font-semibold text-white">{user.displayName}</div>
        <div className="text-cyan-100/50">{user.role}</div>
      </div>

      {onKillSwitch ? (
        <button className="btn-danger text-[10px]" onClick={onKillSwitch}>
          KILL SWITCH
        </button>
      ) : null}

      <button className="btn-secondary text-[10px]" onClick={onLogout}>
        Log Out
      </button>
    </header>
  );
}
