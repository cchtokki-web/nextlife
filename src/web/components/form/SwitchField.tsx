'use client';

import { GlossaryTerm } from '../ui';
import { ChangedBadge } from './ChangedBadge';
import { HelpTip } from './HelpTip';

interface SwitchFieldProps {
  label: string;
  description: string; // 2줄 이하
  checked: boolean;
  onChange: (checked: boolean) => void;
  tooltipTerm?: GlossaryTerm;
  tooltipText?: string;
  changed?: boolean;
}

// 설명문을 반드시 포함하는 스위치. 설명 없는 on/off는 사용자가 무엇을 켰는지
// 알 수 없으므로 description을 optional로 두지 않는다.
export function SwitchField({
  label, description, checked, onChange, tooltipTerm, tooltipText, changed,
}: SwitchFieldProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-card-border p-3">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-primary,#6366f1)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {label}
          <HelpTip term={tooltipTerm} text={tooltipText} />
          <ChangedBadge changed={changed} />
        </span>
        <span className="text-xs leading-snug text-foreground-muted">{description}</span>
      </span>
    </label>
  );
}
