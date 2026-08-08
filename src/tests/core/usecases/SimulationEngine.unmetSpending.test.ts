import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// **목표 생활비를 채우지 못한 금액.**
//
// 인출 경로는 잔액을 넘겨 인출하지 않는다(모든 매도가 Math.min으로 막혀 있다). 그래서
// 돈이 모자란 해에도 totalAssets는 음수가 되지 않고, 대신 그 해의 지출이 조용히 깎인다
// (`unmet`을 actualMonthlySpending에서 차감). 깎인 사실은 어디에도 남지 않았다.
//
// 그 결과 "자산은 남았는데 목표 생활비의 절반밖에 못 쓴 해"가 depletionAge === null,
// 즉 '고갈 위험 없음'으로 보고됐다. 민감도 분석과 몬테카를로 성공률이 모두 이 신호를
// 필요로 한다.
const engine = new SimulationEngine();

// 의료비도 끄고(기본값 미설정) 목표 생활비만 남긴다 — 그래야 spending + unmetSpending을
// 목표와 직접 비교할 수 있다.
function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 65, targetMonthlySpending: 1000000 },
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

describe('SimulationEngine - unmetSpending', () => {
  test('재원이 전혀 없으면 목표 생활비 전액이 미충족으로 기록된다', () => {
    const result = engine.run(params());

    for (const year of result.yearlyResults) {
      expect(year.spending).toBe(0);
      expect(year.unmetSpending).toBe(12000000); // 월 100만원 × 12
    }
  });

  test('재원이 충분하면 미충족이 0이다', () => {
    const result = engine.run(params({
      otherIncomes: [{ id: 'rent', label: '임대소득', monthlyAmount: 5000000, currency: 'KRW' }],
    }));

    for (const year of result.yearlyResults) {
      expect(year.unmetSpending).toBe(0);
    }
  });

  // 이 항등식이 성립해야 unmetSpending을 "쓰려 했던 금액 − 실제로 쓴 금액"으로 읽을 수 있다.
  test('실제 지출과 미충족의 합은 목표 생활비와 같다', () => {
    const result = engine.run(params({
      otherIncomes: [{ id: 'rent', label: '임대소득', monthlyAmount: 400000, currency: 'KRW' }],
    }));

    for (const year of result.yearlyResults) {
      expect(year.spending + year.unmetSpending).toBeCloseTo(12000000, 6);
    }
  });

  test('부분적으로만 충당되면 그 차액이 기록된다', () => {
    const result = engine.run(params({
      otherIncomes: [{ id: 'rent', label: '임대소득', monthlyAmount: 400000, currency: 'KRW' }],
    }));

    for (const year of result.yearlyResults) {
      expect(year.spending).toBeCloseTo(4800000, 6);   // 월 40만원 × 12
      expect(year.unmetSpending).toBeCloseTo(7200000, 6); // 월 60만원 × 12
    }
  });

  // 은퇴 전에는 목표 생활비 자체가 0이므로(엔진이 은퇴 후에만 생활비를 세운다)
  // 미충족이라는 개념이 성립하지 않는다.
  test('은퇴 전에는 미충족이 0이다', () => {
    const result = engine.run(params({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 65, targetMonthlySpending: 1000000 },
    }));

    const beforeRetirement = result.yearlyResults.filter((y) => y.age < 60);
    expect(beforeRetirement.length).toBeGreaterThan(0);
    for (const year of beforeRetirement) {
      expect(year.unmetSpending).toBe(0);
    }
  });
});
