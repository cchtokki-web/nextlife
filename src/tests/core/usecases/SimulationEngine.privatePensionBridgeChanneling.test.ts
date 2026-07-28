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

  test('Fix 4: ISA가 이미 정기 납입으로 월 한도 일부를 채운 상태면, 브릿지 크레딧은 남은 한도만큼만 들어가 연간 총 유입액이 법정 한도(2천만원)를 넘지 않는다', () => {
    const engine = new SimulationEngine();
    const monthlyLimit = 20000000 / 12; // ISA 월 법정 납입 한도 (KRW)
    const isaMonthlyContribution = 1000000; // 한도(약 166.7만원)보다 낮게 설정해 매달 66.7만원의 여유(room)만 남긴다
    const params: SimulationParams = {
      ...baseParams,
      isaAccounts: [
        {
          ...baseParams.isaAccounts![0],
          monthlyContribution: isaMonthlyContribution,
          annualReturn: 0, // growth/dividend를 0으로 고정해 유입액 계산을 단순화한다
          dividendYield: 0,
        },
      ],
    };
    const result = engine.run(params); // expectancy: 55 (baseParams) — age 50~55 구간이 모두 존재

    // baseParams는 currentAge:50이라 ISA가 50~54세에도 정기납입을 계속 쌓는다 — 브릿지가 막 시작된
    // "그 해(55세)"만의 순수 유입액을 보려면 54→55세 구간의 델타로 봐야 한다(54세까지는 브릿지가
    // 아직 발동하지 않으므로 순수 정기납입 누적만 있다).
    const at54 = result.yearlyResults.find((r) => r.age === 54);
    const at55 = result.yearlyResults.find((r) => r.age === 55);
    // assets=[]이므로 stockAssets는 항상 0 — ISA 잔액은 totalAssets에서 pensionAssets를 뺀 값과 같다.
    const isaBalanceAt54 = at54!.totalAssets - at54!.pensionAssets;
    const isaBalanceAt55 = at55!.totalAssets - at55!.pensionAssets;
    const annualIsaInflowAt55 = isaBalanceAt55 - isaBalanceAt54;

    // 캡이 없었다면(버그): 매달 정기납입(100만원) + 무제한 브릿지 순액(약 118.125만원)이 그대로
    // 더해져 연간 약 2,617.5만원까지 쌓여 법정 한도(2천만원)를 크게 초과했을 것이다.
    const uncappedAnnualInflow = 12 * (isaMonthlyContribution + (15000000 / 12) * (1 - 0.055));
    expect(uncappedAnnualInflow).toBeGreaterThan(20000000);

    // 수정 후: 매달 "정기납입 + 브릿지 크레딧"의 합이 월 한도를 넘지 않도록 브릿지 크레딧이
    // 캡핑되므로, 55세 그 해의 총 유입액은 법정 한도(2천만원)를 넘지 않는다.
    expect(annualIsaInflowAt55).toBeLessThanOrEqual(20000000 + 1e-6);
    expect(annualIsaInflowAt55).toBeCloseTo(20000000, 2);
  });

  test('Fix 4: ISA가 이미 월 한도를 꽉 채운 상태면 브릿지 크레딧은 전혀 들어가지 않는다', () => {
    const engine = new SimulationEngine();
    const monthlyLimit = 20000000 / 12;
    const params: SimulationParams = {
      ...baseParams,
      isaAccounts: [
        {
          ...baseParams.isaAccounts![0],
          monthlyContribution: monthlyLimit, // 이미 한도를 꽉 채움 → room = 0
          annualReturn: 0,
          dividendYield: 0,
        },
      ],
    };
    const result = engine.run(params); // expectancy: 55 (baseParams) — age 50~55 구간이 모두 존재

    const at54 = result.yearlyResults.find((r) => r.age === 54);
    const at55 = result.yearlyResults.find((r) => r.age === 55);
    const isaBalanceAt54 = at54!.totalAssets - at54!.pensionAssets;
    const isaBalanceAt55 = at55!.totalAssets - at55!.pensionAssets;
    const annualIsaInflowAt55 = isaBalanceAt55 - isaBalanceAt54;

    // 정기납입만큼만 쌓이고(연 2천만원), 브릿지 크레딧은 room이 0이라 전혀 반영되지 않는다.
    expect(annualIsaInflowAt55).toBeCloseTo(monthlyLimit * 12, 2);
    // 사적연금 쪽은 브릿지 인출 자체는 그대로 발생(세금까지 낸 뒤 자금이 유실)하므로 잔액은 여전히
    // 저율과세 한도(1500만원)만큼 감소한다 — 인출 자체를 막는 것이 아니라 ISA 측 크레딧만 캡한다.
    expect(at55!.pensionAssets).toBeCloseTo(100000000 - 15000000, 2);
  });
});
