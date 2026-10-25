import { describe, test, expect } from 'vitest';
import {
  sumYearTaxes,
  sumYearTaxesAndLevies,
  sumTotalTaxesAndLevies,
} from '@/core/usecases/tax/annualTaxTotals';
import { SimulationYearlyResult } from '@/core/entities/types';
import { makeYearlyResult as makeYear } from '@/tests/fixtures/yearlyResult';

describe('annualTaxTotals', () => {
  test('sumYearTaxes는 세금 4종만 더하고 건강보험료는 제외한다', () => {
    const year = makeYear({
      dividendTaxPaid: 100,
      pensionTaxPaid: 200,
      nationalPensionTaxPaid: 300,
      comprehensiveTaxPaid: 400,
      healthInsurancePaid: 1000,
    });

    expect(sumYearTaxes(year)).toBe(1000);
  });

  test('sumYearTaxesAndLevies는 건강보험료까지 더한다', () => {
    const year = makeYear({
      dividendTaxPaid: 100,
      pensionTaxPaid: 200,
      nationalPensionTaxPaid: 300,
      comprehensiveTaxPaid: 400,
      healthInsurancePaid: 1000,
    });

    expect(sumYearTaxesAndLevies(year)).toBe(2000);
  });

  test('두 함수의 차이는 정확히 건강보험료다', () => {
    const year = makeYear({ healthInsurancePaid: 12345, dividendTaxPaid: 678 });

    expect(sumYearTaxesAndLevies(year) - sumYearTaxes(year)).toBe(year.healthInsurancePaid);
  });

  test('sumTotalTaxesAndLevies는 전 기간을 누적한다', () => {
    const years = [
      makeYear({ dividendTaxPaid: 10, healthInsurancePaid: 1 }),
      makeYear({ pensionTaxPaid: 20, healthInsurancePaid: 2 }),
      makeYear({ comprehensiveTaxPaid: 30, healthInsurancePaid: 3 }),
    ];

    expect(sumTotalTaxesAndLevies(years)).toBe(66);
  });

  test('빈 배열은 0이다', () => {
    expect(sumTotalTaxesAndLevies([])).toBe(0);
  });

  // 이 테스트가 이 파일의 존재 이유다. SimulationYearlyResult에 새 세금 필드를 추가하면서
  // annualTaxTotals를 고치지 않으면 여기서 걸린다 — 세 소비처를 각자 고치는 대신
  // 이 한 곳만 고치게 만드는 장치다.
  test('결과 타입의 모든 세금·공과금 필드가 합산에 포함된다', () => {
    const TAX_FIELDS = [
      'dividendTaxPaid',
      'pensionTaxPaid',
      'nationalPensionTaxPaid',
      'comprehensiveTaxPaid',
      'healthInsurancePaid',
    ] as const satisfies ReadonlyArray<keyof SimulationYearlyResult>;

    // 필드를 하나씩 1로 세워 합계가 정확히 1씩 오르는지 본다. 합산에서 빠진 필드가
    // 있으면 그 필드에서 0이 나온다.
    for (const field of TAX_FIELDS) {
      const contribution = sumYearTaxesAndLevies(makeYear({ [field]: 1 }));
      expect(contribution, `${field}가 sumYearTaxesAndLevies에 포함되지 않았다`).toBe(1);
    }
  });
});
