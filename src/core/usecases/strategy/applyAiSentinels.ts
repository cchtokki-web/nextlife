import { ItemizedContributionField, StrategyRecommendation } from '../../entities/types';
import { CompiledStrategy } from './compileStrategy';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../pension/nationalPensionRules';

const NATIONAL_PENSION_START_AGE_FIELD: ItemizedContributionField = 'nationalPensionStartAge';

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
  // 계산에 들어간 국민연금 개시 나이. 채우지 않았으면 null.
  nationalPensionStartAge: number | null;
}

// 아무것도 채우지 않은 결과. appliedFields를 공유 상수로 두어, 채우지 않는 흔한 경로에서
// 매번 새 배열이 만들어져 소비처의 메모이제이션이 깨지는 일을 막는다.
const NO_APPLIED_FIELDS: ReadonlyArray<ItemizedContributionField> = Object.freeze([]);

function none(compiled: CompiledStrategy): SentinelApplication {
  return { compiled, appliedFields: NO_APPLIED_FIELDS, nationalPensionStartAge: null };
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
// 사용자 params는 건드리지 않는다. 반환값은 engine.run과 화면 표시로만 흘러가며,
// 추천 계산의 입력은 언제나 센티널 미적용 원본(compiled)이다 — 그래서 "적용 → 재계산 →
// 재적용" 되먹임이 구조적으로 불가능하다.
export function applyAiSentinels(
  compiled: CompiledStrategy,
  recommendation: StrategyRecommendation | undefined
): SentinelApplication {
  // improved가 false이면 recommendedPlan은 "baseline 유지 권장"이라 채울 것이 없다.
  if (!recommendation?.improved) return none(compiled);

  const recommendedPlan = recommendation.recommendedPlan;
  if (!recommendedPlan) return none(compiled);

  // resolveStrategy가 아니라 params.strategy를 직접 본다.
  //
  // resolveStrategy는 params.strategy가 없으면 DEFAULT_RETIREMENT_STRATEGY로 폴백하는데,
  // 그 기본값의 nationalPensionStrategy가 'ai_optimized'다. 그래서 폴백된 값으로 판정하면
  // "AI에게 맡기겠다고 고른 적이 한 번도 없는" 레거시 시나리오까지 센티널 사용자로 오인한다.
  // compileStrategy의 통과 경로(strategy 없음 + 레거시 씨앗 없음)는 입력을 비트 단위로
  // 보존하겠다고 보장하는데, 그 보장이 바로 여기서 깨졌다 — 사용자가 직접 저장해 둔
  // withdrawalPlan.nationalPensionStartAge가 추천값으로 덮어써졌다.
  if (compiled.params.strategy?.nationalPensionStrategy !== 'ai_optimized') return none(compiled);

  const recommendedAge = recommendedPlan.nationalPensionStartAge;
  // withdrawalPlan이 없는 것(compileStrategy의 통과 경로 등)은 엔진 기본값 65세와
  // 같은 의미이므로, 폴백 없이 undefined로 비교하면 65세 추천에서도 불필요하게
  // 새 객체를 만들게 된다.
  const currentAge = compiled.params.withdrawalPlan?.nationalPensionStartAge
    ?? NATIONAL_PENSION_NORMAL_START_AGE;
  // 값이 같으면 새 객체를 만들지 않는다. 참조가 바뀌면 page.tsx의 하위 useMemo가 전부
  // 무효화되어 이 화면에서 가장 무거운 렌더(engine.run)가 매번 다시 돈다.
  if (recommendedAge === currentAge) return none(compiled);

  // 개선이 확인된 경우에만 채운다.
  //
  // recommendedPlan은 6개 필드를 함께 최적화한 결과이고, 후보 평가는 withdrawalPlan을 통째로
  // 교체해 이뤄진다. 그중 나이 하나만 사용자의 계획에 이식하면 추천 엔진이 한 번도 평가한 적
  // 없는 조합이 되므로 "추천 = 개선"이 그대로 옮겨오지 않는다. 예를 들어 그리드가 "60세
  // 조기수령 + 일반자산 인출 70세 연기"를 묶어서 고른 경우, 나이만 떼어 오면 일반자산은 은퇴
  // 즉시 인출되는 채로 국민연금만 평생 30% 깎인 계획이 된다.
  //
  // nationalPensionOnlyUtility가 정확히 그 조합을 currentUtility와 같은 기준선에서 채점한
  // 값이다(RecommendationEngine이 계산한다). null이면 판단 근거가 없다는 뜻이므로 보수적으로
  // 사용자 계획을 그대로 둔다.
  const onlyUtility = recommendation.nationalPensionOnlyUtility;
  if (!onlyUtility) return none(compiled);
  if (onlyUtility.score <= recommendation.currentUtility.score) return none(compiled);

  return {
    compiled: {
      ...compiled,
      params: {
        ...compiled.params,
        withdrawalPlan: {
          ...(compiled.params.withdrawalPlan ?? {}),
          nationalPensionStartAge: recommendedAge,
        },
      },
    },
    appliedFields: [NATIONAL_PENSION_START_AGE_FIELD],
    nationalPensionStartAge: recommendedAge,
  };
}
