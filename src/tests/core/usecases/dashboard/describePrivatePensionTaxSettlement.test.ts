import { describe, expect, test } from 'vitest';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';
import { describePrivatePensionTaxSettlement } from '@/core/usecases/dashboard/describePrivatePensionTaxSettlement';

const won = (value: number) => `${Math.round(value / 10_000).toLocaleString()}만원`;

describe('describePrivatePensionTaxSettlement', () => {
  test('정산이 일어난 구간과 최대 금액을 한 문장으로 말한다', () => {
    const settlement = describePrivatePensionTaxSettlement(
      [
        makeYearlyResult({ age: 60, privatePensionYearEndTaxAdjustment: 250_800 }),
        makeYearlyResult({ age: 61, privatePensionYearEndTaxAdjustment: 250_800 }),
        makeYearlyResult({ age: 62, privatePensionYearEndTaxAdjustment: 0 }),
      ],
      won,
    );

    expect(settlement?.fromAge).toBe(60);
    expect(settlement?.toAge).toBe(61);
    expect(settlement?.maxAnnualAmount).toBe(250_800);
    expect(settlement?.sentence).toContain('60세부터 61세 사이에는');
    expect(settlement?.sentence).toContain('연 최대 25만원');
    // 사용자가 두 숫자를 빼서 맞지 않을 때 답이 되는 문장이어야 한다.
    expect(settlement?.sentence).toContain('그해 생활비를 실제로 채운 금액보다 그만큼 작습니다');
  });

  test('정산이 한 해뿐이면 구간이 아니라 그 해만 말한다', () => {
    const settlement = describePrivatePensionTaxSettlement(
      [makeYearlyResult({ age: 60, privatePensionYearEndTaxAdjustment: 300_000 })],
      won,
    );

    expect(settlement?.sentence).toContain('60세에는');
    expect(settlement?.sentence).not.toContain('사이에는');
  });

  test('정산이 없으면 아무 말도 하지 않는다', () => {
    expect(describePrivatePensionTaxSettlement(
      [makeYearlyResult({ age: 60, privatePensionYearEndTaxAdjustment: 0 })],
      won,
    )).toBeNull();
  });

  test('필드가 없는 옛 결과에는 없는 숫자로 문장을 지어내지 않는다', () => {
    // 「측정하지 못했다」와 「0원이다」는 다른 사실이다.
    expect(describePrivatePensionTaxSettlement([makeYearlyResult({ age: 60 })], won)).toBeNull();
  });

  test('만원 미만 정산은 화면에서 0만원으로 찍히므로 문장을 만들지 않는다', () => {
    expect(describePrivatePensionTaxSettlement(
      [makeYearlyResult({ age: 60, privatePensionYearEndTaxAdjustment: 5_000 })],
      won,
    )).toBeNull();
  });
});
