import { describe, test, expect } from 'vitest';
import { explainNationalPension } from '@/core/usecases/pension/explainNationalPension';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

function makeParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3500000 },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 2000000 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 2.5,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

describe('explainNationalPension', () => {
  test('수령액이 설정되지 않았으면 null을 반환한다', () => {
    expect(explainNationalPension(makeParams({ nationalPension: { expectedMonthlyAmount: 0 } }))).toBeNull();
  });

  // **리포트가 "계산 오류"로 읽힌 지점.**
  //
  // 설정은 월 200만원인데 표에는 135만원이 찍혔다. 2,000,000 × 0.70(60세 조기수령) 뒤
  // 연금소득세·지방소득세를 뺀 값이며, 그 두 단계가 리포트 어디에도 없었다.
  describe('60세 조기수령 (리포트 사례)', () => {
    const params = makeParams({ withdrawalPlan: { nationalPensionStartAge: 60 } });

    test('설정액 → 조기수령 감액 → 세금 → 실질 수령액 순으로 펼친다', () => {
      const explanation = explainNationalPension(params)!;

      expect(explanation.claimAge).toBe(60);
      expect(explanation.isPlain).toBe(false);
      expect(explanation.steps.map((s) => s.label)).toEqual([
        '설정한 예상 수령액 (65세 기준)',
        '조기수령 감액 (60세 개시, −30%)',
        '연금소득세 · 지방소득세',
        '실질 수령액',
      ]);
    });

    test('감액은 -60만원, 실질 수령액은 약 135만원이다', () => {
      const [설정, 감액, 세금, 실질] = explainNationalPension(params)!.steps;

      expect(설정.amount).toBe(2000000);
      expect(감액.amount).toBe(-600000); // 2,000,000 × (1 - 0.70)
      expect(세금.amount).toBeLessThan(0);
      expect(실질.amount).toBeCloseTo(1352040, 0);
      expect(실질.isTotal).toBe(true);
    });

    // 단계의 합이 실질 수령액과 맞지 않으면 표가 스스로 모순된다.
    test('합계 줄을 뺀 나머지 단계의 합이 실질 수령액과 같다', () => {
      const { steps, netMonthly } = explainNationalPension(params)!;
      const sum = steps.filter((s) => !s.isTotal).reduce((a, s) => a + s.amount, 0);

      expect(sum).toBeCloseTo(netMonthly, 6);
    });
  });

  test('정상 개시(65세)에는 감액 줄을 만들지 않는다', () => {
    const explanation = explainNationalPension(makeParams({ withdrawalPlan: { nationalPensionStartAge: 65 } }))!;

    expect(explanation.claimAge).toBe(65);
    expect(explanation.steps.some((s) => s.label.includes('조기수령'))).toBe(false);
    expect(explanation.steps.some((s) => s.label.includes('연기수령'))).toBe(false);
  });

  test('연기수령은 가산으로 표시한다', () => {
    const explanation = explainNationalPension(makeParams({ withdrawalPlan: { nationalPensionStartAge: 70 } }))!;

    const 가산 = explanation.steps.find((s) => s.label.includes('연기수령'))!;
    expect(가산.label).toContain('+36%'); // 5년 × 12개월 × 0.6%
    expect(가산.amount).toBeCloseTo(2000000 * 0.36, 6);
  });

  test('물가 모드에 따라 각주가 달라진다', () => {
    expect(explainNationalPension(makeParams())!.inflationNote).toContain('오늘 화폐가치');
    expect(explainNationalPension(makeParams({ inflationMode: 'nominal' }))!.inflationNote)
      .toContain('물가상승률이 매년 누적');
  });

  // **설명이 엔진과 갈라지면 설명이 없느니만 못하다.** 실제 시뮬레이션이 그 해에 소득으로
  // 기록한 국민연금과 이 표의 실질 수령액이 같은 값이어야 한다.
  test('[통합] 엔진이 기록한 국민연금 소득과 일치한다', () => {
    const engine = new SimulationEngine();
    const params = makeParams({ withdrawalPlan: { nationalPensionStartAge: 60 } });

    const explanation = explainNationalPension(params)!;
    const firstPensionYear = engine
      .runSingle(params)
      .yearlyResults.find((y) => y.age === 60)!;

    expect(firstPensionYear.nationalPensionIncome / 12).toBeCloseTo(explanation.netMonthly, 0);
  });
});
