import { describe, test, expect } from 'vitest';
import { makeYearlyResult as makeYearlyResultFixture } from '@/tests/fixtures/yearlyResult';
import { computeLifetimeUtility } from '@/core/usecases/utility/UtilityEngine';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import {
  BequestStrategy, SimulationParams, SimulationResult, SimulationYearlyResult,
} from '@/core/entities/types';

// 60세 은퇴, 95세 기대수명, 월 목표생활비 300만 원 공통 프로필
const userProfile = {
  currentAge: 60,
  retirementAge: 60,
  expectancy: 95,
  targetMonthlySpending: 3000000,
};

const baseParams: SimulationParams = {
  userProfile,
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

const ANNUAL_TARGET = userProfile.targetMonthlySpending * 12; // 3,600만 원

function makeYear(
  age: number,
  overrides: Partial<SimulationYearlyResult> = {}
): SimulationYearlyResult {
  // 공용 픽스처에 이 스위트 고유의 기본값(목표를 정확히 채우는 소득·지출)만 얹는다.
  // 필수 필드가 추가될 때 여기서 다시 깨지지 않도록 복제 대신 위임한다.
  return makeYearlyResultFixture({
    age,
    year: 2026 + (age - userProfile.currentAge),
    totalIncome: ANNUAL_TARGET,
    preTaxTotalIncome: ANNUAL_TARGET,
    spending: ANNUAL_TARGET,
    ...overrides,
  });
}

function makeResult(yearlyResults: SimulationYearlyResult[], depletionAge: number | null): SimulationResult {
  const last = yearlyResults[yearlyResults.length - 1];
  return {
    yearlyResults,
    fireAge: 60,
    depletionAge,
    endingAssets: last.totalAssets,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

// 시나리오 A: 고갈형 - 80세에 자산 완전 고갈, 이후 생활비 0
function buildDepletionScenario(): SimulationResult {
  const years: SimulationYearlyResult[] = [];
  for (let age = 60; age <= 95; age++) {
    if (age < 80) {
      years.push(makeYear(age, { totalAssets: 100000000, pensionAssets: 0 }));
    } else {
      years.push(
        makeYear(age, {
          totalAssets: 0,
          pensionAssets: 0,
          isaAssets: 0,
          cashAssets: 0,
          spending: 0,
          totalIncome: 0,
          preTaxTotalIncome: 0,
        })
      );
    }
  }
  return makeResult(years, 80);
}

// 시나리오 B: 과다잔여형 - 생활비는 항상 충족하지만 사망 시 연금·자산이 과도하게 남음
function buildExcessLeftoverScenario(): SimulationResult {
  const years: SimulationYearlyResult[] = [];
  for (let age = 60; age <= 95; age++) {
    years.push(makeYear(age, { totalAssets: 600000000, pensionAssets: 600000000 }));
  }
  return makeResult(years, null);
}

// 시나리오 C: 균형형 - 생활비를 항상 충족하고, 사망 시 적정 수준(연금 1년치, 총자산 2년치)만 남음
function buildBalancedScenario(): SimulationResult {
  const years: SimulationYearlyResult[] = [];
  for (let age = 60; age <= 95; age++) {
    years.push(makeYear(age, { totalAssets: ANNUAL_TARGET * 2, pensionAssets: ANNUAL_TARGET }));
  }
  return makeResult(years, null);
}

describe('UtilityEngine.computeLifetimeUtility', () => {
  test('빈 yearlyResults에는 점수와 모든 구성요소가 0이어야 한다', () => {
    const emptyResult = makeResult([makeYear(60)], null);
    emptyResult.yearlyResults = [];
    const utility = computeLifetimeUtility(emptyResult, baseParams);

    expect(utility.score).toBe(0);
    Object.values(utility.components).forEach((v) => expect(v).toBe(0));
  });

  test('균형형(적정 잔액) 전략이 과다잔여형과 고갈형보다 Utility가 높아야 한다', () => {
    const depletion = computeLifetimeUtility(buildDepletionScenario(), baseParams);
    const excessLeftover = computeLifetimeUtility(buildExcessLeftoverScenario(), baseParams);
    const balanced = computeLifetimeUtility(buildBalancedScenario(), baseParams);

    expect(balanced.score).toBeGreaterThan(excessLeftover.score);
    expect(balanced.score).toBeGreaterThan(depletion.score);
  });

  test('사망 시 연금잔액이 커도(6억) 작아도(1억) 수급·인출·세금 조건이 같으면 pensionUtilization 점수는 동일하다 (회귀 가드: 잔액 자체는 더 이상 감점 요인이 아님)', () => {
    const hugeLeftoverResult = makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { pensionAssets: 600000000, totalAssets: 600000000 })),
      null
    );
    const modestLeftoverResult = makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { pensionAssets: 100000000, totalAssets: 100000000 })),
      null
    );

    const huge = computeLifetimeUtility(hugeLeftoverResult, baseParams);
    const modest = computeLifetimeUtility(modestLeftoverResult, baseParams);

    expect(modest.components.pensionUtilization).toBe(huge.components.pensionUtilization);
  });

  test('사망 시 연금잔액이 과다해도 bequestAdequacy(상속 자산 적정성)는 여전히 낮게 나온다 (책임 이동 확인: 과다잔여 감점은 이제 bequestAdequacy만의 역할)', () => {
    const hugeLeftoverResult = makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { pensionAssets: 600000000, totalAssets: 600000000 })),
      null
    );
    const balanced = computeLifetimeUtility(buildBalancedScenario(), baseParams);
    const huge = computeLifetimeUtility(hugeLeftoverResult, baseParams);

    expect(huge.components.bequestAdequacy).toBeLessThan(balanced.components.bequestAdequacy);
  });

  describe('bequestAdequacy via userProfile.targetBequest (사용자 지정 상속자산 목표)', () => {
    test('targetBequest가 없으면 기존 공식(목표월생활비 * 24개월)을 그대로 사용한다 (회귀 가드)', () => {
      const result = makeResult(
        Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { totalAssets: ANNUAL_TARGET * 2, pensionAssets: 0 })),
        null
      );
      const utility = computeLifetimeUtility(result, baseParams);
      expect(utility.components.bequestAdequacy).toBe(10);
    });

    test('targetBequest를 설정하면 그 값을 기준으로 ratio를 계산한다 (정확히 달성 시 만점)', () => {
      const targetBequest = 100000000; // 1억원
      const paramsWithTarget: SimulationParams = { ...baseParams, userProfile: { ...userProfile, targetBequest } };
      const result = makeResult(
        Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { totalAssets: targetBequest, pensionAssets: 0 })),
        null
      );
      const utility = computeLifetimeUtility(result, paramsWithTarget);
      expect(utility.components.bequestAdequacy).toBe(10);
    });

    test('targetBequest가 0이면(다 쓰고 가기) 잔여자산이 0일 때 만점이다', () => {
      const paramsWithZeroTarget: SimulationParams = { ...baseParams, userProfile: { ...userProfile, targetBequest: 0 } };
      const result = makeResult(
        Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { totalAssets: 0, pensionAssets: 0 })),
        80
      );
      const utility = computeLifetimeUtility(result, paramsWithZeroTarget);
      expect(utility.components.bequestAdequacy).toBe(10);
    });

    test('targetBequest가 0인데 잔여자산이 남으면 과다잔여로 간주해 감점된다', () => {
      const paramsWithZeroTarget: SimulationParams = { ...baseParams, userProfile: { ...userProfile, targetBequest: 0 } };
      const zeroResult = makeResult(
        Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { totalAssets: 0, pensionAssets: 0 })),
        80
      );
      const leftoverResult = makeResult(
        Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { totalAssets: 200000000, pensionAssets: 0 })),
        null
      );
      const zeroUtility = computeLifetimeUtility(zeroResult, paramsWithZeroTarget);
      const leftoverUtility = computeLifetimeUtility(leftoverResult, paramsWithZeroTarget);
      expect(leftoverUtility.components.bequestAdequacy).toBeLessThan(zeroUtility.components.bequestAdequacy);
    });

    test('잔여자산이 목표에 못 미칠 때, 목표가 클수록(=더 많이 부족할수록) 점수가 낮아진다', () => {
      const endingAssets = 100000000; // 1억원 (아래 두 목표 모두보다 작음 = 항상 미달 구간)
      const makeR = () =>
        makeResult(
          Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { totalAssets: endingAssets, pensionAssets: 0 })),
          null
        );
      const closeTargetParams: SimulationParams = { ...baseParams, userProfile: { ...userProfile, targetBequest: 150000000 } }; // 소폭 미달
      const farTargetParams: SimulationParams = { ...baseParams, userProfile: { ...userProfile, targetBequest: 500000000 } }; // 대폭 미달

      const closeTargetUtility = computeLifetimeUtility(makeR(), closeTargetParams);
      const farTargetUtility = computeLifetimeUtility(makeR(), farTargetParams);
      expect(farTargetUtility.components.bequestAdequacy).toBeLessThan(closeTargetUtility.components.bequestAdequacy);
    });

    test('잔여자산이 목표를 초과할 때는, 목표가 작을수록(=상대적으로 더 많이 초과할수록) 점수가 낮아진다', () => {
      const endingAssets = 200000000; // 2억원 (아래 두 목표 모두보다 큼 = 항상 초과 구간)
      const makeR = () =>
        makeResult(
          Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { totalAssets: endingAssets, pensionAssets: 0 })),
          null
        );
      const smallTargetParams: SimulationParams = { ...baseParams, userProfile: { ...userProfile, targetBequest: 50000000 } }; // 4배 초과
      const bigTargetParams: SimulationParams = { ...baseParams, userProfile: { ...userProfile, targetBequest: 150000000 } }; // 1.33배 초과

      const smallTargetUtility = computeLifetimeUtility(makeR(), smallTargetParams);
      const bigTargetUtility = computeLifetimeUtility(makeR(), bigTargetParams);
      expect(smallTargetUtility.components.bequestAdequacy).toBeLessThan(bigTargetUtility.components.bequestAdequacy);
    });
  });

  describe('pensionUtilization (연금 활용도) 재설계', () => {
    const pensionUserProfile = {
      currentAge: 60,
      retirementAge: 60,
      expectancy: 95,
      targetMonthlySpending: 3000000,
    };
    const NATIONAL_PENSION_ANNUAL = 2000000 * 12;
    const PRIVATE_PENSION_ANNUAL = 10000000;

    const privatePensionAccount = {
      id: 'p1',
      type: 'irp' as const,
      balance: 50000000,
      monthlyContribution: 0,
      annualReturn: 5,
      currency: 'KRW' as const,
    };

    function buildPensionParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
      return {
        ...baseParams,
        userProfile: pensionUserProfile,
        nationalPension: { expectedMonthlyAmount: 0 },
        privatePensions: [],
        ...overrides,
      };
    }

    function buildPensionResult(yearOverrides: Partial<SimulationYearlyResult> = {}): SimulationResult {
      return makeResult(
        Array.from({ length: 36 }, (_, i) => makeYear(60 + i, yearOverrides)),
        null
      );
    }

    test('국민연금을 실제로 수급하면 대상자이지만 미수급인 경우보다 점수가 높다', () => {
      const params = buildPensionParams({ nationalPension: { expectedMonthlyAmount: 2000000 } });
      const receiving = computeLifetimeUtility(
        buildPensionResult({ nationalPensionIncome: NATIONAL_PENSION_ANNUAL }),
        params
      );
      const notReceiving = computeLifetimeUtility(buildPensionResult({ nationalPensionIncome: 0 }), params);

      expect(receiving.components.pensionUtilization).toBeGreaterThan(notReceiving.components.pensionUtilization);
    });

    test('국민연금 비대상자(수급액 0)는 대상자이지만 미수급인 경우보다 점수가 높다 (면제 처리)', () => {
      const notEligible = computeLifetimeUtility(
        buildPensionResult({ nationalPensionIncome: 0 }),
        buildPensionParams({ nationalPension: { expectedMonthlyAmount: 0 } })
      );
      const eligibleButNotReceiving = computeLifetimeUtility(
        buildPensionResult({ nationalPensionIncome: 0 }),
        buildPensionParams({ nationalPension: { expectedMonthlyAmount: 2000000 } })
      );

      expect(notEligible.components.pensionUtilization).toBeGreaterThan(
        eligibleButNotReceiving.components.pensionUtilization
      );
    });

    test('사적연금을 실제로 인출하면 계좌만 있고 인출하지 않는 경우보다 점수가 높다', () => {
      const params = buildPensionParams({ privatePensions: [privatePensionAccount] });
      const withdrawing = computeLifetimeUtility(
        buildPensionResult({ privatePensionIncome: PRIVATE_PENSION_ANNUAL, pensionAssets: 50000000 }),
        params
      );
      const notWithdrawing = computeLifetimeUtility(
        buildPensionResult({ privatePensionIncome: 0, pensionAssets: 100000000 }),
        params
      );

      expect(withdrawing.components.pensionUtilization).toBeGreaterThan(notWithdrawing.components.pensionUtilization);
    });

    test('사적연금 계좌가 아예 없으면 계좌가 있고 인출 중인 경우보다 점수가 낮다', () => {
      const noAccount = computeLifetimeUtility(
        buildPensionResult({ privatePensionIncome: 0, pensionAssets: 0 }),
        buildPensionParams({ privatePensions: [] })
      );
      const withdrawing = computeLifetimeUtility(
        buildPensionResult({ privatePensionIncome: PRIVATE_PENSION_ANNUAL, pensionAssets: 50000000 }),
        buildPensionParams({ privatePensions: [privatePensionAccount] })
      );

      expect(noAccount.components.pensionUtilization).toBeLessThan(withdrawing.components.pensionUtilization);
    });

    test('사적연금 저율과세 한도를 준수(낮은 실효세율)하면 한도를 초과(높은 실효세율)하는 경우보다 점수가 높다', () => {
      const params = buildPensionParams({ privatePensions: [privatePensionAccount] });
      const withinLimit = computeLifetimeUtility(
        buildPensionResult({
          privatePensionIncome: PRIVATE_PENSION_ANNUAL,
          pensionTaxPaid: 500000, // 실효세율 ≈ 4.8% (한도 10% 이내)
        }),
        params
      );
      const overLimit = computeLifetimeUtility(
        buildPensionResult({
          privatePensionIncome: PRIVATE_PENSION_ANNUAL,
          pensionTaxPaid: 3000000, // 실효세율 ≈ 23% (한도 10% 초과)
        }),
        params
      );

      expect(withinLimit.components.pensionUtilization).toBeGreaterThan(overLimit.components.pensionUtilization);
    });
  });

  test('자산 고갈이 없으면 depletionSafety가 만점, 조기 고갈되면 만점보다 낮다', () => {
    const noDepletion = computeLifetimeUtility(buildBalancedScenario(), baseParams);
    const depletion = computeLifetimeUtility(buildDepletionScenario(), baseParams);

    expect(noDepletion.components.depletionSafety).toBeGreaterThan(depletion.components.depletionSafety);
  });

  // B6: depletionSafety의 정규화 분모는 은퇴 후 기간(기대수명 - 은퇴 나이)이다. 같은
  // 고갈 나이라도 기대수명이 길수록 버티지 못한 기간이 길어지므로 점수가 낮아야 한다.
  test('depletionSafety는 은퇴 후 기간을 기대수명에서 잡는다', () => {
    const years = Array.from({ length: 36 }, (_, i) =>
      makeYear(60 + i, { totalAssets: ANNUAL_TARGET * 2, pensionAssets: ANNUAL_TARGET })
    );
    const shortSpanParams: SimulationParams = {
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 90 },
    };
    const longSpanParams: SimulationParams = {
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 110 },
    };

    const shortSpan = computeLifetimeUtility(makeResult(years, 85), shortSpanParams);
    const longSpan = computeLifetimeUtility(makeResult(years, 85), longSpanParams);

    expect(longSpan.components.depletionSafety)
      .toBeLessThan(shortSpan.components.depletionSafety);
  });

  test('생활비 충족률이 낮을수록(지속적 부족) consumption 점수가 낮아진다', () => {
    const fullyFundedResult = buildBalancedScenario();
    const underfundedResult = makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { spending: ANNUAL_TARGET * 0.4, totalAssets: ANNUAL_TARGET * 2, pensionAssets: ANNUAL_TARGET })),
      null
    );

    const fullyFunded = computeLifetimeUtility(fullyFundedResult, baseParams);
    const underfunded = computeLifetimeUtility(underfundedResult, baseParams);

    expect(fullyFunded.components.consumption).toBeGreaterThan(underfunded.components.consumption);
  });

  test('목표를 정확히 채운 계획은 consumption이 만점이다', () => {
    // 예전에는 목표를 100% 채워도 1/1.3 = 77%(35점 중 27점)였고, 만점을 받으려면 목표의
    // 두 배를 써야 했다. 그래서 소비축이 사실상 상수가 되어 후보 서열화에 기여하지 못했다.
    const utility = computeLifetimeUtility(buildBalancedScenario(), baseParams);
    expect(utility.components.consumption).toBe(DEFAULT_UTILITY_CONFIG.weights.consumption);
  });

  test('초과 소비는 다른 해의 결손을 상쇄하지 못한다', () => {
    // consumptionYearUtility에서 초과 보상(옛 코드: `1 + 0.3 * Math.sqrt(ratio - 1)`, 최대 1.3)을
    // 제거한 것을 잠근다. **전 구간이 ratio ≥ 1인 결과로는 이 계약을 잴 수 없다** — 정규화가
    // clamp(x, 0, 1)이라 옛 구현과 새 구현이 똑같이 1로 clamp되기 때문이다. 초과 해와 결손
    // 해가 섞여야 차이가 드러난다.
    //
    // 옛 곡선이면 목표의 2배를 쓴 해가 1.3을 받아 50%만 쓴 해의 0.354를 끌어올려
    // 평균 0.827이 되고, 이 단언이 깨진다.
    const halfOverHalfUnder = makeResult(
      Array.from({ length: 36 }, (_, i) =>
        makeYear(60 + i, { spending: i % 2 === 0 ? ANNUAL_TARGET * 2 : ANNUAL_TARGET * 0.5 })),
      null
    );

    const mixed = computeLifetimeUtility(halfOverHalfUnder, baseParams);
    const balanced = computeLifetimeUtility(buildBalancedScenario(), baseParams);

    // 절반이 결손인 계획이 전 구간 목표를 채운 계획보다 나을 수 없다.
    // (이 단언만으로는 부족하다 — 옛 곡선에서도 성립했다.)
    expect(mixed.components.consumption).toBeLessThan(balanced.components.consumption);

    // 초과분이 보상되지 않으므로 결손 해의 효용만 평균에 남는다:
    //   연도별 효용 평균 = (1.0 + 0.5^1.5) / 2 ≈ 0.677
    //   stabilityFactor = 1 - stdev([2.0, 0.5]) = 0.25 → 계수 0.85 + 0.15×0.25 = 0.8875
    //   → 0.677 × 0.8875 ≈ 0.601
    // 옛 곡선이면 초과 해가 1.3을 받아 평균이 0.827로 올라가고 결과는 ≈ 0.734가 된다.
    // 0.65는 그 둘 사이를 가르는 선이다.
    const ratio = mixed.components.consumption / DEFAULT_UTILITY_CONFIG.weights.consumption;
    expect(ratio).toBeCloseTo(0.601, 2);
    expect(ratio).toBeLessThan(0.65);
  });

  test('소비 효용 분모에 의료비가 포함된다 — 목표를 넘긴 지출이 만점으로 clamp되지 않는다', () => {
    // 엔진은 의료비를 spending에 합산한다. 그 금액을 목표(분모)에도 더하지 않으면 ratio가
    // 1을 넘어 만점으로 clamp되고, 의료비를 켠 계획이 오히려 "목표를 다 채웠다"로 읽힌다.
    //
    // 아래 두 결과는 spending이 같다(목표 + 의료비 600만). 다른 것은 그 초과분이 의료비로
    // 태그되어 있는지뿐이다. 의료비 쪽은 ratio가 정확히 1(= 만점)이어야 하고, 태그가 없는
    // 쪽은 목표를 넘겨 쓴 것이라 역시 1로 clamp된다 — 그래서 이 둘만으로는 계약이 안 잡힌다.
    // 결손이 드러나려면 재원이 부족한 경우를 봐야 한다.
    const HEALTHCARE = 6_000_000;

    // 재원이 목표만큼만 있는데 의료비가 추가로 나가는 계획: spending은 목표에 묶여 있고
    // 그중 의료비 600만이 섞여 있다 → 실제 생활비는 목표에 600만 모자란다.
    const withHealthcare = makeResult(
      Array.from({ length: 36 }, (_, i) =>
        makeYear(60 + i, { spending: ANNUAL_TARGET, healthcareSpending: HEALTHCARE })),
      null
    );
    const withoutHealthcare = makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { spending: ANNUAL_TARGET })),
      null
    );

    // 분모가 (목표 + 의료비)이므로 ratio = 3600/(3600+600) = 0.857 < 1 → 만점 미달.
    expect(computeLifetimeUtility(withHealthcare, baseParams).components.consumption)
      .toBeLessThan(computeLifetimeUtility(withoutHealthcare, baseParams).components.consumption);
  });

  test('구성요소 점수의 합은 score와 일치해야 한다', () => {
    const utility = computeLifetimeUtility(buildBalancedScenario(), baseParams);
    const sum = Object.values(utility.components).reduce((a, b) => a + b, 0);
    expect(utility.score).toBe(sum);
  });

  test('score는 0~100 범위를 벗어나지 않는다', () => {
    const scenarios = [buildDepletionScenario(), buildExcessLeftoverScenario(), buildBalancedScenario()];
    for (const s of scenarios) {
      const utility = computeLifetimeUtility(s, baseParams);
      expect(utility.score).toBeGreaterThanOrEqual(0);
      expect(utility.score).toBeLessThanOrEqual(100);
    }
  });

  test('세부담률이 높을수록(taxBurdenCeiling에 근접/초과) taxEfficiency 점수가 낮아진다', () => {
    // taxBurdenCeiling 기본값 0.3(30%). 세전소득 대비 세금 비율을 각각 0%, 15%, 40%로 구성.
    const noTaxResult = makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { totalAssets: ANNUAL_TARGET * 2, pensionAssets: ANNUAL_TARGET })),
      null
    );
    const moderateTaxResult = makeResult(
      Array.from({ length: 36 }, (_, i) =>
        makeYear(60 + i, {
          totalAssets: ANNUAL_TARGET * 2,
          pensionAssets: ANNUAL_TARGET,
          dividendTaxPaid: ANNUAL_TARGET * 0.15,
        })
      ),
      null
    );
    const heavyTaxResult = makeResult(
      Array.from({ length: 36 }, (_, i) =>
        makeYear(60 + i, {
          totalAssets: ANNUAL_TARGET * 2,
          pensionAssets: ANNUAL_TARGET,
          dividendTaxPaid: ANNUAL_TARGET * 0.4,
        })
      ),
      null
    );

    const noTax = computeLifetimeUtility(noTaxResult, baseParams);
    const moderateTax = computeLifetimeUtility(moderateTaxResult, baseParams);
    const heavyTax = computeLifetimeUtility(heavyTaxResult, baseParams);

    expect(noTax.components.taxEfficiency).toBeGreaterThan(moderateTax.components.taxEfficiency);
    expect(moderateTax.components.taxEfficiency).toBeGreaterThan(heavyTax.components.taxEfficiency);
    // ceiling(30%)을 초과하면 clamp되어 0점이어야 한다
    expect(heavyTax.components.taxEfficiency).toBe(0);
  });

  test('기타소득은 세부담률의 분모에서 제외된다 (넣으면 세금 효율이 부풀려진다)', () => {
    // 이 시뮬레이터는 기타소득에 세금을 매기지 않는다(입력 계약이 "세후 실수령액"이다).
    // 그런 소득을 분모에 넣으면 세금이 붙지 않는 돈이 세부담률을 희석시켜, 월세·임대소득을
    // 입력한 사용자일수록 세금 효율 점수가 좋아진다. 실제로 세금을 덜 내는 것이 아닌데도.
    const withTax = (overrides: Partial<SimulationYearlyResult>) =>
      makeResult(
        Array.from({ length: 36 }, (_, i) =>
          makeYear(60 + i, {
            totalAssets: ANNUAL_TARGET * 2,
            pensionAssets: ANNUAL_TARGET,
            dividendTaxPaid: ANNUAL_TARGET * 0.15,
            ...overrides,
          })
        ),
        null
      );

    // 과세 소득과 세금은 그대로 두고, 비과세 기타소득만 얹는다.
    const withoutOtherIncome = computeLifetimeUtility(withTax({}), baseParams);
    const withOtherIncome = computeLifetimeUtility(
      withTax({ otherIncome: ANNUAL_TARGET, preTaxTotalIncome: ANNUAL_TARGET * 2 }),
      baseParams
    );

    // 실제 세부담은 한 푼도 달라지지 않았으므로 점수도 같아야 한다.
    expect(withOtherIncome.components.taxEfficiency).toBe(withoutOtherIncome.components.taxEfficiency);
  });

  test('금융소득종합과세 경고 연도 비율이 높을수록 taxationRisk 점수가 낮아진다', () => {
    const noWarningResult = makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { totalAssets: ANNUAL_TARGET * 2, pensionAssets: ANNUAL_TARGET })),
      null
    );
    const allWarningResult = makeResult(
      Array.from({ length: 36 }, (_, i) =>
        makeYear(60 + i, { totalAssets: ANNUAL_TARGET * 2, pensionAssets: ANNUAL_TARGET, hasTaxWarning: true })
      ),
      null
    );

    const noWarning = computeLifetimeUtility(noWarningResult, baseParams);
    const allWarning = computeLifetimeUtility(allWarningResult, baseParams);

    expect(noWarning.components.taxationRisk).toBeGreaterThan(allWarning.components.taxationRisk);
  });

  test('건강보험료/총소득 비율이 healthInsuranceCeiling을 초과할수록 taxationRisk 점수가 낮아진다', () => {
    // healthInsuranceCeiling 기본값 0.05(5%). 총소득 대비 건보료 비율을 각각 0%, 10%로 구성.
    const noHealthInsuranceResult = makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { totalAssets: ANNUAL_TARGET * 2, pensionAssets: ANNUAL_TARGET })),
      null
    );
    const highHealthInsuranceResult = makeResult(
      Array.from({ length: 36 }, (_, i) =>
        makeYear(60 + i, {
          totalAssets: ANNUAL_TARGET * 2,
          pensionAssets: ANNUAL_TARGET,
          healthInsurancePaid: ANNUAL_TARGET * 0.1,
        })
      ),
      null
    );

    const noHealthInsurance = computeLifetimeUtility(noHealthInsuranceResult, baseParams);
    const highHealthInsurance = computeLifetimeUtility(highHealthInsuranceResult, baseParams);

    expect(noHealthInsurance.components.taxationRisk).toBeGreaterThan(highHealthInsurance.components.taxationRisk);
  });
});

// C4: "최대 상속"은 종형 곡선이 아니라 단조증가(포화) 곡선으로 채점되어야 한다.
// 종형 곡선을 그대로 쓰면 "가능한 한 많이 남기는" 전략을 고른 사용자가 많이 남길수록 감점된다.
describe('bequestAdequacy — bequestStrategy = maximize (최대 상속)', () => {
  const APPROPRIATE_BALANCE = userProfile.targetMonthlySpending * 24; // 7,200만원 = ANNUAL_TARGET * 2

  const withStrategy = (bequestStrategy: BequestStrategy): SimulationParams => ({
    ...baseParams,
    strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy },
  });

  const resultWithEndingAssets = (totalAssets: number): SimulationResult =>
    makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { totalAssets, pensionAssets: 0 })),
      null
    );

  test('최대 상속을 고르면 잔여자산이 많을수록 점수가 높아진다', () => {
    const params = withStrategy('maximize');
    const atAppropriate = computeLifetimeUtility(resultWithEndingAssets(APPROPRIATE_BALANCE), params);
    const farAbove = computeLifetimeUtility(resultWithEndingAssets(APPROPRIATE_BALANCE * 6), params);

    expect(farAbove.components.bequestAdequacy).toBeGreaterThan(atAppropriate.components.bequestAdequacy);
  });

  test('단조증가여도 배점(가중치)을 넘지 않는다 — 0~1로 정규화된 포화 곡선', () => {
    const params = withStrategy('maximize');
    const astronomical = computeLifetimeUtility(resultWithEndingAssets(1e12), params);

    expect(astronomical.components.bequestAdequacy)
      .toBeLessThanOrEqual(DEFAULT_UTILITY_CONFIG.weights.bequestAdequacy);
    expect(astronomical.components.bequestAdequacy).toBeGreaterThan(0);
  });

  test('잔여자산이 0이면 최대 상속 점수도 0이다', () => {
    const params = withStrategy('maximize');
    const nothing = computeLifetimeUtility(resultWithEndingAssets(0), params);

    expect(nothing.components.bequestAdequacy).toBe(0);
  });

  test('다른 상속 전략(일부 남기기)은 종형 곡선을 그대로 유지한다', () => {
    const params = withStrategy('leave_some');
    const atAppropriate = computeLifetimeUtility(resultWithEndingAssets(APPROPRIATE_BALANCE), params);
    const farAbove = computeLifetimeUtility(resultWithEndingAssets(APPROPRIATE_BALANCE * 6), params);

    expect(farAbove.components.bequestAdequacy).toBeLessThan(atAppropriate.components.bequestAdequacy);
  });

  // 회귀 가드: '최대 상속'은 기본값이 아니어야 한다. 기본값이 단조증가로 채점되면
  // (1) 전략을 저장한 적 없는 모든 시나리오의 점수가 작업 전과 달라지고
  // (2) "과다 잔여자산은 감점"이라는 앱의 기본 판단이 통째로 사라진다.
  test('strategy를 저장하지 않은 시나리오는 기본값(일부 남기기)의 종형 곡선을 쓴다', () => {
    const atAppropriate = computeLifetimeUtility(resultWithEndingAssets(APPROPRIATE_BALANCE), baseParams);
    const farAbove = computeLifetimeUtility(resultWithEndingAssets(APPROPRIATE_BALANCE * 6), baseParams);

    expect(baseParams.strategy).toBeUndefined();
    expect(DEFAULT_RETIREMENT_STRATEGY.bequestStrategy).not.toBe('maximize');
    expect(farAbove.components.bequestAdequacy).toBeLessThan(atAppropriate.components.bequestAdequacy);
  });
});
