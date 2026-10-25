import type {
  AccountWithdrawalPolicy,
  NationalPensionStrategy,
  SimulationParams,
  SpendingShapePreset,
} from '../../entities/types';
import type { RetirementGoalType } from '../../entities/retirementGoal';
import { normalizeRetirementGoals } from '../../entities/retirementGoal';
import type { RankedStrategyCandidate } from '../../strategy/StrategyOptimizer';
import { SPENDING_SHAPE_BY_PATTERN, type SpendingPattern } from '../../strategy/StrategyGenerator';
import { NATIONAL_PENSION_STRATEGY_AGES, resolveStrategy } from '../strategy/compileStrategy';
import { applyRetirementGoals } from '../goals/retirementGoalAdapter';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../pension/nationalPensionRules';

// 추천 전략과 사용자 설정을 잇는 **다섯 축의 단일 테이블**.
//
// 「현재 계획에서 달라지는 점」을 서술하는 일(describeStrategyChanges)과 그 값을 실제로
// 설정에 반영하는 일(applyStrategyToParams)은 같은 매핑을 봐야 한다. 두 함수를 나란히
// 두면 축을 하나 추가할 때 한쪽만 고치는 일이 반드시 생기고, 그러면 카드가 말한 변경이
// 적용되지 않거나 말하지 않은 변경이 적용된다. 그래서 둘 다 이 테이블에서 파생시킨다.
//
// React에 의존하지 않는다 — PDF 렌더러(.ts)와 화면(.tsx)이 함께 쓴다.

// 유니온으로 조여 둔다. `Record<string, string>`이면 축이 저장값을 그대로 읽는 지금 구조에서
// PROPORTIONAL·CUSTOM이 라벨 없이 화면에 원문으로 찍히는데, 컴파일러가 그것을 잡지 못한다.
const WITHDRAWAL_LABELS: Record<AccountWithdrawalPolicy, string> = {
  GENERAL_FIRST: '일반계좌 우선 인출',
  ISA_FIRST: 'ISA 우선 인출',
  PENSION_FIRST: '연금계좌 우선 인출',
  TAX_OPTIMIZED: '세금 최적화 순서로 인출',
  PROPORTIONAL: '계좌별 비례 인출',
  CUSTOM: '사용자 지정 순서로 인출',
};

// 「생활비 전략」 섹션의 SPENDING_SHAPE_OPTIONS와 같은 것을 가리키는 이름이어야 한다 —
// 카드가 「통계 기준으로 감소」라고 말했는데 설정 화면에 그 이름이 없으면 사용자는 방금
// 적용한 것을 되돌릴 항목을 찾지 못한다.
const SPENDING_LABELS = {
  FIXED: '생활비를 일정하게 유지',
  FRONT_LOADED: '통계 기준으로 감소',
  CARE_HEAVY: '완만하게 감소',
} as const;

/**
 * 국민연금 개시 나이 → 전략 enum. compileStrategy의 NATIONAL_PENSION_STRATEGY_AGES에서
 * 파생하므로 그쪽 표가 바뀌면 여기도 따라온다.
 *
 * 'ai_optimized'는 제외한다 — 값은 'normal'과 같은 65세지만 뜻이 "아직 정하지 않았다"이고,
 * 그대로 써 넣으면 AI 센티널이 다시 덮어쓸 수 있는 상태가 된다.
 */
const NATIONAL_PENSION_STRATEGY_BY_AGE: ReadonlyMap<number, NationalPensionStrategy> = new Map(
  (Object.keys(NATIONAL_PENSION_STRATEGY_AGES) as NationalPensionStrategy[])
    .filter((strategy) => strategy !== 'ai_optimized')
    .map((strategy) => [NATIONAL_PENSION_STRATEGY_AGES[strategy], strategy] as const)
);

export type StrategyFieldKey =
  | 'retirementAge'
  | 'nationalPensionStartAge'
  | 'targetMonthlySpending'
  | 'withdrawalPolicy'
  | 'spendingPattern';

/** 반영 결과. 반영할 수 없으면 조용히 넘기지 않고 사유를 돌려준다. */
export type StrategyFieldApplication =
  | { applied: true; params: SimulationParams }
  | { applied: false; reason: string };

export interface StrategyFieldSpec {
  key: StrategyFieldKey;
  /** 카드·PDF가 함께 쓰는 축 이름. 적용 상태 알림의 「반영하지 못했습니다」도 이 이름을 쓴다. */
  label: string;
  /** 현재 계획이 추천과 다른가. describe와 apply가 **같은 술어**를 본다. */
  differs(params: SimulationParams, ranked: RankedStrategyCandidate): boolean;
  describe(
    params: SimulationParams,
    ranked: RankedStrategyCandidate,
    formatValue: (value: number) => string,
  ): { before: string; after: string };
  /** 입력을 변형하지 않고 새 params를 만든다. */
  apply(params: SimulationParams, ranked: RankedStrategyCandidate): StrategyFieldApplication;
}

/**
 * `{ ...params, strategy: ... }` 관용구. 코드베이스의 설정 섹션들과 같은 방식이되,
 * 국민연금 축을 조용히 움직이지 않도록 한 가지를 더 한다.
 *
 * resolveStrategy는 저수준 withdrawalPlan.nationalPensionStartAge에서 수령 전략을 유도하지
 * 않는다(seedStrategyFromLegacyParams는 생활비·상속 축만 유도한다). 그래서 전략 객체를
 * 처음 실체화하는 순간 이 축이 기본값 'ai_optimized'(=65세)로 채워지고, compileStrategy가
 * 그 값으로 개시 나이를 덮어쓴다. 즉 「생활비 배분」만 바꾸려던 적용이 국민연금 개시 나이까지
 * 함께 옮긴다 — 카드가 말하지 않은 변경이다.
 *
 * 반영하지 않기로 한 축은 건드리지 않는다는 원칙에 따라, 아직 전략을 저장한 적 없는
 * 시나리오에 한해 현재 개시 나이에 해당하는 enum을 함께 고정한다.
 *
 * 격자(60·65·66·67·70) 밖의 나이는 표현할 enum이 없어 고정하지 못한다. 그 시나리오는
 * 이 함수와 무관하게 이미 65세로 계산되고 있다 — compileStrategy가 전략 축에서 개시
 * 나이를 유도하는 구조라, 목표를 하나라도 선택한 순간(즉 분석을 돌리는 모든 경우)
 * 저장된 63세는 엔진에 닿지 않는다. 여기서 되살리려면 compileStrategy가 저수준 값을
 * 존중하도록 바꿔야 하는데, 그것은 기존 저장 시나리오의 결과를 바꾸는 별도 작업이다.
 */
function withStrategy(
  params: SimulationParams,
  patch: Partial<ReturnType<typeof resolveStrategy>>,
): SimulationParams {
  const pinned = params.strategy === undefined
    ? NATIONAL_PENSION_STRATEGY_BY_AGE.get(currentPensionAge(params))
    : undefined;
  return {
    ...params,
    strategy: {
      ...resolveStrategy(params),
      ...(pinned ? { nationalPensionStrategy: pinned } : {}),
      ...patch,
    },
  };
}

/**
 * 목표가 정하는 축은 «목표»를 고쳐야 반영된다.
 *
 * userProfile만 덮어쓰면 다음 정규화(normalizeGoalDrivenParams)가 그 값을 목표에서 다시
 * 파생시켜, 방금 적용한 값이 조용히 사라진다. 그래서 목표의 targetValue를 바꾸고
 * applyRetirementGoals에 투영을 맡긴다 — 화면(목표 카드)과 계산이 같은 숫자를 말하게 된다.
 *
 * 대응하는 목표를 고르지 않았으면 반영하지 않는다. 사용자가 고르지 않은 목표를 여기서
 * 만들어 내면, 「최대 5개」 제한과 우선순위를 앱이 대신 결정하게 된다.
 */
function withGoalTarget(
  params: SimulationParams,
  types: readonly RetirementGoalType[],
  value: number,
  reason: string,
  planAxis?: (params: SimulationParams, value: number) => SimulationParams,
): StrategyFieldApplication {
  const goals = normalizeRetirementGoals(params.retirementGoals ?? []);
  const index = goals.findIndex((goal) => types.includes(goal.type));
  if (index === -1) return { applied: false, reason };

  // 출처 표시(targetValueSource)는 «있으면 그대로 두고, 없으면 만들지 않는다».
  //
  // 「반영」은 전후 금액(before/after)을 나란히 놓고 누르는 «명시적 행위»라, 이미 확정된
  // 목표의 금액을 바꿔도 확정 상태를 잃지 않는다 — 사용자는 바뀔 숫자를 보고 눌렀다.
  // 반대로 미확정 목표에 표시를 새로 «만들지는» 않는다. 그 금액을 고른 것은 추천이지
  // 사용자가 아니고, 확정은 목표 카드에서 사용자가 직접 입력을 마쳤을 때만 생긴다
  // (known-issues 14번).
  //
  // 타이핑이 표시를 «떼어 내는» 것(changeTargetValue)과 어긋나 보이지만, 가르는 기준은
  // 같다 — 사용자가 그 숫자를 보고 확인했는가. 타이핑에는 그 순간이 없고 반영에는 있다.
  const next = goals.map((goal, i) => (i === index ? { ...goal, targetValue: value } : goal));
  // 미확정 목표금액은 계획의 축이 되지 못하므로(normalizeGoalDrivenParams), 금액 축은 계획
  // 쪽에도 직접 세워야 반영이 살아남는다. 확정된 목표가 있는 계획에서는 정규화가 그 값으로
  // 다시 덮으므로, 두 자리가 어긋난 채 저장되는 일은 없다.
  const seeded = planAxis ? planAxis(params, value) : params;
  return { applied: true, params: applyRetirementGoals(seeded, next) };
}

export const STRATEGY_FIELD_MAP: readonly StrategyFieldSpec[] = [
  {
    key: 'retirementAge',
    label: '은퇴 시점',
    differs: (params, ranked) =>
      params.userProfile.retirementAge !== ranked.candidate.strategy.retirementAge,
    describe: (params, ranked) => ({
      before: `${params.userProfile.retirementAge}세`,
      after: `${ranked.candidate.strategy.retirementAge}세`,
    }),
    apply: (params, ranked) => withGoalTarget(
      params,
      ['EARLY_RETIREMENT'],
      ranked.candidate.strategy.retirementAge,
      '「빠른 은퇴」 목표를 선택해야 은퇴 시점을 바꿀 수 있습니다',
    ),
  },
  {
    key: 'nationalPensionStartAge',
    label: '국민연금',
    differs: (params, ranked) =>
      currentPensionAge(params) !== ranked.candidate.strategy.nationalPensionStartAge,
    describe: (params, ranked) => ({
      before: `${currentPensionAge(params)}세`,
      after: `${ranked.candidate.strategy.nationalPensionStartAge}세`,
    }),
    apply: (params, ranked) => {
      const age = ranked.candidate.strategy.nationalPensionStartAge;
      const strategy = age === undefined ? undefined : NATIONAL_PENSION_STRATEGY_BY_AGE.get(age);
      // 가장 가까운 나이로 근사하지 않는다. 카드가 "70세"라고 말했는데 67세가 적용되면
      // 화면과 계산이 서로 다른 말을 한다 — 반영하지 못했다고 밝히는 편이 정직하다.
      if (age === undefined || strategy === undefined) {
        return { applied: false, reason: '국민연금 수령 전략으로 표현할 수 없는 개시 나이입니다' };
      }
      const withdrawalPlan = { ...(params.withdrawalPlan ?? {}), nationalPensionStartAge: age };
      return {
        applied: true,
        params: withStrategy({ ...params, withdrawalPlan }, { nationalPensionStrategy: strategy }),
      };
    },
  },
  {
    key: 'targetMonthlySpending',
    label: '월 생활비',
    differs: (params, ranked) =>
      params.userProfile.targetMonthlySpending !== ranked.candidate.strategy.targetMonthlySpending,
    describe: (params, ranked, formatValue) => ({
      before: formatValue(params.userProfile.targetMonthlySpending),
      after: formatValue(ranked.candidate.strategy.targetMonthlySpending),
    }),
    // 생활비 전략을 'target'으로 내리는 처리는 필요 없다 — 정규화가 모든 계획을 그 모드로
    // 고정한다(normalizeGoalDrivenParams).
    apply: (params, ranked) => withGoalTarget(
      params,
      ['LIVING_EXPENSE_STABILITY', 'COMFORTABLE_SPENDING'],
      ranked.candidate.strategy.targetMonthlySpending,
      '「생활비 안정」 또는 「여유 있는 소비」 목표를 선택해야 월 생활비를 바꿀 수 있습니다',
      (current, value) => ({
        ...current,
        userProfile: { ...current.userProfile, targetMonthlySpending: value },
      }),
    ),
  },
  {
    key: 'withdrawalPolicy',
    label: '자산 인출',
    // 이 축은 dimensions가 아니라 «시뮬레이션된 전략»을 읽는다. 다른 축과 다른 예외가 아니라
    // 오히려 규칙 쪽이다.
    //
    // dimensions를 읽으면 「현상 유지」 후보에서 깨진다. 예전에는 baselineDimensions가 미지정
    // 정책을 'GENERAL_FIRST'로 적어 뒀고(라벨용 기본값), 그러면 (1) 아무것도 바꾸지 않는
    // 카드가 "현재 설정 → 일반계좌 우선 인출"이라는 변경점을 표시하고, (2) 반영 버튼이 그
    // 값을 실제로 저장한다. (2)는 표시 문제가 아니다: SimulationEngine은
    // accountWithdrawalPolicy가 미지정일 때만 기존 정기 균등분할 지급 경로를 타므로, 값을
    // 박아 넣는 순간 카드가 보여 준 숫자와 «다른 계획»이 저장된다. 그 기본값은 이제 없다.
    //
    // 비교는 값 하나로 충분하다 — 「이 변경이 효과가 있는가」를 여기서 다시 시뮬레이션해
    // 묻지 않는다. 효과 없는 후보는 여기 오기 «전에» 접힌다
    // (StrategyOptimizer.dedupeByDeterministicOutcome).
    differs: (params, ranked) =>
      params.withdrawalPlan?.accountWithdrawalPolicy
        !== ranked.candidate.strategy.withdrawalPolicy.accountWithdrawalPolicy,
    describe: (params, ranked) => {
      const current = params.withdrawalPlan?.accountWithdrawalPolicy;
      const next = ranked.candidate.strategy.withdrawalPolicy.accountWithdrawalPolicy;
      return {
        before: current ? WITHDRAWAL_LABELS[current] : '현재 설정',
        after: next ? WITHDRAWAL_LABELS[next] : '현재 설정',
      };
    },
    apply: (params, ranked) => {
      const next = ranked.candidate.strategy.withdrawalPolicy.accountWithdrawalPolicy;
      // 후보가 정책을 지정하지 않았다면(= 현상 유지) 반영할 것이 없다. 여기서 기본값을
      // 채워 넣으면 위 주석의 (2)가 그대로 재현된다.
      if (next === undefined) {
        return { applied: false, reason: '현재 인출 정책을 그대로 두는 후보입니다' };
      }
      const withdrawalPlan = {
        ...(params.withdrawalPlan ?? {}),
        accountWithdrawalPolicy: next,
      };
      // 후보 생성기와 같은 처리(StrategyGenerator.strategyFor). 남겨 두면 새 정책과 짝이
      // 맞지 않는 사용자 지정 순서가 유령처럼 남는다.
      delete withdrawalPlan.customWithdrawalOrder;
      return { applied: true, params: { ...params, withdrawalPlan } };
    },
  },
  {
    key: 'spendingPattern',
    label: '생활비 배분',
    // 다른 축과 같이 «현재 설정»과 비교한다. 예전에는 후보 값만 보고 'FIXED'가 아니면
    // 무조건 변경으로 셌는데, 그때는 반영 경로가 없어 현재 설정이 언제나 곡선 없음이었기
    // 때문이다. 이제 계획이 곡선을 가질 수 있으므로 같은 배분을 쓰는 계획에 「연령대별
    // 동일 기준 → …」이라는 없는 변경점이 뜨면 안 된다.
    differs: (params, ranked) => currentShape(params) !== candidateShape(ranked),
    describe: (params, ranked) => ({
      before: SPENDING_LABELS[patternOf(currentShape(params))],
      after: SPENDING_LABELS[ranked.candidate.dimensions.spendingPattern],
    }),
    // 소비 성향은 전략 축이므로 저수준 spendingCurve가 아니라 strategy.spendingShape에
    // 써야 한다. 곡선만 써 넣으면 compileStrategy가 전략에서 곡선을 다시 만들며 덮어쓴다
    // (nationalPensionStrategy·riskProfile이 같은 이유로 전략 축에 쓰는 것과 같다).
    apply: (params, ranked) => ({
      applied: true,
      params: withStrategy(params, { spendingShape: candidateShape(ranked) }),
    }),
  },
];

function currentShape(params: SimulationParams): SpendingShapePreset {
  return resolveStrategy(params).spendingShape ?? 'flat';
}

function candidateShape(ranked: RankedStrategyCandidate): SpendingShapePreset {
  return SPENDING_SHAPE_BY_PATTERN[ranked.candidate.dimensions.spendingPattern];
}

/** 소비 성향 → 격자 축 라벨. SPENDING_LABELS를 현재 설정 쪽에도 쓰기 위한 역방향이다. */
function patternOf(shape: SpendingShapePreset): SpendingPattern {
  const found = (Object.keys(SPENDING_SHAPE_BY_PATTERN) as SpendingPattern[])
    .find((pattern) => SPENDING_SHAPE_BY_PATTERN[pattern] === shape);
  // 표가 SpendingShapePreset 전체를 덮으므로 도달하지 않는다. 손상된 시나리오의 알 수 없는
  // 값이 여기 오면 「일정하게 유지」로 읽어 두는 편이 화면이 비는 것보다 낫다.
  return found ?? 'FIXED';
}

function currentPensionAge(params: SimulationParams): number {
  return params.withdrawalPlan?.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE;
}
