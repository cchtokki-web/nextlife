'use client';

import { motion } from 'framer-motion';
import { UtilityBreakdown, UtilityConfig } from '../../../../core/entities/types';
import { buildUtilityComponentMeta } from '../utilityComponentMeta';

interface UtilityBreakdownBarsProps {
  utility: UtilityBreakdown;
  // 점수를 실제로 계산한 config의 가중치(= 각 항목의 만점). 목표 우선순위가 이 값을
  // 통째로 갈아끼우므로 화면이 기본값을 가정하면 분모가 틀린다 — buildUtilityComponentMeta 참조.
  weights: UtilityConfig['weights'];
}

// UtilityCard.tsx에 있던 6개 Utility 구성요소 바 차트를 그대로 이관.
export function UtilityBreakdownBars({ utility, weights }: UtilityBreakdownBarsProps) {
  return (
    <div className="flex flex-col gap-2">
      {buildUtilityComponentMeta(weights).map(({ key, label, max, color }) => {
        const value = utility.components[key];
        const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
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
        );
      })}
    </div>
  );
}
