import {
  BaselineWithdrawalPlan,
  RetirementStrategy,
  SentinelAxisField,
  SentinelOverlay,
  SimulationParams,
  UtilityBreakdown,
  UtilityConfig,
  VerifiedSentinelStep,
  WithdrawalPlan,
} from '../../entities/types';
import { SimulationEngine } from '../SimulationEngine';
import { computeLifetimeUtility } from '../utility/UtilityEngine';

export interface SentinelAxis {
  field: SentinelAxisField;
  // 이 축을 지배하는 전략 축이 "미정(ai_*)" 상태인가.
  // 없으면 그 필드를 지배하는 전략 축 자체가 없다는 뜻이다.
  isSentinel?: (strategy: RetirementStrategy) => boolean;
}

// 축 서술 테이블. 예전에는 국민연금 개시 나이 하나에 대해서만 이 판정이 applyAiSentinels
// 본문에 손으로 박혀 있었고, 그래서 축을 늘릴 수 없었다.
export const SENTINEL_AXES = [
  {
    field: 'nationalPensionStartAge',
    isSentinel: (s) => s.nationalPensionStrategy === 'ai_optimized',
  },
  {
    field: 'privatePensionMonthlyTarget',
    isSentinel: (s) => s.privatePensionStrategy === 'ai_optimized',
  },
  {
    field: 'isaMaturityDestination',
    isSentinel: (s) => s.preferIsaFirst === 'ai_optimized',
  },
  // 아래 둘은 UI도 전략 축도 없어 컴파일 후에도 미정으로 남는다. 지배 축이 없으므로
  // "저장된 값이 없으면 채운다" 규칙만 적용된다 — 추가 설계 없이 두 축이 살아난다.
  { field: 'assetSellOrderStrategy' },
  { field: 'generalAssetWithdrawalStartAge' },
] as const satisfies readonly SentinelAxis[];

// 축을 추가하고 테이블에 넣는 것을 잊으면 그 축은 조용히 자동 채움에서 빠진다.
type MissingSentinelAxes = Exclude<SentinelAxisField, (typeof SENTINEL_AXES)[number]['field']>;
type SentinelAxesExhaustive = MissingSentinelAxes extends never
  ? true
  : ['SENTINEL_AXES에 빠진 축이 있습니다', MissingSentinelAxes];
const _sentinelAxesAreExhaustive: SentinelAxesExhaustive = true;
void _sentinelAxesAreExhaustive;

// 이 축을 AI 추천값으로 덮어써도 되는가.
//
// 막으려는 것은 "사용자가 직접 정해 둔 값을 덮어쓰는 것"이지 "전략을 저장한 적 없는 새
// 시나리오"가 아니다. 후자를 막으면 설정 패널을 한 번도 열지 않은 사용자 — 가장 흔한 상태 —
// 에게 자동 채움이 통째로 꺼지는데, 화면은 「AI 최적화」를 선택된 채로 보여주므로
// "화면이 말하는 값 ≠ 엔진이 쓴 값"이 된다.
//
// 반대로 저장된 전략을 무시하고 값의 유무만 보면 안 된다. compileStrategy는
// nationalPensionStartAge를 **항상** 채우므로, 그러면 「최대 연기」를 고른 사용자의 값을
// 덮어쓰게 된다(compileStrategy가 보장하는 "입력 비트 단위 보존"이 깨진다).
export function canFillSentinelAxis(axis: SentinelAxis, params: SimulationParams): boolean {
  const savedValue = params.withdrawalPlan?.[axis.field];

  // 전략을 저장한 적이 없으면 어떤 축도 "사용자가 전략으로 정한 값"이 아니다.
  // 남아 있는 저수준 값만 존중한다.
  if (!params.strategy) return savedValue === undefined;

  if (axis.isSentinel) return axis.isSentinel(params.strategy);

  // 지배하는 전략 축이 없는 필드는 저수준 값이 곧 사용자의 의사표시다.
  return savedValue === undefined;
}

// 사용자의 인출계획 위에 오버레이만 얹은 params.
//
// applyAiSentinels가 실제로 만드는 것과 **정확히 같은 형태**여야 한다 — 검증할 때의 조합과
// 화면이 계산하는 조합이 다르면 "검증된 오버레이"라는 말이 거짓이 된다. 그래서 두 곳이
// 이 함수 하나를 공유한다.
export function paramsWithSentinelOverlay(
  params: SimulationParams,
  overlay: SentinelOverlay
): SimulationParams {
  const fields = Object.keys(overlay) as SentinelAxisField[];
  // 참조가 바뀌면 화면의 하위 useMemo가 전부 무효화되어 가장 무거운 렌더(engine.run)가
  // 매번 다시 돈다. 채울 것이 없으면 입력을 그대로 돌려준다.
  if (fields.length === 0) return params;

  const withdrawalPlan: WithdrawalPlan = { ...(params.withdrawalPlan ?? {}) };
  for (const field of fields) {
    const value = overlay[field];
    // undefined는 "엔진 기본 동작으로 되돌림"이다. 키를 남기면 동작은 같아도
    // 구조 비교·직렬화에서 차이가 생긴다(compileStrategy가 같은 이유로 delete를 쓴다).
    if (value === undefined) delete withdrawalPlan[field];
    else Object.assign(withdrawalPlan, { [field]: value });
  }

  return { ...params, withdrawalPlan };
}

function evaluateOverlay(
  params: SimulationParams,
  overlay: SentinelOverlay,
  engine: SimulationEngine,
  cfg: UtilityConfig
): UtilityBreakdown | null {
  try {
    const overlaidParams = paramsWithSentinelOverlay(params, overlay);
    return computeLifetimeUtility(engine.runForUtility(overlaidParams), overlaidParams, cfg);
  } catch (err) {
    // 특정 조합이 엔진을 깨뜨려도 나머지 축의 검증까지 통째로 잃지 않는다.
    console.warn('Skipping sentinel overlay that failed to simulate', overlay, err);
    return null;
  }
}

// 추천안 중 "사용자의 실제 계획 위에 얹어도 개선이 확인된" 축만 골라 누적 사슬로 돌려준다.
//
// ## 왜 그리드 탐색 결과를 그대로 쓸 수 없는가
//
// 후보 평가는 withdrawalPlan을 **통째로 교체**하며 이뤄진다. 그중 일부 축만 사용자의 계획에
// 이식하면 추천 엔진이 한 번도 평가한 적 없는 조합이 되므로 "추천 = 개선"이 그대로 옮겨오지
// 않는다. 예를 들어 그리드가 "60세 조기수령 + 일반자산 인출 70세 연기"를 묶어서 골랐는데
// 나이만 떼어 오면, 일반자산은 은퇴 즉시 인출되는 채로 국민연금만 평생 30% 깎인 계획이 된다.
//
// ## 축별 게이트와 조합 검증을 둘 다 한다
//
// 효용은 축에 대해 가산적이지 않다. 축별 게이트만 쓰면 "각각 +1인데 합치면 −3"을 못 막고,
// 조합만 검증하면 나쁜 축이 좋은 축에 업혀 들어간다.
//
// → 단독 효과 내림차순으로 하나씩 얹으며 결합 효용이 실제로 오르는 동안만 유지한다.
//   전수 부분집합(2^5 = 32)은 불필요하다.
//
// 비용은 축 N개에 대해 시뮬레이션 최대 2N−1회(단독 N회 + 결합 N−1회)로 N ≤ 5다.
// 이미 최대 218개 후보를 돌리는 함수라 무시할 수준이다.
export function buildVerifiedSentinelPlan(
  params: SimulationParams,
  identityPlan: BaselineWithdrawalPlan,
  recommendedPlan: BaselineWithdrawalPlan,
  currentUtility: UtilityBreakdown,
  engine: SimulationEngine,
  cfg: UtilityConfig
): readonly VerifiedSentinelStep[] {
  // 1단계 — 채울 수 있고 실제로 값이 달라지는 축만 남긴다.
  const candidates = SENTINEL_AXES.filter(
    (axis) => canFillSentinelAxis(axis, params) && recommendedPlan[axis.field] !== identityPlan[axis.field]
  );

  // 2단계 — 축별 게이트. 단독으로 기준선을 넘지 못하는 축은 조합에도 넣지 않는다.
  const solo = candidates
    .map((axis) => {
      const overlay: SentinelOverlay = { [axis.field]: recommendedPlan[axis.field] };
      return { field: axis.field as SentinelAxisField, overlay, utility: evaluateOverlay(params, overlay, engine, cfg) };
    })
    .filter((entry) => entry.utility !== null && entry.utility.score > currentUtility.score)
    .sort((a, b) => b.utility!.score - a.utility!.score);

  // 3단계 — 탐욕적 전진 선택.
  const steps: VerifiedSentinelStep[] = [];
  let accepted: SentinelOverlay = {};
  let bestUtility = currentUtility;

  for (const entry of solo) {
    const trial: SentinelOverlay = { ...accepted, [entry.field]: recommendedPlan[entry.field] };
    // 첫 축의 결합 = 단독이므로 이미 계산해 둔 값을 재사용한다.
    const utility = steps.length === 0 ? entry.utility! : evaluateOverlay(params, trial, engine, cfg);
    if (!utility || utility.score <= bestUtility.score) continue;

    accepted = trial;
    bestUtility = utility;
    steps.push({ field: entry.field, planOverrides: trial, utility });
  }

  return steps;
}
