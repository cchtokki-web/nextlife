'use client';

import { motion } from 'framer-motion';
import { BequestStrategy, UtilityBreakdown, UtilityConfig } from '../../../../core/entities/types';
import { buildUtilityComponentMeta } from '../utilityComponentMeta';
import { UtilityComponentExplanations } from '../../../../core/usecases/utility/explainUtilityComponents';

interface UtilityBreakdownBarsProps {
  utility: UtilityBreakdown;
  // 점수를 실제로 계산한 config의 가중치(= 각 항목의 만점). 목표 우선순위가 이 값을
  // 통째로 갈아끼우므로 화면이 기본값을 가정하면 분모가 틀린다 — buildUtilityComponentMeta 참조.
  weights: UtilityConfig['weights'];
  // 축별 점수 근거 한 줄. 점수만으로는 "왜 6점인지"를 알 수 없어 개선할 방법도 없다.
  //
  // 툴팁(hover)이 아니라 항상 보이는 줄로 두는 이유: 모바일에는 hover가 없고 PDF에도
  // 인쇄되지 않아, 정작 설명이 필요한 경로에서 전부 사라진다.
  explanations?: UtilityComponentExplanations;
  // 상속 축의 이름을 정한다 — 「모두 사용」에서는 이 축이 "다 쓰고 갔는가"를 재므로
  // 이름도 그래야 한다(buildUtilityComponentMeta 참조).
  bequestStrategy?: BequestStrategy;
}

// UtilityCard.tsx에 있던 6개 Utility 구성요소 바 차트를 그대로 이관.
export function UtilityBreakdownBars({ utility, weights, explanations, bequestStrategy }: UtilityBreakdownBarsProps) {
  return (
    <div className="flex flex-col gap-3">
      {buildUtilityComponentMeta(weights, bequestStrategy).map(({ key, label, max, color }) => {
        const value = utility.components[key];
        const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
        return (
          <div key={key}>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-foreground-muted">{label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-border/40">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>
              <span className="w-16 shrink-0 text-right font-semibold" style={{ color }}>
                {value}/{max}
              </span>
            </div>
            {explanations && (
              <p className="ml-[6.5rem] mt-1 text-[11px] leading-snug text-foreground-muted">
                {explanations[key]}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
