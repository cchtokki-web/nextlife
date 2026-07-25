import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

describe('SimulationEngine withdrawalPlan (인출 정책 파라미터화)', () => {
  const baseParams: SimulationParams = {
    userProfile: {
      currentAge: 55,
      retirementAge: 60,
      expectancy: 90,
      targetMonthlySpending: 3000000, // 300만 원
    },
    assets: [
      {
        id: 'asset-1',
        type: 'etf',
        ticker: 'VOO',
        name: 'S&P 500 ETF',
        quantity: 100,
        averagePrice: 500, // 500 USD
        annualGrowthRate: 8,
        dividendYield: 2,
        monthlyContribution: 100,
        reinvestDividend: true,
        currency: 'USD',
      },
    ],
    nationalPension: {
      expectedMonthlyAmount: 1000000,
    },
    privatePensions: [
      {
        id: 'pension-1',
        type: 'irp',
        balance: 300000000, // 3억 원 (인출 정책 차이가 잘 드러나도록 충분히 큰 잔액)
        monthlyContribution: 500000,
        annualReturn: 5,
        currency: 'KRW',
      },
    ],
    otherIncomes: [
      {
        id: 'income-1',
        label: '임대소득',
        monthlyAmount: 500000,
        currency: 'KRW',
      },
    ],
    inflationRate: 2.5,
    inflationMode: 'nominal',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };

  test('회귀 가드: withdrawalPlan 미지정 시 결과가 기존 스냅샷과 완전히 동일해야 한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams);
    expect(result).toMatchSnapshot();
  });

  test('withdrawalPlan.privatePensionMonthlyTarget으로 사적연금 세전 인출액이 목표치 근방으로 제한된다', () => {
    const engine = new SimulationEngine();
    const monthlyTargetKRW = 1000000; // 월 100만 원(세전) 목표
    const result = engine.run({
      ...baseParams,
      withdrawalPlan: {
        privatePensionMonthlyTarget: monthlyTargetKRW,
      },
    });

    const retirementYears = result.yearlyResults.filter(
      (r) => r.age >= baseParams.userProfile.retirementAge && r.age < baseParams.userProfile.expectancy
    );

    // 잔액이 충분한 연도에는 세전 연간 인출액이 목표(연 1200만 원)를 크게 초과하지 않아야 한다.
    // (shortfall 충당으로 인한 추가 인출 여지를 감안해 넉넉한 상한을 둔다)
    const annualTargetKRW = monthlyTargetKRW * 12;
    for (const r of retirementYears.slice(0, 5)) {
      expect(r.privatePensionIncome).toBeLessThanOrEqual(annualTargetKRW * 1.5);
    }
  });

  test('withdrawalPlan.privatePensionMonthlyTarget은 사적연금 계좌 여러 개의 합산 기준으로 적용된다', () => {
    // 계좌마다 개별 적용되는 버그가 있다면, 계좌가 2개일 때 총 인출액이 목표의 약 2배가 된다.
    const engine = new SimulationEngine();
    const monthlyTargetKRW = 1000000; // 월 100만 원(세전) 목표 - 계좌 합산 기준이어야 함
    const multiPensionParams: SimulationParams = {
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 85,
        targetMonthlySpending: 100000, // shortfall이 발생하지 않도록 목표 생활비를 낮게 설정
      },
      assets: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 300000000, monthlyContribution: 0, annualReturn: 5, currency: 'KRW' },
        { id: 'pension-2', type: 'savings', balance: 300000000, monthlyContribution: 0, annualReturn: 5, currency: 'KRW' },
      ],
      otherIncomes: [
        { id: 'income-1', label: '임대소득', monthlyAmount: 3000000, currency: 'KRW' }, // shortfall 방지용 충분한 소득
      ],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
      withdrawalPlan: {
        privatePensionMonthlyTarget: monthlyTargetKRW,
      },
    };

    const result = engine.run(multiPensionParams);
    const resultAt60 = result.yearlyResults.find((r) => r.age === 60);
    expect(resultAt60).toBeDefined();

    // 목표는 계좌 합산 기준 월 100만원(세전)이어야 하므로, 세후 연간 사적연금 소득은
    // 대략 1,000,000*12*(1-0.055) ≈ 1134만원 근방이어야 한다.
    const expectedAnnualNet = monthlyTargetKRW * 12 * (1 - 0.055);
    expect(resultAt60!.privatePensionIncome).toBeLessThan(expectedAnnualNet * 1.3);
    expect(resultAt60!.privatePensionIncome).toBeGreaterThan(expectedAnnualNet * 0.7);
  });

  test('withdrawalPlan 없이 retirementAge가 55세 미만이면, 55세 전에는 사적연금을 인출하지 않고 55세부터 시작한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({
      userProfile: { currentAge: 50, retirementAge: 50, expectancy: 60, targetMonthlySpending: 400000 },
      assets: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 300000000, monthlyContribution: 0, annualReturn: 5, currency: 'KRW' },
      ],
      otherIncomes: [{ id: 'income-1', label: '임대소득', monthlyAmount: 1000000, currency: 'KRW' }], // 목표(40만원) 충분히 충당
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
    });

    const before55 = result.yearlyResults.filter((r) => r.age >= 50 && r.age < 55);
    expect(before55.length).toBeGreaterThan(0);
    for (const r of before55) {
      expect(r.privatePensionIncome).toBe(0);
    }

    const from55 = result.yearlyResults.filter((r) => r.age >= 55);
    expect(from55.some((r) => r.privatePensionIncome > 0)).toBe(true);
  });

  test('retirementAge가 55세 미만이고 생활비가 부족해도(shortfall), 55세 이전에는 사적연금을 조기 인출하지 않는다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({
      userProfile: { currentAge: 50, retirementAge: 50, expectancy: 60, targetMonthlySpending: 5000000 }, // 부족분 발생하도록 목표 생활비를 높게
      assets: [], // 일반자산 없음 -> shortfall 시 바로 사적연금으로 갈 수밖에 없는 상황
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 300000000, monthlyContribution: 0, annualReturn: 5, currency: 'KRW' },
      ],
      otherIncomes: [],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
    });

    const before55 = result.yearlyResults.filter((r) => r.age >= 50 && r.age < 55);
    expect(before55.length).toBeGreaterThan(0);
    for (const r of before55) {
      // 55세 미만이므로 shortfall이 있어도 사적연금을 인출할 수 없다 -> 인출 0, 목표 생활비 미충족
      expect(r.privatePensionIncome).toBe(0);
      expect(r.spending).toBeLessThan(5000000 * 12);
    }

    // 55세부터는 후행 인출로 부족분을 정상적으로 충당한다.
    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55).toBeDefined();
    expect(at55!.privatePensionIncome).toBeGreaterThan(0);
  });

  test('withdrawalPlan이 있어도 shortfall 발생 시 기존처럼 사적연금이 후행 인출된다', () => {
    const engine = new SimulationEngine();
    // 목표 생활비를 매우 낮은 사적연금 목표보다 훨씬 높게 잡아 shortfall이 발생하도록 함
    const result = engine.run({
      ...baseParams,
      assets: [], // 일반자산 없음 -> shortfall 시 바로 연금으로 감
      userProfile: {
        ...baseParams.userProfile,
        targetMonthlySpending: 5000000, // 500만 원(사적연금 목표 100만원보다 훨씬 큼)
      },
      withdrawalPlan: {
        privatePensionMonthlyTarget: 1000000,
      },
    });

    const resultAtRetirement = result.yearlyResults.find(
      (r) => r.age === baseParams.userProfile.retirementAge
    );
    expect(resultAtRetirement).toBeDefined();
    // shortfall 충당으로 목표(연 1200만원)를 초과하는 사적연금 인출이 발생해야 한다.
    expect(resultAtRetirement!.privatePensionIncome).toBeGreaterThan(1000000 * 12);
  });
});
