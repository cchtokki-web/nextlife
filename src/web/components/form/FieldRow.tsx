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
  // AI가 제안한 값의 표시 문자열(예: "70세").
  aiHint?: string;
  // 이 값이 계산에 실제로 반영됐는지. 전략이 'ai_optimized'(미정)로 남아 있으면
  // applyAiSentinels가 추천값을 시뮬레이션에 넣으므로 "추천"이 아니라 "적용"이다.
  // 배지 문구가 둘을 구분하지 않으면 화면은 "AI 최적화"라고만 말하는데 엔진은 68세로
  // 계산하는 상태와, 추천만 있고 반영되지 않은 상태를 사용자가 구분할 수 없다.
  aiHintApplied?: boolean;
  // 격자 안에서의 배치 클래스(예: 'col-span-2'). 금액 입력처럼 두 칸을 다 써야
  // 값이 안 잘리는 항목이 있어 호출부가 지정할 수 있게 열어 둔다.
  className?: string;
  children: ReactNode;
}

// 라벨 + 도움말 + 입력 + 상태 배지를 한 줄로 묶는 설정 항목 셸.
export function FieldRow({
  label, tooltipTerm, tooltipText, changed, aiHint, aiHintApplied = false, className = '', children,
}: FieldRowProps) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs sm:text-[13px] font-medium text-foreground/85">{label}</span>
        <HelpTip term={tooltipTerm} text={tooltipText} />
        <ChangedBadge changed={changed} />
        {aiHint && (
          <span className="text-xs font-semibold text-primary/90 bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5">
            {aiHintApplied ? 'AI 적용' : 'AI 추천'}: {aiHint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
