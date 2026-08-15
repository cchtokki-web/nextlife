import { LegacySimulationAdapter } from '../../core/domain/input/LegacySimulationAdapter';
import { LegacySimulationEngine } from '../../core/simulation/LegacySimulationEngine';
import { StrategyOptimizer } from '../../core/strategy/StrategyOptimizer';
import { MonteCarloEngine } from '../../core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '../../core/usecases/montecarlo/volatilityPresets';
import {
  parseOptimizationRequest,
  type StrategyOptimizationResponse,
} from './strategyOptimizationProtocol';

let optimizer: StrategyOptimizer | undefined;

// 예전에는 모듈 최상단에서 엔진을 만들었다. 생성자가 던지면 self.onmessage가 아예 설치되지
// 않고, 메인 스레드는 응답도 에러도 받지 못한 채 영원히 "검증 중" 스피너를 돌린다.
// 생성을 요청 처리 안으로 미뤄 실패가 kind:'error' 응답으로 나가게 한다.
function getOptimizer(): StrategyOptimizer {
  if (!optimizer) {
    const engine = new LegacySimulationEngine();
    optimizer = new StrategyOptimizer(
      engine,
      undefined,
      undefined,
      new MonteCarloEngine(engine),
    );
  }
  return optimizer;
}

self.onmessage = (event: MessageEvent<unknown>) => {
  // 구조화 복제는 어떤 값이든 전달하므로 MessageEvent<T>의 T는 런타임 보장이 아니다.
  // 형식이 맞지 않는 메시지는 requestId를 알 수 없어 응답해도 버려지므로 조용히 무시한다.
  const request = parseOptimizationRequest(event.data);
  if (!request) return;

  const { requestId, params } = request;

  try {
    const input = LegacySimulationAdapter.fromLegacy(params);
    const result = getOptimizer().optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: {
        config: resolveMonteCarloConfig(params),
        finalistLimit: 3,
      },
    });
    const response: StrategyOptimizationResponse = { kind: 'done', requestId, result };
    self.postMessage(response);
  } catch (error) {
    const response: StrategyOptimizationResponse = {
      kind: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

export {};
