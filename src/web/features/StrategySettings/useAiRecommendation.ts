'use client';

import { useMemo } from 'react';
import { SimulationParams, StrategyRecommendation } from '../../../core/entities/types';
import { SimulationEngine } from '../../../core/usecases/SimulationEngine';
import { compileStrategy } from '../../../core/usecases/strategy/compileStrategy';
import { recommendStrategy } from '../../../core/usecases/strategy/RecommendationEngine';

export interface AiRecommendationState {
  recommendation: StrategyRecommendation | null;
  error: string | null;
  // recommendation?.improved의 안전한 별칭. 섹션들이 매번 옵셔널 체이닝하지 않도록 미리 편다.
  improved: boolean;
}

// AI 추천을 params당 1회만 실행하고 결과를 캐시한다.
// 각 섹션의 [AI 추천] 버튼은 이 결과 중 자기 소관 필드만 적용한다 — 섹션마다 별도
// 최적화기를 두면 시뮬레이션 호출이 섹션 수만큼 늘어나기 때문이다.
//
// useMemo의 기본 의존성 비교는 참조 동일성이라, 내용이 같아도 매번 새 params 객체가
// 들어오면(부모 재렌더로 흔히 발생) recommendStrategy(최대 162개 후보 시뮬레이션)가
// 다시 돈다. JSON.stringify로 만든 내용 기반 키를 실제 의존성으로 써서, 참조만 바뀌고
// 내용은 같은 params에 대해서는 재계산을 건너뛴다 — 직렬화 비용은 시뮬레이션 대비 무시할
// 수준이다.
export function useAiRecommendation(params: SimulationParams): AiRecommendationState {
  const paramsKey = useMemo(() => JSON.stringify(params), [params]);

  return useMemo(() => {
    try {
      const compiled = compileStrategy(params);
      const engine = new SimulationEngine();
      const recommendation = recommendStrategy(compiled.params, engine, compiled.utilityConfig);
      return { recommendation, error: null, improved: recommendation.improved };
    } catch {
      // 추천 실패는 설정 화면 전체를 죽일 이유가 아니다. 버튼만 비활성화된다.
      return { recommendation: null, error: '추천을 계산하지 못했습니다.', improved: false };
    }
    // params 대신 paramsKey(내용 기반 문자열 키)를 의존성으로 쓴다. params를 그대로 넣으면
    // 참조가 바뀔 때마다(내용이 같아도) 재계산되어 이 훅의 목적(내용 기준 캐시)이 무효화된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);
}
