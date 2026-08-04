import { SimulationParams, SimulationResult } from '../../entities/types';
import { SimulationEngine } from '../SimulationEngine';
import { compileStrategy } from './compileStrategy';
import { runStrategyPipeline } from './runStrategyPipeline';

// 저장된 시나리오 하나를 "비교용"으로 실행한다.
//
// 원본 params를 엔진에 그대로 넘기면 안 된다. 전략 컴파일러가 도입된 뒤로 화면의 활성
// 시나리오는 compileStrategy를 거치는데, 비교 시나리오만 raw로 돌리면 경제 시나리오·리스크
// 성향·연금 전략·목표 우선순위가 통째로 무시된다. 같은 시나리오를 복제해 비교해도 두 곡선이
// 다르게 그려졌다.
//
// utilityConfig도 함께 넘긴다. 생략하면 목표 우선순위와 무관하게 항상 기본 가중치로 채점되어
// 비교 카드의 효용 점수가 서로를 구분하지 못한다.
export interface RunCompiledScenarioOptions {
  // AI 센티널 자동 채움까지 적용할지.
  //
  // 활성 시나리오는 언제나 적용된 상태로 그려지므로, 끄면 같은 시나리오를 복제해 나란히
  // 놓아도 두 곡선이 다르다 — 자동 채움이 채운 축만큼 어긋난다.
  //
  // 그런데 켜려면 비교 시나리오마다 recommendStrategy를 돌려야 한다(시나리오당 최대 218회
  // 시뮬레이션). 그래서 기본값을 끔으로 두고, 호출부가 그 비용을 감당할 준비가 됐을 때
  // (지연 렌더·메모이제이션) 명시적으로 켠다.
  applySentinels?: boolean;
}

export function runCompiledScenario(
  engine: SimulationEngine,
  params: SimulationParams,
  options: RunCompiledScenarioOptions = {}
): SimulationResult {
  if (options.applySentinels) return runStrategyPipeline(params, engine).result;

  const compiled = compileStrategy(params);
  return engine.run(compiled.params, compiled.utilityConfig);
}
