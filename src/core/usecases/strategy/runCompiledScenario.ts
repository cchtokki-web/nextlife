import { SimulationParams, SimulationResult } from '../../entities/types';
import { SimulationEngine } from '../SimulationEngine';
import { compileStrategy } from './compileStrategy';

// 저장된 시나리오 하나를 "비교용"으로 실행한다.
//
// 원본 params를 엔진에 그대로 넘기면 안 된다. 전략 컴파일러가 도입된 뒤로 화면의 활성
// 시나리오는 compileStrategy를 거치는데, 비교 시나리오만 raw로 돌리면 경제 시나리오·리스크
// 성향·연금 전략·목표 우선순위가 통째로 무시된다. 같은 시나리오를 복제해 비교해도 두 곡선이
// 다르게 그려졌다.
//
// utilityConfig도 함께 넘긴다. 생략하면 목표 우선순위와 무관하게 항상 기본 가중치로 채점되어
// 비교 카드의 효용 점수가 서로를 구분하지 못한다.
//
// 알려진 한계: AI 센티널 자동 채움(applyAiSentinels)은 적용하지 않는다. 그러려면 비교
// 시나리오마다 recommendStrategy를 돌려야 하는데(시나리오당 최대 218회 시뮬레이션) 비교
// 카드가 감당할 비용이 아니다. 따라서 활성 시나리오가 센티널로 채워진 상태라면 그 축(국민연금
// 개시 나이) 하나는 여전히 비교 대상과 어긋난다.
export function runCompiledScenario(
  engine: SimulationEngine,
  params: SimulationParams
): SimulationResult {
  const compiled = compileStrategy(params);
  return engine.run(compiled.params, compiled.utilityConfig);
}
