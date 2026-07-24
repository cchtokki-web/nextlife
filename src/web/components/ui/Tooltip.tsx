'use client';

import { useId, useState, type ReactNode } from 'react';

interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
}

export function Tooltip({ label, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();

  const show = () => setVisible(true);
  const hide = () => setVisible(false);

  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      <span tabIndex={0} onFocus={show} onBlur={hide} aria-describedby={visible ? tooltipId : undefined}>
        {children}
      </span>
      {visible && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-card-border bg-background px-2 py-1 text-xs text-foreground shadow-lg"
        >
          {label}
        </span>
      )}
    </span>
  );
}
