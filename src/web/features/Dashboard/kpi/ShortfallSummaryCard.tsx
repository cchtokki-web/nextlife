'use client';

import { TrendingDown } from 'lucide-react';
import GlassCard from '../../../components/GlassCard';
import { ShortfallReport, ShortfallSummary } from '../../../../core/usecases/dashboard/computeShortfallSummary';

interface ShortfallSummaryCardProps {
  report: ShortfallReport;
  formatValue: (val: number) => string;
}

// "그래서 내가 얼마를 더 준비해야 하는가"에 답하는 카드.
//
// 다른 KPI는 전부 결과 상태를 서술할 뿐이라(준비도 등급, 예상 순자산, 평생 효용) 사용자가
// 행동으로 옮길 숫자가 없었다. 부족액·부족 기간·필요 자산은 이미 계산된 값에서 나오므로
// 새 시뮬레이션 없이 그 빈자리를 메운다.
//
// **두 기준을 나눠 보여주는 이유.**
//
// 「평생 소비 최적화」는 목표 월 350만원을 지속가능한 232만원으로 낮춰 잡는다. 계획 기준으로만
// 보면 부족이 0이라 "문제 없음"으로 읽히지만, 사용자가 세운 목표에는 월 118만원이 모자란다.
// 실제 리포트에 "목표 월 350만원"과 "부족 생활비 월 평균 0원"이 나란히 찍힌 것이 그 결과였다.
export function ShortfallSummaryCard({ report, formatValue }: ShortfallSummaryCardProps) {
  const { goal, plan, goalMonthlySpending, sustainableMonthlySpending } = report;
  if (!goal && !plan) return null;

  // 최적화가 생활비를 낮춰 잡은 계획인가. 그렇다면 목표 기준 부족은 "자산이 모자라다"가
  // 아니라 "목표만큼 쓰면 지속 불가능하다"는 뜻이므로 문장이 달라야 한다.
  const loweredByPlan = sustainableMonthlySpending < goalMonthlySpending;

  return (
    <GlassCard>
      <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <TrendingDown size={18} className="text-danger" aria-hidden="true" />
        현재 계획을 유지하면
      </h3>

      {goal && (
        <section className="mb-4">
          <h4 className="mb-2 text-sm font-semibold text-foreground-muted">목표 생활비 기준</h4>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Row label="목표 생활비">
              월 <strong>{formatValue(goalMonthlySpending)}</strong>
            </Row>
            <Row label="실제 지속가능 생활비">
              월 <strong>{formatValue(sustainableMonthlySpending)}</strong>
            </Row>
            <Row label="목표 대비 부족">
              월 평균 <strong className="text-danger">{formatValue(goal.averageMonthlyShortfall)}</strong>
            </Row>
          </dl>
          <p className="mt-2 text-xs text-foreground-muted">
            {goal.firstShortfallAge}세 ~ {goal.lastShortfallAge}세 {goal.shortfallYears}년간 · 목표를 그대로 채우려면 약{' '}
            <strong>{formatValue(goal.totalShortfallInTodayValue)}</strong>이 더 필요합니다.
          </p>
        </section>
      )}

      {plan ? (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-danger">계획한 생활비조차 채우지 못하는 구간</h4>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Row label="부족 생활비">
              월 평균 <strong className="text-danger">{formatValue(plan.averageMonthlyShortfall)}</strong>
            </Row>
            <Row label="부족 기간">
              <strong>{plan.shortfallYears}년</strong>
              <span className="ml-1 text-xs text-foreground-muted">
                ({plan.firstShortfallAge}세 ~ {plan.lastShortfallAge}세)
              </span>
            </Row>
            <Row label="추가로 필요한 자산">
              약 <strong className="text-danger">{formatValue(plan.totalShortfallInTodayValue)}</strong>
            </Row>
          </dl>
        </section>
      ) : (
        loweredByPlan && (
          <p className="text-sm">
            월 <strong>{formatValue(sustainableMonthlySpending)}</strong> 소비 시에는 자산이 계획대로
            유지됩니다.
          </p>
        )
      )}

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

// 타입만 재수출해 두면 카드를 쓰는 쪽이 usecase 경로를 다시 import하지 않아도 된다.
export type { ShortfallSummary };
