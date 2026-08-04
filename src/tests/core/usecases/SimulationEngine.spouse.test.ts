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

// 월 수령액 → 연간 세후 표시액. 국민연금 실효세율은 수령액에 따라 달라지므로
// (연금소득공제 + 누진세율) 상수로 박지 않고 세금 계산 함수로 유도한다 — 이 파일의
// 주제는 세율이 아니라 배우자 합산·유족연금 중복조정·물가 모드가 수령액에 어떻게
// 반영되는가다.
const annualNetFromMonthly = (monthly: number) => {
  const grossAnnual = monthly * 12;
  return grossAnnual - calculateNationalPensionTaxKRW(grossAnnual, resolveTaxContext());
};

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
    nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
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

describe('SimulationEngine 배우자 국민연금의 물가 반영 모드', () => {
  // 이 describe가 없으면 배우자 국민연금의 명목(nominal) 분기가 어떤 테스트에서도 실행되지
  // 않는다 — 기존 배우자 테스트는 전부 inflationMode: 'real' + inflationRate: 0이라 명목/실질이
  // 같은 값으로 붕괴한다. 그래서 배우자 몫에만 물가 복리를 아예 빼먹거나(실질값 그대로 지급),
  // 반대로 두 번 곱해도((1.1^10)^2) 스위트 전체가 초록이다.
  //
  // 배우자 60세·개시 65세이므로 본인 70세(= 시뮬레이션 10년차, y = 10)에는 조정계수 1이
  // 곱해진 월 100만원이 기준액이다. 물가상승률은 1.1^10을 손으로 계산할 수 있도록 10%로 둔다.
  const spouseOnly = (mode: 'nominal' | 'real'): SimulationParams => ({
    ...pensionOnlyParams,
    inflationRate: 10,
    inflationMode: mode,
    spouse: {
      enabled: true, currentAge: 60, expectancy: 90,
      nationalPensionMonthlyAmount: 1000000, nationalPensionStartAge: 65,
    },
  });

  const incomeAt70 = (mode: 'nominal' | 'real'): number =>
    new SimulationEngine().run(spouseOnly(mode)).yearlyResults.find((y) => y.age === 70)!
      .nationalPensionIncome;

  test('실질 모드에서는 배우자 국민연금에 물가상승이 누적되지 않는다', () => {
    // 월 1,000,000 × 12 = 연 1,200만원(세전). 물가 10%가 10년 지나도 그대로다 —
    // 실질 모드의 모든 금액은 오늘 화폐가치로 표시되기 때문이다.
    expect(incomeAt70('real')).toBeCloseTo(annualNetFromMonthly(1000000), 2);
  });

  test('명목 모드에서는 배우자 국민연금에 시작 시점부터의 물가상승이 누적된다', () => {
    // 1,000,000 × 1.1^10 = 1,000,000 × 2.5937424601 = 2,593,742.4601원/월
    //   × 12개월 = 31,124,909.5212원(세전)
    // 복리를 빼먹으면 연 1,200만원 수준, 두 번 곱하면 1.1^20 배가 되어 둘 다 여기서 걸린다.
    expect(incomeAt70('nominal')).toBeCloseTo(annualNetFromMonthly(1000000 * Math.pow(1.1, 10)), 2);
  });
});

describe('SimulationEngine 본인+배우자 국민연금 합산액', () => {
  // 기존 합산 테스트는 "배우자를 켜면 늘어난다"는 방향만 본다. 방향만 보면 조정계수를
  // 빼먹거나, 유족연금 지급률(0.6)을 두 사람이 모두 살아 있는 해에 곱하거나, 한쪽 금액을
  // 두 번 세어도 전부 "늘어났다"로 통과한다. 그래서 절대값을 고정한다.
  //
  // 본인과 배우자의 금액·개시 나이를 모두 다르게 두어 위 세 결함이 각각 다른 값을 내게 했다:
  //   본인   월 1,000,000, 개시 65세 → 조정계수 1
  //   배우자 월   800,000, 개시 70세 → 조정계수 1 + 0.006 × (70-65) × 12 = 1.36
  const couple: SimulationParams = {
    ...pensionOnlyParams,
    nationalPension: { expectedMonthlyAmount: 1000000 },
    spouse: {
      enabled: true, currentAge: 60, expectancy: 85,
      nationalPensionMonthlyAmount: 800000, nationalPensionStartAge: 70,
    },
  };

  const incomeAt = (age: number): number =>
    new SimulationEngine().run(couple).yearlyResults.find((y) => y.age === age)!.nationalPensionIncome;

  test('배우자 개시 전에는 본인 몫만 나온다', () => {
    // 본인 68세 = 배우자 68세 < 개시 70세 → 배우자 몫 0.
    expect(incomeAt(68)).toBeCloseTo(annualNetFromMonthly(1000000), 2);
  });

  test('둘 다 수령 중인 해의 가구 합산액이 절대값으로 고정된다', () => {
    // 본인   1,000,000 × 1.00 = 1,000,000
    // 배우자   800,000 × 1.36 = 1,088,000
    // 합계 월 2,088,000 → 연 25,056,000원(세전).
    // 조정계수 누락이면 월 1,800,000, 생존 중 0.6 적용이면 월 1,252,800이 되어 구분된다.
    expect(incomeAt(70)).toBeCloseTo(annualNetFromMonthly(2088000), 2);
  });
});

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
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
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
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
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
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });
    const selfFirst = engine.run({
      ...pensionOnlyParams,
      userProfile: { ...pensionOnlyParams.userProfile, expectancy: 70 },
      spouse: {
        enabled: true, currentAge: 55, expectancy: 80,
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });

    expect(spouseFirst.yearlyResults.some((y) => y.spendingFactor === 0)).toBe(false);
    expect(selfFirst.yearlyResults.some((y) => y.spendingFactor === 0)).toBe(false);
  });
});
