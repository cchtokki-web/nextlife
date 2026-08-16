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

/**
 * 격자 축이 실제로 훑는 인출정책. PROPORTIONAL/CUSTOM은 엔진이 후보로 만들지 않는다.
 * 현상 유지 후보는 이 축 밖의 값을 가질 수 있으므로 `StrategyDimensions`는 더 넓다.
 */
export type GridWithdrawalPolicy = Exclude<AccountWithdrawalPolicy, 'PROPORTIONAL' | 'CUSTOM'>;

export interface StrategyDimensions {
  retirementAge: number;
  nationalPensionTiming: NationalPensionTiming;
  nationalPensionStartAge: number;
  /** 격자 후보는 언제나 `GridWithdrawalPolicy`지만, 현상 유지 후보는 사용자의 현재 설정 그대로다. */
  withdrawalPolicy: AccountWithdrawalPolicy;
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
  /** 격자 조합의 수. 현상 유지 후보는 격자 밖이므로 여기 포함되지 않는다. */
  theoreticalCombinationCount: number;
  generatedCandidateCount: number;
  cappedCandidateCount: number;
  /** 현상 유지(무조정) 후보의 id. 격자 조합 하나와 완전히 같으면 그 조합의 id가 된다. */
  baselineCandidateId: string;
  /**
   * 격자 조합 하나와 완전히 같아 «현상 유지 후보»를 걷어낸 횟수. 0 또는 1이다.
   *
   * 방향에 주의한다 — 건너뛰는 쪽은 격자가 아니라 현상 유지다. 격자 조합은 그대로 만들어지고
   * 먼저 넣어 둔 baseline이 목록에서 빠진다. 그래서 이 수를 격자 쪽에서 빼면 안 된다.
   */
  baselineDuplicateCount: number;
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

function timingFor(startAge: number): NationalPensionTiming {
  if (startAge < NATIONAL_PENSION_NORMAL_START_AGE) return 'EARLY';
  return startAge > NATIONAL_PENSION_NORMAL_START_AGE ? 'DEFERRED' : 'NORMAL';
}

function sameCurve(left: SpendingCurve | undefined, right: SpendingCurve | undefined): boolean {
  if (!left || !right) return false;
  return left.breakpointAges.length === right.breakpointAges.length
    && left.multipliers.length === right.multipliers.length
    && left.breakpointAges.every((age, index) => age === right.breakpointAges[index])
    && left.multipliers.every((value, index) => value === right.multipliers[index]);
}

/**
 * 현상 유지 후보를 격자와 같은 어휘(`StrategyDimensions`)로 옮긴다.
 *
 * 축의 값은 seed에서 «읽기만» 한다. 격자 후보처럼 되돌려 쓰지 않으므로, 여기서 고른 라벨이
 * 틀려도 전략 자체는 사용자의 현재 설정 그대로다. 라벨은 페르소나 자격(RecommendationEngine)과
 * 변경점 표시(strategyFieldMap)에만 쓰인다.
 */
function baselineDimensions(seed: RetirementStrategy): StrategyDimensions {
  const startAge = seed.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE;
  const curve = seed.spendingPolicy.curve;
  const spendingPattern: SpendingPattern =
    sameCurve(curve, resolveSpendingCurve('front_loaded')) ? 'FRONT_LOADED'
    : sameCurve(curve, resolveSpendingCurve('care_heavy')) ? 'CARE_HEAVY'
    // 곡선이 없거나 프리셋 어느 쪽도 아니면 FIXED로 둔다. 변경점 표시가 이 값을 "바꿀 것이
    // 없다"의 뜻으로 읽으므로(strategyFieldMap의 spendingPattern 축), 현상 유지에 맞는 기본이다.
    : 'FIXED';
  const preset = seed.legacySettings.yieldPreset;
  return {
    retirementAge: seed.retirementAge,
    nationalPensionTiming: timingFor(startAge),
    nationalPensionStartAge: startAge,
    withdrawalPolicy: seed.withdrawalPolicy.accountWithdrawalPolicy ?? 'GENERAL_FIRST',
    spendingPattern,
    // 'custom'(자산별 직접 입력)과 미지정은 프리셋이 아니다. 라벨만 BALANCED로 두고,
    // 실제 반영 판정은 프리셋을 직접 읽는 strategyFieldMap의 candidatePreset이 맡는다.
    assetAllocation: preset === 'conservative' ? 'CONSERVATIVE'
      : preset === 'aggressive' ? 'GROWTH'
      : 'BALANCED',
  };
}

/**
 * 두 전략이 같은 계획인지 본다. 둘 다 같은 seed에서 spread로 만들어진 JSON 모양의 값이라
 * 재귀 비교로 충분하다(Date·Map 등은 이 타입에 없다).
 */
function sameStrategy(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left as Record<string, unknown>);
  const rightKeys = Object.keys(right as Record<string, unknown>);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key)
    && sameStrategy(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
    )
  );
}

/** 현상 유지 후보의 id. 격자 id는 모두 `retire-`로 시작하므로 부딪히지 않는다. */
const BASELINE_CANDIDATE_ID = 'baseline';

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
    const withdrawalPolicies: GridWithdrawalPolicy[] = [
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

    // 현상 유지(무조정) 후보를 «격자보다 먼저» 넣는다.
    //
    // 이것이 없으면 argmax는 반드시 어떤 조정을 고른다. 현재 계획이 이미 최선인 사용자에게도
    // 바꿀 것을 권하게 되고, 권고가 실제로 이득인지 판별할 기준선조차 후보 목록에 없다.
    // usecases 계통의 RecommendationEngine은 같은 이유로 topCandidates에 `plan: null`을 넣어
    // 두었다 — 이쪽에만 빠져 있었다.
    //
    // 먼저 넣는 이유는 maxCandidates 상한이다 — 상한에 잘려 나가지 않게 한다(대신 격자
    // 조합 하나가 밀린다). 모든 키가 동률일 때 현상 유지가 이기는 것은 «순서»가 아니라 «id»
    // 덕이다: RecommendationEngine의 세 비교자가 마지막 키로 id.localeCompare를 쓰고
    // 'baseline' < 'retire-…'이므로, 배열 어느 자리에 있든 결과가 같다.
    const baseline: StrategyCandidate = {
      id: BASELINE_CANDIDATE_ID,
      dimensions: baselineDimensions(seed),
      strategy: structuredClone(seed),
    };
    const candidates: StrategyCandidate[] = [baseline];
    let cappedCandidateCount = 0;
    let baselineDuplicateCount = 0;
    let baselineCandidateId = BASELINE_CANDIDATE_ID;
    for (const retirementAge of retirementAges) {
      for (const nationalPensionStartAge of nationalPensionAges) {
        const nationalPensionTiming = timingFor(nationalPensionStartAge);
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
              const strategy = strategyFor(seed, dimensions, spending, allocation);
              // 사용자의 현재 설정이 이미 격자 위에 있는 흔한 경우. 같은 계획을 두 장 만들면
              // 숫자가 완전히 같은 카드가 두 개 뜬다. 격자 쪽을 남기고 현상 유지를 걷어,
              // 후보의 라벨과 id가 나머지 격자 후보와 같은 규칙을 따르게 한다.
              if (baselineDuplicateCount === 0 && sameStrategy(strategy, baseline.strategy)) {
                baselineDuplicateCount += 1;
                baselineCandidateId = id;
                candidates.splice(candidates.indexOf(baseline), 1);
              }
              candidates.push({ id, dimensions, strategy });
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
        baselineCandidateId,
        baselineDuplicateCount,
        omittedAxes: OMITTED_AXES,
      },
    };
  }
}
