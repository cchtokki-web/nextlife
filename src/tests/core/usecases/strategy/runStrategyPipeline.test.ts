import { describe, test, expect, vi } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { runStrategyPipeline } from '@/core/usecases/strategy/runStrategyPipeline';
import { runCompiledScenario } from '@/core/usecases/strategy/runCompiledScenario';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import * as RecommendationEngine from '@/core/usecases/strategy/RecommendationEngine';
import { RetirementStrategy, SimulationParams } from '@/core/entities/types';
import { allAxesLiveParams } from '@/tests/fixtures/allAxesLiveParams';

// **화면 경로와 비교 경로가 같은 결과를 내야 한다.**
//
// 예전에는 두 곳이 각자 파이프라인을 조립했다. 비교 쪽(runCompiledScenario)은 컴파일까지만
// 하고 AI 센티널 자동 채움을 건너뛰었고, 그래서 **같은 시나리오를 복제해 나란히 놓아도 두
// 곡선이 다르게 그려졌다** — 활성 시나리오는 AI가 채운 값으로 돌고 비교 시나리오는
// baseline으로 돌기 때문이다.
//
// 자동 채움이 국민연금 나이 하나였을 때도 어긋났고, 다축으로 늘어난 지금은 그 간극이 더 크다.

const engine = new SimulationEngine();

const withStrategy = (overrides: Partial<RetirementStrategy> = {}): SimulationParams => ({
  ...allAxesLiveParams,
  strategy: { ...DEFAULT_RETIREMENT_STRATEGY, ...overrides },
});

describe('runStrategyPipeline', () => {
  test('센티널 자동 채움을 거친 결과를 돌려준다', () => {
    const pipeline = runStrategyPipeline(withStrategy(), engine);

    // 이 픽스처에서 자동 채움이 실제로 일어나야 아래 단언들이 의미를 갖는다.
    expect(pipeline.sentinels.appliedFields.length).toBeGreaterThan(0);

    const direct = engine.run(pipeline.effective.params, pipeline.effective.utilityConfig);
    expect(JSON.stringify(pipeline.result.yearlyResults)).toBe(JSON.stringify(direct.yearlyResults));
  });

  test('compiled는 센티널 미적용 상태로 남는다 (되먹임 방지)', () => {
    // 추천의 입력은 언제나 이 원본이어야 한다. 여기가 오염되면 "적용 → 재추천 → 다시 적용"이
    // 되어 개시 나이가 계산할 때마다 밀려 올라간다.
    const params = withStrategy();
    const pipeline = runStrategyPipeline(params, engine);
    const freshlyCompiled = compileStrategy(params);

    expect(pipeline.compiled.params).toEqual(freshlyCompiled.params);
  });

  test('recommendStrategy에는 센티널 미적용 params가 들어간다', () => {
    const spy = vi.spyOn(RecommendationEngine, 'recommendStrategy');
    try {
      const params = withStrategy();
      const expectedInput = compileStrategy(params).params;

      runStrategyPipeline(params, engine);

      expect(spy).toHaveBeenCalled();
      for (const call of spy.mock.calls) {
        expect(call[0]).toEqual(expectedInput);
      }
    } finally {
      spy.mockRestore();
    }
  });

  test('추천 계산이 실패해도 결과는 진짜 시뮬레이션이다', () => {
    const spy = vi.spyOn(RecommendationEngine, 'recommendStrategy').mockImplementation(() => {
      throw new Error('boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pipeline = runStrategyPipeline(withStrategy(), engine);

      expect(pipeline.recommendation).toBeUndefined();
      // 판단 근거가 없으므로 채우지 않는다 — 사용자 계획 그대로다.
      expect(pipeline.effective).toBe(pipeline.compiled);
      expect(pipeline.result.yearlyResults.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  });
});

describe('runCompiledScenario — 비교 시나리오', () => {
  test('센티널을 적용하면 파이프라인 결과와 일치한다', () => {
    const params = withStrategy();

    const compared = runCompiledScenario(engine, params, { applySentinels: true });
    const pipeline = runStrategyPipeline(params, engine);

    expect(JSON.stringify(compared.yearlyResults)).toBe(JSON.stringify(pipeline.result.yearlyResults));
    expect(compared.utility?.score).toBe(pipeline.result.utility?.score);
  });

  test('센티널을 적용하지 않으면 활성 시나리오와 어긋난다 (기본값의 대가)', () => {
    // 이 차이가 존재한다는 사실 자체를 고정한다. 없어지면 applySentinels 옵션도,
    // 그 비용을 감수하는 호출부의 판단도 근거를 잃는다.
    const params = withStrategy();

    const withoutSentinels = runCompiledScenario(engine, params);
    const withSentinels = runCompiledScenario(engine, params, { applySentinels: true });

    expect(withoutSentinels.yearlyResults.length).toBeGreaterThan(0);
    expect(JSON.stringify(withSentinels.yearlyResults))
      .not.toBe(JSON.stringify(withoutSentinels.yearlyResults));
  });

  test('센티널이 채울 것이 없는 시나리오에서는 두 경로가 같다', () => {
    // 모든 축을 확정값으로 고른 사용자에게는 자동 채움이 개입하지 않으므로,
    // 비교 카드가 옵션과 무관하게 같은 곡선을 그려야 한다.
    const params = withStrategy({
      nationalPensionStrategy: 'defer_max',
      privatePensionStrategy: 'tax_first',
      preferIsaFirst: 'pension_first',
    });
    const fixed: SimulationParams = {
      ...params,
      withdrawalPlan: { assetSellOrderStrategy: 'input_order', generalAssetWithdrawalStartAge: 61 },
    };

    const withoutSentinels = runCompiledScenario(engine, fixed);
    const withSentinels = runCompiledScenario(engine, fixed, { applySentinels: true });

    expect(JSON.stringify(withSentinels.yearlyResults))
      .toBe(JSON.stringify(withoutSentinels.yearlyResults));
  });
});
