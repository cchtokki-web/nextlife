'use client';

import { TrendingDown } from 'lucide-react';
import GlassCard from '../../../components/GlassCard';
import { ShortfallSummary } from '../../../../core/usecases/dashboard/computeShortfallSummary';

interface ShortfallSummaryCardProps {
  summary: ShortfallSummary;
  formatValue: (val: number) => string;
}

// "그래서 내가 얼마를 더 준비해야 하는가"에 답하는 세 줄.
//
// 다른 KPI는 전부 결과 상태를 서술할 뿐이라(준비도 등급, 예상 순자산, 평생 효용) 사용자가
// 행동으로 옮길 숫자가 없었다. 부족액·부족 기간·필요 자산은 이미 계산된 값에서 나오므로
// 새 시뮬레이션 없이 그 빈자리를 메운다.
export function ShortfallSummaryCard({ summary, formatValue }: ShortfallSummaryCardProps) {
  return (
    <GlassCard>
      <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <TrendingDown size={18} className="text-danger" aria-hidden="true" />
        현재 계획을 유지하면
      </h3>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Row label="부족 생활비">
          월 평균 <strong className="text-danger">{formatValue(summary.averageMonthlyShortfall)}</strong>
        </Row>
        <Row label="부족 기간">
          <strong>{summary.shortfallYears}년</strong>
          <span className="ml-1 text-xs text-foreground-muted">
            ({summary.firstShortfallAge}세 ~ {summary.lastShortfallAge}세)
          </span>
        </Row>
        <Row label="추가로 필요한 자산">
          약 <strong className="text-danger">{formatValue(summary.totalShortfallInTodayValue)}</strong>
        </Row>
      </dl>
      {/* 가정을 반드시 밝힌다. 이 금액은 부족분을 그대로 채우는 데 드는 돈이지 특정 수익률로
          굴렸을 때 필요한 원금이 아니다 — 밝히지 않으면 확정된 목표 금액으로 읽힌다. */}
      <p className="mt-3 text-xs text-foreground-muted">
        * 추가로 필요한 자산은 부족분을 그대로 채우는 데 드는 금액입니다. 수익률이 물가상승률과
        같다고 볼 때의 현재 구매력 기준이며, 투자 수익을 가정하면 더 적은 금액으로도 가능합니다.
      </p>
    </GlassCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-foreground-muted">{label}</dt>
      <dd className="mt-0.5 font-display text-lg">{children}</dd>
    </div>
  );
}
