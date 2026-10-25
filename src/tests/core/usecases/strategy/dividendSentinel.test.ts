import { describe, test, expect } from 'vitest';
import { recommendStrategy } from '@/core/usecases/strategy/RecommendationEngine';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { computeLifetimeUtility } from '@/core/usecases/utility/UtilityEngine';
import { DividendStrategy, SimulationParams } from '@/core/entities/types';

// 저성장·고배당 자산(asset-1)의 배당을 재투자하지 않는 쪽이 유리해지는 조합.
// RecommendationEngine.test.ts의 Phase 3 픽스처와 같은 설계다.
const baseParams: SimulationParams = {
  userProfile: { currentAge: 30, retirementAge: 65, expectancy: 90, targetMonthlySpending: 2000000 },
  assets: [
    {
      id: 'asset-0', type: 'etf', ticker: 'GROWTH', name: '성장자산',
      quantity: 1, averagePrice: 30000000, totalReturn: 10, dividendYield: 0,
      monthlyContribution: 0, reinvestDividend: true, currency: 'KRW',
    },
    {
      id: 'asset-1', type: 'etf', ticker: 'SPY', name: '테스트자산',
      quantity: 1, averagePrice: 30000000, totalReturn: 9, dividendYield: 8,
      monthlyContribution: 0, reinvestDividend: true, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    { id: 'pension-1', type: 'irp', balance: 600000000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const compiledWith = (dividendStrategy?: DividendStrategy) =>
  compileStrategy({
    ...baseParams,
    strategy: {
      ...DEFAULT_RETIREMENT_STRATEGY,
      ...(dividendStrategy ? { dividendStrategy } : {}),
    },
  });

describe('배당 재투자 센티널', () => {
  test('「자동으로 선택」이면 사용자의 계획 위에서 검증된 자산별 값을 내놓는다', () => {
    const compiled = compiledWith('ai_optimized');
    const recommendation = recommendStrategy(compiled.params, new SimulationEngine(), compiled.utilityConfig);

    expect(recommendation.verifiedAssetReinvestment).not.toBeNull();
    expect(Object.keys(recommendation.verifiedAssetReinvestment ?? {})).toEqual(['asset-1']);
  });

  // 이 축의 자동 채움이 안전한 근거 전체가 여기에 있다. Phase 3는 «최적화된 인출계획» 위에서
  // 평가하므로 그 값을 사용자의 계획에 그대로 얹으면 한 번도 평가된 적 없는 조합이 된다.
  // verifiedAssetReinvestment는 사용자의 계획 위에서 다시 잰 것이어야 한다.
  test('검증된 값을 사용자의 계획에 적용하면 효용이 실제로 오른다', () => {
    const engine = new SimulationEngine();
    const compiled = compiledWith('ai_optimized');
    const recommendation = recommendStrategy(compiled.params, engine, compiled.utilityConfig);
    const overrides = recommendation.verifiedAssetReinvestment!;

    const applied: SimulationParams = {
      ...compiled.params,
      assets: compiled.params.assets.map((a) =>
        a.id in overrides ? { ...a, reinvestDividend: overrides[a.id] } : a
      ),
    };
    const utility = computeLifetimeUtility(engine.runForUtility(applied), applied, compiled.utilityConfig);

    expect(utility.score).toBeGreaterThan(recommendation.currentUtility.score);
  });

  test('사용자가 「전부 재투자」를 고르면 자동 채움 대상이 아니다', () => {
    const compiled = compiledWith('reinvest_all');
    const recommendation = recommendStrategy(compiled.params, new SimulationEngine(), compiled.utilityConfig);

    expect(recommendation.verifiedAssetReinvestment).toBeNull();
    // 추천 자체는 계속 계산된다 — 화면은 "바꾸면 유리하다"고 말할 수 있어야 한다.
    expect(recommendation.recommendedAssetReinvestment).not.toBeNull();
  });

  // 전략을 저장한 적 없는 옛 시나리오도 기본값이 'ai_optimized'로 해소된다.
  test('전략이 없는 시나리오에서도 자동 채움이 돈다', () => {
    const compiled = compileStrategy(baseParams);
    const recommendation = recommendStrategy(compiled.params, new SimulationEngine(), compiled.utilityConfig);

    expect(recommendation.verifiedAssetReinvestment).not.toBeNull();
  });

  test('파이프라인 끝에서 엔진에 들어가는 params에 그 값이 실려 있다', () => {
    const compiled = compiledWith('ai_optimized');
    const recommendation = recommendStrategy(compiled.params, new SimulationEngine(), compiled.utilityConfig);
    const { compiled: effective, appliedFields } = applyAiSentinels(compiled, recommendation);

    expect(appliedFields).toContain('assetReinvestment');
    expect(effective.params.assets.find((a) => a.id === 'asset-1')?.reinvestDividend).toBe(false);
    // 사용자의 params는 그대로다 — 자동 채움은 계산에만 반영된다.
    expect(compiled.params.assets.find((a) => a.id === 'asset-1')?.reinvestDividend).toBe(true);
  });

  test('「전부 현금 수령」은 컴파일 단계에서 이미 확정되어 자동 채움이 개입하지 않는다', () => {
    const compiled = compiledWith('cash_all');
    const recommendation = recommendStrategy(compiled.params, new SimulationEngine(), compiled.utilityConfig);
    const { appliedFields } = applyAiSentinels(compiled, recommendation);

    expect(compiled.params.assets.every((a) => !a.reinvestDividend)).toBe(true);
    expect(appliedFields).not.toContain('assetReinvestment');
  });
});
