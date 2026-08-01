import { describe, test, expect } from 'vitest';
import { computeAnnualHealthcareCost } from '@/core/usecases/healthcare/healthcareCosts';
import { HealthcareAssumptions } from '@/core/entities/types';

const healthcare: HealthcareAssumptions = {
  enabled: true,
  costGrowthRate: 5,
  baseMonthlyCost: 300000,
  longTermCareEnabled: false,
  longTermCareStartAge: 80,
  longTermCareMonthlyCost: 1500000,
  shockEnabled: false,
  shockAge: 75,
  shockAmount: 30000000,
};

const call = (patch: Partial<Parameters<typeof computeAnnualHealthcareCost>[0]> = {}) =>
  computeAnnualHealthcareCost({
    healthcare, currentAge: 65, retirementAge: 60, simulationStartAge: 60,
    yearsSinceRetirement: 5,
    inflationMode: 'nominal', inflationRate: 2.5, spendingFactor: 1, ...patch,
  });

describe('computeAnnualHealthcareCost', () => {
  test('healthcare가 없으면 0이다', () => {
    expect(call({ healthcare: undefined })).toBe(0);
  });

  test('enabled가 false면 0이다', () => {
    expect(call({ healthcare: { ...healthcare, enabled: false } })).toBe(0);
  });

  test('은퇴 전에는 0이다', () => {
    expect(call({ currentAge: 55, yearsSinceRetirement: -5 })).toBe(0);
  });

  test('은퇴 시점에는 기본 월 의료비의 12배다', () => {
    expect(call({ currentAge: 60, yearsSinceRetirement: 0 })).toBe(300000 * 12);
  });

  test('명목 모드에서는 의료비 증가율 전체가 복리로 적용된다', () => {
    // 5년 경과, 연 5% → 300000 * 12 * 1.05^5
    expect(call()).toBeCloseTo(300000 * 12 * Math.pow(1.05, 5), 0);
  });

  test('실질 모드에서는 물가 초과분만 적용된다', () => {
    // 의료비 5% - 물가 2.5% = 초과 2.5%
    const result = call({ inflationMode: 'real' });

    expect(result).toBeCloseTo(300000 * 12 * Math.pow(1.025, 5), 0);
  });

  test('실질 모드에서 의료비 증가율이 물가보다 낮으면 감소한다', () => {
    const result = call({
      inflationMode: 'real',
      healthcare: { ...healthcare, costGrowthRate: 1 }, // 1% - 2.5% = -1.5%
    });

    expect(result).toBeLessThan(300000 * 12);
  });

  test('장기요양 시작 나이 전에는 장기요양비가 붙지 않는다', () => {
    const withLtc = { ...healthcare, longTermCareEnabled: true, longTermCareStartAge: 80 };

    expect(call({ healthcare: withLtc, currentAge: 79, yearsSinceRetirement: 19 }))
      .toBeCloseTo(300000 * 12 * Math.pow(1.05, 19), 0);
  });

  // B3: 장기요양비는 "장기요양이 시작되는 나이의 금액"으로 입력받는다. 은퇴 시점 기준으로
  // 해석해 (1+증가율)^(현재나이-은퇴나이)를 곱하면, 기본값(은퇴 60 / 시작 80 / 증가율 5%)에서
  // 입력한 150만원이 발생 시점에 1.05^20 = 2.65배가 된다. 같은 함수의 일회성 쇼크가 이미
  // "그 나이에 실제로 나갈 금액"이라는 반대 규약을 쓰고 있어 두 항목이 어긋나 있었다.
  test('장기요양비는 은퇴 시점이 아니라 장기요양 시작 나이 기준 금액이다', () => {
    const withLtc = { ...healthcare, longTermCareEnabled: true, longTermCareStartAge: 80 };
    const base = 300000 * 12 * Math.pow(1.05, 20);
    // 명목 모드이므로 시작 나이까지의 물가상승분만 붙는다(쇼크와 같은 규약).
    const ltc = 1500000 * 12 * Math.pow(1.025, 20);

    expect(call({ healthcare: withLtc, currentAge: 80, yearsSinceRetirement: 20 }))
      .toBeCloseTo(base + ltc, 0);
  });

  test('장기요양 시작 이후에는 의료비 증가율만큼 오른다', () => {
    const withLtc = { ...healthcare, longTermCareEnabled: true, longTermCareStartAge: 80 };
    const base = 300000 * 12 * Math.pow(1.05, 25);
    const ltc = 1500000 * 12 * Math.pow(1.05, 5) * Math.pow(1.025, 20);

    expect(call({ healthcare: withLtc, currentAge: 85, yearsSinceRetirement: 25 }))
      .toBeCloseTo(base + ltc, 0);
  });

  test('실질 모드에서 장기요양 시작 해의 금액은 입력값 그대로다', () => {
    const withLtc = { ...healthcare, longTermCareEnabled: true, longTermCareStartAge: 80 };
    const base = 300000 * 12 * Math.pow(1.025, 20); // 물가 초과분(5% - 2.5%)만 20년

    expect(call({ healthcare: withLtc, currentAge: 80, yearsSinceRetirement: 20, inflationMode: 'real' }))
      .toBeCloseTo(base + 1500000 * 12, 0);
  });

  test('쇼크는 지정한 나이 한 해에만 발생한다', () => {
    const withShock = { ...healthcare, shockEnabled: true, shockAge: 70 };
    const baseAt10 = 300000 * 12 * Math.pow(1.05, 10);
    // 명목 모드이므로 쇼크 금액(오늘 화폐가치 입력)에는 시작 나이(60)부터 발생 나이(70)까지의
    // 물가상승분이 붙는다 — 그래야 그 해의 다른 명목 금액과 같은 화폐가치가 된다.
    const shockAt70 = 30000000 * Math.pow(1.025, 10);

    expect(call({ healthcare: withShock, currentAge: 70, yearsSinceRetirement: 10 }))
      .toBeCloseTo(baseAt10 + shockAt70, 0);
    expect(call({ healthcare: withShock, currentAge: 71, yearsSinceRetirement: 11 }))
      .toBeCloseTo(300000 * 12 * Math.pow(1.05, 11), 0);
  });

  test('쇼크 발생 직전 해에는 쇼크가 붙지 않는다', () => {
    const withShock = { ...healthcare, shockEnabled: true, shockAge: 70 };

    expect(call({ healthcare: withShock, currentAge: 69, yearsSinceRetirement: 9 }))
      .toBeCloseTo(300000 * 12 * Math.pow(1.05, 9), 0);
  });

  test('장기요양 시작 나이가 은퇴 나이보다 이르면 은퇴 첫 해부터 붙는다', () => {
    const withEarlyLtc = { ...healthcare, longTermCareEnabled: true, longTermCareStartAge: 55 };

    // 은퇴 전 지출은 모델링하지 않지만 요양은 이미 55세에 시작된 것으로 보므로,
    // 은퇴 첫 해(60세)의 금액에는 5년치 증가율이 이미 반영되어 있다.
    expect(call({ healthcare: withEarlyLtc, currentAge: 60, yearsSinceRetirement: 0 }))
      .toBeCloseTo(300000 * 12 + 1500000 * 12 * Math.pow(1.05, 5), 0);
  });

  test('생존자가 한 명이면 축소 계수만큼 줄어든다', () => {
    // 의료비는 생활비와 같은 성격의 반복 가구 지출이다. 본인 사후 배우자 단독
    // 생존 기간에 본인 기준 전액이 계속 나가면 안 된다.
    expect(call({ spendingFactor: 0.7 })).toBeCloseTo(call() * 0.7, 0);
  });

  test('둘 다 사망한 해(계수 0)에는 의료비가 0이다', () => {
    expect(call({ spendingFactor: 0 })).toBe(0);
  });

  test('실효 증가율이 -100% 이하여도 음수가 되지 않는다', () => {
    // Math.pow(음수, y)는 연도마다 부호가 뒤집혀 "공짜 돈"을 만든다.
    const result = call({
      inflationMode: 'real',
      healthcare: { ...healthcare, costGrowthRate: -200 }, // -200 - 2.5 = -202.5%
    });

    expect(result).toBe(0);
  });

  test('쇼크 금액에는 의료비 증가율을 적용하지 않는다 (오늘 화폐가치 목돈)', () => {
    const withShock = {
      ...healthcare, shockEnabled: true, shockAge: 70,
      baseMonthlyCost: 0, longTermCareEnabled: false,
    };

    // 실질 모드에서는 모든 금액이 오늘 화폐가치이므로 입력값이 그대로 나온다.
    expect(call({
      healthcare: withShock, currentAge: 70, yearsSinceRetirement: 10, inflationMode: 'real',
    })).toBe(30000000);
  });

  // 명목 모드에서 의료비만 오늘 화폐가치로 남아 과소 계상되던 결함의 회귀 가드.
  // 주변의 모든 명목 금액(목표 생활비·연금 등)은 시뮬레이션 시작 나이부터 인플레이션을
  // 누적하는데, 의료비의 growthFactor는 은퇴 시점(yearsSinceRetirement = 0)부터 시작하므로
  // 은퇴까지의 물가상승분이 아무 데도 반영되지 않았다.
  describe('명목 모드의 화폐가치 정합성', () => {
    const nominalHealthcare: HealthcareAssumptions = {
      ...healthcare, costGrowthRate: 3, baseMonthlyCost: 1000000,
    };
    const nominalCall = (patch: Partial<Parameters<typeof computeAnnualHealthcareCost>[0]> = {}) =>
      computeAnnualHealthcareCost({
        healthcare: nominalHealthcare,
        currentAge: 65, retirementAge: 65, simulationStartAge: 50,
        yearsSinceRetirement: 0,
        inflationMode: 'nominal', inflationRate: 3, spendingFactor: 1, ...patch,
      });

    test('은퇴 시점 의료비에 현재 나이부터 은퇴까지의 물가상승분이 반영된다', () => {
      // 현재 50 / 은퇴 65 / 물가 3% / 의료비 증가 3% / 기준 월 100만원
      // 오늘 화폐가치 12,000,000원 → 명목 12,000,000 × 1.03^15 = 18,695,609원
      expect(nominalCall()).toBeCloseTo(12000000 * Math.pow(1.03, 15), 0);
      expect(Math.round(nominalCall())).toBe(18695609);
    });

    test('은퇴 이후에는 은퇴까지의 물가상승분 위에 의료비 증가율이 복리로 얹힌다', () => {
      expect(nominalCall({ currentAge: 75, yearsSinceRetirement: 10 }))
        .toBeCloseTo(12000000 * Math.pow(1.03, 15) * Math.pow(1.03, 10), 0);
    });

    test('장기요양비에도 같은 계수가 적용된다', () => {
      const withLtc: HealthcareAssumptions = {
        ...nominalHealthcare, longTermCareEnabled: true, longTermCareStartAge: 65,
        longTermCareMonthlyCost: 1000000,
      };

      expect(nominalCall({ healthcare: withLtc }))
        .toBeCloseTo(24000000 * Math.pow(1.03, 15), 0);
    });

    test('쇼크 금액에도 발생 나이까지의 물가상승분이 붙는다', () => {
      const withShock: HealthcareAssumptions = {
        ...nominalHealthcare, baseMonthlyCost: 0, shockEnabled: true, shockAge: 75,
      };

      expect(nominalCall({ healthcare: withShock, currentAge: 75, yearsSinceRetirement: 10 }))
        .toBeCloseTo(30000000 * Math.pow(1.03, 25), 0);
    });

    test('실질 모드는 영향을 받지 않는다 (모든 금액이 오늘 화폐가치)', () => {
      // 의료비 3% - 물가 3% = 0% → 은퇴 시점 값이 입력 그대로 유지된다.
      expect(nominalCall({ inflationMode: 'real' })).toBeCloseTo(12000000, 0);
    });
  });
});
