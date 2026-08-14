import { LegacySimulationEngine } from '../../core/simulation/LegacySimulationEngine';
import { runMonteCarlo } from '../../core/usecases/montecarlo/MonteCarloEngine';
import { MonteCarloRequest, MonteCarloResponse } from './monteCarloProtocol';

// 몬테카를로 워커.
//
// src/core/**가 React 의존이 전혀 없는 순수 TS라 워커가 코어를 그대로 import한다.
//
// **서버가 아니라 워커인 이유**: 시나리오 데이터는 E2EE로 저장되어 서버가 평문을 모른다
// (core/utils/crypto.ts). 서버에서 돌리려면 평문 params를 전송해야 해서 그 설계와 충돌한다.
//
// SimulationEngine은 인스턴스 상태가 없으므로(필드 선언 0개) 워커 수명 동안 하나면 충분하다.
const engine = new LegacySimulationEngine();

self.onmessage = (event: MessageEvent<MonteCarloRequest>) => {
  const { requestId, params, config } = event.data;

  try {
    const result = runMonteCarlo(params, engine, config);
    const response: MonteCarloResponse = { kind: 'done', requestId, result };
    self.postMessage(response);
  } catch (error) {
    // 실패를 조용히 삼키지 않는다 — 훅이 error 상태로 바꿔 화면에 알린다.
    const response: MonteCarloResponse = {
      kind: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

// isolatedModules에서 이 파일을 모듈로 인식시키기 위한 빈 export.
export {};
