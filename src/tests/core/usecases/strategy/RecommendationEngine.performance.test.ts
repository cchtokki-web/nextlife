import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { recommendStrategy } from '@/core/usecases/strategy/RecommendationEngine';
import { allAxesLiveParams as worstCaseParams } from '@/tests/fixtures/allAxesLiveParams';

// StrategyCandidateGenerator의 최악 시나리오(216개 후보, StrategyCandidateGenerator.test.ts 참고)에서
// recommendStrategy가 브라우저 실시간 처리에 부적합할 만큼 느려지지 않는지 검증하는 성능 회귀 가드.
// runForUtility() 도입 전(각 후보마다 run()의 findMaxSustainableValue 30회 이진탐색까지 포함)에는
// 이 시나리오가 수 초 이상 걸렸다.
//
// 픽스처는 strategyAxisDelta 테스트와 공유한다 — 둘 다 "모든 전략 차원이 살아 있는
// 파라미터"를 필요로 하고, 조건이 어긋나면 두 테스트가 서로 다른 것을 재게 된다.

describe('recommendStrategy - 성능 회귀 가드', () => {
  test('최악 시나리오(216개 후보)에서도 5초 이내에 완료된다', () => {
    const engine = new SimulationEngine();

    const start = performance.now();
    const recommendation = recommendStrategy(worstCaseParams, engine);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(5000);
    expect(recommendation.recommendedUtility.score).toBeGreaterThanOrEqual(recommendation.currentUtility.score);
  });
});
