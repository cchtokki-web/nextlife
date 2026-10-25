import { SimulationParams } from '../../core/entities/types';
import { MonteCarloConfig, MonteCarloResult } from '../../core/entities/montecarlo';

// 메인 스레드와 몬테카를로 워커 사이의 메시지 계약.
//
// 양쪽이 같은 타입을 import하므로 한쪽만 바뀌면 컴파일이 깨진다. params는 전부 평문 JSON
// (Date·클래스 인스턴스 없음)이라 구조화 복제로 그대로 넘어간다.
export interface MonteCarloRequest {
  kind: 'run';
  // 응답이 어느 요청의 것인지 가린다. terminate()가 이미 큐에 나간 메시지까지 막아 주지는
  // 않으므로 얇은 방어로 남긴다.
  requestId: number;
  params: SimulationParams;
  config: MonteCarloConfig;
}

export type MonteCarloResponse =
  | { kind: 'done'; requestId: number; result: MonteCarloResult }
  | { kind: 'error'; requestId: number; message: string };
