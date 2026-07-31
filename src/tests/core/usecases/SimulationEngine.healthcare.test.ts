import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { HealthcareAssumptions, SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 60, retirementAge: 60, expectancy: 80, targetMonthlySpending: 2000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 1000000000, monthlyContribution: 0, annualReturn: 0, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const healthcare: HealthcareAssumptions = {
  enabled: true, costGrowthRate: 0, baseMonthlyCost: 500000,
  longTermCareEnabled: false, longTermCareStartAge: 80, longTermCareMonthlyCost: 0,
  shockEnabled: false, shockAge: 75, shockAmount: 0,
};

describe('SimulationEngine 의료비 통합', () => {
  test('healthcare가 없으면 결과가 기존과 완전히 동일하다', () => {
    const engine = new SimulationEngine();

    expect(engine.run({ ...baseParams, healthcare: undefined })).toEqual(engine.run(baseParams));
  });

  test('healthcare.enabled가 false면 결과가 기존과 완전히 동일하다', () => {
    const engine = new SimulationEngine();

    const disabled = engine.run({ ...baseParams, healthcare: { ...healthcare, enabled: false } });

    expect(disabled).toEqual(engine.run(baseParams));
  });

  test('의료비를 켜면 해당 금액이 healthcareSpending에 기록된다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({ ...baseParams, healthcare });
    const at65 = result.yearlyResults.find((y) => y.age === 65)!;

    expect(at65.healthcareSpending).toBe(500000 * 12);
  });

  test('의료비가 총 생활비 인출(spending)에 포함된다', () => {
    const engine = new SimulationEngine();

    const without = engine.run(baseParams);
    const withHc = engine.run({ ...baseParams, healthcare });

    const at65 = (r: typeof without) => r.yearlyResults.find((y) => y.age === 65)!;

    expect(at65(withHc).spending).toBeCloseTo(at65(without).spending + 500000 * 12, 0);
  });

  test('은퇴 전 연도에는 의료비가 0이다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, currentAge: 55, retirementAge: 60 },
      healthcare,
    });
    const at57 = result.yearlyResults.find((y) => y.age === 57)!;

    expect(at57.healthcareSpending).toBe(0);
  });

  test('의료비를 켜면 자산이 더 빨리 줄어든다', () => {
    const engine = new SimulationEngine();

    // baseParams는 assets가 비어 있어 사적연금 인출 잉여분이 담길 곳이 없다(엔진은
    // activeAssets가 없으면 잉여를 그냥 버린다). 그 상태에서는 의료비 유무와 무관하게
    // 기말 자산이 둘 다 0이라 이 비교 자체가 성립하지 않으므로, 잉여를 담을 일반자산을 준다.
    const withHolder: SimulationParams = {
      ...baseParams,
      assets: [{
        id: 'a1', type: 'etf', ticker: 'HOLD', name: '현금성 자산',
        quantity: 1, averagePrice: 0, annualGrowthRate: 0, dividendYield: 0,
        monthlyContribution: 0, reinvestDividend: false, currency: 'KRW',
      }],
    };

    const without = engine.run(withHolder);
    const withHc = engine.run({ ...withHolder, healthcare });

    expect(without.endingAssets).toBeGreaterThan(0);
    expect(withHc.endingAssets).toBeLessThan(without.endingAssets);
  });

  // 아래 세 개는 브리프에 없지만, 의료비를 "지출 라인"으로만 넣고 목표(분모) 쪽을 손대지
  // 않으면 점수가 뒤집히는 문제를 막기 위해 추가한 것이다(Task 5의 spendingFactor와 동형).
  describe('목표(분모) 처리', () => {
    // 사적연금 정상 인출을 0으로 막아 부족분을 전부 사적연금 후행 인출로 메우게 한다.
    // 이 경로의 인출액은 totalIncome에 집계되므로, 의료비를 켜면 분자(소득)가 커진다.
    const shortfallFunded: SimulationParams = {
      ...baseParams,
      withdrawalPlan: { privatePensionMonthlyTarget: 0 },
    };

    test('의료비를 켜도 목표 달성률이 부풀지 않는다', () => {
      const engine = new SimulationEngine();

      const without = engine.run(shortfallFunded);
      const withHc = engine.run({ ...shortfallFunded, healthcare });

      // 분모에 의료비를 더하지 않으면 달성률이 100%대에서 120%대로 뛴다.
      expect(withHc.goalAchievementRate).toBeLessThanOrEqual(without.goalAchievementRate);
      expect(withHc.goalAchievementRate).toBeGreaterThan(without.goalAchievementRate - 15);
    });

    test('의료비를 켜도 소비 효용이 "목표 초과 소비" 보너스를 받지 않는다', () => {
      const engine = new SimulationEngine();

      const without = engine.run(shortfallFunded);
      const withHc = engine.run({ ...shortfallFunded, healthcare });

      // 분모에 의료비를 더하지 않으면 spending만 커져 ratio > 1이 되고,
      // consumptionYearUtility가 이를 보너스로 처리해 점수가 올라간다.
      expect(withHc.utility!.components.consumption)
        .toBeLessThanOrEqual(without.utility!.components.consumption + 1e-9);
    });
  });

  test('배당금만 소비 전략에서도 의료비는 실제로 지출된다', () => {
    const engine = new SimulationEngine();

    const dividendOnly: SimulationParams = { ...baseParams, spendingStrategy: 'dividend_only' };
    const without = engine.run(dividendOnly);
    const withHc = engine.run({ ...dividendOnly, healthcare });

    const at65 = (r: typeof without) => r.yearlyResults.find((y) => y.age === 65)!;

    expect(at65(withHc).healthcareSpending).toBe(500000 * 12);
    // healthcareSpending은 "spending에 포함된 금액"이므로 실제로 지출에 잡혀야 한다.
    expect(at65(withHc).spending).toBeGreaterThan(at65(without).spending);
  });
});
