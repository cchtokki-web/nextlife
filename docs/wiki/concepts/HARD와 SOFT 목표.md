---
type: concept
status: enforced
sources: ["[[AGENTS]] 현행 제품 계약", "[[PRD]] §6", "[[PRD]] §7.2"]
code: [src/core/entities/retirementGoal.ts, src/core/strategy/HardConstraintFilter.ts]
tests: [src/tests/core/strategy/HardConstraintFilter.test.ts, src/tests/core/usecases/goals/targetValueProvenance.test.ts, src/tests/core/entities/retirementGoal.test.ts]
tags: [계산계약, 목표, 제약]
---
# HARD와 SOFT 목표

## 한 줄 정의

목표는 최대 5개까지 우선순위와 HARD·SOFT 강도를 가지며, 금액형 HARD는 사용자가 금액을 직접
확정한 경우에만 후보를 떨어뜨리는 강제 제약이 된다.

## 계약

- 목표는 최소 1개, 최대 5개(`MAX_RETIREMENT_GOALS`)다. 목표 유형·우선순위·HARD/SOFT의
  Single Source of Truth는 `src/core/entities/retirementGoal.ts`다.
- 금액형 HARD 목표는 사용자가 목표 금액을 명시적으로 확정한 경우에만 강제 제약으로 쓴다.
  시스템 초기값이나 추천값을 사용자 확정값으로 승격하지 않는다.
- 「확정인가」를 묻는 유일한 자리는 `confirmedTargetValue()`다. 부족분 판정·HARD/SOFT
  판정·체감 커브가 모두 이 기준을 쓴다.
- HARD는 강도와 기준을 모두 확정해야 성립한다. 강도만 고르고 기준이 씨앗이면
  `hardGoalAwaitsTargetConfirmation()`이 참이고, 그 목표는 아직 아무것도 구속하지 않는다.
- 저장되는 값은 언제나 `'HARD' | 'SOFT'`이고, 사람이 읽는 자리에서만
  `RETIREMENT_GOAL_CONSTRAINT_LABELS`(`반드시 지키기` / `가능하면 달성`)로 바꾼다.

## 흔한 위반

시스템이 계획의 기준 생활비에서 목표 금액을 미리 깔아 준 씨앗을 사용자가 확정한 값과
구별하지 못해, 그 씨앗이 그대로 HARD 바닥이 된 사고가 실제로 있었다
(`src/core/entities/retirementGoal.ts` 32~37행 주석, `docs/known-issues.md` 2번). 월
350만원 씨앗이 HARD 바닥으로 강제되어 후보가 전부 떨어졌다 — 사용자가 진술한 적 없는 숫자가
인출 순서·세제 최적화를 깨는 동시에, 바로 그 금액에 못 미쳤다는 이유로 HARD 미달 판정까지
났다.

반대 방향의 실패도 기록돼 있다. 강도만 「반드시 지키기」로 고르고 기준 금액은 씨앗 그대로 둔
목표가 확인 없이 「준비됨」으로 통과한 사고다(`hardGoalAwaitsTargetConfirmation()` 주석,
`docs/known-issues.md` 14번). 이때 화면은 구속력 있는 HARD처럼 보이지만 엔진은 그 금액을
전혀 강제하지 않는다 — 리뷰어의 판정대로, 말없이 구속하지 않는 HARD는 시끄럽게 후보를
탈락시키는 것보다 나쁜 실패다.

## 근거

- 코드: `src/core/entities/retirementGoal.ts`의 `confirmedTargetValue()`,
  `isSuggestedTargetValue()`, `hardGoalAwaitsTargetConfirmation()`,
  `hardSpendingFloorTarget()`, `RETIREMENT_GOAL_CONSTRAINT_LABELS`, `MAX_RETIREMENT_GOALS`;
  `src/core/strategy/HardConstraintFilter.ts`의 `beforeSimulation()`, `afterEvaluation()`
- 테스트: `src/tests/core/strategy/HardConstraintFilter.test.ts`,
  `src/tests/core/usecases/goals/targetValueProvenance.test.ts`,
  `src/tests/core/entities/retirementGoal.test.ts`

## 관련

[[원장 불변식]] — HARD 생활비 바닥과 `assertSpendingShortfallExplained`의 관계.
[[도달 가능성 5단계]]
