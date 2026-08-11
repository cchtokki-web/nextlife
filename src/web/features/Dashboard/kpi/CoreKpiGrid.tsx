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
import { PensionGapRisk } from '../../../../core/usecases/dashboard/computePensionGapRisk';

interface CoreKpiGridProps {
  // 시장 변동을 반영한 판정. 밴드·두 확률·보정 점수가 전부 여기서 나온다.
  confidence: PlanConfidence;
  expectancy: number;
  endingAssets: number;
  // 이 계획이 실제로 지속 가능한 월 생활비(엔진의 역산 결과).
  sustainableMonthly: number;
  // 사용자가 목표로 세운 월 생활비.
  goalMonthly: number;
  // 연령대별 곡선을 쓸 때, 위 금액이 어느 나이 기준인지. 곡선이 없으면 undefined.
  monthlyTargetAge?: number;
  // 은퇴~국민연금 개시 사이의 공백. 없으면 "없음"으로 표시한다 — 카드를 숨기지 않는 이유는
  // 공백이 없다는 것 자체가 좋은 소식이고, 4열 그리드에서 한 칸이 비면 배치가 무너지기 때문이다.
  pensionGap?: PensionGapRisk;
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
  endingAssets,
  sustainableMonthly,
  goalMonthly,
  monthlyTargetAge,
  pensionGap,
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

  const shortfall = goalMonthly - sustainableMonthly;

  const confidenceSuffix = isProbabilistic && confidence.rates ? (
    <span
      className={
        isWarning
          ? 'flex items-center gap-1 whitespace-nowrap text-[var(--warning)]'
          : 'flex items-center gap-1 whitespace-nowrap'
      }
      // 등급 aria-label은 별점만 읽으므로 확률은 여기서 따로 읽어 준다.
      aria-label={`생활 유지 성공률 ${Math.round(confidence.rates.spendingSuccessRate * 100)}%, 자산 보존 성공률 ${Math.round(confidence.rates.assetSuccessRate * 100)}%`}
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
        {/* ① 은퇴 성공률. 큰 숫자는 **생활 유지 성공률**이다 — 사용자가 실제로 두려워하는 것은
            "죽을 때 잔액이 0원인가"가 아니라 "살아 있는 동안 쓸 돈이 모자라는가"이기 때문이다.
            자산 보존 성공률은 바로 아래 함께 적어 둘이 갈리는 계획을 숨기지 않는다. */}
        <KpiCard label="은퇴 성공률 · 생활 유지" icon={<ShieldCheck size={16} aria-hidden="true" />}>
          {isProbabilistic && band !== undefined && confidence.rates ? (
            <div className="flex flex-col gap-1">
              <span className="font-display text-2xl font-semibold">
                {Math.round(confidence.rates.spendingSuccessRate * 100)}%
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

        {/* ② 이 계획으로 실제 쓸 수 있는 금액. */}
        <KpiCard
          label={monthlyTargetAge !== undefined ? `지속가능 생활비 · ${monthlyTargetAge}세 기준` : '지속가능 생활비'}
          icon={<Landmark size={16} aria-hidden="true" />}
        >
          <span className="font-display text-2xl font-semibold">월 {formatValue(sustainableMonthly)}</span>
        </KpiCard>

        {/* ③ 사용자가 원한 금액. ②와 나란히 놓여야 차이가 한눈에 보인다. */}
        <KpiCard label="목표 생활비" icon={<Target size={16} aria-hidden="true" />}>
          <div className="flex flex-col gap-0.5">
            <span className="font-display text-2xl font-semibold">월 {formatValue(goalMonthly)}</span>
            {shortfall > 0 && (
              <span className="text-sm text-danger">월 {formatValue(shortfall)} 부족</span>
            )}
          </div>
        </KpiCard>

        {/* ④ 계획에서 가장 취약한 구간. 근거는 computePensionGapRisk 주석 참고. */}
        <KpiCard label="연금 공백" icon={<CalendarClock size={16} aria-hidden="true" />}>
          {pensionGap ? (
            <div className="flex flex-col gap-0.5">
              <span className="font-display text-2xl font-semibold">
                {pensionGap.fromAge}~{pensionGap.toAge}세
              </span>
              <span className="text-sm text-foreground-muted">
                {pensionGap.years}년 · 월 {formatValue(pensionGap.monthlyAssetWithdrawal)} 인출
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
          <strong className="font-semibold text-foreground">{formatValue(endingAssets)}</strong>
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
