import { ReturnShockPath, SimulationParams, StrategySimulationResult } from '../../entities/types';
import { SimulationEngine } from '../SimulationEngine';

// 「평생 소비 최적화(max_sustainable)」 계획의 생활비를 **한 번만** 확정해 고정한다.
//
// 이 모듈이 존재하는 이유는 하나다: 어떤 계획을 여러 가정 아래에서 비교하려면 계획 자체는
// 고정되어 있어야 한다. 그렇지 않으면 "가정이 나빠졌을 때 이 계획이 어떻게 되는가"가 아니라
// "가정이 나빠졌다면 나는 얼마를 썼을까"를 묻는 셈이 된다.
//
// 실제로 두 곳이 이 문제를 겪었다.
//   - 몬테카를로: 시행마다 이진탐색을 다시 돌리면 그 시행이 겪을 미래를 미리 알고 생활비를
//     정하는 셈이라(완벽한 예지력) 성공률이 구조적으로 100%에 붙는다. 게다가 비용이 30배다.
//   - 민감도 분석: 수익률 -2%p 시나리오가 생활비를 다시 낮춰 버려서 6개 시나리오가 전부
//     "평생 유지"로 나왔다. 리포트에서 사용자가 정확히 이 모순을 지적했다 — 기준 시나리오는
//     90세에 정확히 0원인데 수익률이 2%p 떨어져도 평생 유지된다는 결과.
//
// 반환값을 params가 아니라 래퍼로 감싸는 이유: 고정된 params를 그대로 engine.run()에 넘기면
// 전략이 여전히 max_sustainable이라 이진탐색이 **다시** 돈다. 그러면 고정한 의미가 사라진다.
// 실행 통로(runFrozenPlan)를 같은 모듈에서 함께 제공해 그 실수를 막는다.
export interface FrozenSpendingPlan {
  // 반드시 runFrozenPlan으로만 실행한다.
  params: SimulationParams;
  // 고정된 월 목표 생활비. 화면·PDF가 "이 금액을 고정한 채 변수 하나만 바꿨다"고
  // 밝히는 데 쓴다 — 밝히지 않으면 사용자는 자기가 입력한 목표 생활비 기준으로 읽는다.
  monthlyTargetSpending: number;
}

export function freezeSpendingPlan(params: SimulationParams, engine: SimulationEngine): FrozenSpendingPlan {
  if ((params.spendingStrategy ?? 'target') !== 'max_sustainable') {
    return { params, monthlyTargetSpending: params.userProfile.targetMonthlySpending };
  }

  const monthlyTargetSpending = engine.run(params).calculatedTargetSpending ?? 0;

  // **전략 문자열은 바꾸지 않는다.** 엔진은 사적연금 정상 인출액을 전략에 따라 다르게
  // 정한다(SimulationEngine.ts:882): max_sustainable/dividend_only는 그 달의 운용수익만큼
  // (max(0, growth)), target은 잔액 ÷ 잔여개월. 'target'으로 바꾸면 생활비는 같아도 연금이
  // 녹는 속도가 달라져, 고정한 계획이 기준 시나리오와 다른 경로를 돈다.
  const frozen: SimulationParams = {
    ...params,
    userProfile: { ...params.userProfile, targetMonthlySpending: monthlyTargetSpending },
  };

  // **상속 하한선을 떼어 낸다.** findMaxSustainable이 기준 시나리오로 돌려주는 결과는
  // sustainabilityTrialParams(SimulationEngine.ts:175)가 하한선을 지운 시행의 결과다.
  // 하한선을 남기면 인출 경로가 막혀 재실행 결과가 기준 시나리오와 어긋난다.
  // (하한선은 탐색의 성공 조건으로 이미 반영되어 있다 — meetsSustainabilityGoal.)
  delete frozen.assetFloor;

  return { params: frozen, monthlyTargetSpending };
}

// 고정 계획의 유일한 실행 통로. run()이 아니라 runSingle을 부르는 것이 요점이다.
export function runFrozenPlan(
  engine: SimulationEngine,
  plan: FrozenSpendingPlan,
  returnPath?: ReturnShockPath
): StrategySimulationResult {
  return engine.runSingle(plan.params, returnPath);
}

// 고정 계획의 params에 시나리오 변형(수익률 ±, 물가 ±, 은퇴시점 ±)을 얹는다.
// 변형 후에도 생활비와 전략은 그대로 고정되어 있어야 하므로 래퍼를 유지한 채 감싼다.
export function mapFrozenPlan(
  plan: FrozenSpendingPlan,
  transform: (params: SimulationParams) => SimulationParams
): FrozenSpendingPlan {
  return { ...plan, params: transform(plan.params) };
}
