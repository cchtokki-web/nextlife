import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

function pensionOnly(over: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 62, targetMonthlySpending: 5_000_000 },
    assets: [], isaAccounts: [], otherIncomes: [],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
      balance: 500_000_000, monthlyContribution: 0,
      totalReturn: 0, dividendYield: 0, currency: 'KRW',
    }],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    taxSettings: { limitPrivatePensionToTaxLimit: true },
    ...over,
  } as unknown as SimulationParams;
}

describe('HARD 바닥은 전략 선호와 세제 최적화를 깬다', () => {
  test('저율과세 한도가 바닥을 막지 못한다', () => {
    // 한도(연 1,500만원)를 켠 채 바닥 월 400만원(연 4,800만원)을 요구한다.
    const result = new SimulationEngine().runSingle(
      pensionOnly({ hardSpendingFloor: 4_000_000 } as Partial<SimulationParams>)
    );

    for (const year of result.yearlyResults) {
      expect(year.spending, `${year.age}세`).toBeGreaterThanOrEqual(48_000_000 - 1);
    }
  });

  test('월 인출 목표가 바닥을 막지 못한다', () => {
    const result = new SimulationEngine().runSingle(pensionOnly({
      hardSpendingFloor: 4_000_000,
      withdrawalPlan: { privatePensionMonthlyTarget: 300_000 },
    } as Partial<SimulationParams>));

    for (const year of result.yearlyResults) {
      expect(year.spending, `${year.age}세`).toBeGreaterThanOrEqual(48_000_000 - 1);
    }
  });

  test('일반자산 인출 개시 나이가 바닥을 막지 못한다', () => {
    const result = new SimulationEngine().runSingle({
      ...pensionOnly(),
      privatePensions: [],
      assets: [{
        id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 500_000_000,
        totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
        reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
      }],
      withdrawalPlan: { generalAssetWithdrawalStartAge: 80 },
      hardSpendingFloor: 4_000_000,
    } as unknown as SimulationParams);

    for (const year of result.yearlyResults) {
      expect(year.spending, `${year.age}세`).toBeGreaterThanOrEqual(48_000_000 - 1);
    }
  });
});

describe('2단계는 선호를 지킨다', () => {
  // 바닥이 없을 때 이 계획이 쓸 수 있는 금액. 한도 연 1,500만원에서 연금소득세를 뗀 순액이다.
  // 1단계가 «실제로 일했는지»를 재는 자다 — 이 값을 넘겼다면 한도를 깼다는 뜻이다.
  const NET_UNDER_TAX_LIMIT = 14_175_000;

  test('바닥이 한도 안쪽이면 1단계가 할 일이 없고 2단계만 돈다', () => {
    // 바닥 100만원/월(연 1,200만원)은 한도 순액 1,417만원에 이미 덮인다. 그래서 이 케이스는
    // 「1단계가 안 도는데도 2단계가 평소대로 도는가」만 지킨다 — 단계 플래그가 2단계로
    // 새면 여기서 한도가 무너진다.
    const result = new SimulationEngine().runSingle(
      pensionOnly({ hardSpendingFloor: 1_000_000 } as Partial<SimulationParams>)
    );

    const first = result.yearlyResults[0];
    expect(first.spending).toBeGreaterThanOrEqual(12_000_000 - 1);
    expect(first.spending).toBeLessThan(60_000_000);
    expect(first.unmetSpending).toBeGreaterThan(0);
    // 바닥이 놀았으므로 한도 순액을 넘어서는 안 된다.
    expect(first.spending).toBeCloseTo(NET_UNDER_TAX_LIMIT, 0);
  });

  test('바닥을 넘는 몫에는 저율과세 한도가 그대로 걸린다', () => {
    // 바닥 200만원/월(연 2,400만원)은 한도 순액 1,417만원을 «넘는다» — 1단계가 한도를 깨고
    // 2,400만원까지 채워야 한다. 그리고 거기서 멈춰야 한다: 목표는 연 6,000만원이지만
    // 2단계는 한도(이미 소진)를 깨지 않으므로 한 푼도 더 꺼내지 않고, 남은 몫은 부족으로
    // 정직하게 기록된다. 1단계와 2단계의 «경계»가 여기서만 드러난다.
    const result = new SimulationEngine().runSingle(
      pensionOnly({ hardSpendingFloor: 2_000_000 } as Partial<SimulationParams>)
    );

    for (const year of result.yearlyResults) {
      expect(year.spending, `${year.age}세`).toBeGreaterThan(NET_UNDER_TAX_LIMIT);
      expect(year.spending, `${year.age}세`).toBeCloseTo(24_000_000, 0);
      expect(year.unmetSpending, `${year.age}세`).toBeGreaterThan(0);
    }
  });
});

describe('바닥이 없으면 아무것도 바뀌지 않는다', () => {
  test('hardSpendingFloor 미지정 시 한도가 그대로 인출을 막는다', () => {
    const result = new SimulationEngine().runSingle(pensionOnly());

    for (const year of result.yearlyResults) {
      expect(year.unmetSpending, `${year.age}세`).toBeGreaterThan(0);
    }
  });
});
