import {
  BequestStrategy, NationalPensionStrategy, PrivatePensionStrategy, RetirementStrategy, RiskProfile,
  SimulationParams, SpendingStrategy, SpendingStrategyChoice, UtilityConfig, WithdrawalPlan,
} from '../../entities/types';
import {
  NATIONAL_PENSION_EARLY_MIN_AGE, NATIONAL_PENSION_NORMAL_START_AGE,
} from '../pension/nationalPensionRules';
import { applyYieldPreset } from '../scenario/applyYieldPreset';
import { applyEconomicScenario } from '../scenario/economicScenarios';
import { resolveTaxSettings } from '../tax/taxRates';
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
  // 'leave_some'은 targetBequest를 "월 목표생활비 * appropriateBequestMonths(24)"로 채우는데,
  // 이는 targetBequest가 미지정일 때 UtilityEngine이 쓰는 추정식과 정확히 같은 값이라 채점
  // 결과가 바뀌지 않는다(엔진의 시뮬레이션 산식은 targetBequest를 아예 읽지 않는다).
  //
  // 예전에는 이 자리에 'maximize'가 있었다. 그때는 'maximize'가 "targetBequest 미지정"으로
  // 컴파일될 뿐 채점상 아무 의미가 없어서 무동작 기본값으로 쓸 수 있었지만, 지금은
  // "많이 남길수록 가점"이라는 실제 의미를 갖는다(UtilityEngine.monotonicAdequacyRaw).
  // 의미를 가진 값을 기본값으로 두면 (1) 패널에서 아무 필드나 건드려 strategy가 materialize
  // 되는 순간 상속 점수가 조용히 뒤집히고 (2) 반대로 그 기본값까지 "최대 상속"으로 채점하면
  // 전략을 한 번도 저장한 적 없는 모든 시나리오의 점수가 작업 전과 달라진다.
  // 기본값은 "화면이 보여주는 문구 = 엔진이 실제로 하는 일"인 값이어야 하며,
  // 엔진이 실제로 가정하는 것은 '2년치 생활비를 적정선으로 본다' = 일부 남기기다.
  bequestStrategy: 'leave_some',
  nationalPensionStrategy: 'ai_optimized',
  privatePensionStrategy: 'ai_optimized',
  preferIsaFirst: false,
  riskProfile: 'ai_recommended',
  economicScenario: 'ai_recommended',
};

// 전략 컴파일러 이전에 출시되어 사용자 데이터에 남아 있는 저수준 필드에서 전략 축을 유도한다.
//
// 여기가 "레거시 → 전략" 매핑의 유일한 장소다. 화면(resolveStrategy)과 엔진(compileStrategy)이
// 각자 씨앗 로직을 갖게 되면 반드시 어긋나고, 그 어긋남이 정확히 이 결함의 원인이었다:
// 저장된 spendingStrategy='dividend_only'를 화면은 'target'으로 그리고, 사용자가 아무 필드나
// 건드리는 순간 그 'target'이 저장돼 전략이 소리 없이 뒤집혔다.
//
// 반환값은 Partial이다 — 유도할 근거가 없는 축은 키 자체를 넣지 않아
// DEFAULT_RETIREMENT_STRATEGY(=baseline)가 그대로 남게 한다.
function seedStrategyFromLegacyParams(params: SimulationParams): Partial<RetirementStrategy> {
  const seed: Partial<RetirementStrategy> = {};

  // 엔진에 존재했던 값만 매핑한다. 알 수 없는 값은 유도하지 않고 baseline('target')에 맡긴다.
  if (params.spendingStrategy === 'dividend_only' || params.spendingStrategy === 'max_sustainable') {
    seed.spendingChoice = params.spendingStrategy;
  }

  // targetBequest는 0과 미설정의 의미가 다르다: 0 = "모두 사용"(명시적 목표), 미설정 = 기존
  // UtilityEngine 추정식. 그래서 `?? undefined`가 아니라 undefined 여부로 나눠 판정한다.
  const targetBequest = params.userProfile?.targetBequest;
  if (targetBequest !== undefined) {
    seed.bequestStrategy = targetBequest > 0 ? 'target_amount' : 'spend_all';
  }

  return seed;
}

// 유도할 레거시 값이 하나라도 있는지. compileStrategy의 "그대로 통과" 경로 판정에 쓴다.
function hasLegacyStrategySeed(params: SimulationParams): boolean {
  return Object.keys(seedStrategyFromLegacyParams(params)).length > 0;
}

// 저장된 시나리오의 전략을 읽는 단일 진입점.
// 우선순위: 기본값 < 레거시 저수준 필드에서 유도한 값 < 사용자가 새 UI에서 명시적으로 저장한 값.
// 설정 화면(StrategySettingsPanel/각 섹션)과 compileStrategy가 모두 이 함수를 쓴다.
export function resolveStrategy(params: SimulationParams): RetirementStrategy {
  return {
    ...DEFAULT_RETIREMENT_STRATEGY,
    ...seedStrategyFromLegacyParams(params),
    ...(params.strategy ?? {}),
  };
}

// 이 시나리오가 "최대 상속"(가능한 한 많이 남기기)을 선택한 상태인가.
// UtilityEngine(채점)과 utilityAnalysis(설명 문구)가 반드시 같은 판정을 쓰도록 여기서 한 번만
// 정의한다. 판정은 화면과 동일한 진입점(resolveStrategy)을 쓰므로 레거시 씨앗을 거친 값이든
// 새 UI가 저장한 값이든 결과가 같다 — 'maximize'는 기본값도 레거시 유도값도 아니라서
// 사용자가 명시적으로 고른 경우에만 참이 된다.
export function isMaximizeBequestStrategy(params: SimulationParams): boolean {
  return resolveStrategy(params).bequestStrategy === 'maximize';
}

// 국민연금 수령 전략 → 청구 나이.
// getNationalPensionAdjustmentFactor가 연기 1개월당 0.6%를 가산하므로
// 70세는 +36%가 된다. 'ai_optimized'는 baseline(정상 개시)으로 내린다.
export const NATIONAL_PENSION_STRATEGY_AGES: Record<NationalPensionStrategy, number> = {
  // 조기수령. StrategyCandidateGenerator의 나이 격자가 [60, 65, 70]이므로 60을 표현할
  // enum이 없으면 AI가 조기수령을 추천해도 적용 시 가장 가까운 'normal'(65)로 뒤집힌다.
  early: NATIONAL_PENSION_EARLY_MIN_AGE,
  normal: NATIONAL_PENSION_NORMAL_START_AGE,
  defer_1y: NATIONAL_PENSION_NORMAL_START_AGE + 1,
  defer_2y: NATIONAL_PENSION_NORMAL_START_AGE + 2,
  defer_max: 70,
  ai_optimized: NATIONAL_PENSION_NORMAL_START_AGE,
};

// 사적연금 전략 → (저율과세 한도 대비 인출 비율, 한도 내 인출 강제 여부).
// null 비율은 "월 목표를 지정하지 않음" = 엔진의 기존 균등분할 인출을 뜻한다.
// limitToTaxLimit이 null이면 "전략이 이 값을 정하지 않음" = 사용자가 「고급 설정」에서
// 직접 켠 값을 그대로 존중한다는 뜻이다. 'ai_optimized'는 "미정"이지 "끄기"가 아니므로
// false를 강제하면 안 된다 — 저장해 둔 설정이 조용히 뒤집힌다.
const PRIVATE_PENSION_RULES: Record<
  PrivatePensionStrategy,
  { limitToTaxLimit: boolean | null; withdrawalRatio: number | null }
> = {
  tax_first: { limitToTaxLimit: true, withdrawalRatio: 1 },
  spending_first: { limitToTaxLimit: false, withdrawalRatio: null },
  growth_first: { limitToTaxLimit: true, withdrawalRatio: 0.5 },
  minimum: { limitToTaxLimit: true, withdrawalRatio: 0.25 },
  ai_optimized: { limitToTaxLimit: null, withdrawalRatio: null },
};

// 「연금 전략」이 "저율과세 한도 내에서만 인출"을 지배하는지, 지배한다면 어떤 값으로
// 고정하는지. null이면 지배하지 않으므로 고급 설정의 값이 그대로 쓰인다.
// 고급 설정 UI가 스위치를 비활성화할지, 어떤 값을 보여줄지 판정하는 데 쓴다 —
// 규칙표를 UI에 복제하면 두 곳이 조용히 어긋난다.
export function resolvePrivatePensionTaxLimitOverride(
  strategy: PrivatePensionStrategy
): boolean | null {
  return (PRIVATE_PENSION_RULES[strategy] ?? PRIVATE_PENSION_RULES.ai_optimized).limitToTaxLimit;
}

// 수익률 프리셋을 지배하는 리스크 성향. 'ai_recommended'(미정)와 'custom'(덮어쓰지 말 것)은
// 키 도메인에서 아예 제거한다.
//
// Partial<Record<RiskProfile, ...>>가 아니라 Record<Exclude<...>>인 이유:
// Partial은 'ai_recommended'/'custom' 항목을 채워 넣어도 컴파일이 통과한다. 이 브랜치에서
// 같은 실수('ai_*' 센티널에 값을 채워 사용자 입력을 조용히 덮어씀)가 세 번 반복됐으므로,
// 네 번째는 리터럴 객체의 초과 프로퍼티 검사로 컴파일 타임에 막는다.
type GoverningRiskProfile = Exclude<RiskProfile, 'custom' | 'ai_recommended'>;

// 리스크 성향 → 기존 수익률 프리셋. 매핑이 없는 성향은 applyYieldPreset을 부르지 않아
// 자산·연금에 직접 입력한 수익률(또는 경제 시나리오가 정한 값)이 그대로 남는다 —
// 'ai_recommended'는 "미정"이지 "중립형"이 아니고, 'custom'은 "내가 넣은 값을 덮어쓰지
// 말라"는 뜻이다.
const RISK_PROFILE_PRESETS: Record<
  GoverningRiskProfile,
  'conservative' | 'base' | 'aggressive'
> = {
  conservative: 'conservative',
  neutral: 'base',
  aggressive: 'aggressive',
};

// 리스크 성향이 수익률을 지배할 수 있는 값인지. "미정"과 "직접입력"을 여기서 한 번만
// 걸러내고, 그 분기가 "여기가 센티널을 처리하는 자리"임을 코드 흐름으로 드러낸다.
function isGoverningRiskProfile(profile: RiskProfile): profile is GoverningRiskProfile {
  return profile !== 'custom' && profile !== 'ai_recommended';
}

// 「투자 전략」의 리스크 성향이 자산·연금·ISA 수익률을 지배하는지, 지배한다면 어떤 프리셋으로
// 고정하는지. null이면 지배하지 않으므로 사용자가 직접 입력한 수익률이 그대로 쓰인다.
// 자산 입력 폼이 수익률 입력을 비활성화할지 판정하는 데 쓴다 —
// resolvePrivatePensionTaxLimitOverride와 같은 이유로, 규칙표를 UI에 복제하면 두 곳이
// 조용히 어긋난다(그 어긋남이 정확히 이 결함이었다: 폼은 사용자 입력값을 보여주는데
// 엔진은 프리셋 값으로 계산했다).
export function resolveRiskProfileYieldPreset(
  riskProfile: RiskProfile
): 'conservative' | 'base' | 'aggressive' | null {
  if (!isGoverningRiskProfile(riskProfile)) return null;
  // 알 수 없는 값(저장된 옛 시나리오에 남은 없어진 enum 등)은 타입 가드를 통과하지만
  // 테이블에는 없다. 런타임 폴백을 지운 순간 undefined가 그대로 새어 나간다.
  return RISK_PROFILE_PRESETS[riskProfile] ?? null;
}

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
//
// default를 두지 않고 모든 case를 명시한 뒤 never 단정으로 마무리한다. default가 있으면
// SpendingStrategyChoice에 새 값이 추가돼도 컴파일이 통과해 조용히 'target'으로 떨어지지만,
// 이 형태에서는 새 값이 exhaustiveCheck에 대입되지 못해 컴파일 에러가 난다.
// never 단정 뒤의 return은 런타임 폴백을 유지하기 위한 것이다 — 타입은 도달 불가라고
// 보지만, 저장된 옛 시나리오에는 실제로 타입에 없는 문자열이 들어 있을 수 있다.
function resolveSpendingStrategy(spendingChoice: SpendingStrategyChoice): SpendingStrategy {
  switch (spendingChoice) {
    case 'dividend_only':
      return 'dividend_only';
    case 'max_sustainable':
      return 'max_sustainable';
    case 'target':
    case 'ai':
      return 'target';
  }

  const exhaustiveCheck: never = spendingChoice;
  void exhaustiveCheck;
  return 'target';
}

// 전략(사용자 언어)을 저수준 파라미터(엔진 언어)로 번역한다.
//
// 순수 함수이며 절대 던지지 않는다. 알 수 없는 enum 값(저장된 옛 시나리오에 남은
// 값 등)이 들어오면 그 축만 baseline으로 폴백하고 나머지 축은 정상 컴파일한다.
//
// 'ai_*' 값은 "아직 미정, 기본값으로 두되 AI 제안을 받겠다"는 표식이며 baseline으로
// 내려간다. 실제 AI 값은 사용자가 추천을 명시적으로 "적용"할 때 확정 enum으로 치환된다.
export function compileStrategy(params: SimulationParams): CompiledStrategy {
  // 전략도 없고 레거시 저수준 필드도 baseline이면 아무것도 번역할 것이 없다.
  // 이 통과 경로가 "새 기능을 하나도 켜지 않은 시나리오는 입력이 비트 단위로 보존된다"를 보장한다.
  if (!params.strategy && !hasLegacyStrategySeed(params)) {
    return { params, utilityConfig: DEFAULT_UTILITY_CONFIG };
  }

  // 화면과 같은 함수로 전략을 읽는다 — 레거시 씨앗 규칙이 두 곳에 흩어지지 않게 하기 위해서다.
  const strategy = resolveStrategy(params);

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

  // 경제 시나리오 → 리스크 성향 순으로 적용한다. 둘 다 수익률을 건드리므로
  // 순서가 결과를 결정한다: 시나리오는 물가·환율을, 리스크 성향은 수익률을 지배한다.
  let economyApplied = applyEconomicScenario(params, strategy.economicScenario);
  const riskPreset = resolveRiskProfileYieldPreset(strategy.riskProfile);
  if (riskPreset) {
    economyApplied = applyYieldPreset(economyApplied, riskPreset);
  }

  const taxSettings = resolveTaxSettings(economyApplied.taxSettings);
  const pensionRule = PRIVATE_PENSION_RULES[strategy.privatePensionStrategy]
    ?? PRIVATE_PENSION_RULES.ai_optimized;
  const limitOverride = resolvePrivatePensionTaxLimitOverride(strategy.privatePensionStrategy);

  const monthlyPensionLimit = taxSettings.privatePensionLimit / 12;
  const privatePensionMonthlyTarget = pensionRule.withdrawalRatio === null
    ? undefined
    : monthlyPensionLimit * pensionRule.withdrawalRatio;

  // 사용자가 직접 넣어둔 withdrawalPlan 필드(일반자산 인출 개시 나이 등)는 보존하고,
  // 전략이 지배하는 3개 필드만 덮어쓴다.
  const withdrawalPlan: WithdrawalPlan = {
    ...(economyApplied.withdrawalPlan ?? {}),
    nationalPensionStartAge:
      NATIONAL_PENSION_STRATEGY_AGES[strategy.nationalPensionStrategy]
      ?? NATIONAL_PENSION_NORMAL_START_AGE,
    isaMaturityDestination: strategy.preferIsaFirst ? 'asset' : 'pension',
  };
  if (privatePensionMonthlyTarget === undefined) {
    delete withdrawalPlan.privatePensionMonthlyTarget;
  } else {
    withdrawalPlan.privatePensionMonthlyTarget = privatePensionMonthlyTarget;
  }

  // 배당 재투자는 compileStrategy가 건드리지 않는다. 「연금 전략」의 스위치는 "설정"이 아니라
  // "일괄 적용 버튼"이며, 눌린 그 순간에만 params.assets를 직접 갱신한다. 여기서 매번
  // 덮어쓰면 AssetFormSection의 자산별 토글이 조용히 뭉개진다.
  const assets = economyApplied.assets;

  return {
    params: {
      ...economyApplied,
      // 결과에 전략을 함께 찍는다. 이 함수는 저수준 필드를 "실체화"하는데
      // (leave_some → userProfile.targetBequest = 월생활비 * 24 등), strategy를 남기지 않으면
      // 컴파일 결과를 다시 읽는 쪽(resolveStrategy)이 그 값을 레거시 씨앗으로 재해석해
      // 전략을 되돌린다 — 방금 실체화한 7,200만원이 '목표 금액 유지'로 읽혀, 금액을 입력한
      // 적도 없는 사용자에게 상속 부족 경고가 뜨고 설명 문구가 표류했다.
      // strategy는 seedStrategyFromLegacyParams보다 우선순위가 높으므로 재유도가 불가능해지고,
      // 동시에 compileStrategy가 멱등이 된다.
      strategy,
      userProfile,
      spendingStrategy,
      assets,
      withdrawalPlan,
      taxSettings: {
        ...taxSettings,
        // null이면 사용자가 고급 설정에서 정한 값을 유지한다.
        limitPrivatePensionToTaxLimit:
          limitOverride ?? taxSettings.limitPrivatePensionToTaxLimit,
      },
    },
    utilityConfig,
  };
}
