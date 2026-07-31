import {
  BequestStrategy, RetirementStrategy, SimulationParams, SpendingStrategy,
  SpendingStrategyChoice, UtilityConfig,
} from '../../entities/types';
import { createUtilityConfig, DEFAULT_UTILITY_CONFIG } from '../utility/utilityWeights';
import { OBJECTIVE_WEIGHT_PRESETS } from './objectivePresets';

// createUtilityConfig는 `{ weights, ...rest }`를 반환한다. rest에 DEFAULT_UTILITY_CONFIG를
// 통째로 넘기면 그 안의 weights가 나중에 스프레드되어 방금 고른 프리셋을 덮어쓴다.
// weights를 떼어낸 나머지만 재사용한다.
const { weights: _defaultWeights, ...UTILITY_CONFIG_REST } = DEFAULT_UTILITY_CONFIG;

export interface CompiledStrategy {
  params: SimulationParams; // 저수준 파라미터가 채워진 결과
  utilityConfig: UtilityConfig; // 목적 함수
}

// 새 시나리오의 기본 전략. 모든 축이 "기존 동작과 동일한 결과"를 내도록 골랐다 —
// 즉 이 기본값으로 compileStrategy를 돌려도 시뮬레이션 결과가 바뀌지 않는다.
export const DEFAULT_RETIREMENT_STRATEGY: RetirementStrategy = {
  mode: 'simple',
  objective: 'ai_recommended',
  spendingChoice: 'target', // 엔진 기본값(spendingStrategy 미지정)과 같은 동작
  bequestStrategy: 'maximize', // targetBequest 미지정 = UtilityEngine 기존 공식
  nationalPensionStrategy: 'ai_optimized',
  privatePensionStrategy: 'ai_optimized',
  preferIsaFirst: false,
  reinvestDividends: true,
  riskProfile: 'ai_recommended',
  economicScenario: 'ai_recommended',
};

// bequestStrategy → userProfile.targetBequest.
// 'maximize'는 undefined를 돌려주며, 이는 "미지정 → UtilityEngine이 월생활비 *
// appropriateBequestMonths로 적정 잔여자산을 추정" 이라는 기존 동작을 뜻한다.
function resolveTargetBequest(
  strategy: BequestStrategy,
  targetMonthlySpending: number,
  userEnteredBequest: number | undefined,
  appropriateBequestMonths: number
): number | undefined {
  switch (strategy) {
    case 'spend_all':
      return 0;
    case 'leave_some':
      return targetMonthlySpending * appropriateBequestMonths;
    case 'target_amount':
      return userEnteredBequest;
    case 'maximize':
    default:
      return undefined;
  }
}

// spendingChoice → 엔진 SpendingStrategy.
// 'ai'는 엔진에 없는 값이므로 baseline인 'target'으로 내린다. 알 수 없는 값(저장된 옛
// 시나리오에 남은, 지금은 없어진 값 등)도 같은 이유로 baseline인 'target'으로 폴백한다.
// 사용자가 무엇을 골랐는지는 strategy.spendingChoice 쪽에 그대로 남는다.
function resolveSpendingStrategy(spendingChoice: SpendingStrategyChoice): SpendingStrategy {
  switch (spendingChoice) {
    case 'dividend_only':
      return 'dividend_only';
    case 'max_sustainable':
      return 'max_sustainable';
    case 'target':
    case 'ai':
    default:
      return 'target';
  }
}

// 전략(사용자 언어)을 저수준 파라미터(엔진 언어)로 번역한다.
//
// 순수 함수이며 절대 던지지 않는다. 알 수 없는 enum 값(저장된 옛 시나리오에 남은
// 값 등)이 들어오면 그 축만 baseline으로 폴백하고 나머지 축은 정상 컴파일한다.
//
// 'ai_*' 값은 "아직 미정, 기본값으로 두되 AI 제안을 받겠다"는 표식이며 baseline으로
// 내려간다. 실제 AI 값은 사용자가 추천을 명시적으로 "적용"할 때 확정 enum으로 치환된다.
export function compileStrategy(params: SimulationParams): CompiledStrategy {
  const strategy = params.strategy;
  if (!strategy) {
    return { params, utilityConfig: DEFAULT_UTILITY_CONFIG };
  }

  const weights = OBJECTIVE_WEIGHT_PRESETS[strategy.objective] ?? DEFAULT_UTILITY_CONFIG.weights;
  const utilityConfig = createUtilityConfig(weights, UTILITY_CONFIG_REST);

  const targetBequest = resolveTargetBequest(
    strategy.bequestStrategy,
    params.userProfile.targetMonthlySpending,
    params.userProfile.targetBequest,
    utilityConfig.appropriateBequestMonths
  );

  // targetBequest가 undefined일 때는 키 자체를 지운다. `targetBequest: undefined`를
  // 남겨두면 JSON 직렬화/구조 비교에서 "키가 없는 것"과 미묘하게 달라진다.
  const userProfile = { ...params.userProfile };
  if (targetBequest === undefined) {
    delete userProfile.targetBequest;
  } else {
    userProfile.targetBequest = targetBequest;
  }

  const spendingStrategy = resolveSpendingStrategy(strategy.spendingChoice);

  return {
    params: { ...params, userProfile, spendingStrategy },
    utilityConfig,
  };
}
