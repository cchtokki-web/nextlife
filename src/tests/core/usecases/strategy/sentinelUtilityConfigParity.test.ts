import { describe, expect, test } from 'vitest';
import { RETIREMENT_GOAL_TYPES, type RetirementGoal } from '@/core/entities/retirementGoal';
import type {
  ObjectivePriority, RetirementStrategy, SentinelAxisField, SentinelOverlay,
  SimulationParams, StrategyRecommendation, UtilityBreakdown, UtilityConfig,
} from '@/core/entities/types';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { SENTINEL_AXES } from '@/core/usecases/strategy/verifiedSentinelPlan';
import { initialParams } from '@/infrastructure/storage/localStore';

/**
 * 화면과 리포트가 «같은» 목적함수로 평가한다는 것을 못박는다(known-issues 12번).
 *
 * 두 소비자가 utilityConfig를 서로 다른 방법으로 얻는다:
 *   화면(DashboardSection)  `compileStrategy(effective.params).utilityConfig` — 다시 컴파일해서
 *   리포트(app/simulator)   `effective.utilityConfig` — 파이프라인이 들고 있던 것 그대로
 *
 * 그 사이에 `applyAiSentinels`가 있고, 그것은 `{ ...compiled, params }`로 **params만** 갈아끼운다.
 * 그래서 「params는 바뀌었는데 utilityConfig는 옛것」처럼 보이지만, 실제로는 어긋날 수 없다 —
 * utilityConfig는 `retirementGoals`와 `strategy.objective` 두 입력만으로 결정되고
 * (compileStrategy: `createGoalUtilityConfig(params.retirementGoals, objectiveUtilityConfig)`),
 * 자동 채움은 인출계획(withdrawalPlan)과 자산의 배당 재투자 플래그만 건드리기 때문이다.
 *
 * **픽스처 한 장으로 같다는 것을 보이면 아무것도 지키지 못한다.** 그래서 이 파일은 두 가지를
 * 함께 고정한다.
 *   1) 등가: SENTINEL_AXES의 «모든» 축 × 목적함수가 실제로 갈리는 목표 조합에서 두 값이 같다.
 *      축 표를 `satisfies Record<SentinelAxisField, …>`로 받으므로 축을 늘리면 픽스처를 만들 때까지
 *      컴파일이 되지 않는다 — 새 축이 조용히 검사에서 빠지지 않는다.
 *   2) 근거: 자동 채움이 «건드리는 최상위 키»가 withdrawalPlan·assets뿐이라는 사실.
 *      등가는 이 사실의 결과일 뿐이라, 근거가 무너지면(예: 어떤 축이 retirementGoals나
 *      strategy를 다시 쓰기 시작하면) 등가가 우연히 유지되더라도 여기서 먼저 걸린다.
 *
 * 이 파일이 깨지면 「값이 틀렸다」가 아니라 「두 소비자 중 한쪽이 다른 목적함수로 채점하기
 * 시작했다」는 뜻이다. 그때는 known-issues 12번을 다시 열고 어느 쪽이 옳은지부터 정해야 한다.
 */

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3_000_000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1000, averagePrice: 100_000,
      totalReturn: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 1_000_000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const baselineUtility: UtilityBreakdown = {
  score: 70,
  components: {
    consumption: 25, depletionSafety: 18, pensionUtilization: 12,
    taxEfficiency: 8, taxationRisk: 5, bequestAdequacy: 2,
  },
};

// 자동 채움이 실제로 발동하려면 사슬의 효용이 기준선보다 높아야 한다(applyAiSentinels의 게이트).
const improvedUtility: UtilityBreakdown = { ...baselineUtility, score: baselineUtility.score + 1 };

function makeRecommendation(
  verifiedSentinelPlan: StrategyRecommendation['verifiedSentinelPlan'],
  verifiedAssetReinvestment: Record<string, boolean> | null = null,
): StrategyRecommendation {
  return {
    currentUtility: baselineUtility,
    verifiedSentinelPlan,
    recommendedParams: initialParams,
    recommendedUtility: improvedUtility,
    recommendedPlan: null,
    recommendedAssetReinvestment: verifiedAssetReinvestment,
    verifiedAssetReinvestment,
    recommendedPrivatePensionChanneling: null,
    recommendedNewPensionContribution: null,
    channelingIncludesAccountTransfer: false,
    improved: true,
    reasons: [],
    deltas: {
      lifetimeConsumption: 0, totalTax: 0, endingAssets: 0, pensionEndingBalance: 0,
      comprehensiveTaxYears: 0, healthInsuranceTotal: 0, nationalPensionTotal: 0,
    },
    totalCandidateCount: 0,
    failedCandidateCount: 0,
    recommendedResult: {
      yearlyResults: [], fireAge: null, depletionAge: null, endingAssets: 0,
      retirementScore: 0, retirementGrade: '보통', goalAchievementRate: 100,
      retirementAssetsAtRetirement: 0,
    },
    itemizedContributions: [],
  };
}

interface AxisFixture {
  // 이 축을 「미정」으로 만드는 전략 값. 지배 축이 없는 필드는 저수준 값이 없기만 하면 되므로 비어 있다.
  strategy: Partial<RetirementStrategy>;
  // 컴파일 결과와 «다른» 값이어야 한다. 같으면 applyAiSentinels가 "채우지 않았다"고 보고하고
  // 등가 검사가 공허하게 통과한다.
  overlay: SentinelOverlay;
}

// 축 표. `satisfies`가 SENTINEL_AXES의 필드 집합과 이 표를 묶어 두므로, 축을 추가하면
// 여기에 픽스처를 만들기 전까지 타입이 통과하지 않는다.
const AXIS_FIXTURES = {
  nationalPensionStartAge: {
    strategy: { nationalPensionStrategy: 'ai_optimized' },
    overlay: { nationalPensionStartAge: 68 }, // 컴파일 기본값은 65
  },
  privatePensionMonthlyTarget: {
    strategy: { privatePensionStrategy: 'ai_optimized' },
    overlay: { privatePensionMonthlyTarget: 1_000_000 }, // ai_optimized는 키 자체를 지운다
  },
  isaMaturityDestination: {
    strategy: { preferIsaFirst: 'ai_optimized' },
    overlay: { isaMaturityDestination: 'asset' },
  },
  assetSellOrderStrategy: {
    strategy: {},
    overlay: { assetSellOrderStrategy: 'high_dividend_first' },
  },
  generalAssetWithdrawalStartAge: {
    strategy: {},
    overlay: { generalAssetWithdrawalStartAge: 62 },
  },
} satisfies Record<SentinelAxisField, AxisFixture>;

const AXIS_FIELDS = Object.keys(AXIS_FIXTURES) as SentinelAxisField[];

// 목적함수가 «실제로 갈리는» 조합만 모은다. 전부 기본 가중치로 수렴하면 등가 검사가
// 「기본값 = 기본값」이 되어 아무것도 재지 못한다(아래 첫 테스트가 그것을 감시한다).
const OBJECTIVE_CASES: ReadonlyArray<{
  label: string;
  objective: ObjectivePriority;
  goals?: RetirementGoal[];
}> = [
  { label: '목표 배열 자체가 없는 옛 시나리오', objective: 'ai_recommended' },
  { label: '목표는 비었고 목적만 세금 최소화', objective: 'tax_minimization', goals: [] },
  {
    label: '연금 최대 활용 HARD 하나',
    objective: 'ai_recommended',
    goals: [{ type: 'PENSION_OPTIMIZATION', priority: 1, constraintType: 'HARD' }],
  },
  {
    label: '상속 HARD + 생활비 SOFT',
    objective: 'bequest_maximization',
    goals: [
      { type: 'INHERITANCE', priority: 1, targetValue: 300_000_000, constraintType: 'HARD' },
      { type: 'LIVING_EXPENSE_STABILITY', priority: 2, targetValue: 2_500_000, constraintType: 'SOFT' },
    ],
  },
  {
    label: '다섯 개 가득',
    objective: 'lifetime_spending',
    goals: RETIREMENT_GOAL_TYPES.slice(0, 5).map((type, index) => ({
      type, priority: index + 1, constraintType: index % 2 === 0 ? 'HARD' : 'SOFT',
    })),
  },
];

function paramsFor(
  objectiveCase: (typeof OBJECTIVE_CASES)[number],
  strategyOverrides: Partial<RetirementStrategy>,
): SimulationParams {
  const params: SimulationParams = {
    ...baseParams,
    strategy: {
      ...DEFAULT_RETIREMENT_STRATEGY,
      objective: objectiveCase.objective,
      ...strategyOverrides,
    },
  };
  // 목표 배열이 «없는» 상태와 «비어 있는» 상태는 compileStrategy에서 다른 길을 탄다.
  // 키를 넣지 않는 것으로만 앞의 상태를 만들 수 있다.
  if (objectiveCase.goals !== undefined) params.retirementGoals = objectiveCase.goals;
  return params;
}

// 화면이 하는 일과 «같은» 계산. 리포트가 들고 있는 값은 applied.compiled.utilityConfig다.
const screenUtilityConfig = (params: SimulationParams): UtilityConfig =>
  compileStrategy(params).utilityConfig;

// 축 하나짜리 검증 사슬. 실제 recommendStrategy가 만드는 것과 같은 형태다.
const chainFor = (field: SentinelAxisField): StrategyRecommendation['verifiedSentinelPlan'] => [
  { field, planOverrides: AXIS_FIXTURES[field].overlay, utility: improvedUtility },
];

// 모든 인출계획 축을 한 번에 채우는 누적 사슬. planOverrides는 0번부터 여기까지의 «누적»이다.
const fullChain = (): StrategyRecommendation['verifiedSentinelPlan'] => {
  let cumulative: SentinelOverlay = {};
  return AXIS_FIELDS.map((field) => {
    cumulative = { ...cumulative, ...AXIS_FIXTURES[field].overlay };
    return { field, planOverrides: cumulative, utility: improvedUtility };
  });
};

const allAxesSentinel: Partial<RetirementStrategy> = {
  nationalPensionStrategy: 'ai_optimized',
  privatePensionStrategy: 'ai_optimized',
  preferIsaFirst: 'ai_optimized',
};

describe('자동 채움 뒤에도 화면과 리포트의 utilityConfig는 같다', () => {
  test('축 표가 SENTINEL_AXES와 정확히 같은 축을 덮는다', () => {
    // 타입은 「빠진 축」을 잡지만, 표에만 있고 엔진에는 없는 «죽은» 축은 잡지 못한다.
    expect(AXIS_FIELDS.slice().sort()).toEqual(SENTINEL_AXES.map((axis) => axis.field).slice().sort());
  });

  test('목표 조합이 실제로 서로 다른 목적함수를 만든다', () => {
    // 이 검사가 없으면 아래 등가 검사들이 전부 「기본 가중치 = 기본 가중치」로 통과한다.
    const distinct = new Set(
      OBJECTIVE_CASES.map((c) => JSON.stringify(screenUtilityConfig(paramsFor(c, {})).weights)),
    );
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });

  for (const objectiveCase of OBJECTIVE_CASES) {
    for (const field of AXIS_FIELDS) {
      test(`${objectiveCase.label} — ${field}를 채워도 두 값이 같다`, () => {
        const compiled = compileStrategy(paramsFor(objectiveCase, AXIS_FIXTURES[field].strategy));
        const applied = applyAiSentinels(compiled, makeRecommendation(chainFor(field)));

        // 실제로 채워졌는지부터 확인한다. 채우지 못했다면 params가 그대로라 등가는 공허하다.
        expect(applied.appliedFields).toContain(field);
        expect(applied.compiled.params).not.toBe(compiled.params);

        expect(screenUtilityConfig(applied.compiled.params)).toEqual(applied.compiled.utilityConfig);
      });
    }

    test(`${objectiveCase.label} — 배당 축을 채워도 두 값이 같다`, () => {
      const compiled = compileStrategy(paramsFor(objectiveCase, {}));
      // 자산 배열을 갈아끼우는 유일한 축이라 인출계획 축들과 경로가 다르다.
      const applied = applyAiSentinels(compiled, makeRecommendation([], { a1: true }));

      expect(applied.appliedFields).toContain('assetReinvestment');
      expect(applied.compiled.params.assets[0].reinvestDividend).toBe(true);

      expect(screenUtilityConfig(applied.compiled.params)).toEqual(applied.compiled.utilityConfig);
    });

    test(`${objectiveCase.label} — 모든 축을 한꺼번에 채워도 두 값이 같다`, () => {
      const compiled = compileStrategy(paramsFor(objectiveCase, allAxesSentinel));
      const applied = applyAiSentinels(compiled, makeRecommendation(fullChain(), { a1: true }));

      expect(applied.appliedFields.slice().sort())
        .toEqual([...AXIS_FIELDS, 'assetReinvestment' as const].slice().sort());

      expect(screenUtilityConfig(applied.compiled.params)).toEqual(applied.compiled.utilityConfig);
    });
  }

  // 등가의 «근거»를 직접 고정한다. 위 등가 검사들은 이 사실의 결과일 뿐이라, 자동 채움이
  // 목적함수의 입력(retirementGoals, strategy.objective)에 손을 뻗기 시작하면 여기가 먼저 깨진다.
  //
  // 새 축이 정말로 다른 곳을 써야 한다면 이 테스트를 고치기 전에 12번을 다시 열 것 —
  // 그 축이 목적함수를 움직이는 순간 화면과 리포트는 «실제로» 갈린다.
  test('자동 채움이 바꾸는 최상위 키는 withdrawalPlan과 assets뿐이다', () => {
    const ALLOWED: ReadonlyArray<keyof SimulationParams> = ['withdrawalPlan', 'assets'];
    const offenders: string[] = [];

    for (const objectiveCase of OBJECTIVE_CASES) {
      const compiled = compileStrategy(paramsFor(objectiveCase, allAxesSentinel));
      const applied = applyAiSentinels(compiled, makeRecommendation(fullChain(), { a1: true }));

      const keys = new Set([
        ...Object.keys(compiled.params),
        ...Object.keys(applied.compiled.params),
      ]) as Set<keyof SimulationParams>;
      for (const key of keys) {
        if (ALLOWED.includes(key)) continue;
        // 참조 비교다. 값이 같아도 새 객체로 갈아끼웠다면 그 축은 그 키를 «쓰고 있는» 것이므로
        // 목적함수의 입력에 닿았는지 사람이 다시 판단해야 한다.
        if (compiled.params[key] !== applied.compiled.params[key]) {
          offenders.push(`${objectiveCase.label}: ${String(key)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
