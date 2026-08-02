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
// 이 함수는 입력을 변형하지 않는다. "추천의 입력은 언제나 센티널 미적용 compiled"라는
// 배선 불변식은 이 파일이 아니라 useStrategyPipeline이 지키고, 그 테스트가 고정한다 —
// 코어에서 웹 계층의 배선을 근거로 단정하면 배선이 바뀔 때 이 주석부터 거짓이 된다.
//
// 지금 채우는 축은 국민연금 개시 나이 하나뿐이다(이름은 복수형이지만).
export function applyAiSentinels(
  compiled: CompiledStrategy,
  recommendation: StrategyRecommendation | undefined
): SentinelApplication {
  // improved가 false이면 recommendedPlan은 "baseline 유지 권장"이라 채울 것이 없다.
  if (!recommendation?.improved) return none(compiled);

  const recommendedPlan = recommendation.recommendedPlan;
  if (!recommendedPlan) return none(compiled);

  // 채워도 되는 상태인지 판정한다. 막으려는 것은 "사용자가 직접 정해 둔 개시 나이를 덮어쓰는
  // 것"이지 "전략을 저장한 적 없는 새 시나리오"가 아니다.
  //
  // resolveStrategy로 판정하면 안 된다. params.strategy가 없을 때 DEFAULT_RETIREMENT_STRATEGY로
  // 폴백하는데 그 기본값이 'ai_optimized'라, 레거시 시나리오가 저장해 둔
  // withdrawalPlan.nationalPensionStartAge까지 추천값으로 덮어썼다(compileStrategy의 통과 경로가
  // 보장하는 "입력 비트 단위 보존"이 깨졌다).
  //
  // 그렇다고 params.strategy만 보면 반대로 과하다. initialParams에는 strategy가 없어 새
  // 시나리오는 항상 통과 경로를 타는데, 그러면 설정 패널을 한 번도 열지 않은 사용자 — 즉 가장
  // 흔한 상태 — 에게 자동 채움이 통째로 꺼진다. 화면은 「AI 최적화」를 선택된 채로 보여주므로
  // 다시 "화면이 말하는 값 ≠ 엔진이 쓴 값"이 된다.
  //
  // 그래서 두 경우를 허용한다: 사용자가 명시적으로 센티널을 고른 경우, 그리고 전략도 저장된
  // 나이도 없어 덮어쓸 것이 애초에 없는 경우.
  const explicitlyAi = compiled.params.strategy?.nationalPensionStrategy === 'ai_optimized';
  const nothingToOverwrite =
    !compiled.params.strategy
    && compiled.params.withdrawalPlan?.nationalPensionStartAge === undefined;
  if (!explicitlyAi && !nothingToOverwrite) return none(compiled);

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
