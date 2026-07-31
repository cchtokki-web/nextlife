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
  // 다른 설정이 이 값을 지배할 때 true. 이유는 description에 적어야 한다 —
  // 이유 없이 흐려진 스위치는 고장으로 읽힌다.
  disabled?: boolean;
}

// 설명문을 반드시 포함하는 스위치. 설명 없는 on/off는 사용자가 무엇을 켰는지
// 알 수 없으므로 description을 optional로 두지 않는다.
export function SwitchField({
  label, description, checked, onChange, tooltipTerm, tooltipText, changed, disabled = false,
}: SwitchFieldProps) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border border-card-border p-3 ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        // disabled일 때도 한 번 더 막는다. 브라우저는 비활성 입력에 click을 보내지 않지만
        // 프로그램적으로 dispatch된 이벤트는 그대로 통과하므로, "지배당하는 값"이 조용히
        // 바뀌는 경로를 남기지 않기 위해 여기서 확실히 차단한다.
        onChange={(e) => { if (!disabled) onChange(e.target.checked); }}
        className={`mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary,#6366f1)] ${
          disabled ? 'cursor-not-allowed' : 'cursor-pointer'
        }`}
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
