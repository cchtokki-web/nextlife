import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// 계층 1(HARD 생활비 바닥)이 계층 2(assetFloor = 상속 하한선·고갈 방지)를 이긴다.
//
// 엔진은 목표를 모른다. 여기서 고정하는 것은 엔진의 «말»뿐이다 — 「하한선 아래로 내려갔다」,
// 「납세로 하한선이 침범당했다」. 그것을 「HARD 생활비 목표가 HARD 상속 목표를 이겼다」로
// 옮기는 것은 평가 계층(GoalEvaluationEngine)의 몫이라 이 파일에는 목표 이름이 없다.

/** 세금이 한 푼도 붙지 않는 단순 계좌 하나. 자산 곡선이 곧 인출 곡선이 되어 읽기 쉽다. */
function taxFreeAssets(valueKRW: number) {
  return [{
    id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: valueKRW,
    totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
    reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
  }];
}

function plan(over: Record<string, unknown>): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 63, targetMonthlySpending: 5_000_000 },
    assets: taxFreeAssets(300_000_000),
    isaAccounts: [], otherIncomes: [], privatePensions: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    hardSpendingFloor: 5_000_000,
    ...over,
  } as unknown as SimulationParams;
}

describe('HARD 생활비 바닥은 상속 하한선을 이긴다', () => {
  test('바닥을 채우려고 하한선 아래로 내려간 해는 그 사실이 남는다', () => {
    const result = new SimulationEngine().runSingle(plan({ assetFloor: 280_000_000 }));

    // 연 6,000만원을 3억에서 꺼낸다. 하한선 2.8억은 첫해에 이미 무너진다.
    for (const year of result.yearlyResults) {
      const d = year.ledger!.diagnostics;
      expect(year.totalAssets, `${year.age}세`).toBeLessThan(280_000_000);
      // 하한선을 깨서 «얻은» 것 — 바닥이 실제로 채워졌다. 깨기만 하고 못 채우면 의미가 없다.
      expect(d.unmetHardSpending, `${year.age}세`).toBe(0);
      expect(d.brokenPreferences, `${year.age}세`).toContain('assetFloor');
      expect(d.overrideReason, `${year.age}세`).toBe('hardSpendingFloor');
      // 하한선을 «깬» 것이지 하한선에 «막힌» 것이 아니다. 두 사실은 서로 다른 자리에 적힌다.
      expect(d.blockedWithdrawalReason, `${year.age}세`).toBeUndefined();
    }
  });

  test('여유 안에서 바닥이 채워지는 해는 하한선을 깨지 않는다', () => {
    // 같은 인출량이지만 하한선이 5,000만원이라 기대수명까지 한 번도 닿지 않는다.
    const result = new SimulationEngine().runSingle(plan({ assetFloor: 50_000_000 }));

    for (const year of result.yearlyResults) {
      const d = year.ledger!.diagnostics;
      expect(year.totalAssets, `${year.age}세`).toBeGreaterThanOrEqual(50_000_000);
      expect(d.unmetHardSpending, `${year.age}세`).toBe(0);
      // 계층은 「필요할 때만」 아래를 깬다. 1단계가 돌았다는 사실만으로 기록하지 않는다.
      expect(d.brokenPreferences, `${year.age}세`).not.toContain('assetFloor');
    }
  });

  test('바닥이 없는 계획에서는 하한선이 종전대로 인출을 막는다', () => {
    const params = plan({ assetFloor: 280_000_000 });
    delete (params as unknown as Record<string, unknown>).hardSpendingFloor;

    const result = new SimulationEngine().runSingle(params);

    for (const year of result.yearlyResults) {
      const d = year.ledger!.diagnostics;
      // 1단계가 아예 돌지 않으므로 하한선이 이긴다 — 자산이 아니라 생활비가 깎인다.
      expect(year.totalAssets, `${year.age}세`).toBeGreaterThanOrEqual(280_000_000 - 1);
      expect(d.brokenPreferences, `${year.age}세`).toEqual([]);
      expect(d.unmetTargetSpending, `${year.age}세`).toBeGreaterThan(0);
      expect(d.blockedWithdrawalReason, `${year.age}세`).toBe('assetFloor');
    }
  });
});

// 납세 의무는 계층 «밖»이다. 세금 징수는 인출 엔진을 거치지 않고 자산을 직접 팔며 하한선을
// 지키지 않는다 — 상속을 남기고 싶다는 이유로 세금을 안 낼 수는 없으므로 그것이 옳다.
// 고칠 것은 그 침범이 «조용히» 일어난다는 점뿐이라, 기록만 남긴다.
describe('납세로 하한선이 침범당하면 계층 밖 사유가 남는다', () => {
  // 사적연금만 5억. 1단계가 저율과세 한도를 깨고 연 5,079만원을 꺼내면 연말에 초과세가
  // 붙고, 그 세금은 인출 엔진 밖에서 연금을 직접 판다.
  const taxPressure = (over: Record<string, unknown>): SimulationParams => ({
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 61, targetMonthlySpending: 4_000_000 },
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
    hardSpendingFloor: 4_000_000,
    ...over,
  } as unknown as SimulationParams);

  test('세금이 하한선을 넘겨 징수된 해는 taxObligation이 남는다', () => {
    // 하한선 4.48억은 인출만으로는 닿지 않는다(연중 최저 4억4,921만원). 그 아래로 내려보낸
    // 것은 오직 연말 초과세다 — 그래서 인출이 깬 사실(brokenPreferences)은 남지 않는다.
    const result = new SimulationEngine().runSingle(taxPressure({ assetFloor: 448_000_000 }));

    const first = result.yearlyResults[0];
    expect(first.totalAssets).toBeLessThan(448_000_000);
    expect(first.ledger!.diagnostics.assetFloorBreachedBy).toBe('taxObligation');
    expect(first.ledger!.diagnostics.brokenPreferences).not.toContain('assetFloor');
  });

  test('하한선을 넘지 않은 해에는 남지 않는다', () => {
    const result = new SimulationEngine().runSingle(taxPressure({ assetFloor: 400_000_000 }));

    const first = result.yearlyResults[0];
    expect(first.totalAssets).toBeGreaterThan(400_000_000);
    expect(first.ledger!.diagnostics.assetFloorBreachedBy).toBeUndefined();
  });

  test('하한선이 없으면 남지 않는다', () => {
    const result = new SimulationEngine().runSingle(taxPressure({}));

    for (const year of result.yearlyResults) {
      expect(year.ledger!.diagnostics.assetFloorBreachedBy, `${year.age}세`).toBeUndefined();
    }
  });
});
