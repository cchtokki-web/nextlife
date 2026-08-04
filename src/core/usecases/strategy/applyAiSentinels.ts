import { ItemizedContributionField, SentinelAxisField, SentinelOverlay, StrategyRecommendation } from '../../entities/types';
import { CompiledStrategy } from './compileStrategy';
import { SENTINEL_AXES, canFillSentinelAxis, paramsWithSentinelOverlay } from './verifiedSentinelPlan';

// 자동 채움 결과. compiled(시뮬레이션 입력)와 "무엇을 채웠는가"를 함께 돌려준다.
//
// 채운 축 목록을 함께 내는 이유: 표시 계층이 같은 판정을 각자 다시 하면 반드시 어긋난다.
// 실제로 그랬다 — 설정 패널의 배지는 "전략이 ai_optimized인가"로, 대시보드 체크리스트는
// 아무 판정도 없이 추천 항목을 전부 "할 일"로 그렸다. 그래서 엔진이 이미 70세로 도는데
// 체크리스트는 "70세로 바꾸세요"라고 시키고, 배지는 버튼을 누르면 오히려 '적용'에서
// '추천'으로 내려갔다. 판정은 여기 한 곳에서만 한다.
export interface SentinelApplication {
  compiled: CompiledStrategy;
  // 자동 채움이 실제로 계산에 넣은 축. 비어 있으면 compiled는 입력과 동일한 참조다.
  appliedFields: ReadonlyArray<ItemizedContributionField>;
  // 계산에 들어간 값. 축 하나짜리 전용 필드(예전의 nationalPensionStartAge)를 축 수만큼
  // 늘리는 대신 맵으로 둔다 — 축이 늘 때마다 표시 계층의 배선이 함께 늘어나지 않는다.
  appliedValues: SentinelOverlay;
}

// 아무것도 채우지 않은 결과. 빈 값들을 공유 상수로 두어, 채우지 않는 흔한 경로에서
// 매번 새 객체가 만들어져 소비처의 메모이제이션이 깨지는 일을 막는다.
const NO_APPLIED_FIELDS: ReadonlyArray<ItemizedContributionField> = Object.freeze([]);
const NO_APPLIED_VALUES: SentinelOverlay = Object.freeze({});

function none(compiled: CompiledStrategy): SentinelApplication {
  return { compiled, appliedFields: NO_APPLIED_FIELDS, appliedValues: NO_APPLIED_VALUES };
}

function axisFor(field: SentinelAxisField) {
  return SENTINEL_AXES.find((axis) => axis.field === field);
}

// 'ai_*' 센티널이 남아 있는 축을 AI 추천값으로 채운다.
//
// compileStrategy는 센티널을 baseline으로 내린다("아직 미정, 기본값으로 두되 AI 제안을
// 받겠다"). 이 함수가 그 후반부를 담당한다 — 추천이 도착하면 미정 축만 추천값으로 바꿔
// 시뮬레이션에 넘긴다.
//
// compileStrategy 안에 넣지 않고 별도 단계로 둔 이유는 시그니처 순환이다: compileStrategy가
// 추천을 반영하려면 추천이 필요한데, recommendStrategy는 이미 컴파일된 params를 입력으로
// 요구한다 — 서로의 출력을 서로의 입력으로 요구하는 순환이라 한 함수로 합칠 수 없다.
//
// 이 함수는 입력을 변형하지 않는다. "추천의 입력은 언제나 센티널 미적용 compiled"라는
// 배선 불변식은 이 파일이 아니라 useStrategyPipeline이 지키고, 그 테스트가 고정한다 —
// 코어에서 웹 계층의 배선을 근거로 단정하면 배선이 바뀔 때 이 주석부터 거짓이 된다.
//
// **채울 값은 여기서 고르지 않는다.** 개선 여부 검증은 recommendStrategy가
// verifiedSentinelPlan(누적 사슬)으로 이미 끝냈고, 이 함수는 그 사슬에서 "지금 이 compiled
// 에서도 채워도 되는" 앞부분만 잘라 적용한다. 예전에는 채울 축이 국민연금 개시 나이 하나뿐이라
// 판정이 이 본문에 손으로 박혀 있었고, 그래서 축을 늘릴 수 없었다.
export function applyAiSentinels(
  compiled: CompiledStrategy,
  recommendation: StrategyRecommendation | undefined
): SentinelApplication {
  // improved가 false이면 추천은 "baseline 유지 권장"이라 채울 것이 없다.
  if (!recommendation?.improved) return none(compiled);

  // 사슬을 앞에서부터 걸으며, 지금 채울 수 없는 축을 만나면 멈춘다.
  //
  // 중간을 건너뛰고 뒤의 축만 적용하면 안 된다 — 각 단계의 utility는 "0번부터 여기까지"를
  // 함께 시뮬레이션한 값이라, 앞 축을 빼면 그 수치가 근거를 잃는다. 효용은 축에 대해
  // 가산적이지 않으므로 부분집합의 효용을 추론할 수 없다.
  //
  // 추천 계산 시점의 params와 지금의 compiled가 다를 수 있어(화면이 추천을 한 커밋 뒤로
  // 미룬다) 이 재판정이 반드시 필요하다.
  let applicable: StrategyRecommendation['verifiedSentinelPlan'][number] | null = null;
  for (const step of recommendation.verifiedSentinelPlan) {
    const axis = axisFor(step.field);
    if (!axis || !canFillSentinelAxis(axis, compiled.params)) break;
    applicable = step;
  }
  if (!applicable) return none(compiled);

  // 개선이 확인된 조합만 적용한다. 사슬은 생성 시점에 이미 이 조건을 만족하지만,
  // 판정을 여기에도 두어 "이 함수가 적용하는 것은 반드시 기준선보다 나은 것"을 국소적으로
  // 읽을 수 있게 한다.
  if (applicable.utility.score <= recommendation.currentUtility.score) return none(compiled);

  // 이미 같은 값이 들어 있는 축은 "채웠다"고 말하지 않는다. 전부 같으면 새 객체를 만들지
  // 않는다 — 참조가 바뀌면 화면의 하위 useMemo가 전부 무효화되어 가장 무거운 렌더가 다시 돈다.
  const overlay = applicable.planOverrides;
  const changedFields = (Object.keys(overlay) as SentinelAxisField[]).filter(
    (field) => overlay[field] !== compiled.params.withdrawalPlan?.[field]
  );
  if (changedFields.length === 0) return none(compiled);

  return {
    compiled: { ...compiled, params: paramsWithSentinelOverlay(compiled.params, overlay) },
    appliedFields: changedFields,
    appliedValues: overlay,
  };
}
