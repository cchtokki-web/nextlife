import { describe, test, expect, vi } from 'vitest';
import { computeSensitivityAnalysis, SensitivityScenario } from '@/core/usecases/dashboard/computeSensitivityAnalysis';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams, SimulationResult } from '@/core/entities/types';

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

function makeResult(depletionAge: number | null): SimulationResult {
  return {
    yearlyResults: [],
    fireAge: 60,
    depletionAge,
    endingAssets: 0,
    retirementScore: 70,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
    householdEndAge: 90,
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
    const runForUtility = vi.fn((p: SimulationParams) => makeResult(85));
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
    const runForUtility = vi.fn((p: SimulationParams) => makeResult(85));
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
