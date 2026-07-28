import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

describe('SimulationEngine 사적연금 브릿지 조기인출(Phase 4)', () => {
  const baseParams: SimulationParams = {
    userProfile: {
      currentAge: 50,
      retirementAge: 60,
      expectancy: 55,
      targetMonthlySpending: 0,
    },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [
      {
        id: 'p1',
        type: 'irp',
        balance: 100000000,
        monthlyContribution: 0,
        annualReturn: 0,
        currency: 'KRW',
        earlyChannelingEnabled: true,
      },
    ],
    isaAccounts: [
      {
        id: 'isa1',
        type: 'general',
        balance: 0,
        monthlyContribution: 0,
        annualReturn: 0,
        dividendYield: 0,
        currency: 'KRW',
        maturityYears: 99, // 테스트 기간 내 만기가 발생하지 않도록 충분히 길게 설정
      },
    ],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };

  test('55세 미만에는 브릿지 조기인출이 발동하지 않아 사적연금 잔액이 그대로 유지된다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({ ...baseParams, userProfile: { ...baseParams.userProfile, expectancy: 54 } });

    const at54 = result.yearlyResults.find((r) => r.age === 54);
    expect(at54!.pensionAssets).toBeCloseTo(100000000, 2);
  });

  test('55세부터 저율과세 한도(연 1500만원)만큼 조기 인출되어 사적연금 잔액이 감소한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams); // expectancy: 55

    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55!.pensionAssets).toBeCloseTo(100000000 - 15000000, 2);
  });

  test('인출된 순액(세후)만큼만 총자산이 줄어든다(나머지는 ISA로 이동해 총자산에는 그대로 남음)', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams); // expectancy: 55

    const at54 = result.yearlyResults.find((r) => r.age === 54);
    const at55 = result.yearlyResults.find((r) => r.age === 55);
    const expectedTax = 15000000 * 0.055; // 55세 세율 5.5%(PRIVATE_PENSION_TAX_BRACKETS)
    expect(at54!.totalAssets - at55!.totalAssets).toBeCloseTo(expectedTax, 2);
  });

  test('브릿지 구간에서는 privatePensionIncome(생활비 소득)에 반영되지 않는다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams); // expectancy: 55

    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55!.privatePensionIncome).toBe(0);
  });

  test('retirementAge 이후에는 기존 인출 로직으로 복귀해 privatePensionIncome에 반영된다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({ ...baseParams, userProfile: { ...baseParams.userProfile, expectancy: 60 } });

    const at59 = result.yearlyResults.find((r) => r.age === 59);
    const at60 = result.yearlyResults.find((r) => r.age === 60);
    expect(at59!.privatePensionIncome).toBe(0); // 아직 브릿지 구간(재직 중)
    expect(at60!.privatePensionIncome).toBeGreaterThan(0); // retirementAge 도달, 기존 로직으로 복귀
  });

  test('earlyChannelingEnabled가 없으면(기본값) 55세가 지나도 조기인출이 발동하지 않는다', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [{ ...baseParams.privatePensions[0], earlyChannelingEnabled: undefined }],
    };
    const result = engine.run(params);

    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55!.pensionAssets).toBeCloseTo(100000000, 2);
  });

  test('ISA 계좌가 없으면 earlyChannelingEnabled가 켜져 있어도 브릿지 조기인출이 발동하지 않는다(자금 소실 방지)', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...baseParams,
      isaAccounts: [], // ISA 계좌 없음
    };
    const result = engine.run(params);

    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55!.pensionAssets).toBeCloseTo(100000000, 2); // 사적연금 잔액이 변하지 않음
  });
});
