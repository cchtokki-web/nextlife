import { describe, test, expect } from 'vitest';
import { computePensionStartMarkers } from '@/core/usecases/dashboard/computePensionStartMarkers';
import { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3500000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1800000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('computePensionStartMarkers', () => {
  test('본인 국민연금 수령액이 있으면 개시 나이에 마커를 만든다', () => {
    expect(computePensionStartMarkers(baseParams, 65)).toEqual([
      { age: 65, label: '본인 국민연금 시작' },
    ]);
  });

  test('본인 국민연금 수령액이 0이면 마커를 만들지 않는다', () => {
    const params = { ...baseParams, nationalPension: { expectedMonthlyAmount: 0 } };
    expect(computePensionStartMarkers(params, 65)).toEqual([]);
  });

  // 재현 시나리오: 본인 50세/배우자 46세, 배우자 개시 60세(조기) → 본인 나이 64세.
  // 차트의 막대가 64세에 작게 생겼다가 65세에 커지는 이유가 바로 이것이다.
  test('배우자 개시 나이를 본인 나이로 환산해 함께 표시하고 오름차순 정렬한다', () => {
    const params: SimulationParams = {
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 46, expectancy: 92,
        nationalPensionMonthlyAmount: 200000, nationalPensionStartAge: 60,
      },
    };

    expect(computePensionStartMarkers(params, 65)).toEqual([
      { age: 64, label: '배우자 국민연금 시작' },
      { age: 65, label: '본인 국민연금 시작' },
    ]);
  });

  test('배우자 수령액이 0이면 배우자 마커를 만들지 않는다', () => {
    const params: SimulationParams = {
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 45, expectancy: 92,
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 59,
      },
    };

    expect(computePensionStartMarkers(params, 65)).toEqual([
      { age: 65, label: '본인 국민연금 시작' },
    ]);
  });

  test('같은 나이에 둘 다 시작하면 하나의 마커로 합친다', () => {
    const params: SimulationParams = {
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 50, expectancy: 92,
        nationalPensionMonthlyAmount: 200000, nationalPensionStartAge: 65,
      },
    };

    expect(computePensionStartMarkers(params, 65)).toEqual([
      { age: 65, label: '본인 국민연금 시작 · 배우자 국민연금 시작' },
    ]);
  });

  // 시뮬레이션 시작 시점에 이미 받고 있으면 차트 구간 안에서 "시작"하는 사건이 아니다.
  test('배우자가 이미 수령 중이면 마커를 만들지 않는다', () => {
    const params: SimulationParams = {
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 68, expectancy: 92,
        nationalPensionMonthlyAmount: 200000, nationalPensionStartAge: 65,
      },
    };

    expect(computePensionStartMarkers(params, 65)).toEqual([
      { age: 65, label: '본인 국민연금 시작' },
    ]);
  });
});
