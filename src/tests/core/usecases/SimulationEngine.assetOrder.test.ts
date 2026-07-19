import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

describe('SimulationEngine 자산 매도 순서 전략', () => {
  const twoAssetParams: SimulationParams = {
    userProfile: {
      currentAge: 60,
      retirementAge: 60,
      expectancy: 80,
      targetMonthlySpending: 300000, // 30만 원
    },
    assets: [
      {
        id: 'growth',
        type: 'etf',
        ticker: 'GROWTH',
        name: '저배당 성장주',
        quantity: 1,
        averagePrice: 30000000, // 3천만 원
        annualGrowthRate: 0,
        dividendYield: 0.5,
        monthlyContribution: 0,
        reinvestDividend: false,
        currency: 'KRW',
      },
      {
        id: 'highdiv',
        type: 'etf',
        ticker: 'HIGHDIV',
        name: '고배당주',
        quantity: 1,
        averagePrice: 30000000, // 3천만 원
        annualGrowthRate: 0,
        dividendYield: 6,
        monthlyContribution: 0,
        reinvestDividend: false,
        currency: 'KRW',
      },
    ],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };

  test('high_dividend_first 전략은 고배당 자산을 먼저 소진해, 저배당 자산을 먼저 소진하는 경우보다 후반부 배당소득이 낮다', () => {
    const engine = new SimulationEngine();
    const highDivFirst = engine.run({
      ...twoAssetParams,
      withdrawalPlan: { assetSellOrderStrategy: 'high_dividend_first' },
    });
    const lowDivFirst = engine.run({
      ...twoAssetParams,
      withdrawalPlan: { assetSellOrderStrategy: 'low_dividend_first' },
    });

    const checkpointAge = 70;
    const highDivFirstAt70 = highDivFirst.yearlyResults.find((r) => r.age === checkpointAge);
    const lowDivFirstAt70 = lowDivFirst.yearlyResults.find((r) => r.age === checkpointAge);

    expect(highDivFirstAt70).toBeDefined();
    expect(lowDivFirstAt70).toBeDefined();
    expect(highDivFirstAt70!.dividendIncome).toBeLessThan(lowDivFirstAt70!.dividendIncome);
  });

  test('assetSellOrderStrategy 미지정 시 input_order와 동일하게 동작한다', () => {
    const engine = new SimulationEngine();
    const unspecified = engine.run(twoAssetParams);
    const explicitInputOrder = engine.run({
      ...twoAssetParams,
      withdrawalPlan: { assetSellOrderStrategy: 'input_order' },
    });

    expect(unspecified.yearlyResults).toEqual(explicitInputOrder.yearlyResults);
  });
});

describe('SimulationEngine ISA 만기 자금 이동 목적지', () => {
  const isaMaturityParams: SimulationParams = {
    userProfile: {
      currentAge: 60,
      retirementAge: 60,
      expectancy: 65,
      targetMonthlySpending: 100000, // 기타소득으로 충분히 충당되도록 낮게 설정
    },
    assets: [
      {
        id: 'asset-1',
        type: 'etf',
        ticker: 'ASSET',
        name: '일반자산',
        quantity: 1,
        averagePrice: 5000000,
        annualGrowthRate: 0,
        dividendYield: 0,
        monthlyContribution: 0,
        reinvestDividend: false,
        currency: 'KRW',
      },
    ],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [
      {
        id: 'pension-1',
        type: 'irp',
        balance: 5000000,
        monthlyContribution: 0,
        annualReturn: 0,
        currency: 'KRW',
      },
    ],
    isaAccounts: [
      {
        id: 'isa-1',
        type: 'general',
        balance: 10000000, // 1천만 원, 성장 없음 -> 만기 시 수익 0, 세금 0, 순액 그대로 이전
        monthlyContribution: 0,
        annualReturn: 0,
        dividendYield: 0,
        currency: 'KRW',
        maturityYears: 1,
      },
    ],
    otherIncomes: [
      // 목표 생활비와 정확히 일치시켜 잉여현금 재투자/부족분 인출이 자산에 영향을 주지 않도록 한다.
      { id: 'income-1', label: '임대소득', monthlyAmount: 100000, currency: 'KRW' },
    ],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };

  test('미지정(기본값) 시 ISA 만기 자금은 사적연금으로 이동한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(isaMaturityParams);

    const resultAt60 = result.yearlyResults.find((r) => r.age === 60);
    expect(resultAt60).toBeDefined();
    expect(resultAt60!.pensionAssets).toBeGreaterThan(12000000); // 500만원 + 1000만원 ISA 이전분
    expect(resultAt60!.stockAssets).toBeLessThan(7000000); // 자산은 그대로 500만원 근방
  });

  test("isaMaturityDestination: 'asset' 설정 시 ISA 만기 자금은 일반 자산으로 이동한다", () => {
    const engine = new SimulationEngine();
    const result = engine.run({
      ...isaMaturityParams,
      withdrawalPlan: { isaMaturityDestination: 'asset' },
    });

    const resultAt60 = result.yearlyResults.find((r) => r.age === 60);
    expect(resultAt60).toBeDefined();
    expect(resultAt60!.stockAssets).toBeGreaterThan(12000000); // 500만원 + 1000만원 ISA 이전분
    expect(resultAt60!.pensionAssets).toBeLessThan(7000000); // 연금은 그대로 500만원 근방
  });
});
