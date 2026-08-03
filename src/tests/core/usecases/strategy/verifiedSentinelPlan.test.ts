import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { getIdentityPlan } from '@/core/usecases/strategy/StrategyCandidateGenerator';
import {
  SENTINEL_AXES,
  buildVerifiedSentinelPlan,
  canFillSentinelAxis,
  paramsWithSentinelOverlay,
} from '@/core/usecases/strategy/verifiedSentinelPlan';
import { computeLifetimeUtility } from '@/core/usecases/utility/UtilityEngine';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { BaselineWithdrawalPlan, SentinelAxisField, SimulationParams } from '@/core/entities/types';
import { allAxesLiveParams } from '@/tests/fixtures/allAxesLiveParams';

// **다축 센티널의 검증 절차.**
//
// 예전에는 국민연금 개시 나이 "하나"만 자동으로 채웠고, 그 하나를 위해
// nationalPensionOnlyUtility라는 축 전용 필드를 StrategyRecommendation에 달아 뒀다.
// 축이 5개로 늘면 그런 필드가 5개 필요해진다 — 확장이 불가능한 형태다.
//
// ## 왜 "축별 게이트"만으로는 부족한가
//
// 효용은 축에 대해 가산적이지 않다. 각각 +1인 축 두 개를 합치면 −3이 될 수 있다
// (예: 국민연금을 늦추면서 일반자산 인출도 늦추면 그 사이 구간의 생활비가 무너진다).
// 그렇다고 조합만 검증하면 반대로 나쁜 축이 좋은 축에 업혀 들어간다.
//
// → 탐욕적 전진 선택: 단독 효과 내림차순으로 하나씩 얹으며, 결합 효용이 실제로 오르는
//   동안만 유지한다. 각 단계의 utility는 추정이 아니라 그 조합을 실제로 시뮬레이션한 값이다.
//   그래야 "검증됐다"는 말이 참이 된다.

const engine = new SimulationEngine();
const cfg = DEFAULT_UTILITY_CONFIG;

function compiledParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return compileStrategy({ ...allAxesLiveParams, ...overrides }).params;
}

function axisFor(field: SentinelAxisField) {
  const axis = SENTINEL_AXES.find((a) => a.field === field);
  if (!axis) throw new Error(`축 정의가 없다: ${field}`);
  return axis;
}

describe('canFillSentinelAxis — 무엇을 덮어써도 되는가', () => {
  test('전략을 저장한 적이 없고 저수준 값도 없으면 채운다', () => {
    // 설정 패널을 한 번도 열지 않은 가장 흔한 상태. 여기서 막으면 자동 채움이 통째로 꺼진다.
    const params: SimulationParams = { ...allAxesLiveParams };

    for (const axis of SENTINEL_AXES) {
      expect(canFillSentinelAxis(axis, params), `${axis.field}`).toBe(true);
    }
  });

  test('전략은 없지만 저수준 값이 저장돼 있으면 채우지 않는다', () => {
    // 전략 컴파일러 이전에 저장된 시나리오. 그 값은 사용자가 직접 정한 것이다.
    const params: SimulationParams = {
      ...allAxesLiveParams,
      withdrawalPlan: { nationalPensionStartAge: 70, assetSellOrderStrategy: 'high_dividend_first' },
    };

    expect(canFillSentinelAxis(axisFor('nationalPensionStartAge'), params)).toBe(false);
    expect(canFillSentinelAxis(axisFor('assetSellOrderStrategy'), params)).toBe(false);
    // 저장되지 않은 축은 여전히 비어 있다.
    expect(canFillSentinelAxis(axisFor('generalAssetWithdrawalStartAge'), params)).toBe(true);
  });

  test('전략 축이 ai_optimized면 컴파일된 값이 있어도 채운다', () => {
    // compileStrategy는 nationalPensionStartAge를 항상 채우므로 "값이 있는가"로 판정하면
    // 센티널을 고른 사용자에게 자동 채움이 영영 동작하지 않는다.
    const params = compiledParams({
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' },
    });

    expect(params.withdrawalPlan?.nationalPensionStartAge).toBeDefined();
    expect(canFillSentinelAxis(axisFor('nationalPensionStartAge'), params)).toBe(true);
  });

  test('전략 축이 확정값이면 채우지 않는다', () => {
    const params = compiledParams({
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'defer_max' },
    });

    expect(canFillSentinelAxis(axisFor('nationalPensionStartAge'), params)).toBe(false);
  });

  test('사적연금 인출액도 전략 축을 따른다', () => {
    const aiParams = compiledParams({
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, privatePensionStrategy: 'ai_optimized' },
    });
    const fixedParams = compiledParams({
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, privatePensionStrategy: 'tax_first' },
    });

    expect(canFillSentinelAxis(axisFor('privatePensionMonthlyTarget'), aiParams)).toBe(true);
    expect(canFillSentinelAxis(axisFor('privatePensionMonthlyTarget'), fixedParams)).toBe(false);
  });

  test('지배하는 전략 축이 없는 필드는 저장값이 없을 때만 채운다', () => {
    // 매도 순서·일반자산 인출 개시 나이는 UI도 전략 축도 없다. 전략을 저장했더라도
    // 이 축들은 여전히 "미정"이므로 채울 수 있어야 한다 — 그래야 두 축이 살아난다.
    const withStrategy = compiledParams({ strategy: DEFAULT_RETIREMENT_STRATEGY });

    expect(canFillSentinelAxis(axisFor('assetSellOrderStrategy'), withStrategy)).toBe(true);
    expect(canFillSentinelAxis(axisFor('generalAssetWithdrawalStartAge'), withStrategy)).toBe(true);

    const saved = { ...withStrategy, withdrawalPlan: { ...withStrategy.withdrawalPlan, generalAssetWithdrawalStartAge: 70 } };
    expect(canFillSentinelAxis(axisFor('generalAssetWithdrawalStartAge'), saved)).toBe(false);
  });

  test('생활비 배수는 센티널 축이 아니다', () => {
    // 자동으로 목표 생활비를 올리면 화면이 보여주는 목표와 엔진이 쓴 목표가 달라진다.
    // 추천으로는 제안하되(monthlySpendingMultiplier), 조용히 적용하지는 않는다.
    expect(SENTINEL_AXES.map((a) => a.field)).not.toContain('monthlySpendingMultiplier');
  });
});

describe('buildVerifiedSentinelPlan — 탐욕적 전진 선택', () => {
  const params = compiledParams({ strategy: DEFAULT_RETIREMENT_STRATEGY });
  const identityPlan = getIdentityPlan(params);
  const currentUtility = computeLifetimeUtility(engine.runForUtility(params), params, cfg);

  // 모든 축을 identity와 다르게 바꾼 "추천안". 실제 추천 결과와 무관하게 절차 자체를 검증한다.
  const recommendedPlan: BaselineWithdrawalPlan = {
    ...identityPlan,
    nationalPensionStartAge: 70,
    assetSellOrderStrategy: 'high_dividend_first',
    generalAssetWithdrawalStartAge: 70,
    isaMaturityDestination: 'asset',
    privatePensionMonthlyTarget: 2000000,
  };

  const steps = buildVerifiedSentinelPlan(params, identityPlan, recommendedPlan, currentUtility, engine, cfg);

  test('각 단계의 효용은 그 조합을 실제로 시뮬레이션한 값과 같다', () => {
    // 이것이 "검증된 오버레이"라는 주장의 전부다. 추정치를 실으면 화면이 계산하는 값과
    // 어긋나고, 그 어긋남은 사용자에게 "적용했더니 점수가 내려갔다"로 나타난다.
    expect(steps.length).toBeGreaterThan(0);

    for (const step of steps) {
      const overlayParams = paramsWithSentinelOverlay(params, step.planOverrides);
      const actual = computeLifetimeUtility(engine.runForUtility(overlayParams), overlayParams, cfg);

      expect(step.utility, `${step.field} 단계의 효용이 실측과 다르다`).toEqual(actual);
    }
  });

  test('효용은 단계마다 엄격히 증가하며 기준선보다 높다', () => {
    let previous = currentUtility.score;
    for (const step of steps) {
      expect(step.utility.score, `${step.field} 단계에서 효용이 오르지 않았다`).toBeGreaterThan(previous);
      previous = step.utility.score;
    }
  });

  test('오버레이는 누적된다 — 앞 단계의 축이 뒤 단계에도 남아 있다', () => {
    // 사슬이 누적되어야 화면이 "여기까지는 검증된 조합"이라고 앞에서부터 잘라 쓸 수 있다.
    steps.forEach((step, i) => {
      expect(Object.keys(step.planOverrides).length).toBe(i + 1);
      if (i > 0) {
        expect(step.planOverrides).toMatchObject(steps[i - 1].planOverrides);
      }
      expect(step.planOverrides[step.field]).toEqual(recommendedPlan[step.field]);
    });
  });

  test('채울 수 없는 축은 사슬에 등장하지 않는다', () => {
    // 국민연금을 사용자가 직접 정해 뒀다면 그 축은 후보에서 아예 빠져야 한다.
    const fixedAge = compiledParams({
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'defer_max' },
    });
    const fixedIdentity = getIdentityPlan(fixedAge);
    const fixedCurrent = computeLifetimeUtility(engine.runForUtility(fixedAge), fixedAge, cfg);

    const fixedSteps = buildVerifiedSentinelPlan(
      fixedAge, fixedIdentity, { ...recommendedPlan, nationalPensionStartAge: 60 }, fixedCurrent, engine, cfg
    );

    expect(fixedSteps.map((s) => s.field)).not.toContain('nationalPensionStartAge');
  });

  test('추천안이 identity와 같으면 사슬이 비어 있다', () => {
    const nothing = buildVerifiedSentinelPlan(params, identityPlan, identityPlan, currentUtility, engine, cfg);

    expect(nothing).toEqual([]);
  });
});

describe('paramsWithSentinelOverlay', () => {
  const params = compiledParams({ strategy: DEFAULT_RETIREMENT_STRATEGY });

  test('오버레이가 비어 있으면 params를 그대로 돌려준다', () => {
    // 참조가 바뀌면 화면의 하위 useMemo가 전부 무효화되어 가장 무거운 렌더가 다시 돈다.
    expect(paramsWithSentinelOverlay(params, {})).toBe(params);
  });

  test('지정한 축만 덮어쓰고 나머지 인출계획은 보존한다', () => {
    const overlaid = paramsWithSentinelOverlay(params, { nationalPensionStartAge: 70 });

    expect(overlaid.withdrawalPlan?.nationalPensionStartAge).toBe(70);
    expect(overlaid.withdrawalPlan?.isaMaturityDestination).toBe(params.withdrawalPlan?.isaMaturityDestination);
    expect(overlaid.userProfile).toEqual(params.userProfile);
  });

  test('값이 undefined인 축은 키 자체를 지운다', () => {
    // 엔진은 privatePensionMonthlyTarget이 "없을 때" 잔여 개월 균등분할로 동작한다.
    // undefined 값을 가진 키를 남기면 동작은 같아도 구조 비교·직렬화에서 차이가 생긴다.
    const withTarget = paramsWithSentinelOverlay(params, { privatePensionMonthlyTarget: 1000000 });
    const cleared = paramsWithSentinelOverlay(withTarget, { privatePensionMonthlyTarget: undefined });

    expect('privatePensionMonthlyTarget' in (cleared.withdrawalPlan ?? {})).toBe(false);
  });
});
