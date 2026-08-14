import type { AccountWithdrawalPolicy, SpendingCurve } from '../entities/types';
import type {
  AccountProjection,
  RetirementGoals,
  RetirementProfile,
  RetirementStrategy,
} from '../domain/input/retirement';
import {
  NATIONAL_PENSION_DEFERRED_MAX_AGE,
  NATIONAL_PENSION_EARLY_MIN_AGE,
  NATIONAL_PENSION_NORMAL_START_AGE,
} from '../usecases/pension/nationalPensionRules';
import { resolveSpendingCurve } from '../usecases/spending/spendingCurve';
import { YIELD_PRESET_RATES } from '../usecases/scenario/applyYieldPreset';

export type NationalPensionTiming = 'EARLY' | 'NORMAL' | 'DEFERRED';
export type SpendingPattern = 'FIXED' | 'FRONT_LOADED' | 'CARE_HEAVY';
export type AssetAllocationPreset = 'CONSERVATIVE' | 'BALANCED' | 'GROWTH';

export interface StrategyDimensions {
  retirementAge: number;
  nationalPensionTiming: NationalPensionTiming;
  nationalPensionStartAge: number;
  withdrawalPolicy: Exclude<AccountWithdrawalPolicy, 'PROPORTIONAL' | 'CUSTOM'>;
  spendingPattern: SpendingPattern;
  assetAllocation: AssetAllocationPreset;
}

export interface StrategyCandidate {
  id: string;
  dimensions: StrategyDimensions;
  strategy: RetirementStrategy;
}

export interface StrategyGenerationOptions {
  /** A final safety valve. The default grid is at most 1,000 candidates. */
  maxCandidates?: number;
}

export interface StrategyGenerationDebug {
  axisSizes: Record<keyof StrategyDimensions, number>;
  theoreticalCombinationCount: number;
  generatedCandidateCount: number;
  cappedCandidateCount: number;
  omittedAxes: Array<{ axis: 'privatePensionStartAge' | 'cashBufferMonths' | 'guardrail'; reason: string }>;
}

export interface StrategyGenerationResult {
  candidates: StrategyCandidate[];
  debug: StrategyGenerationDebug;
}

const RETIREMENT_AGE_GRID = [58, 59, 60, 61, 62, 63, 64, 65] as const;
const DEFAULT_MAX_CANDIDATES = 1_000;

interface SpendingCandidate {
  label: SpendingPattern;
  curve?: SpendingCurve;
}

interface AllocationCandidate {
  label: AssetAllocationPreset;
  preset: keyof typeof YIELD_PRESET_RATES | null;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function cloneProjection(
  projection: AccountProjection,
  preset: keyof typeof YIELD_PRESET_RATES | null,
): AccountProjection {
  if (!preset) return { ...projection };
  const rates = YIELD_PRESET_RATES[preset];
  return {
    ...projection,
    annualReturn: projection.accountKind === 'private_pension'
      ? rates.pensionReturn
      : rates.stockGrowth,
  };
}

function strategyFor(
  seed: RetirementStrategy,
  dimensions: StrategyDimensions,
  spending: SpendingCandidate,
  allocation: AllocationCandidate,
): RetirementStrategy {
  const withdrawalPolicy = {
    ...seed.withdrawalPolicy,
    accountWithdrawalPolicy: dimensions.withdrawalPolicy,
  };
  delete withdrawalPolicy.customWithdrawalOrder;

  const spendingPolicy = {
    ...seed.spendingPolicy,
    mode: 'target' as const,
    ...(spending.curve ? { curve: spending.curve } : {}),
  };
  if (!spending.curve) delete spendingPolicy.curve;

  const projections = seed.assetAllocation?.accountProjections.map((projection) =>
    cloneProjection(projection, allocation.preset)
  );

  return {
    ...seed,
    retirementAge: dimensions.retirementAge,
    nationalPensionStartAge: dimensions.nationalPensionStartAge,
    withdrawalPolicy,
    spendingPolicy,
    ...(projections
      ? { assetAllocation: { accountProjections: projections } }
      : {}),
    legacySettings: {
      ...seed.legacySettings,
      ...(allocation.preset ? { yieldPreset: allocation.preset } : {}),
    },
  };
}

/**
 * Explainable rule + bounded grid candidate generation.
 *
 * Only strategy axes that the current deterministic engine actually executes are included.
 * Unsupported example axes remain visible in debug output instead of producing duplicate plans.
 */
export class StrategyGenerator {
  generate(
    profile: RetirementProfile,
    _goals: RetirementGoals,
    seed: RetirementStrategy,
    options: StrategyGenerationOptions = {},
  ): StrategyGenerationResult {
    const maxCandidates = Math.max(1, Math.floor(options.maxCandidates ?? DEFAULT_MAX_CANDIDATES));
    // 이미 은퇴한 사용자의 seed 은퇴 나이는 현재 나이보다 과거여도 반드시 보존한다.
    // 새 후보만 현재~계획 종료 구간으로 제한해야 기존 시나리오가 후보 0개로 사라지지 않는다.
    const retirementAges = uniqueSorted([
      seed.retirementAge,
      ...RETIREMENT_AGE_GRID.filter((age) =>
        age >= profile.personal.currentAge && age <= seed.planHorizonAge
      ),
    ]);

    const nationalPension = profile.pensions.find((pension) => pension.kind === 'national');
    const hasNationalPension = (nationalPension?.account.expectedMonthlyAmount ?? 0) > 0;
    const nationalPensionGrid = [
          NATIONAL_PENSION_EARLY_MIN_AGE,
          NATIONAL_PENSION_NORMAL_START_AGE,
          NATIONAL_PENSION_DEFERRED_MAX_AGE,
        ].filter((age) => age <= seed.planHorizonAge);
    // 계획 종료가 60세 전이면 모든 법정 개시 나이가 projection 밖이다. 그 경우에도 연금 축을
    // 비우지 않고 기존 설정을 유지해, "기간 내 미수령" 전략을 정상적으로 평가한다.
    const nationalPensionAges = hasNationalPension && nationalPensionGrid.length > 0
      ? nationalPensionGrid
      : [seed.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE];

    const hasIsa = profile.assets.some((asset) => asset.kind === 'isa');
    const hasPrivatePension = profile.pensions.some((pension) => pension.kind === 'private');
    const accountClassCount = Number(profile.assets.some((asset) => asset.kind === 'investment'))
      + Number(hasIsa) + Number(hasPrivatePension);
    const withdrawalPolicies: StrategyDimensions['withdrawalPolicy'][] = [
      'GENERAL_FIRST',
      ...(hasIsa ? ['ISA_FIRST' as const] : []),
      ...(hasPrivatePension ? ['PENSION_FIRST' as const] : []),
      ...(accountClassCount >= 2 ? ['TAX_OPTIMIZED' as const] : []),
    ];

    const spendingCandidates: SpendingCandidate[] = [
      { label: 'FIXED' },
      { label: 'FRONT_LOADED', curve: resolveSpendingCurve('front_loaded') },
      { label: 'CARE_HEAVY', curve: resolveSpendingCurve('care_heavy') },
    ];
    const hasMarketAccount = profile.assets.length > 0 || hasPrivatePension;
    const allocations: AllocationCandidate[] = hasMarketAccount
      ? [
          { label: 'CONSERVATIVE', preset: 'conservative' },
          { label: 'BALANCED', preset: 'base' },
          { label: 'GROWTH', preset: 'aggressive' },
        ]
      : [{ label: 'BALANCED', preset: null }];

    const candidates: StrategyCandidate[] = [];
    let cappedCandidateCount = 0;
    for (const retirementAge of retirementAges) {
      for (const nationalPensionStartAge of nationalPensionAges) {
        const nationalPensionTiming: NationalPensionTiming = nationalPensionStartAge
          < NATIONAL_PENSION_NORMAL_START_AGE ? 'EARLY'
          : nationalPensionStartAge > NATIONAL_PENSION_NORMAL_START_AGE ? 'DEFERRED' : 'NORMAL';
        for (const withdrawalPolicy of withdrawalPolicies) {
          for (const spending of spendingCandidates) {
            for (const allocation of allocations) {
              if (candidates.length >= maxCandidates) {
                cappedCandidateCount += 1;
                continue;
              }
              const dimensions: StrategyDimensions = {
                retirementAge,
                nationalPensionTiming,
                nationalPensionStartAge,
                withdrawalPolicy,
                spendingPattern: spending.label,
                assetAllocation: allocation.label,
              };
              const id = [
                `retire-${retirementAge}`,
                `np-${nationalPensionStartAge}`,
                withdrawalPolicy,
                spending.label,
                allocation.label,
              ].join('|');
              candidates.push({ id, dimensions, strategy: strategyFor(seed, dimensions, spending, allocation) });
            }
          }
        }
      }
    }

    const axisSizes: StrategyGenerationDebug['axisSizes'] = {
      retirementAge: retirementAges.length,
      nationalPensionTiming: new Set(nationalPensionAges.map((age) =>
        age < NATIONAL_PENSION_NORMAL_START_AGE ? 'EARLY'
        : age > NATIONAL_PENSION_NORMAL_START_AGE ? 'DEFERRED' : 'NORMAL')).size,
      nationalPensionStartAge: nationalPensionAges.length,
      withdrawalPolicy: withdrawalPolicies.length,
      spendingPattern: spendingCandidates.length,
      assetAllocation: allocations.length,
    };
    const theoreticalCombinationCount = retirementAges.length * nationalPensionAges.length
      * withdrawalPolicies.length * spendingCandidates.length * allocations.length;

    return {
      candidates,
      debug: {
        axisSizes,
        theoreticalCombinationCount,
        generatedCandidateCount: candidates.length,
        cappedCandidateCount,
        omittedAxes: [
          {
            axis: 'privatePensionStartAge',
            reason: '현재 엔진은 사적연금 개시 나이를 은퇴 나이(최소 55세)로 결정하므로 독립 축이 아닙니다.',
          },
          {
            axis: 'cashBufferMonths',
            reason: 'cashBufferMonths는 아직 SimulationEngine 인출 경로에 연결되지 않아 후보 축에서 제외했습니다.',
          },
          {
            axis: 'guardrail',
            reason: '현재 엔진에는 동적 GUARDRAIL 소비 규칙이 없어 기존 FIXED/연령별 소비 곡선만 탐색합니다.',
          },
        ],
      },
    };
  }
}
