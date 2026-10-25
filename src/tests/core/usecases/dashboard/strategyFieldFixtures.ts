import type { SimulationParams } from '@/core/entities/types';
import type { StrategyDimensions } from '@/core/strategy/StrategyGenerator';
import type { RankedStrategyCandidate } from '@/core/strategy/StrategyOptimizer';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';

// describeStrategyChanges / applyStrategyToParams / 두 함수의 계약 테스트가 공유하는 픽스처.
//
// 세 파일이 각자 후보를 만들면 "describe는 A를 보고 apply는 B를 본다"는 상황이 생겨,
// 두 함수의 정합을 검증한다는 계약 테스트의 목적 자체가 무너진다.

/**
 * 은퇴 나이·목표 생활비는 「은퇴 목표」 카드가 유일한 편집 경로다(normalizeGoalDrivenParams).
 * 그래서 추천 적용도 그 목표를 고쳐야 반영되며, 목표가 없으면 반영하지 않고 사유를 남긴다.
 * 픽스처는 프로필 값과 «짝이 맞는» 목표를 함께 넣어, 분석을 돌릴 수 있는 실제 상태를 만든다.
 */
function goalsFor(userProfile: SimulationParams['userProfile']): SimulationParams['retirementGoals'] {
  return [
    {
      type: 'EARLY_RETIREMENT',
      priority: 1,
      targetValue: userProfile.retirementAge,
      constraintType: 'HARD',
    },
    {
      type: 'LIVING_EXPENSE_STABILITY',
      priority: 2,
      targetValue: userProfile.targetMonthlySpending,
      constraintType: 'SOFT',
    },
  ];
}

export function makeParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
  const userProfile = overrides.userProfile ?? {
    currentAge: 50,
    retirementAge: 60,
    expectancy: 90,
    targetMonthlySpending: 3_500_000,
  };
  return {
    userProfile,
    retirementGoals: goalsFor(userProfile),
    assets: [],
    nationalPension: { expectedMonthlyAmount: 1_500_000 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    yieldPreset: 'base',
    withdrawalPlan: { nationalPensionStartAge: 65, accountWithdrawalPolicy: 'ISA_FIRST' },
    ...overrides,
  };
}

export interface RankedOverrides extends Partial<StrategyDimensions> {
  targetMonthlySpending?: number;
}

/**
 * 후보의 축 값만 지정해 완전한 RankedStrategyCandidate를 만든다.
 *
 * dimensions와 strategy는 실제 StrategyGenerator가 만들 때처럼 **서로 일치**시킨다.
 * 둘이 어긋난 픽스처는 실제로는 일어나지 않는 조합을 테스트하게 된다.
 */
export function makeRanked(overrides: RankedOverrides = {}): RankedStrategyCandidate {
  const dimensions: StrategyDimensions = {
    retirementAge: overrides.retirementAge ?? 62,
    nationalPensionStartAge: overrides.nationalPensionStartAge ?? 65,
    nationalPensionTiming: overrides.nationalPensionTiming
      ?? ((overrides.nationalPensionStartAge ?? 65) < 65 ? 'EARLY'
        : (overrides.nationalPensionStartAge ?? 65) > 65 ? 'DEFERRED' : 'NORMAL'),
    withdrawalPolicy: overrides.withdrawalPolicy ?? 'ISA_FIRST',
    spendingPattern: overrides.spendingPattern ?? 'FIXED',
  };
  const targetMonthlySpending = overrides.targetMonthlySpending ?? 3_500_000;

  return {
    rank: 1,
    candidate: {
      id: 'candidate-1',
      dimensions,
      strategy: {
        targetMonthlySpending,
        planHorizonAge: 90,
        simulationStartYear: 2026,
        retirementAge: dimensions.retirementAge,
        nationalPensionStartAge: dimensions.nationalPensionStartAge,
        withdrawalPolicy: { accountWithdrawalPolicy: dimensions.withdrawalPolicy },
        // 후보는 언제나 target 모드로 생성된다(StrategyGenerator.strategyFor 주석 참고).
        spendingPolicy: { mode: 'target' },
        legacySettings: {
          inflationRate: 2,
          inflationMode: 'real',
          baseExchangeRate: 1350,
          exchangeScenario: 'base',
          displayCurrency: 'KRW',
          // 후보는 seed의 수익률 가정을 그대로 물려받는다(StrategyGenerator.strategyFor).
          yieldPreset: 'base',
        },
        legacyPresence: {
          withdrawalPlan: true,
          spendingStrategy: false,
          spendingCurve: false,
          assetFloor: false,
        },
        utilityConfig: DEFAULT_UTILITY_CONFIG,
      },
    },
    simulation: { yearlyResults: [], depletionAge: null, endingAssets: 200_000_000 },
    evaluation: {
      hardConstraintsSatisfied: true,
      goalEvaluations: [],
      weightedScore: 80,
      score: 80,
      utility: {
        score: 80,
        components: {
          consumption: 0,
          depletionSafety: 0,
          pensionUtilization: 0,
          taxEfficiency: 0,
          taxationRisk: 0,
          bequestAdequacy: 0,
        },
      },
      hardConstraintFailures: [],
      unsupportedHardGoals: [],
    },
  };
}
