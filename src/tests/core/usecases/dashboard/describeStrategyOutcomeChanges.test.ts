import { describe, expect, test } from 'vitest';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';
import { summarizePlanOutcome } from '@/core/usecases/dashboard/summarizePlanOutcome';
import { describeStrategyOutcomeChanges } from '@/core/usecases/dashboard/describeStrategyOutcomeChanges';

const won = (value: number) => `${Math.round(value / 10_000).toLocaleString()}만원`;

describe('summarizePlanOutcome', () => {
  test('은퇴 전 연도는 평균에 넣지 않는다', () => {
    const outcome = summarizePlanOutcome(
      [
        makeYearlyResult({ age: 59, withdrawal: 100_000_000, healthInsurancePaid: 9_000_000 }),
        makeYearlyResult({ age: 60, withdrawal: 30_000_000 }),
        makeYearlyResult({ age: 61, withdrawal: 10_000_000 }),
      ],
      60,
    );

    expect(outcome.averageAnnualWithdrawal).toBe(20_000_000);
    expect(outcome.averageAnnualTaxAndLevy).toBe(0);
  });

  test('세금 평균에 건강보험료를 포함한다', () => {
    // 연금을 더 뽑아 건보료를 키우는 계획이 「세금이 늘지 않았다」로 보이지 않아야 한다
    // (annualTaxTotals의 sumYearTaxesAndLevies 주석).
    const outcome = summarizePlanOutcome(
      [makeYearlyResult({ age: 60, pensionTaxPaid: 1_000_000, healthInsurancePaid: 500_000 })],
      60,
    );

    expect(outcome.averageAnnualTaxAndLevy).toBe(1_500_000);
  });

  test('국민연금은 실제로 지급된 첫 해의 세후 월액으로 요약한다', () => {
    const outcome = summarizePlanOutcome(
      [
        makeYearlyResult({ age: 60, nationalPensionIncome: 0 }),
        makeYearlyResult({ age: 65, nationalPensionIncome: 24_000_000 }),
        makeYearlyResult({ age: 66, nationalPensionIncome: 30_000_000 }),
      ],
      60,
    );

    expect(outcome.nationalPensionFirstAge).toBe(65);
    expect(outcome.nationalPensionMonthlyNet).toBe(2_000_000);
  });

  test('국민연금 수령 이력이 없으면 0이 아니라 null이다', () => {
    // 0으로 접으면 국민연금이 없는 사용자 화면에 「월 0원」이라는 없는 항목이 생긴다.
    const outcome = summarizePlanOutcome([makeYearlyResult({ age: 60 })], 60);

    expect(outcome.nationalPensionFirstAge).toBeNull();
    expect(outcome.nationalPensionMonthlyNet).toBeNull();
  });
});

describe('describeStrategyOutcomeChanges', () => {
  const before = summarizePlanOutcome(
    [
      makeYearlyResult({ age: 60, withdrawal: 40_000_000, pensionTaxPaid: 3_000_000 }),
      makeYearlyResult({ age: 65, nationalPensionIncome: 22_800_000, withdrawal: 14_000_000, pensionTaxPaid: 1_000_000 }),
    ],
    60,
  );

  test('국민연금 개시가 당겨지면 감액된 실수령액을 개시 나이와 함께 말한다', () => {
    // 60세 조기수령은 30% 감액이다(nationalPensionRules). 카드가 「65세 → 60세」만 말하면
    // 사용자는 그 대가를 적용한 뒤에 알게 된다.
    const after = summarizePlanOutcome(
      [
        makeYearlyResult({ age: 60, nationalPensionIncome: 16_224_480, withdrawal: 20_000_000, pensionTaxPaid: 1_000_000 }),
        makeYearlyResult({ age: 65, nationalPensionIncome: 16_224_480, withdrawal: 20_000_000, pensionTaxPaid: 1_000_000 }),
      ],
      60,
    );

    const changes = describeStrategyOutcomeChanges(before, after, won);
    const pension = changes.find((change) => change.key === 'nationalPensionMonthly');

    expect(pension?.before).toBe('65세부터 월 190만원');
    expect(pension?.after).toBe('60세부터 월 135만원');
    expect(pension?.difference).toBeLessThan(0);
    expect(pension?.direction).toBe('higher_is_better');
  });

  test('인출액과 세부담의 전후를 함께 낸다', () => {
    const after = summarizePlanOutcome(
      [
        makeYearlyResult({ age: 60, withdrawal: 60_000_000, pensionTaxPaid: 6_000_000, healthInsurancePaid: 1_000_000 }),
        makeYearlyResult({ age: 65, nationalPensionIncome: 22_800_000, withdrawal: 20_000_000, pensionTaxPaid: 2_000_000 }),
      ],
      60,
    );

    const changes = describeStrategyOutcomeChanges(before, after, won);

    expect(changes.map((change) => change.key)).toEqual(['annualWithdrawal', 'annualTaxAndLevy']);
    expect(changes[0].before).toBe('2,700만원');
    expect(changes[0].after).toBe('4,000만원');
    expect(changes[1].direction).toBe('lower_is_better');
    expect(changes[1].difference).toBeGreaterThan(0);
  });

  test('달라지지 않은 항목은 행을 만들지 않는다', () => {
    expect(describeStrategyOutcomeChanges(before, before, won)).toEqual([]);
  });

  test('비교할 「전」이 없으면 아무것도 말하지 않는다', () => {
    // 현상 유지 후보가 HARD 제약에 걸려 시뮬레이션까지 가지 못한 경우다. 없는 기준으로
    // 개선폭을 지어내지 않는다.
    expect(describeStrategyOutcomeChanges(undefined, before, won)).toEqual([]);
  });
});
