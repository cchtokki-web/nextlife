import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SINGLE_SURVIVOR_SPENDING_FACTOR } from '@/core/usecases/spouse/spouseRules';
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
  // 주의: 아래 두 테스트는 "변경 전 엔진과 동일하다"를 증명하지 않는다(둘 다 변경 후 엔진끼리의
  // 비교다). 특히 healthcare: undefined는 runSingle 입장에서 필드가 없는 것과 같은 입력이라
  // 사실상 실행의 결정성만 확인한다. 증명하는 것은 "의료비 off ≡ 의료비 미설정"이라는 동치성이고,
  // 실제 무회귀 증거는 (1) SimulationEngine.withdrawalPlan.test.ts 스냅샷이 +36/-0(추가된
  // healthcareSpending 줄뿐, 기존 값 변경 0)이라는 것과 (2) 의료비 기능 이전부터 있던 기존
  // 테스트 전체가 그대로 통과한다는 사실이다.
  test('healthcare: undefined는 healthcare 필드 자체가 없는 것과 동치다', () => {
    const engine = new SimulationEngine();

    expect(engine.run({ ...baseParams, healthcare: undefined })).toEqual(engine.run(baseParams));
  });

  test('healthcare.enabled가 false면 다른 의료비 값과 무관하게 의료비 미설정과 동치다', () => {
    const engine = new SimulationEngine();

    const disabled = engine.run({
      ...baseParams,
      spendingStrategy: 'target',
      healthcare: {
        // enabled가 false이므로 아래 값들은 결과에 전혀 반영되면 안 된다.
        enabled: false, costGrowthRate: 12, baseMonthlyCost: 3000000,
        longTermCareEnabled: true, longTermCareStartAge: 65, longTermCareMonthlyCost: 5000000,
        shockEnabled: true, shockAge: 70, shockAmount: 100000000,
      },
    });

    expect(disabled).toEqual(engine.run({ ...baseParams, spendingStrategy: 'target' }));
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
  // 않으면 점수가 뒤집히는 문제를 막기 위해 추가한 것이다(spendingFactor와 동형).
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

    test('FIRE 판정도 의료비를 감당할 수 있어야 성립한다', () => {
      const engine = new SimulationEngine();

      // 월 220만원 고정소득 vs 목표 220만원(생활비 200 + 의료비 50 = 250만원엔 미달).
      // 의료비를 목표에 넣지 않으면 "의료비를 못 내는데 FIRE 달성"이 된다.
      const fixedIncome: SimulationParams = {
        ...baseParams,
        privatePensions: [],
        otherIncomes: [{ id: 'o1', label: '임대소득', monthlyAmount: 2200000, currency: 'KRW' }],
      };

      expect(engine.run(fixedIncome).fireAge).toBe(60);
      expect(engine.run({ ...fixedIncome, healthcare }).fireAge).toBeNull();
    });
  });

  // 연도 루프는 computeHouseholdEndAge()까지, 즉 "둘 중 늦게 죽는 쪽"까지 돈다. 그 구간에서
  // 의료비만 축소 계수를 안 받으면 사망한 본인 앞으로 전액이 계속 인출된다.
  describe('배우자 생존 기간 축소 계수', () => {
    // 본인 60세/기대수명 80, 배우자 55세/기대수명 90 → deathAtSelfAge = 60 + (90-55) = 95.
    // 즉 본인 사후 81~95세 구간을 배우자가 단독 생존한다.
    const withSpouse: SimulationParams = {
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 55, expectancy: 90,
      },
    };

    const healthcareAt = (params: SimulationParams, age: number) =>
      new SimulationEngine().run(params).yearlyResults.find((y) => y.age === age)!.healthcareSpending;

    test('둘 다 생존한 해에는 의료비가 전액 나간다', () => {
      expect(healthcareAt({ ...withSpouse, healthcare }, 75)).toBe(500000 * 12);
    });

    test('본인 사후 배우자 단독 생존 기간에는 의료비도 축소 계수만큼 줄어든다', () => {
      expect(healthcareAt({ ...withSpouse, healthcare }, 85))
        .toBeCloseTo(500000 * 12 * SINGLE_SURVIVOR_SPENDING_FACTOR, 6);
    });

    test('본인 기대수명 이후로 잡힌 쇼크도 축소 계수를 따른다', () => {
      // shockAge 85는 본인 기대수명(80)을 넘는다. 계수를 적용하지 않으면 사망한 본인 앞으로
      // 목돈 1억이 전액 인출된다.
      const withLateShock: HealthcareAssumptions = {
        ...healthcare, baseMonthlyCost: 0, shockEnabled: true, shockAge: 85, shockAmount: 100000000,
      };

      expect(healthcareAt({ ...withSpouse, healthcare: withLateShock }, 85))
        .toBeCloseTo(100000000 * SINGLE_SURVIVOR_SPENDING_FACTOR, 6);
    });

    test('배우자가 없으면 계수가 1이라 의료비가 그대로다', () => {
      expect(healthcareAt({ ...baseParams, healthcare }, 75)).toBe(500000 * 12);
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
