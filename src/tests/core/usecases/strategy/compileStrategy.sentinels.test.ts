import { describe, test, expect } from 'vitest';
import {
  NATIONAL_PENSION_STRATEGY_AGES, compileStrategy, DEFAULT_RETIREMENT_STRATEGY,
  resolvePrivatePensionTaxLimitOverride,
} from '@/core/usecases/strategy/compileStrategy';
import { OBJECTIVE_WEIGHT_PRESETS } from '@/core/usecases/strategy/objectivePresets';
import { resolveEconomicScenarioProfile } from '@/core/usecases/scenario/economicScenarios';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '@/core/usecases/pension/nationalPensionRules';
import { RetirementStrategy, SimulationParams } from '@/core/entities/types';

// 다섯 축 전부에 대해 "'ai_*'는 미정이며 baseline과 완전히 같은 결과를 낸다"는 불변식을
// 한자리에서 단정한다.
//
// 이 브랜치에서 같은 사고가 세 번 났다: 'ai_*' 값에 매핑 테이블 항목이 채워져 사용자가
// 직접 저장해 둔 설정(저율과세 한도, 물가상승률, 경제 시나리오)이 조용히 덮어써졌다.
// 경제 시나리오는 Record<Exclude<...>>가 컴파일 타임에 막고, 리스크 성향은 2026-08-22에
// 지배값(conservative/neutral/aggressive) 자체가 타입에서 제거되어 애초에 이 사고를
// 일으킬 값이 없다. 나머지 세 축은 완전 Record를 유지해야 해서(모든 키가 값을 가져야 한다)
// "우연히 baseline과 같은 값"이라 안전할 뿐 타입이 강제하지 않는다. 조용한 네 번째 사고는
// 여기서 잡는다.
const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
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

describe("'ai_*' 센티널은 baseline과 동일하다", () => {
  test('목표 우선순위: ai_recommended 가중치가 기본 가중치와 같다', () => {
    // 달라지면 "목표를 정하지 않았다"가 조용히 특정 목표로 채점된다.
    expect(OBJECTIVE_WEIGHT_PRESETS.ai_recommended).toEqual(DEFAULT_UTILITY_CONFIG.weights);
  });

  test('국민연금: ai_optimized 개시 나이가 normal(정상 개시)과 같다', () => {
    // 여기에 다른 나이가 들어가면 "AI 최적화"를 고른 것만으로 수령 시점이 이동한다.
    expect(NATIONAL_PENSION_STRATEGY_AGES.ai_optimized)
      .toBe(NATIONAL_PENSION_STRATEGY_AGES.normal);
    expect(NATIONAL_PENSION_STRATEGY_AGES.ai_optimized).toBe(NATIONAL_PENSION_NORMAL_START_AGE);
  });

  test('사적연금: ai_optimized는 null 센티널이라 어떤 저수준 값도 정하지 않는다', () => {
    // limitToTaxLimit이 null이어야 고급 설정에서 켜고 끈 값이 살아남는다.
    expect(resolvePrivatePensionTaxLimitOverride('ai_optimized')).toBeNull();

    // withdrawalRatio도 null이어야 월 인출 목표 키가 아예 생기지 않는다.
    const r = compileStrategy(withStrategy({ privatePensionStrategy: 'ai_optimized' }));
    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget).toBeUndefined();
  });

  test('경제 시나리오: ai_recommended는 프로필이 없다', () => {
    expect(resolveEconomicScenarioProfile('ai_recommended')).toBeNull();
    expect(resolveEconomicScenarioProfile('recession')).not.toBeNull();
  });

  test('다섯 축 모두 ai_*인 전략은 저수준 파라미터를 baseline대로만 채운다', () => {
    // DEFAULT_RETIREMENT_STRATEGY 자체가 다섯 축 중 넷을 'ai_*'로 둔다. 어느 한 축이라도
    // 매핑 테이블에 값이 생기면 사용자가 직접 입력한 값이 여기서 어긋난다.
    const params = withStrategy({});
    params.inflationRate = 3.7;
    params.taxSettings = { ...params.taxSettings, limitPrivatePensionToTaxLimit: true } as never;

    const r = compileStrategy(params);

    expect(r.params.inflationRate).toBe(3.7);
    expect(r.params.exchangeScenario).toBe('base');
    expect(r.params.yieldPreset).toBeUndefined();
    expect(r.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(true);
    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget).toBeUndefined();
    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(NATIONAL_PENSION_NORMAL_START_AGE);
    expect(r.utilityConfig.weights).toEqual(DEFAULT_UTILITY_CONFIG.weights);
  });
});
