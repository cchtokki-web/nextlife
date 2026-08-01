import { describe, test, expect } from 'vitest';
import {
  ECONOMIC_SCENARIO_PROFILES, GoverningEconomicScenario, applyEconomicScenario,
  isEconomicScenarioGoverning, resolveEconomicScenarioProfile,
} from '@/core/usecases/scenario/economicScenarios';
import { SimulationParams } from '@/core/entities/types';

const GOVERNING: GoverningEconomicScenario[] = [
  'long_term_average', 'recession', 'high_inflation', 'low_growth',
];

const params: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 1,
      annualGrowthRate: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 1000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('ECONOMIC_SCENARIO_PROFILES', () => {
  test('AI 추천을 제외한 모든 시나리오에 프로필이 정의되어 있다', () => {
    for (const s of GOVERNING) {
      expect(ECONOMIC_SCENARIO_PROFILES[s], s).toBeDefined();
    }
  });

  // 상대 비교(toBeGreaterThan)와 "프로필을 다시 참조해 같은지" 비교만으로는 같은 프로필
  // 안에서 두 필드를 맞바꾼 실수(recession의 stockGrowthRate 3과 pensionReturnRate 2)가
  // 드러나지 않는다. 네 프로필의 절대값을 통째로 고정해 그 부류의 회귀를 잡는다.
  // taxLawProfiles.test.ts가 이미 같은 방식으로 세율표를 고정하고 있다.
  test('네 프로필의 값이 정확히 고정되어 있다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES).toEqual({
      long_term_average: {
        inflationRate: 2.5, stockGrowthRate: 7, pensionReturnRate: 4, exchangeScenario: 'base',
      },
      recession: {
        inflationRate: 1.5, stockGrowthRate: 3, pensionReturnRate: 2, exchangeScenario: 'usd_up',
      },
      high_inflation: {
        inflationRate: 5, stockGrowthRate: 6, pensionReturnRate: 3, exchangeScenario: 'usd_up',
      },
      low_growth: {
        inflationRate: 2, stockGrowthRate: 4, pensionReturnRate: 2.5, exchangeScenario: 'base',
      },
    });
  });

  test('모든 프로필에서 주식 수익률이 사적연금 수익률보다 높다', () => {
    // 사적연금은 더 보수적인 배분을 가정한다(EconomicScenarioProfile 주석). 두 필드를
    // 맞바꾸면 이 불변식이 먼저 깨진다.
    for (const s of GOVERNING) {
      const p = ECONOMIC_SCENARIO_PROFILES[s];
      expect(p.stockGrowthRate, s).toBeGreaterThan(p.pensionReturnRate);
    }
  });

  test('고물가는 장기 평균보다 물가상승률이 높다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES.high_inflation.inflationRate)
      .toBeGreaterThan(ECONOMIC_SCENARIO_PROFILES.long_term_average.inflationRate);
  });

  test('장기 침체는 장기 평균보다 주식 수익률이 낮다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES.recession.stockGrowthRate)
      .toBeLessThan(ECONOMIC_SCENARIO_PROFILES.long_term_average.stockGrowthRate);
  });

  test('AI 추천(미정)에는 프로필이 없다', () => {
    // 프로필을 주면 사용자가 직접 입력한 물가상승률이 조용히 덮어써진다.
    // 이제 'ai_recommended'는 키 도메인에서 Exclude로 제거되어 있어, 이 테이블에 항목을
    // 채워 넣으려는 시도 자체가 컴파일 에러가 된다(런타임 단언은 그 보강이다).
    expect(resolveEconomicScenarioProfile('ai_recommended')).toBeNull();
    expect(Object.keys(ECONOMIC_SCENARIO_PROFILES)).not.toContain('ai_recommended');
    expect(isEconomicScenarioGoverning('ai_recommended')).toBe(false);
    expect(isEconomicScenarioGoverning('recession')).toBe(true);
  });

  test('알 수 없는 시나리오 값도 프로필 없음으로 떨어진다', () => {
    // 타입 가드는 통과하지만 테이블에 없는 값. 런타임 폴백(?? null)이 사라지면 여기가 깨진다.
    expect(resolveEconomicScenarioProfile('nope' as never)).toBeNull();
    expect(isEconomicScenarioGoverning('nope' as never)).toBe(false);
  });
});

describe('applyEconomicScenario', () => {
  test('물가·환율 시나리오·수익률을 한꺼번에 교체한다', () => {
    const r = applyEconomicScenario(params, 'high_inflation');
    const profile = ECONOMIC_SCENARIO_PROFILES.high_inflation!;

    expect(r.inflationRate).toBe(profile.inflationRate);
    expect(r.exchangeScenario).toBe(profile.exchangeScenario);
    expect(r.assets[0].annualGrowthRate).toBe(profile.stockGrowthRate);
    expect(r.privatePensions[0].annualReturn).toBe(profile.pensionReturnRate);
  });

  // B1: ISA는 assets와 같은 시장 연동 계좌인데(annualReturn + dividendYield로 성장하고
  // 엔진이 자기 annualReturn으로 굴린다) 시나리오에서만 빠져 있었다. "장기 침체"를 골라
  // 주식이 7% → 3%로 떨어지는 동안 ISA만 사용자 입력값을 유지하면, 구성상 ISA가 항상
  // 최고 수익 버킷이 되어 isaMaturityDestination 추천과 연금→ISA 채널링 판정이
  // 그 인공물 쪽으로 편향된다.
  test('ISA 계좌 수익률도 주식 수익률로 함께 교체한다', () => {
    const withIsa: SimulationParams = {
      ...params,
      isaAccounts: [{
        id: 'i1', type: 'general', balance: 1000, monthlyContribution: 0,
        annualReturn: 9, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
      }],
    };

    const r = applyEconomicScenario(withIsa, 'recession');

    expect(r.isaAccounts![0].annualReturn).toBe(ECONOMIC_SCENARIO_PROFILES.recession!.stockGrowthRate);
  });

  test('ISA 계좌가 없어도 크래시하지 않는다', () => {
    expect(() => applyEconomicScenario(params, 'recession')).not.toThrow();
    expect(applyEconomicScenario(params, 'recession').isaAccounts).toBeUndefined();
  });

  test('입력 객체를 변형하지 않는다', () => {
    const snapshot = JSON.parse(JSON.stringify(params));

    applyEconomicScenario(params, 'recession');

    expect(params).toEqual(snapshot);
  });

  test('알 수 없는 시나리오는 입력을 그대로 반환한다', () => {
    expect(applyEconomicScenario(params, 'nope' as never)).toEqual(params);
  });

  test('AI 추천(미정)은 사용자가 입력한 물가상승률을 보존한다', () => {
    const custom = { ...params, inflationRate: 3.7 };

    const r = applyEconomicScenario(custom, 'ai_recommended');

    expect(r.inflationRate).toBe(3.7);
    expect(r).toEqual(custom);
  });
});
