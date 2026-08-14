import { Loader2, Star } from 'lucide-react';
import type { SimulationParams } from '../../../../core/entities/types';
import type { RankedStrategyCandidate } from '../../../../core/strategy/StrategyOptimizer';
import type { StrategyOptimizationStatus } from '../../../hooks/useStrategyOptimization';
import GlassCard from '../../../components/GlassCard';
import styles from '../Dashboard.module.css';

interface StrategyRecommendationCardsProps {
  candidates: readonly RankedStrategyCandidate[];
  status: StrategyOptimizationStatus;
  currentGoalProbability?: number;
  params: SimulationParams;
  formatValue: (value: number) => string;
}

const WITHDRAWAL_LABELS: Record<string, string> = {
  GENERAL_FIRST: '일반계좌 우선 인출',
  ISA_FIRST: 'ISA 우선 인출',
  PENSION_FIRST: '연금계좌 우선 인출',
  TAX_OPTIMIZED: '세금 최적화 순서로 인출',
};

const ALLOCATION_LABELS = {
  CONSERVATIVE: '보수적 자산배분',
  BALANCED: '균형 자산배분',
  GROWTH: '성장형 자산배분',
} as const;

const SPENDING_LABELS = {
  FIXED: '생활비를 일정하게 유지',
  FRONT_LOADED: '은퇴 초기에 생활비를 더 사용',
  CARE_HEAVY: '후기 의료·돌봄 지출에 대비',
} as const;

export function strategyCharacteristicLabel(candidate: RankedStrategyCandidate): string {
  if (candidate.candidate.dimensions.spendingPattern === 'FRONT_LOADED') return '초기 여유형';
  if (candidate.candidate.dimensions.spendingPattern === 'CARE_HEAVY') return '돌봄 대비형';
  if (candidate.candidate.dimensions.assetAllocation === 'CONSERVATIVE') return '안정형';
  if (candidate.candidate.dimensions.assetAllocation === 'GROWTH') return '성장형';
  return '균형형';
}

export interface StrategyChange {
  label: string;
  before: string;
  after: string;
}

export function strategyChanges(
  params: SimulationParams,
  ranked: RankedStrategyCandidate,
  formatValue: (value: number) => string,
): StrategyChange[] {
  const { strategy } = ranked.candidate;
  const dimensions = ranked.candidate.dimensions;
  const currentPensionAge = params.withdrawalPlan?.nationalPensionStartAge ?? 65;
  const currentWithdrawal = params.withdrawalPlan?.accountWithdrawalPolicy;
  const currentAllocation = params.yieldPreset;
  const changes: StrategyChange[] = [];

  if (params.userProfile.retirementAge !== strategy.retirementAge) {
    changes.push({
      label: '은퇴 시점',
      before: `${params.userProfile.retirementAge}세`,
      after: `${strategy.retirementAge}세`,
    });
  }
  if (currentPensionAge !== strategy.nationalPensionStartAge) {
    changes.push({
      label: '국민연금',
      before: `${currentPensionAge}세`,
      after: `${strategy.nationalPensionStartAge}세`,
    });
  }
  if (params.userProfile.targetMonthlySpending !== strategy.targetMonthlySpending) {
    changes.push({
      label: '월 생활비',
      before: formatValue(params.userProfile.targetMonthlySpending),
      after: formatValue(strategy.targetMonthlySpending),
    });
  }
  if (currentWithdrawal !== dimensions.withdrawalPolicy) {
    changes.push({
      label: '자산 인출',
      before: currentWithdrawal ? WITHDRAWAL_LABELS[currentWithdrawal] ?? currentWithdrawal : '현재 설정',
      after: WITHDRAWAL_LABELS[dimensions.withdrawalPolicy] ?? dimensions.withdrawalPolicy,
    });
  }
  const candidatePreset = strategy.legacySettings.yieldPreset;
  if (currentAllocation !== candidatePreset) {
    changes.push({
      label: '투자 성향',
      before: currentAllocation === 'conservative' ? '보수적 자산배분'
        : currentAllocation === 'aggressive' ? '성장형 자산배분' : '균형 자산배분',
      after: ALLOCATION_LABELS[dimensions.assetAllocation],
    });
  }
  if (dimensions.spendingPattern !== 'FIXED') {
    changes.push({
      label: '생활비 배분',
      before: '연령대별 동일 기준',
      after: SPENDING_LABELS[dimensions.spendingPattern],
    });
  }

  return changes;
}

export function StrategyRecommendationCards({
  candidates,
  status,
  currentGoalProbability,
  params,
  formatValue,
}: StrategyRecommendationCardsProps) {
  if (status === 'running' || status === 'idle') {
    return (
      <GlassCard className="flex items-center gap-2 text-sm text-foreground-muted">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        최종 후보의 시장 변동 경로를 검증하고 있습니다...
      </GlassCard>
    );
  }

  if (status === 'error' || status === 'unsupported') {
    return (
      <GlassCard className="text-sm text-foreground-muted">
        추천 전략 3개를 검증하지 못했습니다. 현재 계획 분석과 상세 분석은 계속 확인할 수 있습니다.
      </GlassCard>
    );
  }

  if (candidates.length === 0) {
    return <GlassCard className="text-sm text-foreground-muted">현재 목표 조건을 만족하는 추천 후보가 없습니다.</GlassCard>;
  }

  const recommended = candidates[0];
  return (
    <>
      <div className={styles.recommendationComparison} aria-label="현재 계획과 추천 전략 비교">
        <div>
          <span>현재 목표 달성률</span>
          <strong>{currentGoalProbability === undefined ? '계산 중' : `${Math.round(currentGoalProbability * 100)}%`}</strong>
        </div>
        <span className={styles.comparisonArrow} aria-hidden="true">→</span>
        <div>
          <span>추천 전략 적용</span>
          <strong>{Math.round((recommended.monteCarlo?.goalSuccessProbability ?? 0) * 100)}%</strong>
        </div>
      </div>

      <div className={styles.recommendationGrid}>
        {candidates.map((candidate) => {
          const probability = candidate.monteCarlo?.goalSuccessProbability ?? 0;
          const changes = strategyChanges(params, candidate, formatValue);
          return (
            <article
              key={candidate.candidate.id}
              className={`${styles.strategyCard} ${candidate.rank === 1 ? styles.recommendedStrategyCard : ''}`}
            >
              <header className={styles.strategyCardHeader}>
                <div>
                  <p className={styles.strategyLabel}>{strategyCharacteristicLabel(candidate)}</p>
                  <p className={styles.strategySummary}>
                    {ALLOCATION_LABELS[candidate.candidate.dimensions.assetAllocation]} ·{' '}
                    {SPENDING_LABELS[candidate.candidate.dimensions.spendingPattern]}
                  </p>
                </div>
                {candidate.rank === 1 && (
                  <span className={styles.recommendedBadge}><Star size={13} aria-hidden="true" /> 추천</span>
                )}
              </header>

              <dl className={styles.strategyMetrics}>
                <div><dt>목표 성공확률</dt><dd>{Math.round(probability * 100)}%</dd></div>
                <div><dt>생활비</dt><dd>월 {formatValue(candidate.candidate.strategy.targetMonthlySpending)}</dd></div>
                <div><dt>예상 잔여자산</dt><dd>{formatValue(candidate.monteCarlo?.terminalAssetMedian ?? candidate.simulation.endingAssets)}</dd></div>
              </dl>

              <div className={styles.strategyChanges}>
                <h4>현재 계획에서 달라지는 점</h4>
                {changes.length > 0 ? (
                  <dl>
                    {changes.map((change) => (
                      <div key={change.label}>
                        <dt>{change.label}</dt>
                        <dd><span>{change.before}</span><b aria-hidden="true">→</b><strong>{change.after}</strong></dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p>핵심 설정은 유지하고 시장 변동 안정성만 재검증한 전략입니다.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
