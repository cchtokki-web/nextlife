import { SimulationParams, SimulationResult, StrategyRecommendation } from '../../entities/types';
import { LegacySimulationEngine } from '../../simulation/LegacySimulationEngine';
import { CompiledStrategy, compileStrategy } from './compileStrategy';
import { SentinelApplication, applyAiSentinels } from './applyAiSentinels';
import { LegacyRecommendationEngine } from '../../recommendation/LegacyRecommendationEngine';
import { simulateLegacyConfig } from '../../application/simulateLegacyConfig';

export interface StrategyPipelineResult {
  // 사용자 입력을 컴파일한 것. AI 센티널은 아직 baseline으로 내려가 있다.
  compiled: CompiledStrategy;
  // 계산 실패 시 undefined. 추천이 없어도 나머지 단계는 정상 진행된다.
  recommendation: StrategyRecommendation | undefined;
  // 무엇을 자동으로 채웠는지.
  sentinels: SentinelApplication;
  // 센티널 자동 채움까지 끝나 engine.run에 실제로 들어간 것.
  effective: CompiledStrategy;
  result: SimulationResult;
}

// 전략 파이프라인. 시뮬레이터 화면이 쓰는 계산 경로와 **같은 단계, 같은 순서**다.
//
//   params → compiled ─┬─→ recommendStrategy → recommendation
//                      └─→ applyAiSentinels(compiled, recommendation) → effective → engine.run
//
// ## 왜 필요한가
//
// 화면(useStrategyPipeline)과 시나리오 비교(runCompiledScenario)가 각자 파이프라인을 조립하다
// 어긋났다. 비교 쪽은 컴파일까지만 하고 센티널 자동 채움을 건너뛰었고, 그래서 **같은 시나리오를
// 복제해 나란히 놓아도 두 곡선이 다르게 그려졌다** — 활성 시나리오는 AI가 채운 값으로 돌고
// 비교 시나리오는 baseline으로 돌기 때문이다. 자동 채움이 국민연금 나이 하나였을 때도 어긋났고,
// 다축으로 늘어난 지금은 그 간극이 더 커졌다.
//
// **불변식: recommendStrategy의 입력은 언제나 센티널 미적용 compiled다.**
// effective를 넘기면 "적용 → 그 위에서 재추천 → 다시 적용"이 되어 개시 나이가 렌더마다
// 밀려 올라가는 되먹임 루프가 생긴다.
//
// ## 화면이 이 함수를 그대로 쓰지 않는 이유
//
// useStrategyPipeline은 같은 단계를 **나눠서** 실행한다. recommendStrategy가 이 앱에서 가장
// 무거운 계산(최대 218개 후보 시뮬레이션)이라 engine.run과 같은 렌더 패스에서 돌면 안 되고,
// 그래서 한 커밋 뒤로 미뤄 트랜지션 우선순위에서 계산한다. 그 지연은 React 훅으로만 표현할 수
// 있어 순수 함수로 내려올 수 없다.
//
// 대신 두 경로가 같은 결과를 낸다는 것을 테스트가 고정한다(runStrategyPipeline.test.ts).
export function runStrategyPipeline(
  params: SimulationParams,
  engine: LegacySimulationEngine
): StrategyPipelineResult {
  const compiled = compileStrategy(params);

  let recommendation: StrategyRecommendation | undefined;
  try {
    recommendation = new LegacyRecommendationEngine(engine)
      .recommendLegacyConfig(compiled.params, compiled.utilityConfig);
  } catch (err) {
    // 추천 실패는 부분적이다 — 나머지 계산은 여전히 옳으므로 여기서 던져 전체를 무효화하지 않는다.
    console.warn('Failed to compute strategy recommendation', err);
    recommendation = undefined;
  }

  const sentinels = applyAiSentinels(compiled, recommendation);
  const effective = sentinels.compiled;

  return {
    compiled,
    recommendation,
    sentinels,
    effective,
    result: simulateLegacyConfig(engine, effective.params, effective.utilityConfig),
  };
}
