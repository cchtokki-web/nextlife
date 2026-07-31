'use client';

import { type ReactNode } from 'react';
import { GlossaryTerm } from '../ui';
import { ChangedBadge } from './ChangedBadge';
import { HelpTip } from './HelpTip';

interface FieldRowProps {
  label: string;
  tooltipTerm?: GlossaryTerm;
  tooltipText?: string;
  // 기본값과 다른 값이면 true. diffDefaults가 계산한 결과를 받는다.
  changed?: boolean;
  // AI가 제안한 값의 표시 문자열(예: "70세"). 표시만 하며 자동 적용하지 않는다.
  aiHint?: string;
  children: ReactNode;
}

// 라벨 + 도움말 + 입력 + 상태 배지를 한 줄로 묶는 설정 항목 셸.
export function FieldRow({
  label, tooltipTerm, tooltipText, changed, aiHint, children,
}: FieldRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-foreground-muted">{label}</span>
        <HelpTip term={tooltipTerm} text={tooltipText} />
        <ChangedBadge changed={changed} />
        {aiHint && (
          <span className="text-[10px] text-foreground-muted">AI 추천: {aiHint}</span>
        )}
      </div>
      {children}
    </div>
  );
}
