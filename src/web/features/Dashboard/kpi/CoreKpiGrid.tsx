'use client';

import { type ReactNode } from 'react';
import { Wallet, Landmark, ShieldCheck, Award, AlertTriangle, Target, CalendarClock } from 'lucide-react';
import GlassCard from '../../../components/GlassCard';
import { RetirementLikelihoodStars } from './RetirementLikelihoodStars';
import { bandToStars } from './gradeToStars';
import {
  PLAN_CONFIDENCE_BAND_LABEL,
  PLAN_CONFIDENCE_BAND_TIER,
  PlanConfidence,
} from '../../../../core/usecases/dashboard/computePlanConfidence';
import type { SimulationMetrics } from '../../../../core/usecases/metrics/SimulationMetricsCalculator';

interface CoreKpiGridProps {
  // 시장 변동을 반영한 판정. 밴드·두 확률·보정 점수가 전부 여기서 나온다.
  confidence: PlanConfidence;
  expectancy: number;
  metrics: SimulationMetrics;
  utilityScore?: number; // Lifetime Utility Score. 없으면(계산 실패 등) 보조 행에서 뺀다.
  formatValue: (val: number) => string;
  resultBasis?: 'current' | 'recommended';
}

// 결과 화면 최상단 핵심 KPI 4장.
//
// **왜 4장인가.** 예전 4장은 (준비도 / 기대수명 시점 순자산 / 예상 월 생활비 / 평생 효용)이라,
// 사용자가 첫 화면에서 얻는 정보 중 절반이 "그래서 내가 무엇을 해야 하는가"와 연결되지 않았다.
// 특히 90세 예상 순자산은 상속 목표가 없는 사용자에게는 순위가 낮은 숫자다.
//
// 지금 4장은 사용자가 실제로 묻는 네 가지다: 이 계획이 될 확률은? / 실제로 얼마를 쓸 수 있나? /
// 내가 원한 금액과 얼마나 차이 나나? / 가장 위험한 구간은 언제인가. 기말 순자산과 평생 효용은
// 아래 보조 행으로 내린다(효용의 근거는 「상세 분석」의 점수 구성이 이미 담당한다).
export function CoreKpiGrid({
  confidence,
  expectancy,
  metrics,
  utilityScore,
  formatValue,
  resultBasis = 'current',
}: CoreKpiGridProps) {
  const isProbabilistic = confidence.basis === 'probabilistic' && confidence.band !== undefined;
  const band = confidence.band;
  // 밴드가 red 계열이면 경고를 시각화한다. 예전에는 isMonteCarloConflict("결정론은 괜찮다는데
  // 확률이 낮다")로 판정했는데, 판정 자체가 확률에서 나오는 지금은 그 조건이 밴드와 같은 말을
  // 두 번 하는 것이 된다.
  const isWarning = band !== undefined && PLAN_CONFIDENCE_BAND_TIER[band] === 'red';

  const firstShortfall = metrics.shortfall.shortfallYears[0];
  const lastShortfall = metrics.shortfall.shortfallYears.at(-1);
  const goalProbability = metrics.goalSuccessProbability;

  const confidenceSuffix = isProbabilistic && confidence.rates ? (
    <span
      className={
        isWarning
          ? 'flex items-center gap-1 whitespace-nowrap text-[var(--warning)]'
          : 'flex items-center gap-1 whitespace-nowrap'
      }
      // 등급 aria-label은 별점만 읽으므로 확률은 여기서 따로 읽어 준다.
      aria-label={`목표 성공 확률 ${Math.round((confidence.rates.goalSuccessProbability ?? confidence.rates.spendingSuccessRate) * 100)}%, 생활 유지 성공률 ${Math.round(confidence.rates.spendingSuccessRate * 100)}%, 자산 보존 성공률 ${Math.round(confidence.rates.assetSuccessRate * 100)}%`}
    >
      {isWarning && <AlertTriangle size={13} className="shrink-0" aria-hidden="true" />}
      <span aria-hidden="true">자산 보존 {Math.round(confidence.rates.assetSuccessRate * 100)}%</span>
    </span>
  ) : (
    <span className="whitespace-nowrap">시장 변동성 미반영</span>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* ① 정량 판정 가능한 목표의 동시 성공확률. 생활 유지와 자산 보존 주변확률도 함께
            적어 어느 축 때문에 전체 확률이 낮아졌는지 숨기지 않는다. */}
        <KpiCard label="정량 목표 성공 확률" icon={<ShieldCheck size={16} aria-hidden="true" />}>
          {isProbabilistic && band !== undefined && confidence.rates && goalProbability !== null ? (
            <div className="flex flex-col gap-1">
              <span className="font-display text-2xl font-semibold">
                {Math.round(goalProbability * 100)}%
              </span>
              <RetirementLikelihoodStars
                score={confidence.score}
                starCount={bandToStars(band)}
                gradeLabel={PLAN_CONFIDENCE_BAND_LABEL[band]}
                suffix={confidenceSuffix}
              />
            </div>
          ) : (
            <RetirementLikelihoodStars score={confidence.score} suffix={confidenceSuffix} />
          )}
        </KpiCard>

        <KpiCard label="현재 전략 평균 실제 소비" icon={<Landmark size={16} aria-hidden="true" />}>
          <span className="font-display text-2xl font-semibold">월 {formatValue(metrics.actualSpending)}</span>
        </KpiCard>

        {/* ③ 사용자가 원한 금액. ②와 나란히 놓여야 차이가 한눈에 보인다. */}
        <KpiCard label="목표 생활비" icon={<Target size={16} aria-hidden="true" />}>
          <div className="flex flex-col gap-0.5">
            <span className="font-display text-2xl font-semibold">월 {formatValue(metrics.targetSpending)}</span>
            <span className="text-sm text-foreground-muted">
              목표 달성률 {Math.round(metrics.spendingAchievementRate * 100)}%
            </span>
          </div>
        </KpiCard>

        {/* ④ 목표 생활비를 실제로 채우지 못한 연도와 그 기간의 평균 부족액. */}
        <KpiCard label="생활비 부족 발생" icon={<CalendarClock size={16} aria-hidden="true" />}>
          {firstShortfall && lastShortfall ? (
            <div className="flex flex-col gap-0.5">
              <span className="font-display text-2xl font-semibold">
                {firstShortfall.age}~{lastShortfall.age}세
              </span>
              <span className="text-sm text-foreground-muted">
                {metrics.shortfall.shortfallYears.length}년 · 월 평균 {formatValue(metrics.shortfall.averageMonthlyShortfall)}
              </span>
            </div>
          ) : (
            <span className="font-display text-2xl font-semibold">없음</span>
          )}
        </KpiCard>
      </div>

      {/* 2순위 지표. 카드에서 내리되 화면에서 지우지는 않는다 — 상속 목표가 있는 사용자에게
          기말 순자산은 여전히 중요하고, 평생 효용은 이 앱의 핵심 개념이다. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-sm text-foreground-muted">
        <span className="inline-flex items-center gap-1.5">
          <Wallet size={14} aria-hidden="true" />
          {expectancy}세 예상 순자산 · {resultBasis === 'recommended' ? '추천 결과' : '현재 계획'}{' '}
          <strong className="font-semibold text-foreground">{formatValue(metrics.terminalAssets)}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Landmark size={14} aria-hidden="true" />
          {metrics.sustainableSpendingBasis === 'probabilistic'
            ? `${Math.round((metrics.sustainableSpendingTargetProbability ?? 0) * 100)}% 목표 기준 지속가능 생활비`
            : '기준 수익률상 지속가능 생활비'}{' '}
          <strong className="font-semibold text-foreground">월 {formatValue(metrics.sustainableSpending)}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck size={14} aria-hidden="true" />
          자산 생존 <strong className="font-semibold text-foreground">{metrics.assetSurvival ? '예' : '아니오'}</strong>
        </span>
        {utilityScore !== undefined && (
          <span className="inline-flex items-center gap-1.5">
            <Award size={14} aria-hidden="true" />
            평생 효용 <strong className="font-semibold text-foreground">{Math.round(utilityScore)}점</strong>
          </span>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <GlassCard className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-sm text-foreground-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div>{children}</div>
    </GlassCard>
  );
}
