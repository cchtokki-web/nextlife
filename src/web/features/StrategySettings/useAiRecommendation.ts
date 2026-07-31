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
export function useAiRecommendation(params: SimulationParams): AiRecommendationState {
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
  }, [params]);
}
