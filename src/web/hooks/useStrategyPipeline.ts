'use client';

import { useDeferredValue, useMemo } from 'react';
import { SimulationParams, SimulationResult, StrategyRecommendation } from '../../core/entities/types';
import { LegacySimulationEngine } from '../../core/simulation/LegacySimulationEngine';
import { CompiledStrategy, compileStrategy } from '../../core/usecases/strategy/compileStrategy';
import { LegacyRecommendationEngine } from '../../core/recommendation/LegacyRecommendationEngine';
import { SentinelApplication, applyAiSentinels } from '../../core/usecases/strategy/applyAiSentinels';
import { useBackgroundValue } from './useBackgroundValue';
import { simulateLegacyConfig } from '../../core/application/simulateLegacyConfig';

export interface StrategyPipeline {
  // 사용자 입력을 컴파일한 것. AI 센티널은 아직 baseline으로 내려가 있다.
  compiled: CompiledStrategy;
  // 센티널 자동 채움까지 끝나 engine.run에 실제로 들어간 것.
  effective: CompiledStrategy;
  // 무엇을 자동으로 채웠는지. 표시 계층이 "이미 반영됨"을 판정하는 단일 소스다.
  sentinels: SentinelApplication;
  recommendation: StrategyRecommendation | undefined;
  // 추천이 없는 이유가 "계산 실패"인지 "개선 여지 없음"인지 구분한다. 후자는
  // recommendStrategy가 improved:false인 정상 객체를 반환하므로 undefined가 되지 않는다.
  recommendationFailed: boolean;
  // 추천이 아직 최신 입력을 따라잡지 못한 상태. "탐색 중" 표시에 쓴다.
  isComputingRecommendation: boolean;
  result: SimulationResult;
}

// 시뮬레이터 화면의 계산 파이프라인.
//
//   params → compiled ─┬─→ (한 커밋 지연) → legacy recommendStrategy → recommendation
//                      └─→ applyAiSentinels(compiled, recommendation) → effective → engine.run
//
// page.tsx 본문이 아니라 훅으로 뽑은 이유는 아래 불변식을 테스트로 고정하기 위해서다.
// page.tsx는 1000줄이 넘고 세션·시나리오·PDF·차트에 얽혀 있어 통째로 렌더하는 테스트를
// 붙이기 어려웠고, 그래서 이 파이프라인의 핵심 불변식이 오래 무검증 상태였다.
//
// **불변식: legacy recommendStrategy의 입력은 언제나 센티널 미적용 compiled다.**
//
// 주의: 이 훅의 recommendation은 `StrategyOptimizer`의 목표 기반 페르소나 추천과
// 다른 결과다. 새 optimizer 결과는 AnalysisRuntime의 strategyOptimization으로 별도
// 전달된다. 두 결과를 같은 추천으로 합치려면 저장·적용·PDF 경로를 함께 전환해야 한다.
// 자동 보완 계약: applyAiSentinels는 사용자가 미지정으로 둔 축만 채운다. 사용자가 직접
// 설정한 값은 legacy 추천과 optimizer 추천 어느 쪽도 덮어쓰지 않는다.
//
// effective를 넘기면 "적용 → 그 위에서 재추천 → 다시 적용"이 되어 개시 나이가 렌더마다
// 밀려 올라가는 되먹임 루프가 생긴다. 단위 테스트로는 잡히지 않는다 — applyAiSentinels가
// 입력을 변형하지 않는다는 것만 증명할 뿐, 배선이 무엇을 넘기는지는 증명하지 못한다.
// useStrategyPipeline.test.tsx가 recommendStrategy에 실제로 넘어간 params를 검사한다.
export function useStrategyPipeline(
  params: SimulationParams,
  engine: LegacySimulationEngine
): StrategyPipeline {
  // 빠른 타이핑 중 메인 스레드를 막지 않도록 파라미터를 미룬다.
  const deferredParams = useDeferredValue(params);

  // 전략(사용자 언어)을 저수준 파라미터로 컴파일한 뒤 엔진에 넘긴다.
  // strategy가 없는 기존 시나리오는 compileStrategy가 입력을 그대로 통과시킨다.
  const compiled = useMemo(() => compileStrategy(deferredParams), [deferredParams]);

  // AI 추천 전략은 다수의 후보를 시뮬레이션하는(최악 218개) 이 화면에서 가장 무거운 계산이라,
  // 아래 engine.run과 같은 렌더 패스에서 돌면 안 된다. useBackgroundValue가 compiled를 한 커밋
  // 뒤로 미뤄 트랜지션(비긴급) 우선순위에서 계산하게 하고, 아직 따라잡지 못한 렌더를
  // "탐색 중" 로딩 상태로 노출한다.
  //
  // 예전에는 useDeferredValue를 연쇄해 이것을 만들려 했지만 그 방식으로는 2단이 되지 않는다
  // (React 19의 updateDeferredValueImpl은 이미 비긴급 렌더이면 새 값을 그대로 반환한다).
  // 그래서 로딩 상태가 영구히 false였고, 추천 계산은 실제로는 result와 같은 패스에서 돌았다.
  // 자세한 근거는 useBackgroundValue와 그 테스트 참조.
  //
  // 원본 params가 아니라 compiled를 미루는 이유: compileStrategy가 같은 입력에 대해 두 번
  // 실행되지 않는다(예전에는 두 개의 useMemo가 결국 같은 params를 각자 컴파일했다).
  //
  // 여기에 effective를 넘기면 안 된다 — 위 불변식 참고.
  const [recommendationCompiled, isComputingRecommendation] = useBackgroundValue(compiled);
  const recommendationEngine = useMemo(() => new LegacyRecommendationEngine(engine), [engine]);

  const { recommendation, recommendationFailed } = useMemo(() => {
    try {
      return {
        recommendation: recommendationEngine.recommendLegacyConfig(
          recommendationCompiled.params,
          recommendationCompiled.utilityConfig
        ),
        recommendationFailed: false,
      };
    } catch (err) {
      console.error('Failed to compute strategy recommendation', err);
      return { recommendation: undefined, recommendationFailed: true };
    }
  }, [recommendationEngine, recommendationCompiled]);

  // 미정으로 남은 센티널 축을 추천값으로 채운다. 사용자 params는 그대로 두고 계산에만
  // 반영하므로, 추천의 입력(compiled)과 시뮬레이션의 입력(effective)이 분리된다.
  const sentinels = useMemo(
    () => applyAiSentinels(compiled, recommendation),
    [compiled, recommendation]
  );
  const effective = sentinels.compiled;

  // cfg를 넘겨야 대시보드 헤드라인 효용 점수(result.utility)가 사용자가 고른 목표 우선순위를
  // 반영한다 — 생략하면 항상 기본 가중치로 계산되어 목표 우선순위를 아무리 바꿔도 점수가 그대로다.
  // engine.run에는 try/catch를 두지 않는다. 예외는 simulator/error.tsx(App Router 에러
  // 바운더리)가 받는다.
  //
  // "직전 성공 결과를 폴백으로 유지" 방식을 검토했지만 택하지 않았다. (1) 그러려면 렌더 간
  // 살아남는 가변 캐시를 렌더 중에 갱신해야 하는데 이 저장소의 lint 규칙(react-hooks/refs)이
  // 정당하게 금지한다. 상태로 대신하면 이 화면에서 가장 무거운 렌더가 매번 한 번 더 돈다.
  // (2) 더 중요하게는, 살아 있는 설정 패널 옆에 옛 결과를 보여주는 것 자체가 "화면이 말하는
  // 값과 엔진이 실제로 쓴 값이 다른" 상태다 — 이 브랜치가 반복해서 제거해 온 결함 유형이다.
  // recommendStrategy의 try/catch와 비대칭인 것도 의도적이다: 그쪽 실패는 부분적이고
  // (나머지 대시보드는 여전히 옳다) 전용 "계산하지 못했습니다" 상태가 있지만,
  // engine.run이 실패하면 진실하게 보여줄 결과가 하나도 없다.
  const result = useMemo(
    () => simulateLegacyConfig(engine, effective.params, effective.utilityConfig),
    [engine, effective.params, effective.utilityConfig]
  );

  return {
    compiled,
    effective,
    sentinels,
    recommendation,
    recommendationFailed,
    isComputingRecommendation,
    result,
  };
}
