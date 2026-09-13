export const RETIREMENT_GOAL_TYPES = [
  'LIVING_EXPENSE_STABILITY',
  'EARLY_RETIREMENT',
  'ASSET_SURVIVAL',
  'COMFORTABLE_SPENDING',
  'HOUSING_STABILITY',
  'PENSION_OPTIMIZATION',
  'TAX_OPTIMIZATION',
  'RISK_REDUCTION',
  'INHERITANCE',
  'ASSET_GROWTH',
] as const;

export type RetirementGoalType = (typeof RETIREMENT_GOAL_TYPES)[number];

export type RetirementGoalConstraintType = 'HARD' | 'SOFT';

/**
 * 목표금액의 «출처». 오늘 값은 하나뿐이다 — 사용자가 목표 카드의 입력창에 «직접 써넣은» 값.
 *
 * 유니온으로 두는 이유는 boolean이 「모른다」를 표현하지 못하기 때문이다. 시스템 씨앗과
 * 출처를 알 수 없는 저장 데이터는 서로 다른 사연이지만 «확정이 아니다»라는 점에서 같고,
 * 그 상태는 필드의 «부재»로 표현한다(아래 targetValueSource 주석).
 */
export type RetirementGoalTargetSource = 'user';

export interface RetirementGoal {
  type: RetirementGoalType;
  priority: number;
  targetValue?: number;
  /**
   * `targetValue`가 «사용자가 확정한 목표금액»인가. **없으면 미확정이다.**
   *
   * 목표를 고르는 순간 화면이 계획의 값에서 목표금액을 «깔아 준다»(RetirementGoalSelector의
   * defaultTarget). 그 씨앗은 사용자가 한 번도 진술한 적 없는 숫자인데, 예전에는 사용자가
   * 타이핑한 값과 «같은 자리에 같은 형태로» 저장되어 둘을 구별할 방법이 없었다. 그래서
   * 시스템이 깔아 준 350만원이 HARD 바닥이 되어 후보를 전부 떨어뜨리는 일이 생겼다
   * (known-issues 2번).
   *
   * **선택 필드이고, 기본값은 「미확정」쪽이다.** 필수로 만들거나 기본을 「확정」으로 두면
   * 이미 저장된 씨앗이 «전부» 확정으로 승격되는데, 그것이 정확히 이 수정이 막으려는 일이다.
   * 같은 이유로 기존 데이터를 마이그레이션하지 «않는다» — 표시가 없는 것이 곧 「모른다」이고,
   * 모르는 것은 확정이 아니다.
   *
   * **씨앗에는 붙이지 않는다.** 출처 표시는 사용자가 금액을 직접 입력하고 입력을 마친 경우에만
   * 붙는다(RetirementGoalSelector의 commitTargetEdit). blur·Enter 시점에만 붙으며, 키 입력
   * 하나하나로는 붙지 않는다 — 고치다 만 금액을 확정으로 읽으면 표시가 다시 뜻을 잃는다
   * (known-issues 14번).
   *
   * blur·Enter «자체»가 조건인 것은 아니다. commitTargetEdit은 두 관문을 더 지난다 —
   * 이번 포커스에서 실제로 값을 쳤고 그 값이 커밋 시점까지 그대로 남아 있어야 하며
   * (editedTargets), isSuggestedTargetValue가 참이어야 한다. 그래서 입력칸을 스쳐 지나기만
   * 한 경우, 금액이 아닌 목표(빠른 은퇴의 나이), 빈 칸은 모두 확정되지 않는다.
   * 정규화·어댑터·저장 복원처럼 목표 객체를 다시 만드는 경로가 이 표시를 «지어내면» 수정이
   * 조용히 무효가 되므로, 그 경로들은 있는 그대로 옮기기만 한다.
   */
  targetValueSource?: RetirementGoalTargetSource;
  constraintType: RetirementGoalConstraintType;
}

/**
 * 「목표금액」을 갖는 목표 유형 — 즉 `targetValue`가 «돈»을 뜻하는 유형.
 *
 * 「빠른 은퇴」는 여기 없다. 그 목표의 `targetValue`는 나이이고, 씨앗도 사용자가 1단계에서
 * «직접 입력한» 은퇴 나이를 그대로 옮긴 것이라 「사용자가 말한 적 없는 숫자」가 아니다.
 * 승인된 설계가 씨앗으로 지목한 것도 금액 셋뿐이다(생활비 둘, 상속).
 */
const MONEY_TARGET_GOAL_TYPES = [
  'LIVING_EXPENSE_STABILITY',
  'COMFORTABLE_SPENDING',
  'INHERITANCE',
  'ASSET_GROWTH',
] as const satisfies readonly RetirementGoalType[];

/**
 * 이 유형의 판정이 «목표 금액»을 필요로 하는가.
 *
 * export하는 이유: 화면이 「이 목표를 「반드시 지키기」로 고를 수 있는가」를 물을 때 이 사실이
 * 필요하다. 금액이 필요한 유형인데 그 금액을 «물어보는 칸»이 없으면 사용자는 영원히 확정할
 * 수 없고, 그 HARD는 어떤 축도 켜지 못한다(goalSuccessConditions의 hardRequirementGoals).
 * 화면이 유형 목록을 다시 적으면 분류가 옮겨지는 날 화면만 옛말을 하게 된다.
 */
export function hasMoneyTarget(type: RetirementGoalType): boolean {
  return (MONEY_TARGET_GOAL_TYPES as readonly RetirementGoalType[]).includes(type);
}

/**
 * 판정에 쓸 수 있는 목표금액. **사용자가 확정하지 않았으면 undefined다.**
 *
 * 여기가 「확정인가」를 묻는 «유일한» 자리다. 부족분·HARD/SOFT 판정·체감 커브의 기준이
 * 모두 이 함수를 지나야 한 가지 뜻을 갖는다 — 한 곳이라도 `goal.targetValue`를 직접 읽으면
 * 그 자리에서만 씨앗이 다시 확정값으로 취급되고, 그것이 사용자가 보는 결과를 가른다.
 *
 * 금액이 아닌 목표(「빠른 은퇴」의 나이)는 이 함수의 대상이 아니므로 값을 그대로 돌려준다.
 */
export function confirmedTargetValue(goal: RetirementGoal): number | undefined {
  if (!hasMoneyTarget(goal.type)) return goal.targetValue;
  return goal.targetValueSource === 'user' ? goal.targetValue : undefined;
}

/**
 * 화면이 「아직 제안입니다」를 말해야 하는 상태인가. 판정에서 빠진 값을 아무 표시 없이
 * 보여 주면, 「반드시 지키기」를 골라 둔 사용자가 그 금액이 강제되지 않는다는 사실을 알 수
 * 없다 — 이 수정이 목표를 조용히 약화시키는 쪽으로 읽히는 지점이 정확히 거기다.
 */
export function isSuggestedTargetValue(goal: RetirementGoal): boolean {
  return goal.targetValue !== undefined
    && hasMoneyTarget(goal.type)
    && goal.targetValueSource !== 'user';
}

/**
 * 이 목표가 「반드시 지키기」로 «성립하기 위해» 사용자의 확정을 기다리고 있는가.
 *
 * **HARD는 강도와 기준을 모두 확정해야 성립한다.** 강도만 고르고 기준이 씨앗이면 두 가지
 * 중 하나가 일어난다 — 그 금액을 그대로 강제하면 사용자가 말한 적 없는 숫자로 계획을
 * 묶는 것이고(2번), 그냥 통과시키면 아무것도 구속하지 않는 HARD가 「준비됨」으로 확인받는다
 * (14번). 리뷰어의 말대로 «조용히» 받아들이는 쪽이 더 나쁜 실패다. 그래서 어느 쪽도 하지
 * 않고 사용자에게 그 금액을 확인하거나 고치도록 요구한다.
 *
 * **판정은 목표«자신의» 기준으로 한다.** 이 술어가 참이 되는 것은 기준이 씨앗인 목표뿐이다
 * (생활비 둘·상속). 「빠른 은퇴」의 은퇴 나이와 「자산 고갈 방지」의 기대수명은 사용자가
 * 1단계에서 «직접 입력한» 값이라 확인이 해결할 문제가 애초에 없다 — 그 둘은 금액 목표가
 * 아니므로 isSuggestedTargetValue에서 걸러진다.
 */
export function hardGoalAwaitsTargetConfirmation(goal: RetirementGoal): boolean {
  return goal.constraintType === 'HARD' && isSuggestedTargetValue(goal);
}

export const MAX_RETIREMENT_GOALS = 5;

/**
 * 조건 강도의 표시 이름. **여기가 유일한 출처다** — 목표 선택 화면·대시보드 안내·추천 카드·
 * PDF가 같은 말을 쓴다. 저장되는 값은 언제나 `'HARD' | 'SOFT'`이고, 사람이 읽는 자리에서만
 * 이 이름으로 바꾼다.
 *
 * 한 곳에 두는 이유는 라벨 자체가 계약이기 때문이다. 화면이 「반드시 지키기」라 부른 것을
 * 다른 화면이 「필수」라 부르면, 사용자는 자기가 못박은 조건이 어디서 깨졌는지 추적할 수 없다.
 */
export const RETIREMENT_GOAL_CONSTRAINT_LABELS: Record<RetirementGoalConstraintType, string> = {
  HARD: '반드시 지키기',
  SOFT: '가능하면 달성',
};

/**
 * 목표의 표시 이름. **여기가 유일한 출처다** — 목표 선택 화면·추천 카드·PDF·충돌 문구가
 * 같은 말을 쓴다.
 *
 * 강도 라벨 바로 옆에 두는 이유: 예전에는 이름이 web의 goalCatalog에만 있어서,
 * core가 목표 이름을 말해야 할 때(describeGoalConflict) core → web import가 생겼다.
 * 계산 계층이 화면 계층을 향하는 그 방향은 AGENTS.md가 금지한다. 이름은 도메인의 것이고
 * 설명문·입력 라벨 같은 «화면의» 메타데이터만 goalCatalog에 남는다.
 */
export const RETIREMENT_GOAL_LABELS: Record<RetirementGoalType, string> = {
  LIVING_EXPENSE_STABILITY: '생활비 안정',
  EARLY_RETIREMENT: '빠른 은퇴',
  ASSET_SURVIVAL: '자산 고갈 방지',
  COMFORTABLE_SPENDING: '여유 있는 소비',
  HOUSING_STABILITY: '주거 안정',
  PENSION_OPTIMIZATION: '연금 최대 활용',
  TAX_OPTIMIZATION: '세금 최소화',
  RISK_REDUCTION: '투자 위험 최소화',
  INHERITANCE: '상속 자산 확보',
  ASSET_GROWTH: '자산 성장',
};

/**
 * 생활비에 «관한» 목표 유형. 유형은 「무엇에 관한 목표인가」만 말하고, 얼마나 구속력이
 * 있는지는 constraintType이 따로 정한다(스펙 「유형과 강도를 분리한다」).
 */
export const SPENDING_GOAL_TYPES = [
  'LIVING_EXPENSE_STABILITY',
  'COMFORTABLE_SPENDING',
] as const satisfies readonly RetirementGoalType[];

/**
 * 위 배열이 «유형 수준에서» 말하는 것. 배열에서 유도하므로 둘은 갈라질 수 없다.
 *
 * 필요한 이유는 hardSpendingFloorTarget의 반환값(number | undefined)에 「어느 유형이
 * 통과했는가」가 실리지 않기 때문이다. 그 사실을 호출부가 다시 쓰면 규칙이 두 벌이 되고,
 * 여기서 유도해 두면 생활비 유형이 하나 늘 때 그 사실이 타입을 타고 호출부까지 흘러간다.
 */
export type SpendingGoalType = (typeof SPENDING_GOAL_TYPES)[number];

/**
 * 유형이 생활비에 관한 것인가. `includes` 대신 이 술어를 쓰면 `goal.type`이 실제로 좁혀져,
 * 「생활비 목표만 담는다」는 약속을 tsc가 검사할 수 있게 된다.
 */
export function isSpendingGoalType(type: RetirementGoalType): type is SpendingGoalType {
  return SPENDING_GOAL_TYPES.some((spendingType) => spendingType === type);
}

/**
 * 이 목표가 세우는 런타임 생활비 바닥(월 금액). 바닥을 세우지 않는 목표는 undefined다.
 *
 * **단일 출처인 이유.** 같은 규칙을 두 곳이 본다 — compileStrategy는 이 값들의 max로
 * `params.hardSpendingFloor`를 유도하고(엔진이 인출로 «채우는» 금액), GoalEvaluationEngine은
 * 결과가 그 바닥에 닿았는지 «판정»한다. 두 벌로 갈라지면 엔진이 세운 바닥과 평가가 재는
 * 바닥이 어긋나 「반드시 지키기」가 이름만 남는다. retirementAgeHardFailure가 한 곳에 있는
 * 것과 같은 이유다.
 *
 * `targetValue > 0` 가드는 normalizeGoalDrivenParams.firstGoalWithTarget의 것과 같다:
 * 0은 「입력창을 비웠다」이지 「생활비 0원이 목표」가 아니다.
 *
 * **미확정 씨앗은 바닥을 세우지 않는다.** 세우면 두 가지가 동시에 일어난다 — 사용자가 말한
 * 적 없는 금액이 인출 순서·세제 최적화를 깨고, 그 금액에 못 미쳤다는 이유로 HARD 미달이
 * 보고된다. 체감 커브가 목표를 내리는 계획에서는 그 미달이 «구조적으로» 영구적이라
 * 후보가 전멸했다(known-issues 2번). 바닥과 판정이 같은 함수에서 나오므로 둘은 갈라지지
 * 않는다 — 판정만 끄면 엔진은 여전히 씨앗을 향해 인출하면서 그 결과를 검사하지 않게 된다.
 */
export function hardSpendingFloorTarget(goal: RetirementGoal): number | undefined {
  if (goal.constraintType !== 'HARD') return undefined;
  if (!isSpendingGoalType(goal.type)) return undefined;
  const targetValue = confirmedTargetValue(goal);
  if (targetValue === undefined || !(targetValue > 0)) return undefined;
  return targetValue;
}

function normalizeTargetValue(goal: RetirementGoal): number | undefined {
  if (goal.targetValue === undefined || !Number.isFinite(goal.targetValue)) return undefined;
  if (goal.type === 'EARLY_RETIREMENT') {
    return Math.min(120, Math.max(1, goal.targetValue));
  }
  return Math.max(0, goal.targetValue);
}

export function normalizeRetirementGoals(
  goals: readonly RetirementGoal[],
): RetirementGoal[] {
  const seen = new Set<RetirementGoalType>();

  return [...goals]
    .sort((a, b) => a.priority - b.priority)
    .filter((goal) => {
      if (!RETIREMENT_GOAL_TYPES.includes(goal.type) || seen.has(goal.type)) return false;
      seen.add(goal.type);
      return true;
    })
    .slice(0, MAX_RETIREMENT_GOALS)
    .map((goal, index) => {
      const targetValue = normalizeTargetValue(goal);
      const normalized: RetirementGoal = { ...goal, priority: index + 1, targetValue };
      // 출처 표시는 «옮기기만» 한다 — 여기서 붙이면 정규화를 지나는 것만으로 씨앗이
      // 확정으로 승격되어 표시 자체가 뜻을 잃는다. 값이 사라진 목표(입력창을 비웠다)에서는
      // 표시도 함께 지운다: 가리킬 금액이 없는 출처는 다음 씨앗에 잘못 들러붙는다.
      if (targetValue === undefined) delete normalized.targetValueSource;
      return normalized;
    });
}

export function moveRetirementGoal(
  goals: readonly RetirementGoal[],
  type: RetirementGoalType,
  direction: -1 | 1,
): RetirementGoal[] {
  const normalized = normalizeRetirementGoals(goals);
  const from = normalized.findIndex((goal) => goal.type === type);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= normalized.length) return normalized;

  const reordered = [...normalized];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
  return reordered.map((goal, index) => ({ ...goal, priority: index + 1 }));
}
