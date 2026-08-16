import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// **FIRE는 「소득만으로 생활비를 감당하게 되는 시점」이다.**
//
// 사적연금 인출은 그 소득이 아니다. 연금저축·IRP는 본인이 적립한 «자산»이고, 인출은 원금
// 소진이라 계좌가 비면 멈춘다. 그것까지 소득으로 세면 자산을 헐어 쓰는 계획이 "달성"으로
// 찍히고, 잔액이 클수록 FIRE가 빨라진다 — 사실과 반대 방향이다.
//
// describeFireAge.ts는 이 한계를 알면서도 표시 문구로 완화하는 쪽을 택했었다. 그러나 문구는
// fireAge가 «늦게» 나올 때의 오해만 막는다. 실제 문제는 원금 인출 때문에 실제보다 «이르게»
// 나오는 것이고, 그건 문구로 막을 수 없다.
//
// 국민연금·배당·기타소득은 소득으로 센다. 종신 지급이거나 원금을 유지한 채 나오는 흐름이라
// 계좌가 비어 멈추지 않는다.

const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 2_000_000 },
    assets: [],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

describe('SimulationEngine - fireAge', () => {
  test('사적연금 인출만으로 생활비를 채우는 계획은 FIRE가 아니다', () => {
    const result = engine.run(params({
      privatePensions: [
        { id: 'irp', type: 'irp', balance: 1_000_000_000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
      ],
    }));

    expect(result.fireAge).toBeNull();
  });

  test('국민연금만으로 생활비가 채워지면 그 개시 나이에 달성한다', () => {
    const result = engine.run(params({
      nationalPension: { expectedMonthlyAmount: 2_500_000 },
      withdrawalPlan: { nationalPensionStartAge: 65 },
    }));

    expect(result.fireAge).toBe(65);
  });

  // 잔액이 클수록 FIRE가 빨라지던 것이 이 지표의 핵심 오류였다.
  test('사적연금 잔액이 아무리 커도 달성 시점을 앞당기지 못한다', () => {
    const base = params({
      nationalPension: { expectedMonthlyAmount: 2_500_000 },
      withdrawalPlan: { nationalPensionStartAge: 65 },
    });

    const withPension = engine.run({
      ...base,
      privatePensions: [
        { id: 'irp', type: 'irp', balance: 1_000_000_000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
      ],
    });

    expect(withPension.fireAge).toBe(engine.run(base).fireAge);
  });

  // 배당은 원금을 유지한 채 나오는 흐름이라 소득이 맞다. 이 축까지 빼면 지표가
  // 「국민연금만 센다」가 되어 다른 방향으로 틀린다.
  test('배당 소득은 FIRE 소득으로 센다', () => {
    const result = engine.run(params({
      assets: [{
        id: 'div', type: 'stock', ticker: 'DIV', name: '고배당',
        quantity: 100_000, averagePrice: 10_000, annualGrowthRate: 0, dividendYield: 4,
        monthlyContribution: 0, reinvestDividend: false, currency: 'KRW',
      }],
    }));

    expect(result.fireAge).toBe(60);
  });
});
