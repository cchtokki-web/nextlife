import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SINGLE_SURVIVOR_SPENDING_FACTOR } from '@/core/usecases/spouse/spouseRules';
import { calculateNationalPensionTaxKRW } from '@/core/usecases/tax/TaxEngine';
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';
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
      },
    });

    expect(disabled).toEqual(baseline);
  });

  test('배우자가 더 오래 살면 시뮬레이션이 그 시점까지 연장된다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 60, expectancy: 90, // 30년 후 = 본인 90세,
      },
    });

    expect(result.yearlyResults[result.yearlyResults.length - 1].age).toBe(90);
  });

  test('배우자 사망 후 생활비가 축소 계수만큼 줄어든다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 80 },
      spouse: {
        enabled: true, currentAge: 60, expectancy: 70, // 10년 후 = 본인 70세 사망,
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
        enabled: true, currentAge: 60, expectancy: 85, // 25년 후 = 본인 85세,
      },
    });

    const afterSelfDeath = result.yearlyResults.find((y) => y.age === 80)!;

    expect(afterSelfDeath.spending).toBeGreaterThan(0);
    expect(afterSelfDeath.spouseAlive).toBe(true);
  });
});

// 월 수령액 → 연간 세후 표시액. 국민연금 실효세율은 수령액에 따라 달라지므로
// (연금소득공제 + 누진세율) 상수로 박지 않고 세금 계산 함수로 유도한다 — 이 파일의
// 주제는 세율이 아니라 배우자 합산·유족연금 중복조정·물가 모드가 수령액에 어떻게
// 반영되는가다.
const annualNetFromMonthly = (monthly: number) => {
  const grossAnnual = monthly * 12;
  return grossAnnual - calculateNationalPensionTaxKRW(grossAnnual, resolveTaxContext());
};

describe('SimulationEngine 유족연금 승계 배선', () => {
  // inheritSurvivorPension의 공식은 단위 테스트가 증명한다. 여기서 증명할 것은 엔진이
  // **본인 사망 이후 구간에만** 그 함수를 태우는가다. 배우자 명의 연금이 사라진 지금
  // 이 승계가 배우자 단독 생존 구간의 유일한 국민연금 소득원이라, 배선이 끊기면 그 구간이
  // 통째로 0이 된다.
  test('본인 사망 후 배우자 생존 구간에는 본인 연금의 지급률만큼만 남는다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 70 }, // 본인 70세 사망
      spouse: { enabled: true, currentAge: 60, expectancy: 85 },
    });

    // 본인 월 100만 * 0.6 = 60만. 승계를 빠뜨리면 0, 그대로 두면 100만이 되어 전부 구분된다.
    expect(result.yearlyResults.find((y) => y.age === 75)!.nationalPensionIncome)
      .toBeCloseTo(annualNetFromMonthly(600000), 6);
  });

  test('배우자가 먼저 사망하면 본인 연금은 그대로 유지된다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 90 },
      spouse: { enabled: true, currentAge: 60, expectancy: 70 }, // 본인 70세에 배우자 사망
    });

    expect(result.yearlyResults.find((y) => y.age === 75)!.nationalPensionIncome)
      .toBeCloseTo(annualNetFromMonthly(1000000), 6);
  });
});

describe('SimulationEngine 배우자 사망 후 점수 분모', () => {
  // 배우자가 본인 기대수명(80)까지 생존 → 전 기간 2인 가구.
  const bothAlive = {
    enabled: true, currentAge: 60, expectancy: 80,
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
  //
  // 목표 생활비를 소득(국민연금 100만 + 사적연금 인출 150만)보다 높게 잡아 잉여가 남지
  // 않게 한다. 예전에는 이 픽스처가 잉여를 내면서도 고갈했는데, 그건 잉여 현금을 넣을
  // 자산(assets: [])이 없어 그 돈이 **증발**했기 때문이다 — 현금 버킷이 그 소실을 고쳤다.
  const depleting: SimulationParams = {
    ...baseParams,
    userProfile: { ...baseParams.userProfile, targetMonthlySpending: 4000000 },
    withdrawalPlan: { privatePensionMonthlyTarget: 1500000 },
  };
  const longLivedSpouse = {
    enabled: true, currentAge: 60, expectancy: 95,
  } as const;

  test('본인 기대수명 이후의 고갈이 점수에 반영된다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({ ...depleting, spouse: longLivedSpouse });

    // 전제 확인: 고갈이 본인 사후·배우자 생존 중에 일어난다.
    // 절대 나이를 박지 않는다 — 이 테스트가 겨냥하는 것은 "고갈 안전성을 무엇으로 정규화하는가"
    // 이지 특정 나이가 아니다. 세금·인출 규칙이 바뀔 때마다 무관한 이유로 깨지면 안 된다.
    expect(result.depletionAge).not.toBeNull();
    expect(result.depletionAge!).toBeGreaterThan(depleting.userProfile.expectancy);
    expect(result.depletionAge!).toBeLessThan(longLivedSpouse.expectancy);
    expect(result.yearlyResults[result.yearlyResults.length - 1].age).toBe(95);

    // 고갈 안전성을 본인 기대수명(80)으로 정규화하면 (84-60)/(80-60) = 1.2가 clamp에 걸려
    // "고갈 없음"과 똑같은 만점이 나온다. 가구 종료 나이(95)로 정규화해야 감점된다.
    expect(result.utility!.components.depletionSafety)
      .toBeLessThan(DEFAULT_UTILITY_CONFIG.weights.depletionSafety);
  });

  test('같은 나이에 고갈해도 배우자가 더 오래 살수록 은퇴 점수가 낮다', () => {
    const engine = new SimulationEngine();

    // 인출액이 privatePensionMonthlyTarget으로 고정되어 있어 두 시나리오의 현금흐름이
    // 고갈 시점까지 완전히 같다 — 고갈 나이가 동일하고 종료 나이만 다르다.
    // 짧은 쪽의 배우자 기대수명(90)은 고갈 나이보다 뒤여야 한다. 앞이면 그 시나리오는
    // 고갈 전에 끝나 버려(depletionAge = null) 비교 자체가 성립하지 않는다.
    const shorter = engine.run({ ...depleting, spouse: { ...longLivedSpouse, expectancy: 90 } });
    const longer = engine.run({ ...depleting, spouse: longLivedSpouse });

    expect(shorter.depletionAge).not.toBeNull();
    expect(longer.depletionAge).toBe(shorter.depletionAge);
    // 무일푼 기간이 1년에서 11년으로 늘었으므로 점수는 더 낮아야 한다.
    expect(longer.retirementScore).toBeLessThan(shorter.retirementScore);
    expect(longer.utility!.components.depletionSafety)
      .toBeLessThan(shorter.utility!.components.depletionSafety);
    // 엔진의 longevityScore 정규화를 절대값으로 고정한다. 배우자가 11년을 무일푼으로 사는
    // 계획이므로 고갈 안전성이 만점이어서는 안 된다 — span을 본인 기대수명(80)으로
    // 정규화하면 (84-60)/(80-60)=1.2가 clamp에 걸려 만점이 나온다. 가구 종료 나이(95)로
    // 정규화해야 감점된다.
    //
    // 예전에는 이 자리에서 retirementGrade가 '매우 안정'이 아님을 단언했다. 그러나 등급은
    // 총점에서 파생되므로 세금 모델이 바뀌어 총점 수준이 오르내리면 판별력이 사라진다
    // (건보료 과세표준 정정으로 총점이 올라 실제로 그렇게 됐다). 위 상대 비교와 달리
    // 이쪽은 절대 기준이 필요하므로, 등급이 아니라 겨냥하는 항목 자체를 직접 본다.
    expect(longer.utility!.components.depletionSafety)
      .toBeLessThan(DEFAULT_UTILITY_CONFIG.weights.depletionSafety);
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
        enabled: true, currentAge: 60, expectancy: 70, // 본인 70세에 배우자 사망 → 71세부터 1인,
      },
    });

    expect(result.fireAge).toBe(71);
  });

  test('본인 기대수명 이후여도 가구 종료 전에 달성하면 FIRE 나이를 보고한다', () => {
    const engine = new SimulationEngine();

    // 배우자가 20살 어리고 95세까지 산다 → 가구 종료는 본인 나이 115세.
    //
    // 본인 사망(80세) 다음 해부터 목표 생활비가 1인 기준(×0.7 = 연 1,680만원)으로 줄어드는
    // 반면 기타소득은 그대로라, 그 시점에 처음 FIRE가 성립한다.
    //   2인 구간: 기타 1,560만 + 국민연금 약 590만 = 약 2,150만 < 2,400만 (미달)
    //   1인 구간: 기타 1,560만 + 유족연금 약 358만 = 약 1,918만 ≥ 1,680만 (충족)
    //
    // 예전에는 배우자 국민연금이 개시되는 것으로 같은 상황을 만들었는데, 배우자 명의 연금을
    // 다루지 않게 되면서 트리거를 기타소득으로 바꿨다. 기타소득을 고른 이유는 세금도 자산
    // 감소도 얽히지 않아 소득이 전 구간 고정이기 때문이다(배당은 매도로 원금이 줄면 함께 줄어든다).
    const result = engine.run({
      ...pensionOnly,
      nationalPension: { expectedMonthlyAmount: 500000 },
      otherIncomes: [{ id: 'o1', label: '임대소득', monthlyAmount: 1300000, currency: 'KRW' }],
      spouse: { enabled: true, currentAge: 40, expectancy: 95 },
    });

    expect(result.householdEndAge).toBe(115);
    // 본인 기대수명(80)으로 게이트하면 null이 되어 "FIRE 달성 불가"라는 거짓 진술이 된다.
    expect(result.fireAge).not.toBeNull();
    expect(result.fireAge!).toBeGreaterThan(pensionOnly.userProfile.expectancy);
  });
});

// 국민연금 금액을 손계산으로 고정하기 위한 파라미터. 자산·사적연금·기타소득을 모두 비워
// nationalPensionIncome에 섞여 들어올 다른 재원을 없앴다(배당세·종합과세 조정이 걸리면
// 손계산과 어긋난다). 본인 국민연금은 각 describe에서 필요할 때만 채운다.
const pensionOnlyParams: SimulationParams = {
  userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 2000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('SimulationEngine 생존 경계 연도의 spendingFactor', () => {
  const engine = new SimulationEngine();

  // 이 describe가 없으면 "사망하는 바로 그 해"가 어느 쪽에 속하는지가 어디에도 고정되어
  // 있지 않다. 기존 테스트는 사망 5년 전(69세)과 5년 후(75세)만 보므로, 생존 판정의
  // 부등호가 `<=`에서 `<`로 바뀌어 계수가 한 해 일찍 꺾여도 전부 초록이다.

  test('배우자가 사망하는 그 해까지 2인 가구이고, 다음 해부터 1인 가구다', () => {
    // 배우자 60세·기대수명 70 → deathAtSelfAge = 60 + (70-60) = 본인 70세.
    // 엔진은 기대수명 "까지"를 생존으로 보므로 70세 행은 아직 계수 1이다.
    const result = engine.run({
      ...pensionOnlyParams,
      userProfile: { ...pensionOnlyParams.userProfile, expectancy: 80 },
      spouse: {
        enabled: true, currentAge: 60, expectancy: 70,
      },
    });
    const at = (age: number) => result.yearlyResults.find((y) => y.age === age)!;

    expect(at(69)).toMatchObject({ spouseAlive: true, spendingFactor: 1 });
    expect(at(70)).toMatchObject({ spouseAlive: true, spendingFactor: 1 });
    expect(at(71)).toMatchObject({ spouseAlive: false, spendingFactor: SINGLE_SURVIVOR_SPENDING_FACTOR });
  });

  test('본인이 사망하는 그 해까지 2인 가구이고, 다음 해부터 배우자 단독 가구다', () => {
    // 본인 기대수명 70, 배우자는 본인 나이 85세까지 생존(55세 + 30년) → 가구 종료 85세.
    const result = engine.run({
      ...pensionOnlyParams,
      userProfile: { ...pensionOnlyParams.userProfile, expectancy: 70 },
      spouse: {
        enabled: true, currentAge: 55, expectancy: 80,
      },
    });
    const at = (age: number) => result.yearlyResults.find((y) => y.age === age)!;

    expect(at(69)).toMatchObject({ spouseAlive: true, spendingFactor: 1 });
    expect(at(70)).toMatchObject({ spouseAlive: true, spendingFactor: 1 });
    expect(at(71)).toMatchObject({ spouseAlive: true, spendingFactor: SINGLE_SURVIVOR_SPENDING_FACTOR });

    // 마지막 해도 배우자 생존 구간이다 — 루프는 배우자가 죽는 해에서 끝난다.
    const last = result.yearlyResults[result.yearlyResults.length - 1];
    expect(last).toMatchObject({ age: 85, spouseAlive: true, spendingFactor: SINGLE_SURVIVOR_SPENDING_FACTOR });
  });

  test('가구 종료 나이까지 계수 0인 해는 한 번도 나오지 않는다', () => {
    // 루프 종료 나이가 max(본인 기대수명, 배우자 사망 나이)이므로 "둘 다 사망"인 해는
    // 구조적으로 존재할 수 없다(computeSpendingFactor의 0 분기는 엔진 경로에서 도달 불가).
    // 종료 조건이 바뀌어 사망 후 연도가 결과에 섞이면 생활비 0인 유령 행이 차트에 그려진다.
    const spouseFirst = engine.run({
      ...pensionOnlyParams,
      userProfile: { ...pensionOnlyParams.userProfile, expectancy: 80 },
      spouse: {
        enabled: true, currentAge: 60, expectancy: 70,
      },
    });
    const selfFirst = engine.run({
      ...pensionOnlyParams,
      userProfile: { ...pensionOnlyParams.userProfile, expectancy: 70 },
      spouse: {
        enabled: true, currentAge: 55, expectancy: 80,
      },
    });

    expect(spouseFirst.yearlyResults.some((y) => y.spendingFactor === 0)).toBe(false);
    expect(selfFirst.yearlyResults.some((y) => y.spendingFactor === 0)).toBe(false);
  });
});
