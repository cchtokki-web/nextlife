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

  test('withdrawalPlan.privatePensionStartAge 이전에는 사적연금을 인출하지 않고 계속 성장한다', () => {
    // shortfall 후행 인출까지 개입되지 않도록, 다른 소득(기타소득)만으로 목표 생활비를
    // 충분히 충당 가능한 시나리오를 구성하여 "개시 전 인출 0"을 순수하게 검증한다.
    const engine = new SimulationEngine();
    const startAgeTestParams: SimulationParams = {
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 85,
        targetMonthlySpending: 400000, // 40만 원 (기타소득만으로 충분히 충당 가능)
      },
      assets: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [
        {
          id: 'pension-1',
          type: 'irp',
          balance: 300000000, // 3억 원
          monthlyContribution: 0,
          annualReturn: 5,
          currency: 'KRW',
        },
      ],
      otherIncomes: [
        { id: 'income-1', label: '임대소득', monthlyAmount: 1000000, currency: 'KRW' }, // 100만 원
      ],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
      withdrawalPlan: {
        privatePensionStartAge: 70, // 은퇴(60세)보다 늦게 인출 개시
      },
    };

    const result = engine.run(startAgeTestParams);

    // 60~69세 구간: 기타소득(100만 원)이 목표 생활비(40만 원)를 충분히 초과하므로
    // shortfall이 발생하지 않고, 사적연금 인출도 전혀 없어야 한다.
    const preStartYears = result.yearlyResults.filter((r) => r.age >= 60 && r.age < 70);
    expect(preStartYears.length).toBeGreaterThan(0);
    for (const r of preStartYears) {
      expect(r.privatePensionIncome).toBe(0);
    }

    // 70세 이후에는 사적연금 인출이 발생해야 한다.
    const postStartYears = result.yearlyResults.filter((r) => r.age >= 70);
    const hasPensionIncomeAfterStart = postStartYears.some((r) => r.privatePensionIncome > 0);
    expect(hasPensionIncomeAfterStart).toBe(true);
  });

  test('withdrawalPlan.privatePensionMonthlyTarget으로 사적연금 세전 인출액이 목표치 근방으로 제한된다', () => {
    const engine = new SimulationEngine();
    const monthlyTargetKRW = 1000000; // 월 100만 원(세전) 목표
    const result = engine.run({
      ...baseParams,
      withdrawalPlan: {
        privatePensionStartAge: baseParams.userProfile.retirementAge,
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
        privatePensionStartAge: baseParams.userProfile.retirementAge,
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
