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

  // **상속 전략은 배점을 바꾸지 않는다.**
  //
  // 「모두 사용」에서 이 축을 0점으로 만드는 안을 시도했다가 되돌렸다. 그때 이 축이 재는 것은
  // "상속을 잘 남겼는가"가 아니라 "다 쓰고 갔는가"이고, 미소진 자산을 잡는 축이 이것 하나뿐이다
  // (소비 만족도는 목표를 채우면 만점이라 안 쓰고 남긴 자산을 잡지 못한다). 배점을 걷어내자
  // 페르소나 하니스에서 "다 쓰고 간다"고 선언하고 46억을 남기는 계획의 효용이 10점 **올랐다**.
  // 대신 표시 이름만 바꾼다(buildUtilityComponentMeta).
  test.each(['spend_all', 'leave_some', 'maximize'] as const)(
    '상속 전략 %s은 효용 배점을 바꾸지 않는다',
    (bequestStrategy) => {
      const result = compileStrategy(withStrategy({ bequestStrategy }));

      expect(result.utilityConfig.weights).toEqual(DEFAULT_UTILITY_CONFIG.weights);
    }
  );

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

  // 「생활비 배분」은 이제 추천이 반영하고 「고급 / 전문가 설정」이 소유하는 축이다. 목표
  // 기반 계획은 언제나 spendingChoice 'target'이므로, 여기서 모드를 따지면 추천이 고른
  // 곡선이 계산에 닿지 못한다 — 카드가 곡선을 켠 확률을 보여 주고 적용하면 곡선 없는
  // 계획이 저장되던 결함이 정확히 그것이었다.
  test('목표 생활비 유지 모드에서도 소비 성향이 곡선으로 해소된다', () => {
    const result = compileStrategy(withStrategy({
      spendingChoice: 'target',
      spendingShape: 'care_heavy',
    }));
    const curve = result.params.spendingCurve!;

    expect(curve.multipliers[0]).toBeGreaterThan(curve.multipliers[curve.multipliers.length - 1]);
    expect(curve.multipliers.length).toBe(curve.breakpointAges.length + 1);
  });

  // 곡선 생성은 생활비 «모드»와 무관하다. 예전에는 max_sustainable에서만 만들었고, 그
  // 근거는 「소비 성향 입력이 그 모드에서만 화면에 보인다」였다. 지금은 ‹생활비 전략›
  // 섹션이 모든 모드에서 그 값을 보여 주므로 조건의 근거 자체가 사라졌다.
  test('생활비 모드와 무관하게 소비 성향이 곡선을 정한다', () => {
    for (const choice of ['target', 'ai', 'dividend_only', 'max_sustainable'] as const) {
      const result = compileStrategy(withStrategy({
        spendingChoice: choice,
        spendingShape: 'front_loaded',
      }));

      expect(result.params.spendingCurve, choice).toBeDefined();
    }
  });

  // 곡선을 고르지 않은 계획은 어떤 모드에서도 곡선 코드 경로를 타지 않아야 한다 —
  // 위 변경이 「모든 계획에 곡선이 생긴다」로 번지지 않았음을 고정한다.
  test("소비 성향이 'flat'이면 어떤 모드에서도 키가 생기지 않는다", () => {
    for (const choice of ['target', 'ai', 'dividend_only', 'max_sustainable'] as const) {
      const result = compileStrategy(withStrategy({ spendingChoice: choice, spendingShape: 'flat' }));

      expect('spendingCurve' in result.params, choice).toBe(false);
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

  // 예전 규칙은 "상속 목표를 고르지 않았으면 하한선을 건다"였다. 그래서 목표 화면에서
  // 상속을 고르지 않은 사용자가 가장 강한 인출 제약을 받았고, 화면에는 그 금액이 보이지
  // 않아 원인을 알 수 없었다.
  describe('상속 하한선은 고른 상속 목표에서만 나온다', () => {
    const withTargetAndGoals = (goals: SimulationParams['retirementGoals']): SimulationParams => ({
      ...withTarget({}),
      retirementGoals: goals,
    });

    test('목표 목록이 있는데 상속을 고르지 않았으면 하한선이 없다', () => {
      const result = compileStrategy(withTargetAndGoals([
        { type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' },
      ]));

      expect('assetFloor' in result.params).toBe(false);
      // 채점 기준(targetBequest)은 그대로 둔다 — 하한선은 인출 제약이고 이것은 목표액이다.
      expect(result.params.userProfile.targetBequest).toBe(100_000_000);
    });

    test('상속을 HARD로 골랐을 때만 하한선이 생긴다', () => {
      const hard = compileStrategy(withTargetAndGoals([
        { type: 'INHERITANCE', priority: 1, constraintType: 'HARD', targetValue: 100_000_000 },
      ]));
      const soft = compileStrategy(withTargetAndGoals([
        { type: 'INHERITANCE', priority: 1, constraintType: 'SOFT', targetValue: 100_000_000 },
      ]));

      expect(hard.params.assetFloor).toBe(100_000_000);
      expect('assetFloor' in soft.params).toBe(false);
    });

    test('목표를 한 번도 고른 적 없는 시나리오는 예전 동작을 유지한다', () => {
      // retirementGoals 키 자체가 없으면 목표 화면을 거친 적이 없다는 뜻이다.
      // 저장된 결과가 조용히 달라지면 안 된다.
      const result = compileStrategy(withTarget({}));

      expect(result.params.assetFloor).toBe(100_000_000);
    });
  });

  test('음수 마진은 하한선을 낮추지 않는다', () => {
    const result = compileStrategy(withTarget({ bequestSafetyMarginRate: -50 }));

    expect(result.params.assetFloor).toBe(100_000_000);
  });
});

// 배당 재투자 축. 저장은 자산별 boolean에 하고, 이 축은 «누가 그 값을 정하는가»만 말한다.
describe('compileStrategy - 배당 재투자', () => {
  const assets: SimulationParams['assets'] = [
    {
      id: 'a1', type: 'etf', ticker: 'A', name: 'A', quantity: 1, averagePrice: 1000,
      totalReturn: 7, dividendYield: 2, monthlyContribution: 0, reinvestDividend: true, currency: 'KRW',
    },
    {
      id: 'a2', type: 'etf', ticker: 'B', name: 'B', quantity: 1, averagePrice: 1000,
      totalReturn: 7, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW',
    },
  ];
  const withAssets = (patch: Partial<RetirementStrategy>): SimulationParams => ({
    ...withStrategy(patch), assets,
  });

  test("'reinvest_all'은 전 자산을 재투자로 실체화한다", () => {
    const result = compileStrategy(withAssets({ dividendStrategy: 'reinvest_all' }));
    expect(result.params.assets.map((a) => a.reinvestDividend)).toEqual([true, true]);
  });

  test("'cash_all'은 전 자산을 현금 수령으로 실체화한다", () => {
    const result = compileStrategy(withAssets({ dividendStrategy: 'cash_all' }));
    expect(result.params.assets.map((a) => a.reinvestDividend)).toEqual([false, false]);
  });

  // 여기서 덮어쓰면 저장된 자산별 값이 사라져 자동 채움의 기준선이 없어지고,
  // 전문가가 자산별로 정한 값도 조용히 뭉개진다.
  test("'ai_optimized'는 자산 배열을 손대지 않는다(참조까지 그대로)", () => {
    const params = withAssets({ dividendStrategy: 'ai_optimized' });
    const result = compileStrategy(params);

    expect(result.params.assets).toBe(params.assets);
  });

  test('미지정 전략도 기본값이 ai_optimized라 자산을 손대지 않는다', () => {
    const params = { ...baseParams, assets };
    expect(compileStrategy(params).params.assets).toBe(assets);
  });

  test('이미 전부 같은 값이면 배열을 새로 만들지 않는다', () => {
    const allTrue = assets.map((a) => ({ ...a, reinvestDividend: true }));
    const params = { ...withStrategy({ dividendStrategy: 'reinvest_all' }), assets: allTrue };

    expect(compileStrategy(params).params.assets).toBe(allTrue);
  });

  test('두 번 컴파일해도 결과가 같다', () => {
    const once = compileStrategy(withAssets({ dividendStrategy: 'cash_all' }));
    const twice = compileStrategy(once.params);

    expect(twice.params.assets).toEqual(once.params.assets);
  });
});
