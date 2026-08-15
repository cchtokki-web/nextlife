import type { NationalPensionStrategy, RiskProfile, SimulationParams } from '../../entities/types';
import type { RetirementGoalType } from '../../entities/retirementGoal';
import { normalizeRetirementGoals } from '../../entities/retirementGoal';
import type { RankedStrategyCandidate } from '../../strategy/StrategyOptimizer';
import { NATIONAL_PENSION_STRATEGY_AGES, resolveStrategy } from '../strategy/compileStrategy';
import { applyRetirementGoals } from '../goals/retirementGoalAdapter';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../pension/nationalPensionRules';

// 추천 전략과 사용자 설정을 잇는 **여섯 축의 단일 테이블**.
//
// 「현재 계획에서 달라지는 점」을 서술하는 일(describeStrategyChanges)과 그 값을 실제로
// 설정에 반영하는 일(applyStrategyToParams)은 같은 매핑을 봐야 한다. 두 함수를 나란히
// 두면 축을 하나 추가할 때 한쪽만 고치는 일이 반드시 생기고, 그러면 카드가 말한 변경이
// 적용되지 않거나 말하지 않은 변경이 적용된다. 그래서 둘 다 이 테이블에서 파생시킨다.
//
// React에 의존하지 않는다 — PDF 렌더러(.ts)와 화면(.tsx)이 함께 쓴다.

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

/**
 * 수익률 프리셋 → 리스크 성향. compileStrategy의 RISK_PROFILE_PRESETS를 뒤집은 것이다.
 *
 * 두 값을 **함께** 써야 하는 이유: compileStrategy는 리스크 성향이 지배값이면
 * applyYieldPreset으로 yieldPreset을 다시 덮어쓴다. 프리셋만 써 넣으면 분석을 다시
 * 돌리는 순간 사용자의 옛 성향으로 되돌아가, 버튼이 아무 일도 하지 않은 것처럼 보인다.
 */
const RISK_PROFILE_BY_PRESET: Record<'conservative' | 'base' | 'aggressive', RiskProfile> = {
  conservative: 'conservative',
  base: 'neutral',
  aggressive: 'aggressive',
};

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
  | 'assetAllocation'
  | 'spendingPattern';

/** 반영 결과. 반영할 수 없으면 조용히 넘기지 않고 사유를 돌려준다. */
export type StrategyFieldApplication =
  | { applied: true; params: SimulationParams }
  | { applied: false; reason: string };

export interface StrategyFieldSpec {
  key: StrategyFieldKey;
  /** 카드·PDF·배너가 함께 쓰는 축 이름. */
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
 * 그 값으로 개시 나이를 덮어쓴다. 즉 「투자 성향」만 바꾸려던 적용이 국민연금 개시 나이까지
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
): StrategyFieldApplication {
  const goals = normalizeRetirementGoals(params.retirementGoals ?? []);
  const index = goals.findIndex((goal) => types.includes(goal.type));
  if (index === -1) return { applied: false, reason };

  const next = goals.map((goal, i) => (i === index ? { ...goal, targetValue: value } : goal));
  return { applied: true, params: applyRetirementGoals(params, next) };
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
    ),
  },
  {
    key: 'withdrawalPolicy',
    label: '자산 인출',
    differs: (params, ranked) =>
      params.withdrawalPlan?.accountWithdrawalPolicy !== ranked.candidate.dimensions.withdrawalPolicy,
    describe: (params, ranked) => {
      const current = params.withdrawalPlan?.accountWithdrawalPolicy;
      const next = ranked.candidate.dimensions.withdrawalPolicy;
      return {
        before: current ? WITHDRAWAL_LABELS[current] ?? current : '현재 설정',
        after: WITHDRAWAL_LABELS[next] ?? next,
      };
    },
    apply: (params, ranked) => {
      const withdrawalPlan = {
        ...(params.withdrawalPlan ?? {}),
        accountWithdrawalPolicy: ranked.candidate.dimensions.withdrawalPolicy,
      };
      // 후보 생성기와 같은 처리(StrategyGenerator.strategyFor). 남겨 두면 새 정책과 짝이
      // 맞지 않는 사용자 지정 순서가 유령처럼 남는다.
      delete withdrawalPlan.customWithdrawalOrder;
      return { applied: true, params: { ...params, withdrawalPlan } };
    },
  },
  {
    key: 'assetAllocation',
    label: '투자 성향',
    differs: (params, ranked) => params.yieldPreset !== candidatePreset(ranked),
    describe: (params, ranked) => ({
      before: params.yieldPreset === 'conservative' ? '보수적 자산배분'
        : params.yieldPreset === 'aggressive' ? '성장형 자산배분' : '균형 자산배분',
      after: ALLOCATION_LABELS[ranked.candidate.dimensions.assetAllocation],
    }),
    apply: (params, ranked) => {
      const preset = candidatePreset(ranked);
      // 'custom'(자산별 직접 입력)이나 미지정은 프리셋이 아니라서 리스크 성향으로 옮길 수
      // 없다. 시장성 자산이 하나도 없는 시나리오에서 후보가 프리셋 없이 생성될 때 나온다.
      if (preset === undefined || !(preset in RISK_PROFILE_BY_PRESET)) {
        return { applied: false, reason: '후보가 수익률 프리셋을 지정하지 않았습니다' };
      }
      const governing = preset as keyof typeof RISK_PROFILE_BY_PRESET;
      return {
        applied: true,
        params: withStrategy(
          { ...params, yieldPreset: governing },
          { riskProfile: RISK_PROFILE_BY_PRESET[governing] },
        ),
      };
    },
  },
  {
    key: 'spendingPattern',
    label: '생활비 배분',
    // 이 축만 현재 설정을 보지 않고 후보의 값만 본다. 의도된 현행 동작이다 —
    // 판정 기준을 바꾸면 화면과 PDF 리포트의 문구가 함께 움직인다.
    differs: (_params, ranked) => ranked.candidate.dimensions.spendingPattern !== 'FIXED',
    describe: (_params, ranked) => ({
      before: '연령대별 동일 기준',
      after: SPENDING_LABELS[ranked.candidate.dimensions.spendingPattern],
    }),
    // 반영 경로가 막혀 있다. compileStrategy는 생활비 모드가 '최대 지속가능'일 때만 곡선을
    // 만드는데(그 밖에는 spendingCurve 키를 지운다), 추천 후보는 전부 '목표액' 모드로
    // 고정 생성된다. 곡선을 살리려고 모드를 바꾸면 추천의 목표 생활비가 무시되므로 두
    // 요구가 정면으로 충돌한다. 계산 경로를 넓히는 것은 기존 저장 시나리오의 결과를
    // 바꾸는 일이라 별도 작업으로 둔다.
    apply: () => ({
      applied: false,
      reason: '목표액 기준 계획에는 연령대별 생활비 곡선을 적용할 수 없습니다',
    }),
  },
];

function currentPensionAge(params: SimulationParams): number {
  return params.withdrawalPlan?.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE;
}

function candidatePreset(ranked: RankedStrategyCandidate): SimulationParams['yieldPreset'] {
  return ranked.candidate.strategy.legacySettings.yieldPreset;
}
