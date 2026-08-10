'use client';

import { type ReactNode } from 'react';
import { Wallet, Landmark, ShieldCheck, Award, AlertTriangle } from 'lucide-react';
import GlassCard from '../../../components/GlassCard';
import { RetirementLikelihoodStars } from './RetirementLikelihoodStars';
import { PlanAssetStatus } from '../../../../core/usecases/dashboard/resolvePlanAssetStatus';
import { isMonteCarloConflict } from '../../../../core/usecases/montecarlo/monteCarloConflict';
import { computePlanConfidence } from '../../../../core/usecases/dashboard/computePlanConfidence';
import type { MonteCarloStatus } from '../../../hooks/useMonteCarlo';

interface CoreKpiGridProps {
  survivalScore: number; // 은퇴 준비도 점수 (result.retirementScore) — 자산 충분성/현금흐름/연금 커버율/
  // 고갈 위험/인플레이션 방어력을 종합한 점수. "생존 가능성"이 아니라 준비도 등급으로 표기한다.
  expectancy: number;
  endingAssets: number;
  monthlyTarget: number;
  // 연령대별 생활비 곡선을 쓸 때, monthlyTarget이 어느 나이 기준인지. 곡선이 없으면 undefined.
  monthlyTargetAge?: number;
  utilityScore?: number; // Lifetime Utility Score. 없으면(계산 실패 등) 카드 자체를 숨긴다.
  formatValue: (val: number) => string;
  resultBasis?: 'current' | 'recommended';
  // 시장 변동 반영 성공률. 등급 배지 옆에 병기해, 결정론 등급만 보고 안심하는 상태를 막는다.
  // 51인 실측에서 "매우 안정" 25명 중 13명의 MC 성공률이 80% 미만이었다.
  monteCarlo?: { successRate: number };
  monteCarloStatus?: MonteCarloStatus;
  // 결정론 고갈 판정. 충돌 여부는 이 둘을 함께 봐야 정해진다(isMonteCarloConflict).
  planAssetStatus?: PlanAssetStatus;
}

// 결과 화면 최상단 핵심 KPI 4장.
export function CoreKpiGrid({
  survivalScore,
  expectancy,
  endingAssets,
  monthlyTarget,
  monthlyTargetAge,
  utilityScore,
  formatValue,
  resultBasis = 'current',
  monteCarlo,
  monteCarloStatus,
  planAssetStatus,
}: CoreKpiGridProps) {
  // MC는 baseline(현재 계획) 기준으로만 계산된다(page.tsx가 effective.params로 호출).
  // survivalScore는 After 모드에서 추천 결과를 가리키므로, 그대로 병기하면 "추천안의 등급
  // 옆에 현재 계획의 확률"이 붙어 화면이 말하는 값과 계산에 쓴 값이 달라진다.
  // 추천안의 확률을 보이려면 MC를 한 번 더 돌려야 하는데, 그건 토글마다 워커 요청이
  // 두 배가 되고 스켈레톤이 깜빡인다. Before 모드에서만 보여준다.
  const shownMonteCarlo =
    resultBasis === 'current' && monteCarloStatus === 'done' && planAssetStatus !== undefined
      ? monteCarlo
      : undefined;
  const conflict =
    planAssetStatus !== undefined && isMonteCarloConflict(planAssetStatus, shownMonteCarlo);

  // **헤드라인 숫자를 시장 변동 반영 점수로 바꾼다.**
  //
  // 예전에는 결정론 점수를 그대로 크게 보여주고 성공률은 옆에 작게 붙였다. 실제 리포트에서
  // "64점(주의)"과 "성공률 37%"가 그렇게 한 화면에 놓였는데, 사용자가 받는 인상은 앞의
  // 숫자가 결정한다 — 뒤의 확률은 부연으로 읽힌다. 판정을 하나로 합쳐 그 어긋남을 없앤다.
  const confidence = computePlanConfidence(survivalScore, shownMonteCarlo?.successRate);

  // running/idle/error/unsupported는 확률을 표시하지 않고 결정론 등급만 보이는 상태로
  // 폴백한다. 워커를 못 쓰는 환경은 사용자가 어찌할 수 없는데, 그 자리에 경고성 문구를 두면
  // 계획 자체의 문제로 오해된다. MC 상태 자체는 위험 분석 그룹(MonteCarloSection)이 알린다.
  const monteCarloSuffix = shownMonteCarlo ? (
    <span
      className={
        conflict
          ? 'flex items-center gap-1 whitespace-nowrap text-[var(--warning)]'
          : 'flex items-center gap-1 whitespace-nowrap'
      }
      // 등급 aria-label은 별점만 읽으므로 확률은 여기서 따로 읽어 준다.
      aria-label={`시장 변동 반영 시 자산 유지 확률 ${Math.round(shownMonteCarlo.successRate * 100)}%`}
    >
      {conflict && <AlertTriangle size={13} className="shrink-0" aria-hidden="true" />}
      <span aria-hidden="true">
        {confidence.score}점 · 시장변동 {Math.round(shownMonteCarlo.successRate * 100)}%
      </span>
    </span>
  ) : undefined;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {/* 라벨에 "· 시장 변동 반영"을 덧붙이지 않는다. 2열 그리드의 좁은 모바일 카드에서
          세 줄로 접히는데, 바로 아래 접미사가 "시장변동 37%"라고 이미 같은 말을 한다. */}
      <KpiCard
        label={`${expectancy}세까지 은퇴 준비도`}
        icon={<ShieldCheck size={16} aria-hidden="true" />}
      >
        <RetirementLikelihoodStars
          score={confidence.score}
          gradeLabel={confidence.band}
          suffix={monteCarloSuffix}
        />
      </KpiCard>
      <KpiCard label={`${expectancy}세 예상 순자산 · ${resultBasis === 'recommended' ? '추천 결과' : '현재 계획'}`} icon={<Wallet size={16} aria-hidden="true" />}>
        <span className="font-display text-2xl font-semibold">{formatValue(endingAssets)}</span>
      </KpiCard>
      {/* 연령대별 곡선을 쓰면 금액 하나가 어느 구간인지 밝혀야 한다 — 60대와 80대가 다르다. */}
      <KpiCard
        label={monthlyTargetAge !== undefined ? `예상 월 생활비 · ${monthlyTargetAge}세 기준` : '예상 월 생활비'}
        icon={<Landmark size={16} aria-hidden="true" />}
      >
        <span className="font-display text-2xl font-semibold">{formatValue(monthlyTarget)}</span>
      </KpiCard>
      {utilityScore !== undefined && (
        <KpiCard label="평생 효용" icon={<Award size={16} aria-hidden="true" />}>
          {/* 점수를 별 옆이 아니라 등급 텍스트 옆(별 아래 줄)에 붙인다. 카드 폭이 좁아
              별 5개와 "보통 71점"을 한 줄에 두면 글자가 세로로 쪼개진다. */}
          <RetirementLikelihoodStars
            score={utilityScore}
            suffix={<span>{Math.round(utilityScore)}점</span>}
          />
        </KpiCard>
      )}
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
