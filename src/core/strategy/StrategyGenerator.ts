import type { AccountWithdrawalPolicy, SpendingCurve } from '../entities/types';
import type {
  AccountProjection,
  RetirementGoals,
  RetirementProfile,
  RetirementStrategy,
} from '../domain/input/retirement';
import { normalizeRetirementGoals } from '../entities/retirementGoal';
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
  /**
   * 최종 안전장치. 기본 격자는 은퇴나이 × 국민연금개시 × 인출정책 × 소비패턴 × 자산배분이며,
   * 은퇴나이 축이 seed·목표 나이로 늘어나면 기본값 1,000을 넘어 잘릴 수 있다. 잘린 수는
   * `debug.cappedCandidateCount`로 드러나고, 탈락은 점수가 아니라 순회 순서로 정해진다.
   */
  maxCandidates?: number;
}

export interface StrategyGenerationDebug {
  axisSizes: Record<keyof StrategyDimensions, number>;
  theoreticalCombinationCount: number;
  generatedCandidateCount: number;
  cappedCandidateCount: number;
  omittedAxes: ReadonlyArray<{ axis: OmittedAxis; reason: string }>;
}

export type OmittedAxis = typeof OMITTED_AXES[number]['axis'];

export interface StrategyGenerationResult {
  candidates: StrategyCandidate[];
  debug: StrategyGenerationDebug;
}

// 입력에 의존하지 않는 상수라 매 호출마다 새로 만들지 않는다. `axis` 유니온도 여기서
// 파생시켜(OmittedAxis), 항목을 추가할 때 타입을 따로 손대지 않아도 되게 한다.
const OMITTED_AXES = [
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
  {
    axis: 'spendingPolicyMode',
    reason: '후보 비교 기준을 맞추기 위해 모든 후보를 target 모드로 고정합니다. max_sustainable을 쓰던 사용자에게는 추천 전략의 생활비 기준이 현재 설정과 다릅니다.',
  },
] as const satisfies ReadonlyArray<{ axis: string; reason: string }>;

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

  // 모든 후보를 'target' 모드로 고정한다. 후보끼리 비교하려면 같은 기준의 목표 생활비를
  // 써야 하는데, 'max_sustainable'은 목표액 대신 엔진이 역산한 지속가능액을 쓰기 때문이다
  // (freezeSpendingPlan.ts). 즉 사용자가 max_sustainable을 쓰고 있었다면 추천 후보는 그
  // 설정과 다른 전략이며, 이 사실은 debug.omittedAxes의 spendingPolicyMode 항목에 남는다.
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
    goals: RetirementGoals,
    seed: RetirementStrategy,
    options: StrategyGenerationOptions = {},
  ): StrategyGenerationResult {
    const maxCandidates = Math.max(1, Math.floor(options.maxCandidates ?? DEFAULT_MAX_CANDIDATES));
    // 이미 은퇴한 사용자의 seed 은퇴 나이는 현재 나이보다 과거여도 반드시 보존한다.
    // 새 후보만 현재~계획 종료 구간으로 제한해야 기존 시나리오가 후보 0개로 사라지지 않는다.
    // 선택한 조기은퇴 목표가 기존 고정 격자 밖에 있어도 후보로 직접 평가한다. HARD 여부와
    // 무관하게 생성하고, 실제 탈락 판단은 HardConstraintFilter 한 곳에서 맡는다.
    const goalRetirementAges = normalizeRetirementGoals(goals.selectedGoals ?? [])
      .filter((goal) => goal.type === 'EARLY_RETIREMENT' && goal.targetValue !== undefined)
      .map((goal) => goal.targetValue as number)
      .filter((age) => age >= profile.personal.currentAge && age <= seed.planHorizonAge);
    const retirementAges = uniqueSorted([
      seed.retirementAge,
      ...goalRetirementAges,
      ...RETIREMENT_AGE_GRID.filter((age) =>
        age >= profile.personal.currentAge && age <= seed.planHorizonAge
      ),
    ]);

    const nationalPension = profile.pensions.find((pension) => pension.kind === 'national');
    const hasNationalPension = (nationalPension?.account.expectedMonthlyAmount ?? 0) > 0;
    // 은퇴 나이 축과 같은 기준으로 거른다. 현재 나이 이전의 개시 나이는 이미 지나간 선택이라
    // 후보가 될 수 없다. 남겨 두면 조기수령 감액률만 영구 적용된 채 순위에 오른다.
    const nationalPensionGrid = [
      NATIONAL_PENSION_EARLY_MIN_AGE,
      NATIONAL_PENSION_NORMAL_START_AGE,
      NATIONAL_PENSION_DEFERRED_MAX_AGE,
    ].filter((age) => age >= profile.personal.currentAge && age <= seed.planHorizonAge);
    // 모든 법정 개시 나이가 projection 밖이면(계획 종료가 60세 전이거나 이미 그 나이를 지난
    // 경우) 연금 축을 비우지 않고 기존 설정을 유지해, "기간 내 미수령" 전략도 정상 평가한다.
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
        omittedAxes: OMITTED_AXES,
      },
    };
  }
}
