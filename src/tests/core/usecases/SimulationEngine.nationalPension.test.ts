import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { calculateNationalPensionTaxKRW } from '@/core/usecases/tax/TaxEngine';
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';
import { SimulationParams } from '@/core/entities/types';
import auditCase from '@/tests/fixtures/auditReportCase.json';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';

// 세후 국민연금액. 실효세율은 수령액에 따라 달라지므로(연금소득공제 + 누진세율) 상수로
// 박지 않고 세금 계산 함수로 유도한다 — 이 파일의 주제는 세율이 아니라 조기/연기수령
// 감액·가산이 수령액에 어떻게 반영되는가다.
const netAnnual = (grossAnnualKRW: number) =>
  grossAnnualKRW - calculateNationalPensionTaxKRW(grossAnnualKRW, resolveTaxContext());

describe('SimulationEngine 국민연금 조기/연기수령', () => {
  const baseParams: SimulationParams = {
    userProfile: {
      currentAge: 55,
      retirementAge: 60,
      expectancy: 85,
      targetMonthlySpending: 500000, // shortfall을 최소화해 국민연금 수치를 순수하게 검증
    },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 1000000 }, // 65세 기준 월 100만 원
    privatePensions: [],
    otherIncomes: [
      { id: 'income-1', label: '임대소득', monthlyAmount: 2000000, currency: 'KRW' },
    ],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };

  test('withdrawalPlan 미지정 시 기존과 동일하게 65세부터 감액/가산 없이 수령한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams);

    const resultAt64 = result.yearlyResults.find((r) => r.age === 64);
    const resultAt65 = result.yearlyResults.find((r) => r.age === 65);
    expect(resultAt64!.nationalPensionIncome).toBe(0);

    const expectedAnnualNet = netAnnual(1000000 * 12);
    expect(Math.abs(resultAt65!.nationalPensionIncome - expectedAnnualNet)).toBeLessThan(1);
  });

  test('nationalPensionStartAge=60 조기수령 시 60세부터 30% 감액된 금액을 수령한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({
      ...baseParams,
      withdrawalPlan: { nationalPensionStartAge: 60 },
    });

    const resultAt59 = result.yearlyResults.find((r) => r.age === 59);
    const resultAt60 = result.yearlyResults.find((r) => r.age === 60);
    expect(resultAt59!.nationalPensionIncome).toBe(0);

    const expectedAnnualNet = netAnnual(1000000 * 0.7 * 12); // 30% 감액
    expect(Math.abs(resultAt60!.nationalPensionIncome - expectedAnnualNet)).toBeLessThan(1);
  });

  test('nationalPensionStartAge=70 연기수령 시 70세부터 36% 가산된 금액을 수령한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({
      ...baseParams,
      withdrawalPlan: { nationalPensionStartAge: 70 },
    });

    const resultAt69 = result.yearlyResults.find((r) => r.age === 69);
    const resultAt70 = result.yearlyResults.find((r) => r.age === 70);
    expect(resultAt69!.nationalPensionIncome).toBe(0);

    const expectedAnnualNet = netAnnual(1000000 * 1.36 * 12); // 36% 가산
    expect(Math.abs(resultAt70!.nationalPensionIncome - expectedAnnualNet)).toBeLessThan(1);
  });

  test('nationalPensionStartAge가 범위를 벗어나도(예: 90) 70세 상한으로 클램프되어 처리된다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({
      ...baseParams,
      withdrawalPlan: { nationalPensionStartAge: 90 },
    });

    const resultAt70 = result.yearlyResults.find((r) => r.age === 70);
    const expectedAnnualNet = netAnnual(1000000 * 1.36 * 12);
    expect(Math.abs(resultAt70!.nationalPensionIncome - expectedAnnualNet)).toBeLessThan(1);
  });

  test('감사 리포트의 월 200만원은 60세 추천에서 30% 감액되고 국민·사적연금 세금이 분리된다', () => {
    const source = normalizeSimulationParams((auditCase as { params: unknown }).params);
    const result = new SimulationEngine().run({
      ...source,
      withdrawalPlan: { ...source.withdrawalPlan, nationalPensionStartAge: 60 },
    });
    const at60 = result.yearlyResults.find((year) => year.age === 60)!;

    // 65세 기준 월 200만원 × 70% × 12개월. 65세 금액 2,400만원을 그대로 쓰면 실패한다.
    expect(at60.nationalPensionIncome + at60.nationalPensionTaxPaid).toBeCloseTo(16_800_000, 0);
    expect(at60.nationalPensionIncome).toBeCloseTo(16_224_480, 0);
    expect(at60.nationalPensionTaxPaid).toBeCloseTo(575_520, 0);

    // pensionTaxPaid는 사적연금 세금, nationalPensionTaxPaid는 국민연금 세금이다.
    // 둘을 합친 필드로 되돌아가면 아래 독립 단언이 깨진다.
    expect(at60.pensionTaxPaid).toBeGreaterThan(0);
    expect(at60.pensionTaxPaid).not.toBeCloseTo(at60.nationalPensionTaxPaid, 0);
    expect(at60.pensionIncome).toBeCloseTo(
      at60.nationalPensionIncome + at60.privatePensionIncome,
      5,
    );
  });
});
