import { useState, type ReactNode } from "react";

interface AccordionSectionProps {
  title: string;
  subtitle?: string;
  /** Controlled mode: pass open + onToggle. Uncontrolled: omit both, optionally set defaultOpen. */
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}

export function AccordionSection({
  title,
  subtitle,
  open: controlledOpen,
  defaultOpen = false,
  onToggle,
  children
}: AccordionSectionProps): JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const handleToggle = () => {
    if (isControlled && onToggle) {
      onToggle();
    } else if (!isControlled) {
      setUncontrolledOpen((v) => !v);
    }
  };

  return (
    <section className={`panel min-h-0 overflow-hidden ${open ? "flex flex-1 flex-col" : "flex-none"}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between border-b border-cyan-300/15 px-3 py-2 text-left"
        onClick={handleToggle}
      >
        <div className="min-w-0">
          <div className="panel-title text-[11px]">{title}</div>
          {subtitle ? <div className="mt-0.5 truncate text-[10px] text-cyan-100/45">{subtitle}</div> : null}
        </div>
        <div className="ml-3 text-[12px] text-cyan-100/55">{open ? "−" : "+"}</div>
      </button>
      {open ? <div className="min-h-0 flex-1 overflow-hidden">{children}</div> : null}
    </section>
  );
}
