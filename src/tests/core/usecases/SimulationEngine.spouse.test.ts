import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SINGLE_SURVIVOR_SPENDING_FACTOR } from '@/core/usecases/spouse/spouseRules';
import { NATIONAL_PENSION_TAX_RATE } from '@/core/usecases/tax/taxRates';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 60, retirementAge: 60, expectancy: 80, targetMonthlySpending: 2000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 500000000, monthlyContribution: 0, annualReturn: 0, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('SimulationEngine 배우자 통합', () => {
  // 주의: 아래 두 테스트는 "변경 전 엔진과 동일하다"를 증명하지 않는다(둘 다 변경 후 엔진끼리의
  // 비교다). 증명하는 것은 "배우자 off ≡ 배우자 미설정"이라는 동치성과 실행의 결정성이다.
  // 실제 무회귀 증거는 (1) SimulationEngine.withdrawalPlan.test.ts의 스냅샷과
  // (2) 배우자 기능 이전부터 있던 기존 테스트 전체가 그대로 통과한다는 사실이다.
  test('spouse: undefined는 spouse 필드 자체가 없는 것과 동치다', () => {
    const engine = new SimulationEngine();

    const withoutField = engine.run(baseParams);
    const withUndefined = engine.run({ ...baseParams, spouse: undefined });

    expect(withUndefined).toEqual(withoutField);
  });

  test('spouse.enabled가 false면 다른 배우자 값과 무관하게 배우자 미설정과 동치다', () => {
    const engine = new SimulationEngine();

    const baseline = engine.run(baseParams);
    const disabled = engine.run({
      ...baseParams,
      spouse: {
        // enabled가 false이므로 아래 값들은 결과에 전혀 반영되면 안 된다.
        enabled: false, currentAge: 58, expectancy: 95,
        nationalPensionMonthlyAmount: 900000, nationalPensionStartAge: 65,
      },
    });

    expect(disabled).toEqual(baseline);
  });

  test('배우자가 더 오래 살면 시뮬레이션이 그 시점까지 연장된다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 60, expectancy: 90, // 30년 후 = 본인 90세
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });

    expect(result.yearlyResults[result.yearlyResults.length - 1].age).toBe(90);
  });

  test('배우자 국민연금이 본인 것과 합산된다', () => {
    const engine = new SimulationEngine();

    const solo = engine.run(baseParams);
    const couple = engine.run({
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 60, expectancy: 80,
        nationalPensionMonthlyAmount: 500000, nationalPensionStartAge: 65,
      },
    });

    const at70 = (r: typeof solo) => r.yearlyResults.find((y) => y.age === 70)!;
    expect(at70(couple).nationalPensionIncome).toBeGreaterThan(at70(solo).nationalPensionIncome);
  });

  test('본인이 아직 수령 개시 전이어도 이미 개시한 배우자 국민연금은 지급된다', () => {
    const engine = new SimulationEngine();

    // 본인은 60세(개시 나이 65 전)지만 배우자는 68세로 이미 수령 중이다.
    const result = engine.run({
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 68, expectancy: 88,
        nationalPensionMonthlyAmount: 500000, nationalPensionStartAge: 65,
      },
    });

    const at62 = result.yearlyResults.find((y) => y.age === 62)!;

    expect(at62.nationalPensionIncome).toBeGreaterThan(0);
  });

  test('배우자 사망 후 생활비가 축소 계수만큼 줄어든다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 80 },
      spouse: {
        enabled: true, currentAge: 60, expectancy: 70, // 10년 후 = 본인 70세 사망
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });

    const before = result.yearlyResults.find((y) => y.age === 69)!;
    const after = result.yearlyResults.find((y) => y.age === 75)!;

    expect(before.spouseAlive).toBe(true);
    expect(after.spouseAlive).toBe(false);
    expect(after.spending).toBeCloseTo(before.spending * SINGLE_SURVIVOR_SPENDING_FACTOR, 0);
  });

  test('본인 사망 후에도 배우자 생존 기간에는 생활비가 계속 발생한다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 70 },
      spouse: {
        enabled: true, currentAge: 60, expectancy: 85, // 25년 후 = 본인 85세
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });

    const afterSelfDeath = result.yearlyResults.find((y) => y.age === 80)!;

    expect(afterSelfDeath.spending).toBeGreaterThan(0);
    expect(afterSelfDeath.spouseAlive).toBe(true);
  });
});

// 국민연금 세율은 고정 2%(taxRates.ts). 월 수령액 → 연간 세후 표시액 환산에 쓴다.
const annualNetFromMonthly = (monthly: number) => monthly * (1 - NATIONAL_PENSION_TAX_RATE) * 12;

describe('SimulationEngine 유족연금 중복조정 배선', () => {
  // computeSurvivorPensionMonthly의 공식은 단위 테스트가 증명한다. 여기서 증명할 것은 엔진이
  // 그 함수에 "생존자 연금"과 "사망자 연금"을 올바른 순서로 넘기는가다. 그래서 두 금액을
  // 비대칭으로 두어, 인자를 뒤바꾸거나 단순 합산하거나 사망자 몫을 버리면 전부 다른 값이
  // 나오도록 설계했다(배우자 연금이 0인 다른 테스트로는 이 배선을 구분할 수 없다).
  test('배우자 사망 시 본인 연금과 배우자 유족연금 중 큰 쪽만 남는다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 90 },
      spouse: {
        enabled: true, currentAge: 60, expectancy: 70, // 본인 70세에 배우자 사망
        nationalPensionMonthlyAmount: 2000000, nationalPensionStartAge: 65,
      },
    });

    // 본인 100만 vs 사망한 배우자 200만 * 0.6 = 120만 → 유족연금 120만이 이긴다.
    // 인자 뒤바꿈이면 200만, 단순 합산이면 300만, 사망자 몫 버리면 100만이 되어 전부 구분된다.
    expect(result.yearlyResults.find((y) => y.age === 75)!.nationalPensionIncome)
      .toBeCloseTo(annualNetFromMonthly(1200000), 6);
  });

  test('본인 사망 시 배우자 연금과 본인 유족연금 중 큰 쪽만 남는다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 70 }, // 본인 70세 사망
      spouse: {
        enabled: true, currentAge: 60, expectancy: 85,
        nationalPensionMonthlyAmount: 300000, nationalPensionStartAge: 65,
      },
    });

    // 배우자 30만 vs 사망한 본인 100만 * 0.6 = 60만 → 유족연금 60만이 이긴다.
    // 인자 뒤바꿈이면 100만이 되어 구분된다(앞 테스트와 대칭으로 방향이 반대다).
    expect(result.yearlyResults.find((y) => y.age === 75)!.nationalPensionIncome)
      .toBeCloseTo(annualNetFromMonthly(600000), 6);
  });
});

describe('SimulationEngine 배우자 사망 후 점수 분모', () => {
  // 배우자가 본인 기대수명(80)까지 생존 → 전 기간 2인 가구.
  const bothAlive = {
    enabled: true, currentAge: 60, expectancy: 80,
    nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
  } as const;
  // 배우자가 본인 70세에 사망 → 71세부터 1인 가구. 종료 나이는 위와 같은 80세라
  // yearlyResults 길이가 동일해 두 결과를 직접 비교할 수 있다.
  const spouseDiesEarly = { ...bothAlive, expectancy: 70 } as const;

  test('축소 계수가 결과에 그대로 노출된다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({ ...baseParams, spouse: spouseDiesEarly });

    expect(result.yearlyResults.find((y) => y.age === 69)!.spendingFactor).toBe(1);
    expect(result.yearlyResults.find((y) => y.age === 75)!.spendingFactor)
      .toBe(SINGLE_SURVIVOR_SPENDING_FACTOR);
  });

  test('배우자 미설정이면 축소 계수는 항상 1이다', () => {
    const engine = new SimulationEngine();

    const result = engine.run(baseParams);

    expect(result.yearlyResults.every((y) => y.spendingFactor === 1)).toBe(true);
  });

  test('축소된 필요를 충족하면 consumption 점수가 깎이지 않는다', () => {
    const engine = new SimulationEngine();

    const couple = engine.run({ ...baseParams, spouse: bothAlive });
    const widowed = engine.run({ ...baseParams, spouse: spouseDiesEarly });

    // 사별 후 실제 지출은 0.7배로 줄지만 필요도 0.7배로 줄었으므로 충족률은 그대로 1이다.
    // 목표 분모가 2인 기준으로 고정되어 있으면 ratio가 0.7로 떨어지면서 점수가 깎인다.
    expect(widowed.yearlyResults.find((y) => y.age === 75)!.spending)
      .toBeCloseTo(couple.yearlyResults.find((y) => y.age === 75)!.spending * SINGLE_SURVIVOR_SPENDING_FACTOR, 0);
    expect(widowed.utility!.components.consumption).toBe(couple.utility!.components.consumption);
  });

  test('사별 연도의 목표 생활비가 축소되어 goalAchievementRate가 올라간다', () => {
    // 자산·사적연금이 없어 소득이 국민연금뿐이라 두 시나리오의 소득이 완전히 동일하다.
    // 따라서 goalAchievementRate의 차이는 오직 목표(분모) 차이에서만 나온다.
    const pensionOnly: SimulationParams = { ...baseParams, privatePensions: [] };
    const engine = new SimulationEngine();

    const couple = engine.run({ ...pensionOnly, spouse: bothAlive });
    const widowed = engine.run({ ...pensionOnly, spouse: spouseDiesEarly });

    expect(couple.goalAchievementRate).toBe(engine.run(pensionOnly).goalAchievementRate);
    expect(widowed.goalAchievementRate).toBeGreaterThan(couple.goalAchievementRate);
  });
});

describe('SimulationEngine 배우자 단독 생존 기간의 고갈', () => {
  // 본인 기대수명 80, 배우자는 본인 나이 기준 95세까지 생존. 자산은 84세에 고갈된다 —
  // 즉 본인 사후 배우자가 11년을 무일푼으로 사는 계획이다.
  const depleting: SimulationParams = {
    ...baseParams,
    withdrawalPlan: { privatePensionMonthlyTarget: 1500000 },
  };
  const longLivedSpouse = {
    enabled: true, currentAge: 60, expectancy: 95,
    nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
  } as const;

  test('본인 기대수명 이후의 고갈이 점수에 반영된다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({ ...depleting, spouse: longLivedSpouse });

    // 전제 확인: 고갈이 본인 사후·배우자 생존 중에 일어난다.
    expect(result.depletionAge).toBe(84);
    expect(result.yearlyResults[result.yearlyResults.length - 1].age).toBe(95);

    // 고갈 안전성을 본인 기대수명(80)으로 정규화하면 (84-60)/(80-60) = 1.2가 clamp에 걸려
    // "고갈 없음"과 똑같은 만점이 나온다. 가구 종료 나이(95)로 정규화해야 감점된다.
    expect(result.utility!.components.depletionSafety)
      .toBeLessThan(DEFAULT_UTILITY_CONFIG.weights.depletionSafety);
  });

  test('같은 나이에 고갈해도 배우자가 더 오래 살수록 은퇴 점수가 낮다', () => {
    const engine = new SimulationEngine();

    // 인출액이 privatePensionMonthlyTarget으로 고정되어 있어 두 시나리오의 현금흐름이
    // 고갈 시점까지 완전히 같다 — 고갈 나이가 84세로 동일하고 종료 나이만 다르다.
    const shorter = engine.run({ ...depleting, spouse: { ...longLivedSpouse, expectancy: 85 } });
    const longer = engine.run({ ...depleting, spouse: longLivedSpouse });

    expect(shorter.depletionAge).toBe(84);
    expect(longer.depletionAge).toBe(84);
    // 무일푼 기간이 1년에서 11년으로 늘었으므로 점수는 더 낮아야 한다.
    expect(longer.retirementScore).toBeLessThan(shorter.retirementScore);
    expect(longer.utility!.components.depletionSafety)
      .toBeLessThan(shorter.utility!.components.depletionSafety);
    // 은퇴 등급으로 엔진의 longevityScore 정규화를 고정한다. 이 계획은 배우자가 11년을
    // 무일푼으로 사는 계획이므로 최고 등급이어서는 안 된다 — 그런데 span을 본인 기대수명
    // (80)으로 정규화하면 (84-60)/(80-60)=1.2가 clamp에 걸려 만점이 되고 등급이 '매우 안정'이
    // 된다. retirementScore 비교만으로는 이 결함이 드러나지 않아(다른 항목 차이에 묻힌다)
    // 등급으로 단언한다.
    expect(longer.retirementGrade).not.toBe('매우 안정');
  });
});

describe('SimulationEngine FIRE 판정의 가구 규모 계수', () => {
  // 자산·사적연금이 없어 소득이 국민연금뿐이다 — FIRE 판정의 분자를 정확히 고정하기 위해서다.
  // 국민연금 월 150만원(65세 개시, 세후 2%) = 연 1,764만원.
  //   2인 기준 목표 = 200만 * 12         = 2,400만원 (미달)
  //   1인 기준 목표 = 200만 * 12 * 0.7   = 1,680만원 (충족)
  // 즉 이 시나리오의 FIRE 달성 여부는 오직 spendingFactor를 곱했는지로만 갈린다.
  const pensionOnly: SimulationParams = {
    ...baseParams,
    privatePensions: [],
    nationalPension: { expectedMonthlyAmount: 1500000 },
  };

  test('배우자 사망으로 줄어든 목표 생활비를 기준으로 FIRE를 판정한다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...pensionOnly,
      spouse: {
        enabled: true, currentAge: 60, expectancy: 70, // 본인 70세에 배우자 사망 → 71세부터 1인
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });

    expect(result.fireAge).toBe(71);
  });

  test('본인 기대수명 이후여도 가구 종료 전에 달성하면 FIRE 나이를 보고한다', () => {
    const engine = new SimulationEngine();

    // 배우자가 20살 어리고 95세까지 산다 → 가구 종료는 본인 나이 115세.
    // 배우자 국민연금(월 300만)은 배우자가 65세가 되는 본인 85세부터 나온다.
    const result = engine.run({
      ...pensionOnly,
      nationalPension: { expectedMonthlyAmount: 1000000 },
      spouse: {
        enabled: true, currentAge: 40, expectancy: 95,
        nationalPensionMonthlyAmount: 3000000, nationalPensionStartAge: 65,
      },
    });

    expect(result.householdEndAge).toBe(115);
    // 본인 기대수명(80)으로 게이트하면 null이 되어 "FIRE 달성 불가"라는 거짓 진술이 된다.
    expect(result.fireAge).toBe(85);
  });
});
