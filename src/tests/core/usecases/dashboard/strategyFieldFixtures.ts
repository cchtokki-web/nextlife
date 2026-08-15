import type { SimulationParams } from '@/core/entities/types';
import type { StrategyDimensions } from '@/core/strategy/StrategyGenerator';
import type { RankedStrategyCandidate } from '@/core/strategy/StrategyOptimizer';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';

// describeStrategyChanges / applyStrategyToParams / 두 함수의 계약 테스트가 공유하는 픽스처.
//
// 세 파일이 각자 후보를 만들면 "describe는 A를 보고 apply는 B를 본다"는 상황이 생겨,
// 두 함수의 정합을 검증한다는 계약 테스트의 목적 자체가 무너진다.

const ALLOCATION_PRESETS = {
  CONSERVATIVE: 'conservative',
  BALANCED: 'base',
  GROWTH: 'aggressive',
} as const;

export function makeParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: {
      currentAge: 50,
      retirementAge: 60,
      expectancy: 90,
      targetMonthlySpending: 3_500_000,
    },
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
    assetAllocation: overrides.assetAllocation ?? 'BALANCED',
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
          yieldPreset: ALLOCATION_PRESETS[dimensions.assetAllocation],
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
