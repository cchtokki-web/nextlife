import { describe, test, expect } from 'vitest';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { OBJECTIVE_WEIGHT_PRESETS } from '@/core/usecases/strategy/objectivePresets';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { RetirementStrategy, SimulationParams } from '@/core/entities/types';

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

describe('compileStrategy', () => {
  test('strategy가 없으면 params를 그대로 통과시키고 기본 UtilityConfig를 반환한다', () => {
    const result = compileStrategy(baseParams);

    expect(result.params).toEqual(baseParams);
    expect(result.utilityConfig).toEqual(DEFAULT_UTILITY_CONFIG);
  });

  test('목표 우선순위가 UtilityConfig.weights로 번역된다', () => {
    const result = compileStrategy(withStrategy({ objective: 'tax_minimization' }));

    expect(result.utilityConfig.weights).toEqual(OBJECTIVE_WEIGHT_PRESETS.tax_minimization);
    // weights 외 나머지 설정(appropriateBequestMonths 등)은 기본값을 유지한다.
    expect(result.utilityConfig.appropriateBequestMonths)
      .toBe(DEFAULT_UTILITY_CONFIG.appropriateBequestMonths);
  });

  test('상속 전략 "모두 사용"은 targetBequest를 0으로 만든다', () => {
    const result = compileStrategy(withStrategy({ bequestStrategy: 'spend_all' }));

    expect(result.params.userProfile.targetBequest).toBe(0);
  });

  test('상속 전략 "일부 남기기"는 월생활비 * 24를 targetBequest로 설정한다', () => {
    const result = compileStrategy(withStrategy({ bequestStrategy: 'leave_some' }));

    expect(result.params.userProfile.targetBequest).toBe(3000000 * 24);
  });

  test('상속 전략 "최대 상속"은 targetBequest를 미지정으로 남긴다', () => {
    const params = withStrategy({ bequestStrategy: 'maximize' });
    params.userProfile = { ...params.userProfile, targetBequest: 999 };

    const result = compileStrategy(params);

    expect(result.params.userProfile.targetBequest).toBeUndefined();
  });

  test('상속 전략 "목표 금액 유지"는 사용자가 입력한 targetBequest를 보존한다', () => {
    const params = withStrategy({ bequestStrategy: 'target_amount' });
    params.userProfile = { ...params.userProfile, targetBequest: 123456789 };

    const result = compileStrategy(params);

    expect(result.params.userProfile.targetBequest).toBe(123456789);
  });

  test('생활비 전략 "AI 추천"은 엔진 값 target으로 내려간다', () => {
    const result = compileStrategy(withStrategy({ spendingChoice: 'ai' }));

    expect(result.params.spendingStrategy).toBe('target');
    // 사용자가 무엇을 골랐는지는 strategy 쪽에 그대로 남아야 한다.
    expect(result.params.strategy?.spendingChoice).toBe('ai');
  });

  test('생활비 전략 "배당금만 소비"는 그대로 엔진 값이 된다', () => {
    const result = compileStrategy(withStrategy({ spendingChoice: 'dividend_only' }));

    expect(result.params.spendingStrategy).toBe('dividend_only');
  });

  test('알 수 없는 enum 값이 들어와도 던지지 않고 baseline으로 폴백한다', () => {
    // 저장된 옛 시나리오에 없어진 enum 값이 남아 있어도 화면이 죽으면 안 된다.
    const params = withStrategy({});
    (params.strategy as RetirementStrategy).objective = 'nonexistent' as never;

    expect(() => compileStrategy(params)).not.toThrow();
    expect(compileStrategy(params).utilityConfig.weights).toEqual(DEFAULT_UTILITY_CONFIG.weights);
  });

  test('입력 params 객체를 변형하지 않는다 (순수 함수)', () => {
    const params = withStrategy({ bequestStrategy: 'spend_all' });
    const snapshot = JSON.parse(JSON.stringify(params));

    compileStrategy(params);

    expect(params).toEqual(snapshot);
  });
});
