import { describe, test, expect, vi } from 'vitest';
import { computeSensitivityAnalysis } from '@/core/usecases/dashboard/computeSensitivityAnalysis';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 40, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [
    { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 10, averagePrice: 400000,
      annualGrowthRate: 7, dividendYield: 1.5, monthlyContribution: 500000, reinvestDividend: true, currency: 'KRW' },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 50000000, monthlyContribution: 300000, annualReturn: 4, currency: 'KRW' },
  ],
  isaAccounts: [
    { id: 'i1', type: 'general', balance: 20000000, monthlyContribution: 200000,
      annualReturn: 5, dividendYield: 2, currency: 'KRW', maturityYears: 3 },
  ],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

function makeResult(
  depletionAge: number | null,
  extras: { endingAssets?: number; yearlyResults?: SimulationYearlyResult[] } = {}
): SimulationResult {
  return {
    yearlyResults: extras.yearlyResults ?? [],
    fireAge: 60,
    depletionAge,
    endingAssets: extras.endingAssets ?? 0,
    retirementScore: 70,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

function makeMockEngine(depletionAgeByLabel: Record<string, number | null>): SimulationEngine {
  const runForUtility = vi.fn((params: SimulationParams) => {
    if (params.assets[0]?.annualGrowthRate === 5) return makeResult(depletionAgeByLabel['returnDown']);
    if (params.assets[0]?.annualGrowthRate === 9) return makeResult(depletionAgeByLabel['returnUp']);
    if (params.inflationRate === 3) return makeResult(depletionAgeByLabel['inflationUp']);
    if (params.inflationRate === 1) return makeResult(depletionAgeByLabel['inflationDown']);
    if (params.userProfile.retirementAge === 57) return makeResult(depletionAgeByLabel['retirementEarlier']);
    if (params.userProfile.retirementAge === 63) return makeResult(depletionAgeByLabel['retirementLater']);
    throw new Error(`unexpected params: ${JSON.stringify(params)}`);
  });
  return { runForUtility } as unknown as SimulationEngine;
}

describe('computeSensitivityAnalysis', () => {
  test('투자수익률 시나리오는 assets/privatePensions/isaAccounts 수익률에 동일하게 델타를 적용한다', () => {
    const engine = makeMockEngine({
      returnDown: 85, returnUp: 90, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    });
    computeSensitivityAnalysis(baseParams, makeResult(88), engine);

    const calls = (engine.runForUtility as unknown as { mock: { calls: SimulationParams[][] } }).mock.calls;
    const returnDownCall = calls.find((c) => c[0].assets[0].annualGrowthRate === 5)![0];
    expect(returnDownCall.privatePensions[0].annualReturn).toBe(2); // 4 - 2
    expect(returnDownCall.isaAccounts![0].annualReturn).toBe(3); // 5 - 2

    const returnUpCall = calls.find((c) => c[0].assets[0].annualGrowthRate === 9)![0];
    expect(returnUpCall.privatePensions[0].annualReturn).toBe(6); // 4 + 2
    expect(returnUpCall.isaAccounts![0].annualReturn).toBe(7); // 5 + 2
  });

  test('물가상승률/은퇴시점 시나리오는 해당 필드만 바꾸고 나머지는 baseParams와 동일하다', () => {
    const engine = makeMockEngine({
      returnDown: 88, returnUp: 88, inflationUp: 85, inflationDown: 90,
      retirementEarlier: 86, retirementLater: 89,
    });
    computeSensitivityAnalysis(baseParams, makeResult(88), engine);

    const calls = (engine.runForUtility as unknown as { mock: { calls: SimulationParams[][] } }).mock.calls;
    const inflationUpCall = calls.find((c) => c[0].inflationRate === 3)![0];
    expect(inflationUpCall.assets[0].annualGrowthRate).toBe(7); // 변경 없음
    expect(inflationUpCall.userProfile.retirementAge).toBe(60); // 변경 없음

    const retirementEarlierCall = calls.find((c) => c[0].userProfile.retirementAge === 57)![0];
    expect(retirementEarlierCall.inflationRate).toBe(2); // 변경 없음
  });

  test('retirementEarlier는 currentAge + 1 미만으로 내려가지 않도록 clamp된다', () => {
    const params: SimulationParams = {
      ...baseParams,
      userProfile: { currentAge: 58, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
    };
    const runForUtility = vi.fn((_p: SimulationParams) => makeResult(85));
    const engine = { runForUtility } as unknown as SimulationEngine;

    computeSensitivityAnalysis(params, makeResult(88), engine);

    const calls = (runForUtility as unknown as { mock: { calls: SimulationParams[][] } }).mock.calls;
    const earlierCall = calls.find((c) => c[0].userProfile.retirementAge < 60);
    expect(earlierCall![0].userProfile.retirementAge).toBe(59); // max(58+1, 60-3=57) = 59
  });

  test('retirementLater는 expectancy - 1을 넘지 않도록 clamp된다', () => {
    const params: SimulationParams = {
      ...baseParams,
      userProfile: { currentAge: 40, retirementAge: 88, expectancy: 90, targetMonthlySpending: 3000000 },
    };
    const runForUtility = vi.fn((_p: SimulationParams) => makeResult(85));
    const engine = { runForUtility } as unknown as SimulationEngine;

    computeSensitivityAnalysis(params, makeResult(88), engine);

    const calls = (runForUtility as unknown as { mock: { calls: SimulationParams[][] } }).mock.calls;
    const laterCall = calls.find((c) => c[0].userProfile.retirementAge > 88);
    expect(laterCall![0].userProfile.retirementAge).toBe(89); // min(90-1=89, 88+3=91) = 89
  });

  test('depletionAge가 빠른(위험한) 시나리오부터 정렬되고, null(평생 유지)은 항상 뒤로 간다', () => {
    const engine = makeMockEngine({
      returnDown: 82, returnUp: null, inflationUp: 86, inflationDown: null,
      retirementEarlier: 84, retirementLater: 89,
    });
    const scenarios = computeSensitivityAnalysis(baseParams, makeResult(88), engine);

    const nonNullKeys = scenarios.filter((s) => s.depletionAge !== null).map((s) => s.key);
    expect(nonNullKeys).toEqual(['returnDown', 'retirementEarlier', 'inflationUp', 'retirementLater']);
    const nullKeys = scenarios.filter((s) => s.depletionAge === null).map((s) => s.key);
    expect(nullKeys.sort()).toEqual(['inflationDown', 'returnUp'].sort());
    expect(scenarios.slice(-2).every((s) => s.depletionAge === null)).toBe(true);
  });

  test('deltaYears는 baseline/시나리오의 null 조합 4가지를 모두 올바르게 계산한다', () => {
    // baseline=88(둘 다 숫자), returnDown=82 -> delta = 82-88 = -6
    // baseline=88, returnUp=null(시나리오만 null, 평생 유지로 개선) -> delta = expectancy(90)-88 = +2
    const engine = makeMockEngine({
      returnDown: 82, returnUp: null, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    });
    const scenarios = computeSensitivityAnalysis(baseParams, makeResult(88), engine);
    expect(scenarios.find((s) => s.key === 'returnDown')!.deltaYears).toBe(-6);
    expect(scenarios.find((s) => s.key === 'returnUp')!.deltaYears).toBe(2);
  });

  test('baseline도 null(평생 유지)이고 시나리오도 null이면 deltaYears는 null이다', () => {
    const engine = makeMockEngine({
      returnDown: null, returnUp: null, inflationUp: null, inflationDown: null,
      retirementEarlier: null, retirementLater: null,
    });
    const scenarios = computeSensitivityAnalysis(baseParams, makeResult(null), engine);
    scenarios.forEach((s) => {
      expect(s.depletionAge).toBeNull();
      expect(s.deltaYears).toBeNull();
    });
  });

  test('baseline은 숫자인데 시나리오가 null(평생 유지로 개선)이면 deltaYears는 expectancy - baseline이다', () => {
    const engine = makeMockEngine({
      returnDown: 88, returnUp: null, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    });
    const scenarios = computeSensitivityAnalysis(baseParams, makeResult(80), engine);
    expect(scenarios.find((s) => s.key === 'returnUp')!.deltaYears).toBe(10); // 90 - 80
  });

  // B5: "고갈 없음"의 센티널은 고정값이 아니라 그 계획의 기대수명이어야 한다.
  // 90세로 고정하면 기대수명 100세인 계획에서 95세 고갈 시나리오가 고갈이 전혀 없는
  // baseline보다 5년 "낫다"고 보고된다.
  test('고갈 없음 센티널은 그 계획의 기대수명이다', () => {
    const engine = makeMockEngine({
      returnDown: 95, returnUp: null, inflationUp: null, inflationDown: null,
      retirementEarlier: null, retirementLater: null,
    });
    const params: SimulationParams = {
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 100 },
    };

    const scenarios = computeSensitivityAnalysis(params, makeResult(null), engine);

    expect(scenarios.find((s) => s.key === 'returnDown')!.deltaYears).toBe(-5);
  });

  // **왜 연속형 지표가 필요한가.**
  //
  // depletionAge만 보고하면 여유 있는 계획에서는 6개 시나리오가 전부 null이 되어 화면이
  // "고갈 위험 없습니다" 한 줄로 접힌다. 실제 리포트에서 수익률 ±2%p가 기말자산을 수억 원
  // 갈라놓는데도 사용자는 "아무 차이 없음"을 봤다. 재계산은 이미 하고 있었고, 그 결과에서
  // 버려지던 값을 함께 싣는다.
  describe('연속형 지표', () => {
    test('기말자산과 baseline 대비 증감을 함께 보고한다', () => {
      const runForUtility = vi.fn((params: SimulationParams) => {
        if (params.assets[0]?.annualGrowthRate === 5) return makeResult(null, { endingAssets: 820000000 });
        return makeResult(null, { endingAssets: 3000000000 });
      });
      const engine = { runForUtility } as unknown as SimulationEngine;

      const scenarios = computeSensitivityAnalysis(
        baseParams, makeResult(null, { endingAssets: 2500000000 }), engine
      );

      const returnDown = scenarios.find((s) => s.key === 'returnDown')!;
      expect(returnDown.endingAssets).toBe(820000000);
      expect(returnDown.endingAssetsDelta).toBe(820000000 - 2500000000);

      const returnUp = scenarios.find((s) => s.key === 'returnUp')!;
      expect(returnUp.endingAssetsDelta).toBe(3000000000 - 2500000000);
    });

    // 자산이 남아 있어도 목표 생활비를 못 채운 해는 계획이 실패한 해다. depletionAge는
    // 그 해를 잡지 못한다(인출 경로가 잔액을 넘겨 인출하지 않아 totalAssets가 0이 되지 않는다).
    test('목표 생활비를 채우지 못한 해의 수를 보고한다', () => {
      const yearlyResults = [
        makeYearlyResult({ age: 80, unmetSpending: 0 }),
        makeYearlyResult({ age: 81, unmetSpending: 1200000 }),
        makeYearlyResult({ age: 82, unmetSpending: 3600000 }),
      ];
      const runForUtility = vi.fn(() => makeResult(null, { yearlyResults }));
      const engine = { runForUtility } as unknown as SimulationEngine;

      const scenarios = computeSensitivityAnalysis(baseParams, makeResult(null), engine);

      expect(scenarios[0].unmetSpendingYears).toBe(2);
    });
  });

  // **은퇴시점 시나리오가 무효였던 이유.**
  //
  // 엔진은 일반자산 매도 개시를 withdrawalPlan.generalAssetWithdrawalStartAge ?? retirementAge로
  // 읽는다. 그런데 센티널 단계(verifiedSentinelPlan의 SENTINEL_AXES)가 이 필드를 항상 채우므로,
  // retirementAge만 3년 옮긴 시나리오는 은퇴만 당겨지고 자산 인출은 옛 나이에 그대로 머물렀다.
  test('은퇴시점 시나리오는 일반자산 인출 개시 나이도 함께 옮긴다', () => {
    const params: SimulationParams = {
      ...baseParams,
      withdrawalPlan: { generalAssetWithdrawalStartAge: 60 },
    };
    const runForUtility = vi.fn((_p: SimulationParams) => makeResult(85));
    const engine = { runForUtility } as unknown as SimulationEngine;

    computeSensitivityAnalysis(params, makeResult(88), engine);

    const calls = (runForUtility as unknown as { mock: { calls: SimulationParams[][] } }).mock.calls;
    const earlier = calls.find((c) => c[0].userProfile.retirementAge === 57)![0];
    expect(earlier.withdrawalPlan?.generalAssetWithdrawalStartAge).toBe(57);

    const later = calls.find((c) => c[0].userProfile.retirementAge === 63)![0];
    expect(later.withdrawalPlan?.generalAssetWithdrawalStartAge).toBe(63);
  });

  test('일반자산 인출 개시 나이가 설정되지 않았으면 만들어 내지 않는다', () => {
    // 미설정은 "은퇴 나이를 따른다"는 뜻이라(엔진의 ?? 폴백) 이미 함께 움직인다.
    // 여기서 값을 채워 넣으면 사용자가 설정하지 않은 계획을 시나리오가 지어내는 셈이다.
    const runForUtility = vi.fn((_p: SimulationParams) => makeResult(85));
    const engine = { runForUtility } as unknown as SimulationEngine;

    computeSensitivityAnalysis(baseParams, makeResult(88), engine);

    const calls = (runForUtility as unknown as { mock: { calls: SimulationParams[][] } }).mock.calls;
    const earlier = calls.find((c) => c[0].userProfile.retirementAge === 57)![0];
    expect(earlier.withdrawalPlan?.generalAssetWithdrawalStartAge).toBeUndefined();
  });

  // mock이 아닌 실제 엔진으로 "재계산이 실제로 일어나고 방향이 맞는가"를 고정한다.
  // 위 테스트들은 전부 mock engine이라 엔진이 통째로 바뀌어도 통과한다.
  //
  // 자산을 넉넉하게 잡는 이유가 이 테스트의 요점이다: 고갈이 전혀 없어(depletionAge가 모두
  // null) 예전 구현으로는 6개 시나리오가 구분되지 않던 계획에서도, 기말자산은 뚜렷하게
  // 갈린다는 것을 보인다. 리포트가 보고한 상황(잔여자산 25억, 민감도 전부 "평생 유지")이
  // 정확히 이 형태였다.
  test('[통합] 고갈이 없는 계획에서도 수익률에 따라 기말자산이 갈린다', () => {
    const engine = new SimulationEngine();
    const richParams: SimulationParams = {
      ...baseParams,
      assets: [
        { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 500, averagePrice: 400000,
          annualGrowthRate: 7, dividendYield: 1.5, monthlyContribution: 2000000, reinvestDividend: true, currency: 'KRW' },
      ],
      nationalPension: { expectedMonthlyAmount: 2000000 },
    };
    const baseline = engine.runForUtility(richParams);

    // 전제 확인: 이 계획은 고갈되지 않는다. 고갈되면 아래 비교가 "0 대 0"이 되어 무의미해진다.
    expect(baseline.depletionAge).toBeNull();
    expect(baseline.endingAssets).toBeGreaterThan(0);

    const scenarios = computeSensitivityAnalysis(richParams, baseline, engine);

    // 예전 구현이라면 여기서 멈췄다 — 6개 전부 "평생 유지"라 구분되는 정보가 없었다.
    expect(scenarios.every((s) => s.depletionAge === null)).toBe(true);

    const down = scenarios.find((s) => s.key === 'returnDown')!;
    const up = scenarios.find((s) => s.key === 'returnUp')!;

    expect(down.endingAssets).toBeLessThan(baseline.endingAssets);
    expect(up.endingAssets).toBeGreaterThan(baseline.endingAssets);
    expect(down.endingAssetsDelta).toBeLessThan(0);
    expect(up.endingAssetsDelta).toBeGreaterThan(0);
  });

  test('특정 시나리오가 예외를 던져도 나머지 5개는 정상 반환된다', () => {
    const runForUtility = vi.fn((params: SimulationParams) => {
      if (params.assets[0]?.annualGrowthRate === 5) throw new Error('시뮬레이션 실패');
      return makeResult(85);
    });
    const engine = { runForUtility } as unknown as SimulationEngine;

    const scenarios = computeSensitivityAnalysis(baseParams, makeResult(88), engine);

    expect(scenarios).toHaveLength(5);
    expect(scenarios.find((s) => s.key === 'returnDown')).toBeUndefined();
  });
});
