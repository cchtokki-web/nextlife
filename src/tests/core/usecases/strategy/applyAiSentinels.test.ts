import { describe, test, expect } from 'vitest';
import { initialParams } from '@/infrastructure/storage/localStore';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { recommendStrategy } from '@/core/usecases/strategy/RecommendationEngine';
import {
  CompleteWithdrawalPlan, NationalPensionStrategy, SimulationParams, StrategyRecommendation,
  UtilityBreakdown,
} from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1000, averagePrice: 100000,
      totalReturn: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const compiledFor = (nationalPensionStrategy: NationalPensionStrategy) =>
  compileStrategy({
    ...baseParams,
    strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy },
  });

const utility: UtilityBreakdown = {
  score: 76,
  components: {
    consumption: 27, depletionSafety: 20, pensionUtilization: 13,
    taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0,
  },
};

const plan = (nationalPensionStartAge: number): CompleteWithdrawalPlan => ({
  privatePensionMonthlyTarget: 0,
  nationalPensionStartAge,
  assetSellOrderStrategy: 'input_order',
  isaMaturityDestination: 'pension',
  generalAssetWithdrawalStartAge: 60,
  monthlySpendingMultiplier: 1,
});

const utilityWithScore = (score: number): UtilityBreakdown => ({ ...utility, score });

// 국민연금 나이 한 축짜리 검증 사슬. 실제 recommendStrategy가 만드는 것과 같은 형태다.
// 점수 기본값을 baseline보다 1점 높게 둬서, 이 인자를 신경 쓰지 않는 테스트들이
// "적용되는" 경로를 그대로 타게 한다.
const ageChain = (
  nationalPensionStartAge: number,
  score = utility.score + 1
): StrategyRecommendation['verifiedSentinelPlan'] => [
  {
    field: 'nationalPensionStartAge',
    planOverrides: { nationalPensionStartAge },
    utility: utilityWithScore(score),
  },
];

function makeRecommendation(
  recommendedPlan: CompleteWithdrawalPlan | null,
  improved = true,
  // 자동 채움이 검증한 축들의 누적 사슬.
  verifiedSentinelPlan: StrategyRecommendation['verifiedSentinelPlan'] =
    recommendedPlan ? ageChain(recommendedPlan.nationalPensionStartAge) : []
): StrategyRecommendation {
  return {
    currentUtility: utility,
    verifiedSentinelPlan,
    recommendedParams: initialParams,
    recommendedUtility: utility,
    recommendedPlan,
    recommendedAssetReinvestment: null,
    recommendedPrivatePensionChanneling: null,
    recommendedNewPensionContribution: null,
    channelingIncludesAccountTransfer: false,
    improved,
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

describe('applyAiSentinels', () => {
  test("nationalPensionStrategy가 'ai_optimized'이면 추천 나이로 채운다", () => {
    const compiled = compiledFor('ai_optimized');
    expect(compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(65);

    const { compiled: applied } = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied.params.withdrawalPlan?.nationalPensionStartAge).toBe(68);
  });

  test('채운 축을 appliedFields와 appliedValues로 보고한다', () => {
    // 표시 계층("이미 반영됨" 그룹, 설정 패널 배지)이 이 값 하나만 보고 판정한다.
    // 각자 다시 판정하면 어긋나므로 여기가 단일 소스다.
    const compiled = compiledFor('ai_optimized');
    const applied = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied.appliedFields).toEqual(['nationalPensionStartAge']);
    expect(applied.appliedValues.nationalPensionStartAge).toBe(68);
  });

  test('채우지 않았으면 appliedFields가 비어 있고 참조가 매번 같다', () => {
    // 빈 배열을 매번 새로 만들면 소비처의 메모이제이션이 이유 없이 깨진다.
    const compiled = compiledFor('defer_max');
    const a = applyAiSentinels(compiled, makeRecommendation(plan(68)));
    const b = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(a.appliedFields).toEqual([]);
    expect(a.appliedValues).toEqual({});
    expect(a.appliedFields).toBe(b.appliedFields);
    expect(a.appliedValues).toBe(b.appliedValues);
  });

  test('검증된 조합의 효용이 baseline보다 낮으면 채우지 않는다', () => {
    // 추천 격자는 여러 필드를 함께 최적화하므로, 그중 일부만 떼어 사용자의 계획에 이식하면
    // 한 번도 시뮬레이션된 적 없는 조합이 된다. 그 조합이 baseline보다 나쁠 수 있고,
    // 그때 자동 채움은 "AI 적용"이라는 이름으로 결과를 악화시킨다.
    //
    // 정상 경로에서는 recommendStrategy가 이런 사슬을 애초에 만들지 않지만, 판정을 이 함수
    // 안에도 두어 "적용하는 것은 반드시 기준선보다 나은 것"을 국소적으로 읽을 수 있게 한다.
    const compiled = compiledFor('ai_optimized');
    const worse = makeRecommendation(plan(60), true, ageChain(60, utility.score - 1));

    expect(applyAiSentinels(compiled, worse).compiled).toBe(compiled);
  });

  test('검증된 조합의 효용이 baseline과 같으면 채우지 않는다', () => {
    // 개선이 없는데 참조를 새로 만들면 page.tsx의 하위 useMemo가 전부 무효화되어
    // 이 화면에서 가장 무거운 렌더가 이유 없이 다시 돈다.
    const compiled = compiledFor('ai_optimized');
    const flat = makeRecommendation(plan(60), true, ageChain(60, utility.score));

    expect(applyAiSentinels(compiled, flat).compiled).toBe(compiled);
  });

  test('검증된 축이 하나도 없으면 채우지 않는다', () => {
    // 시뮬레이션 실패 등으로 판단 근거가 없을 때는 보수적으로 사용자 계획을 그대로 둔다.
    const compiled = compiledFor('ai_optimized');
    const unknown = makeRecommendation(plan(68), true, []);

    expect(applyAiSentinels(compiled, unknown).compiled).toBe(compiled);
  });

  test('채울 수 없는 축을 만나면 사슬을 거기서 자른다', () => {
    // 중간을 건너뛰고 뒤의 축만 적용하면 안 된다 — 각 단계의 효용은 "0번부터 여기까지"를
    // 함께 시뮬레이션한 값이라, 앞 축을 빼면 그 수치가 근거를 잃는다.
    // 여기서는 국민연금이 확정 전략('defer_max')이라 0번 단계부터 막힌다.
    const compiled = compiledFor('defer_max');
    const chain: StrategyRecommendation['verifiedSentinelPlan'] = [
      { field: 'nationalPensionStartAge', planOverrides: { nationalPensionStartAge: 68 }, utility: utilityWithScore(80) },
      {
        field: 'generalAssetWithdrawalStartAge',
        planOverrides: { nationalPensionStartAge: 68, generalAssetWithdrawalStartAge: 65 },
        utility: utilityWithScore(85),
      },
    ];

    const applied = applyAiSentinels(compiled, makeRecommendation(plan(68), true, chain));

    expect(applied.compiled).toBe(compiled);
    expect(applied.appliedFields).toEqual([]);
  });

  test('지배하는 전략 축이 없는 필드는 저장값이 없으면 채운다', () => {
    // 매도 순서·일반자산 인출 개시 나이는 UI도 전략 축도 없어 컴파일 후에도 미정으로 남는다.
    // 추가 설계 없이 이 두 축이 살아나는 자리다.
    const compiled = compiledFor('defer_max');
    const chain: StrategyRecommendation['verifiedSentinelPlan'] = [
      {
        field: 'generalAssetWithdrawalStartAge',
        planOverrides: { generalAssetWithdrawalStartAge: 65 },
        utility: utilityWithScore(utility.score + 3),
      },
    ];

    const applied = applyAiSentinels(compiled, makeRecommendation(plan(70), true, chain));

    expect(applied.appliedFields).toEqual(['generalAssetWithdrawalStartAge']);
    expect(applied.compiled.params.withdrawalPlan?.generalAssetWithdrawalStartAge).toBe(65);
    // 확정 전략인 국민연금 나이는 그대로 유지된다.
    expect(applied.compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
  });

  test('확정 enum이면 추천이 있어도 채우지 않는다', () => {
    const compiled = compiledFor('defer_max');
    const { compiled: applied } = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied).toBe(compiled);
    expect(applied.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
  });

  test('추천이 없으면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, undefined).compiled).toBe(compiled);
  });

  test('recommendedPlan이 null이면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, makeRecommendation(null)).compiled).toBe(compiled);
  });

  test('improved가 false이면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, makeRecommendation(plan(68), false)).compiled).toBe(compiled);
  });

  test('추천 나이가 이미 컴파일된 값과 같으면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, makeRecommendation(plan(65))).compiled).toBe(compiled);
  });

  test('전략도 저장된 나이도 없는 새 시나리오는 채운다', () => {
    // initialParams에는 strategy가 없어 새 시나리오는 항상 compileStrategy의 통과 경로를
    // 탄다. 여기서 채우지 않으면 설정 패널을 한 번도 열지 않은 사용자 — 가장 흔한 상태 —
    // 에게 자동 채움이 통째로 꺼진다. 화면은 「AI 최적화」를 선택된 채로 보여주므로
    // "화면이 말하는 값 ≠ 엔진이 쓴 값"이 된다.
    const compiled = compileStrategy(baseParams);
    expect(compiled.params.strategy).toBeUndefined();
    expect(compiled.params.withdrawalPlan).toBeUndefined();

    const applied = applyAiSentinels(compiled, makeRecommendation(plan(70)));

    expect(applied.compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
    expect(applied.appliedFields).toEqual(['nationalPensionStartAge']);
  });

  test('통과 경로에 사용자가 저장해 둔 수령 나이가 있으면 추천값으로 덮어쓰지 않는다', () => {
    // compileStrategy의 통과 경로는 "새 기능을 하나도 켜지 않은 시나리오는 입력이 비트
    // 단위로 보존된다"를 보장한다. 이 함수가 그 보장을 깨면, 전략 컴파일러 이전에 저장된
    // 시나리오를 열기만 해도 사용자가 직접 고른 개시 나이가 조용히 바뀐다.
    const compiled = compileStrategy({
      ...baseParams,
      withdrawalPlan: { nationalPensionStartAge: 62 },
    });
    expect(compiled.params.strategy).toBeUndefined();
    expect(compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(62);

    const { compiled: applied } = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied).toBe(compiled);
    expect(applied.params.withdrawalPlan?.nationalPensionStartAge).toBe(62);
  });

  test('withdrawalPlan의 다른 필드와 utilityConfig는 보존된다', () => {
    const compiled = compileStrategy({
      ...baseParams,
      withdrawalPlan: { generalAssetWithdrawalStartAge: 62 },
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' },
    });

    const { compiled: applied } = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied.params.withdrawalPlan?.generalAssetWithdrawalStartAge).toBe(62);
    expect(applied.params.withdrawalPlan?.isaMaturityDestination).toBe('pension');
    expect(applied.utilityConfig).toBe(compiled.utilityConfig);
  });

  test('params의 다른 최상위 필드는 그대로 유지된다', () => {
    const compiled = compiledFor('ai_optimized');
    const { compiled: applied } = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied.params.userProfile).toBe(compiled.params.userProfile);
    expect(applied.params.assets).toBe(compiled.params.assets);
    expect(applied.params.strategy).toBe(compiled.params.strategy);
  });
});

describe('applyAiSentinels 통합 — 실제 추천 엔진', () => {
  // 합성 utility가 아니라 recommendStrategy가 실제로 만든 추천으로 검증한다.
  // 위 단위 테스트들은 게이트 "로직"이 맞는지만 보고, 이 테스트는 게이트가 실제 데이터에서
  // 걸리는 일이 있는지 — 즉 이 방어가 무의미한 항상-참이 아닌지 — 를 지킨다.
  const engineParams: SimulationParams = {
    ...baseParams,
    // 조기 은퇴 + 높은 생활비. 그리드는 전체 조합으로 큰 개선(39 → 60)을 찾지만, 그 조합에서
    // 국민연금 나이만 떼어 내면 오히려 baseline보다 나빠진다. 자동 채움이 막아야 하는 경우다.
    userProfile: { currentAge: 45, retirementAge: 50, expectancy: 90, targetMonthlySpending: 4000000 },
    strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' },
  };

  test('나이 축만 떼어 내면 악화되는 추천은 그 축을 자동 채움하지 않는다', () => {
    const engine = new SimulationEngine();
    const compiled = compileStrategy(engineParams);
    const recommendation = recommendStrategy(compiled.params, engine, compiled.utilityConfig);

    // 전제: 추천은 개선을 주장하고, 그 나이는 baseline과 다르다.
    expect(recommendation.improved).toBe(true);
    expect(recommendation.recommendedPlan?.nationalPensionStartAge)
      .not.toBe(compiled.params.withdrawalPlan?.nationalPensionStartAge);

    // 전제: 나이 축만 얹으면 실제로 개선이 아니다(이 테스트의 존재 이유).
    // 검증을 거치지 않고 그리드 결과를 그대로 이식했다면 여기서 악화가 발생한다.
    const onlyAgeParams = {
      ...compiled.params,
      withdrawalPlan: {
        ...(compiled.params.withdrawalPlan ?? {}),
        nationalPensionStartAge: recommendation.recommendedPlan!.nationalPensionStartAge,
      },
    };
    const onlyAge = engine.run(onlyAgeParams, compiled.utilityConfig);
    expect(onlyAge.utility!.score).toBeLessThanOrEqual(recommendation.currentUtility.score);

    // 그러므로 그 축은 검증 사슬에 들어가지 않는다.
    expect(recommendation.verifiedSentinelPlan.map((s) => s.field)).not.toContain('nationalPensionStartAge');
  });

  test('자동 채움을 거른 계획의 효용은 baseline보다 낮아지지 않는다', () => {
    const engine = new SimulationEngine();
    const compiled = compileStrategy(engineParams);
    const recommendation = recommendStrategy(compiled.params, engine, compiled.utilityConfig);
    const { compiled: effective } = applyAiSentinels(compiled, recommendation);

    const baseline = engine.run(compiled.params, compiled.utilityConfig);
    const applied = engine.run(effective.params, effective.utilityConfig);

    expect(typeof baseline.utility?.score).toBe('number');
    expect(applied.utility!.score).toBeGreaterThanOrEqual(baseline.utility!.score);
  });
});

describe('applyAiSentinels 통합', () => {
  test("센티널을 채운 결과가 같은 나이의 확정 전략과 동일하다", () => {
    const engine = new SimulationEngine();

    // 기대값을 프로덕션 코드와 같은 스프레드로 손수 만들면 미러 구현이 되어, 두 코드가
    // 나란히 틀려도 통과한다. 대신 완전히 다른 경로로 같은 계획에 도달한다 —
    // 'defer_max'는 compileStrategy가 70세로 컴파일하는 확정 전략이고,
    // 'ai_optimized' + 추천 70세는 applyAiSentinels가 70세로 채우는 경로다.
    // 두 계획은 국민연금 개시 나이 말고 다른 축이 모두 같으므로 결과가 일치해야 한다.
    const viaSentinel = applyAiSentinels(compiledFor('ai_optimized'), makeRecommendation(plan(70))).compiled;
    const viaExplicit = compiledFor('defer_max');

    expect(viaSentinel.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
    expect(viaExplicit.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);

    const fromSentinel = engine.run(viaSentinel.params, viaSentinel.utilityConfig);
    const fromExplicit = engine.run(viaExplicit.params, viaExplicit.utilityConfig);

    // 필드가 실제로 존재하는지 먼저 확인한다. 없는 필드를 비교하면 undefined === undefined로
    // 무의미하게 통과한다.
    expect(typeof fromSentinel.utility?.score).toBe('number');
    expect(fromSentinel.utility?.score).toBe(fromExplicit.utility?.score);
    expect(fromSentinel.utility?.components).toEqual(fromExplicit.utility?.components);

    expect(fromSentinel.yearlyResults.length).toBeGreaterThan(0);
    expect(JSON.stringify(fromSentinel.yearlyResults)).toBe(JSON.stringify(fromExplicit.yearlyResults));
  });

  test('센티널을 채우면 baseline(65세)과 결과가 달라진다', () => {
    const engine = new SimulationEngine();
    const compiled = compiledFor('ai_optimized');

    const baseline = engine.run(compiled.params, compiled.utilityConfig);
    const { compiled: applied } = applyAiSentinels(compiled, makeRecommendation(plan(70)));
    const appliedResult = engine.run(applied.params, applied.utilityConfig);

    // 빈 배열끼리 비교하면 "[]" === "[]"로 무의미하게 통과하므로 먼저 내용이 있는지 확인한다.
    // 한쪽만 비어 있어도 .not.toBe는 통과해 버리므로 양쪽 모두 확인해야 한다.
    expect(baseline.yearlyResults.length).toBeGreaterThan(0);
    expect(appliedResult.yearlyResults.length).toBeGreaterThan(0);

    // endingAssets는 이 시나리오에서 지표가 되지 못한다 — 자산이 66세경 완전 소진되어
    // 국민연금을 언제 받든 65세/70세 모두 0으로 고정된다. 연도별 결과 전체를 비교해야
    // "자동 채움이 시뮬레이션을 실제로 바꿨다"를 검증할 수 있다.
    expect(JSON.stringify(appliedResult.yearlyResults))
      .not.toBe(JSON.stringify(baseline.yearlyResults));
  });

  test('센티널을 채워도 원본 compiled는 변형되지 않는다(되먹임 방지)', () => {
    const compiled = compiledFor('ai_optimized');
    const before = compiled.params.withdrawalPlan?.nationalPensionStartAge;

    applyAiSentinels(compiled, makeRecommendation(plan(68)));

    // 추천 계산(recommendStrategy)의 입력은 언제나 이 원본이다. 여기가 오염되면
    // 다음 추천이 이미 적용된 값 위에서 계산되어 되먹임이 시작된다.
    expect(compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(before);
    expect(before).toBe(65);
  });
});
