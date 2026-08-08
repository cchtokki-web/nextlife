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

  test('알 수 없는 생활비 전략 값이 들어와도 던지지 않고 baseline(target)으로 폴백한다', () => {
    // 저장된 옛 시나리오에 없어진 enum 값이 남아 있어도 화면이 죽으면 안 된다.
    const params = withStrategy({});
    (params.strategy as RetirementStrategy).spendingChoice = 'nonexistent' as never;

    expect(() => compileStrategy(params)).not.toThrow();
    expect(compileStrategy(params).params.spendingStrategy).toBe('target');
  });

  test('알 수 없는 상속 전략 값이 들어와도 던지지 않고 targetBequest가 미지정으로 폴백한다', () => {
    // 저장된 옛 시나리오에 없어진 enum 값이 남아 있어도 화면이 죽으면 안 된다.
    const params = withStrategy({});
    (params.strategy as RetirementStrategy).bequestStrategy = 'nonexistent' as never;

    expect(() => compileStrategy(params)).not.toThrow();
    expect(compileStrategy(params).params.userProfile.targetBequest).toBeUndefined();
  });

  test('입력 params 객체를 변형하지 않는다 (순수 함수)', () => {
    const params = withStrategy({ bequestStrategy: 'spend_all' });
    const snapshot = JSON.parse(JSON.stringify(params));

    compileStrategy(params);

    expect(params).toEqual(snapshot);
  });
});

describe('compileStrategy - 연령대별 생활비 곡선', () => {
  // 소비 성향·안전마진은 「평생 소비 최적화」 전용 하위 입력이다. 아래 픽스처들이
  // spendingChoice를 함께 주는 것은 편의가 아니라 그 조건 자체를 테스트하는 것이다.
  const withLifetimeMode = (patch: Partial<RetirementStrategy>): SimulationParams =>
    withStrategy({ spendingChoice: 'max_sustainable', ...patch });

  test("기본값('flat')은 spendingCurve 키 자체를 만들지 않는다", () => {
    // 기본 전략으로 컴파일해도 결과가 안 바뀐다는 불변식. 키가 남으면 곡선 코드 경로를
    // 타게 되고, `{ spendingCurve: undefined }`는 JSON 직렬화에서 "키가 없는 것"과 달라
    // useScenarios의 dirty 비교가 흔들린다.
    const result = compileStrategy(withStrategy({}));

    expect('spendingCurve' in result.params).toBe(false);
  });

  test('활동기 집중형은 감소하는 배수 곡선으로 해소된다', () => {
    const result = compileStrategy(withLifetimeMode({ spendingShape: 'front_loaded' }));
    const curve = result.params.spendingCurve!;

    expect(curve.multipliers[0]).toBeGreaterThan(curve.multipliers[curve.multipliers.length - 1]);
    expect(curve.multipliers.length).toBe(curve.breakpointAges.length + 1);
  });

  test('평생 소비 최적화가 아니면 소비 성향을 골라 두었어도 곡선이 생기지 않는다', () => {
    // 화면(RetirementGoalSection)이 소비 성향 입력을 max_sustainable에서만 보여주므로,
    // 컴파일도 같은 조건이어야 한다. 어긋나면 되돌릴 수 없는 유령 상태가 된다: 평생 소비
    // 최적화에서 활동기 집중형을 고른 뒤 「목표 생활비 유지」로 되돌리면, 입력은 화면에서
    // 사라지지만 60대 목표는 계속 1.2배로 계산되고 그 설정을 볼 방법이 없다.
    for (const choice of ['target', 'ai', 'dividend_only'] as const) {
      const result = compileStrategy(withStrategy({
        spendingChoice: choice,
        spendingShape: 'front_loaded',
      }));

      expect('spendingCurve' in result.params).toBe(false);
    }
  });
});

describe('compileStrategy - 상속 안전마진', () => {
  const withTarget = (patch: Partial<RetirementStrategy>): SimulationParams => ({
    ...withStrategy({
      bequestStrategy: 'target_amount',
      spendingChoice: 'max_sustainable',
      ...patch,
    }),
    userProfile: { ...baseParams.userProfile, targetBequest: 100_000_000 },
  });

  test('마진은 엔진 하한선만 부풀리고 채점 기준은 건드리지 않는다', () => {
    // assetFloor(엔진 제약)와 targetBequest(채점 기준)의 역할 구분을 지킨다.
    // 채점까지 올리면 여유를 크게 잡을수록 "적정선을 못 채웠다"로 읽혀 상속 점수가
    // 낮아지는 반대 방향 압력이 생긴다.
    const result = compileStrategy(withTarget({ bequestSafetyMarginRate: 20 }));

    expect(result.params.assetFloor).toBe(120_000_000);
    expect(result.params.userProfile.targetBequest).toBe(100_000_000);
  });

  test('마진 0은 기존 동작과 같다', () => {
    const withoutMargin = compileStrategy(withTarget({}));
    const zeroMargin = compileStrategy(withTarget({ bequestSafetyMarginRate: 0 }));

    expect(withoutMargin.params.assetFloor).toBe(100_000_000);
    expect(zeroMargin.params.assetFloor).toBe(100_000_000);
  });

  test('상속 전략이 target_amount가 아니면 마진을 줘도 하한선이 생기지 않는다', () => {
    // 마진은 "지켜야 할 금액"에 붙는 것이라 지킬 금액이 없으면 의미가 없다.
    const result = compileStrategy(withStrategy({
      bequestStrategy: 'leave_some',
      bequestSafetyMarginRate: 20,
    }));

    expect('assetFloor' in result.params).toBe(false);
  });

  test('평생 소비 최적화가 아니면 마진을 줘도 하한선이 부풀지 않는다', () => {
    // 곡선과 같은 이유다. 다만 하한선 자체(= 목표 상속자산)는 모든 전략에서 유효하므로,
    // 마진만 빠지고 하한선은 남아야 한다 — 통째로 지우면 상속 목표가 사라진다.
    const result = compileStrategy({
      ...withStrategy({
        bequestStrategy: 'target_amount',
        spendingChoice: 'target',
        bequestSafetyMarginRate: 20,
      }),
      userProfile: { ...baseParams.userProfile, targetBequest: 100_000_000 },
    });

    expect(result.params.assetFloor).toBe(100_000_000);
  });

  test('음수 마진은 하한선을 낮추지 않는다', () => {
    const result = compileStrategy(withTarget({ bequestSafetyMarginRate: -50 }));

    expect(result.params.assetFloor).toBe(100_000_000);
  });
});
