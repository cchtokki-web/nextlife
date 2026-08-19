import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { SimulationParams } from '@/core/entities/types';
import * as RecommendationEngine from '@/core/usecases/strategy/RecommendationEngine';
import { useStrategyPipeline } from '@/web/hooks/useStrategyPipeline';

// 자동 채움이 실제로 일어나는 픽스처. 국민연금이 충분히 커야 개시 나이 축에 최적화 여지가
// 생기고, 그래야 "추천이 도착한 뒤 무엇이 recommendStrategy로 다시 들어가는가"를 볼 수 있다.
const sentinelParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1000, averagePrice: 100000,
      totalReturn: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 2500000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
  strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' },
};

describe('useStrategyPipeline', () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(RecommendationEngine, 'recommendStrategy');
  });

  afterEach(() => {
    spy.mockRestore();
  });

  test('센티널을 자동으로 채워 시뮬레이션에 반영한다', async () => {
    const engine = new SimulationEngine();
    const { result } = renderHook(() => useStrategyPipeline(sentinelParams, engine));

    // 자동 채움은 추천이 도착한 뒤(한 커밋 지연) 일어난다.
    await waitFor(() => {
      expect(result.current.sentinels.appliedValues.nationalPensionStartAge).toBeDefined();
    });

    const appliedAge = result.current.sentinels.appliedValues.nationalPensionStartAge;
    expect(result.current.effective.params.withdrawalPlan?.nationalPensionStartAge).toBe(appliedAge);
    // compiled는 건드리지 않는다 — 센티널은 baseline(65세)으로 남아 있어야 한다.
    expect(result.current.compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(65);
  });

  // 이 저장소가 오래 검증하지 못한 불변식이다. applyAiSentinels의 단위 테스트는 "함수가 입력을
  // 변형하지 않는다"만 증명하고, 배선이 recommendStrategy에 무엇을 넘기는지는 증명하지 못한다.
  // useBackgroundValue(compiled)를 effective로 바꾸면 개시 나이가 렌더마다 밀려 올라가는
  // 되먹임 루프가 생기는데, 그 변경으로 이 테스트가 실패해야 한다.
  test('recommendStrategy의 입력은 언제나 센티널 미적용 params다(되먹임 방지)', async () => {
    const engine = new SimulationEngine();
    const { result } = renderHook(() => useStrategyPipeline(sentinelParams, engine));

    await waitFor(() => {
      expect(result.current.sentinels.appliedValues.nationalPensionStartAge).toBeDefined();
    });

    const appliedAge = result.current.sentinels.appliedValues.nationalPensionStartAge;
    expect(spy).toHaveBeenCalled();

    // 지금까지의 모든 호출을 검사한다. 한 번이라도 채워진 값이 들어갔다면 그 시점부터
    // 되먹임이 시작된 것이다.
    //
    // 되먹임에는 두 모양이 있고 이 테스트가 둘 다 잡는다.
    //   수렴형 — 나이가 70(최대 연기)에서 멈춘다. 렌더는 끝나지만 추천이 이미 적용된 값
    //            위에서 계산되므로 아래 나이 단언이 실패한다.
    //   발산형 — 렌더가 멈추지 않는다. 되먹임이 시작되려면 채워진 값이 최소 한 번
    //            recommendStrategy로 들어가야 하므로 대개 아래 나이 단언이 먼저 잡고,
    //            그마저 놓치면 바로 아래 호출 횟수 상한이 1차 방어선이다. 타임아웃은
    //            그 둘이 모두 실패했을 때의 최후 폴백이지 주된 감지기가 아니다.

    // 이 픽스처에 검증력이 있으려면 채워진 값이 65와 달라야 한다.
    expect(appliedAge).not.toBe(65);

    for (const call of spy.mock.calls) {
      const passed = call[0] as SimulationParams;
      // `?? 65` 폴백을 두면 필드가 통째로 사라지는 회귀에도 통과한다. compiled는
      // 'ai_optimized'에서 65를 명시적으로 넣으므로 폴백이 발동할 일이 없다.
      expect(passed.withdrawalPlan?.nationalPensionStartAge).toBe(65);
    }

    // 호출 횟수도 묶어 둔다. 되먹임이 아니어도 파이프라인이 스스로를 재촉발하면 이 화면에서
    // 가장 무거운 계산이 조용히 여러 번 돈다. 정상 경로는 compiled 한 번 + 배경 승격 한 번이다.
    expect(spy.mock.calls.length).toBeLessThanOrEqual(4);
  });

  test('추천 계산이 실패해도 시뮬레이션은 baseline으로 계속 돌고 실패를 알린다', async () => {
    const engine = new SimulationEngine();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    spy.mockImplementation(() => { throw new Error('boom'); });

    const { result } = renderHook(() => useStrategyPipeline(sentinelParams, engine));

    await waitFor(() => expect(result.current.recommendationFailed).toBe(true));

    expect(result.current.recommendation).toBeUndefined();
    // 판단 근거가 없으므로 채우지 않는다 — 사용자 계획 그대로다.
    expect(result.current.sentinels.appliedValues.nationalPensionStartAge).toBeUndefined();
    expect(result.current.effective).toBe(result.current.compiled);
    // 결과는 여전히 진짜 시뮬레이션이다(빈 화면이 되지 않는다).
    expect(result.current.result.yearlyResults.length).toBeGreaterThan(0);

    consoleError.mockRestore();
  });

  test('result는 compiled가 아니라 effective로 계산한다(표시 == 실제)', async () => {
    const engine = new SimulationEngine();
    const { result } = renderHook(() => useStrategyPipeline(sentinelParams, engine));

    await waitFor(() => {
      expect(result.current.sentinels.appliedValues.nationalPensionStartAge).toBeDefined();
    });

    const { effective, compiled } = result.current;
    expect(effective).not.toBe(compiled);

    const fromEffective = engine.run(effective.params, effective.utilityConfig);
    const fromCompiled = engine.run(compiled.params, compiled.utilityConfig);

    // 두 결과가 실제로 다른 픽스처여야 이 단언에 검증력이 있다.
    expect(JSON.stringify(fromEffective.yearlyResults))
      .not.toBe(JSON.stringify(fromCompiled.yearlyResults));
    expect(JSON.stringify(result.current.result.yearlyResults))
      .toBe(JSON.stringify(fromEffective.yearlyResults));
  });
});
