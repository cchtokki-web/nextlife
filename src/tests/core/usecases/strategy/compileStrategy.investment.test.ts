import { describe, test, expect } from 'vitest';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { ECONOMIC_SCENARIO_PROFILES } from '@/core/usecases/scenario/economicScenarios';
import { RetirementStrategy, SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 1,
      totalReturn: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 1000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const withStrategy = (patch: Partial<RetirementStrategy>): SimulationParams => ({
  ...baseParams,
  strategy: { ...DEFAULT_RETIREMENT_STRATEGY, ...patch },
});

describe('compileStrategy 투자/경제 축', () => {
  test('경제 시나리오가 물가와 환율 시나리오를 지배한다', () => {
    const r = compileStrategy(withStrategy({ economicScenario: 'high_inflation' }));

    expect(r.params.inflationRate).toBe(ECONOMIC_SCENARIO_PROFILES.high_inflation!.inflationRate);
    expect(r.params.exchangeScenario).toBe(ECONOMIC_SCENARIO_PROFILES.high_inflation!.exchangeScenario);
  });

  // 2026-08-22: 리스크 성향은 더 이상 수익률을 지배하지 않는다. 예전에는 'aggressive'
  // 같은 지배값을 고르면 경제 시나리오보다 나중에 적용되어 최종 승자가 됐지만, 이제
  // riskProfile은 'custom' | 'ai_recommended' 둘뿐이고 어느 쪽도 수익률을 건드리지 않는다.
  test('리스크 성향이 ai_recommended면 경제 시나리오를 골라도 자산 수익률은 사용자 입력 그대로다', () => {
    // 경제 시나리오는 더 이상 수익률을 지배하지 않는다(물가·환율만 지배한다).
    // riskProfile도 ai_recommended라 프리셋이 없으므로, 어느 축도 수익률을 건드리지 않는다.
    const r = compileStrategy(withStrategy({
      economicScenario: 'recession',
      riskProfile: 'ai_recommended',
    }));

    expect(r.params.assets[0].totalReturn).toBe(baseParams.assets[0].totalReturn);
  });

  test('리스크 성향이 custom이면 자산·연금에 직접 입력한 수익률을 그대로 쓴다', () => {
    // '사용자 직접입력'은 프리셋 매핑이 없어야 한다. RiskProfile에서 지배값
    // (conservative/neutral/aggressive)이 통째로 제거됐으므로, applyYieldPreset이
    // 호출되어 직접 입력한 값이 조용히 덮어써질 경로 자체가 없다.
    const params = withStrategy({ riskProfile: 'custom' });
    params.assets = [{ ...params.assets[0], totalReturn: 11.5 }];
    params.privatePensions = [{ ...params.privatePensions[0], totalReturn: 6.5 }];

    const r = compileStrategy(params);

    expect(r.params.assets[0].totalReturn).toBe(11.5);
    expect(r.params.privatePensions[0].totalReturn).toBe(6.5);
    expect(r.params.yieldPreset).toBeUndefined();
  });

  test('custom이어도 경제 시나리오가 자산 수익률을 덮어쓰지 않는다', () => {
    // ai_recommended와 같은 메커니즘이다 — 경제 시나리오는 물가·환율만 적용하고,
    // 리스크 성향(custom)도 그 위에 아무것도 얹지 않는다.
    const r = compileStrategy(withStrategy({
      economicScenario: 'recession',
      riskProfile: 'custom',
    }));

    expect(r.params.assets[0].totalReturn).toBe(baseParams.assets[0].totalReturn);
  });

  // 2026-08-22: compileStrategy는 어떤 riskProfile 값에도 자산 배열을 다시 만들지
  // 않는다(applyYieldPreset 호출 경로가 없다). reinvestDividend·totalReturn 모두
  // 입력 그대로 통과해야 한다.
  test('리스크 성향과 무관하게 자산별 reinvestDividend와 수익률이 보존된다', () => {
    const params = withStrategy({ riskProfile: 'ai_recommended' });
    params.assets = [{ ...params.assets[0], reinvestDividend: false, totalReturn: 12.3 }];

    const r = compileStrategy(params);

    expect(r.params.assets[0].reinvestDividend).toBe(false);
    expect(r.params.assets[0].totalReturn).toBe(12.3);
  });
});
