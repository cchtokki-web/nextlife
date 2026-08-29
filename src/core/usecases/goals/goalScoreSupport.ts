import {
  RETIREMENT_GOAL_LABELS,
  type RetirementGoalType,
} from '../../entities/retirementGoal';

/**
 * 점수 «산식»이 없는 목표 — 평가가 결과를 «재서» 점수를 내는 대신 상수를 돌려주는 유형.
 *
 * **`isQuantitativelyJudgedGoal`과 다른 질문에 답한다.** 그쪽은 「시행 하나로 성공/실패를
 * 물을 수 있는가」(목표 달성 «확률»의 판정 대상)이고, 이쪽은 「결과에서 점수를 유도하는 식이
 * 있는가」(종합 목표 «점수»의 산정 대상)다. 둘은 겹치지만 같지 않다 — 연금 최대 활용·세금
 * 최소화·투자 위험 최소화는 확률로는 판정할 수 없지만 점수 산식은 있다
 * (`pensionUtilization` · `taxEfficiency` · `depletionSafety`). 그 셋을 여기 넣으면 실제로
 * 후보를 변별하고 있는 점수를 「없는 것」이라고 말하게 된다.
 *
 * 오늘 이 집합에 있는 것은 「주거 안정」 하나다. `evaluateGoal`이 그 목표에만
 * `score: 0`을 상수로 돌려주며, 사유도 「정량화할 정보가 없습니다」라고 적는다.
 *
 * **화면이 유형을 직접 나열하지 않게 하려고 여기에 둔다.** 목표 카드·대시보드·PDF가 각자
 * 목록을 들고 있으면 목표 하나가 분류를 옮기는 날 그 화면들만 옛말을 하게 된다
 * (`RetirementGoalSelector`의 「정량 판정 대상 아님」 안내가 같은 이유로 엔진의 분류를 읽는다).
 *
 * **이 집합은 계산에 쓰이지 않는다.** `weightedGoalScore`는 종전대로 이 목표의 0점을 분자와
 * 분모에 «그대로» 넣는다 — 계산 정책 변경은 별도 결정 사항이며(D2-①), 그 결정 전까지 기존
 * 계산 의미는 regression contract다. 이 파일이 하는 일은 그 사실을 «말하게» 하는 것뿐이다.
 */
const UNSCORED_GOAL_TYPES: ReadonlySet<RetirementGoalType> = new Set<RetirementGoalType>([
  'HOUSING_STABILITY',
]);

/** 이 목표가 결과에서 점수를 유도하는 산식을 갖는가. */
export function hasGoalScoreFormula(type: RetirementGoalType): boolean {
  return !UNSCORED_GOAL_TYPES.has(type);
}

/** 주어진 목표들 중 점수 산정 대상이 «아닌» 것. 입력 순서를 그대로 지킨다. */
export function unscoredGoalTypes(
  types: readonly RetirementGoalType[],
): RetirementGoalType[] {
  return types.filter((type) => !hasGoalScoreFormula(type));
}

/**
 * 점수 산정 대상이 아닌 목표를 사용자 언어로 밝히는 문장. 대상이 없으면 빈 문자열이다.
 *
 * **화면과 PDF가 같은 문장을 인쇄해야 하므로 core에 한 벌만 둔다**(PRD 9.3의 규약이며,
 * `describeSuccessRates`·`describeSustainableSpendingBasis`가 같은 자리에 있다).
 *
 * 문장이 반드시 말해야 하는 것은 «0점의 뜻»이다. 그 값은 어디에도 인쇄되지 않지만 종합
 * 점수를 통해 추천 순위에 닿으므로, 사용자가 그것을 「이 목표에 실패했다」로 읽을 여지를
 * 남기면 안 된다. 0은 판정 결과가 아니라 판정의 부재다.
 */
export function describeUnscoredGoals(types: readonly RetirementGoalType[]): string {
  const unscored = unscoredGoalTypes(types);
  if (unscored.length === 0) return '';

  const names = unscored.map((type) => `「${RETIREMENT_GOAL_LABELS[type]}」`).join('·');
  return `${names}은 점수 산정 대상이 아닙니다 — 달성·미달을 잴 정량 기준이 없어 평가 점수를 `
    + '계산하지 않으며, 0점은 목표 실패가 아니라 «판정하지 않음»을 뜻합니다.';
}
