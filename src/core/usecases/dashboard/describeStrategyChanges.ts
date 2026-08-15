import type { SimulationParams } from '../../entities/types';
import type { RankedStrategyCandidate } from '../../strategy/StrategyOptimizer';

// 「현재 계획에서 달라지는 점」. 화면의 추천 카드와 PDF 리포트가 **같은 함수**를 쓴다.
//
// 예전에는 이 로직이 StrategyRecommendationCards.tsx 안에만 있었고 PDF에는 추천이 아예
// 없었다. PDF에 추천을 실으면서 문구를 다시 짜면 같은 계획의 두 문서가 서로 다른 변경
// 목록을 말하게 된다 — 그래서 계산이 아니라 «서술»이지만 Single Source of Truth를 지킨다.
//
// React에 의존하지 않도록 core에 둔다. PDF 렌더러(.ts)가 컴포넌트 파일(.tsx)을 import하면
// lucide-react·CSS 모듈까지 함께 끌려온다.

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

export interface StrategyChange {
  label: string;
  before: string;
  after: string;
}

export function describeStrategyChanges(
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
