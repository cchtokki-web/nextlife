---
type: concept
status: enforced
sources: ["[[AGENTS]] 현행 제품 계약", "[[PRD]] §6", "[[PRD]] §7.2"]
code: [src/core/entities/retirementGoal.ts, src/core/strategy/HardConstraintFilter.ts, src/core/usecases/goals/goalSuccessConditions.ts, src/core/usecases/montecarlo/resolveSimulationVerdict.ts]
tests: [src/tests/core/strategy/HardConstraintFilter.test.ts, src/tests/core/usecases/goals/targetValueProvenance.test.ts, src/tests/core/entities/retirementGoal.test.ts, src/tests/core/usecases/goals/goalSuccessConditions.test.ts, src/tests/core/usecases/montecarlo/hardGoalSuccess.test.ts, src/tests/core/usecases/montecarlo/resolveSimulationVerdict.test.ts]
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
- 확정된 HARD 목표는 Monte Carlo의 `hardGoalSuccessProbability`를 구동한다. 이 값은 확정
  HARD 목표가 요구하는 조건을 «모두» 만족한 시행의 비율이다. 「확정」의 뜻은 위와 같다 —
  `constraintType === 'HARD'`이고 `hardGoalAwaitsTargetConfirmation(goal)`이 거짓이어야
  한다. `resolveSimulationVerdict`는 이 술어를 다시 구현하지 않고 그대로 재사용한다.
- 이 비율에 들어가는 것은 «정량 판정 대상» 목표뿐이다. `isQuantitativelyJudgedGoal()`이
  가르는 여섯 유형(생활비 안정·여유 있는 소비·자산 고갈 방지·상속·자산 성장·빠른 은퇴)만
  시행 하나로 성공·실패를 물을 수 있다. 주거 안정을 HARD로 고르는 것은 조건을 하나 더
  만들지 않는다 — 그 목표는 `hardGoalSuccess.unjudged`로 드러나고, 화면·PDF는 「이 비율이
  판정하지 않은 HARD 목표가 있다」는 사실을 반드시 함께 적는다(known-issues 1번 — 계산은
  이미 옳았고 결함은 화면이 못박지 않은 조건을 지킨 것처럼 보인 데 있었다는 결론을 그대로
  따른다).
- 목표에서 «활성 조건»이 하나도 나오지 않으면 `resolveGoalSuccessConditions`는 계획
  기본값(생활비 유지·자산 생존)으로 되돌아가고, 이때 `hardRequirements`는 세 축 모두
  `false`다 — 사용자가 아무것도 못박지 않았기 때문이다.

### 알려진 한계 — 기말자산 조건은 단일 문턱이다

`terminalAssetGoalOf`는 상속·자산 성장 목표 중 «확정된 목표액이 가장 큰 것 하나»만
기말자산 조건으로 채택하고(`terminalAssetGoal`), `hardRequirements.terminalAsset`은 그
금액을 «준» 목표에만 귀속시킨다. 여러 자산 목표를 동시에 고르면 문턱은 언제나 하나다.

그래서 사용자가 **HARD 상속 3억과 SOFT 상속 5억을 함께** 고르면 5억이 이긴다
(`explicit.reduce`가 최댓값을 취한다). `source`는 SOFT 목표이므로 `terminalAsset`은
`false`다 — 이것은 옳다. 5억을 HARD 요구로 보고하면 사용자가 못박은 적 없는 금액을
못박았다고 말하는 것이고, 그것이 바로 위 「흔한 위반」이 기록한 실패 패턴이다.

**그러나 그 대가로 사용자가 실제로 못박은 3억 HARD 요구가 이 비율에서 통째로 사라진다.**
기말자산 4억으로 끝나는 시행은 3억 HARD 목표를 만족하고 5억 SOFT 목표는 놓치지만,
단일 문턱 설계는 그 둘을 구별해 셀 수 없다 — `hardGoalSuccessProbability`는 3억 조건을
전혀 판정하지 않은 채 5억 조건(놓쳤으므로 실패)만 본다. 이 비율의 신뢰 범위를 판단하는
사람은 이 사실을 알아야 한다. 여러 문턱을 동시에 추적하려면 별도 설계가 필요하고,
이 커밋의 범위가 아니다 — 여기서는 한계로만 기록한다.

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
- 코드: `src/core/usecases/goals/goalSuccessConditions.ts`의 `isQuantitativelyJudgedGoal()`
  (정량 판정 대상 여섯 유형을 가른다), `resolveGoalSuccessConditions()`의
  `hardRequirements` 산출부(확정 HARD만 요구 축을 켠다, 활성 조건이 없으면 세 축 모두
  `false`로 되돌아간다), `terminalAssetGoalOf()`(기말자산 문턱이 단일 값이고 그 값을 준
  목표에만 HARD 귀속을 준다 — 위 「알려진 한계」의 근거)
- 코드: `src/core/usecases/montecarlo/resolveSimulationVerdict.ts`의 `judged`/`unjudged`
  분류부(`isQuantitativelyJudgedGoal`을 그대로 재사용해 화면·PDF에 넘긴다), `hardGoalSuccess`가
  요구 축이 하나도 없으면 `null`이 되는 분기
- 테스트: `src/tests/core/strategy/HardConstraintFilter.test.ts`,
  `src/tests/core/usecases/goals/targetValueProvenance.test.ts`,
  `src/tests/core/entities/retirementGoal.test.ts`
- 테스트: `src/tests/core/usecases/goals/goalSuccessConditions.test.ts`의
  `resolveGoalSuccessConditions — hardRequirements`(확정 HARD만 축을 켜는 것, 목표액을
  준 목표가 아니면 `terminalAsset`이 `false`인 것) 및 `isQuantitativelyJudgedGoal`
  describe 블록(모든 목표 유형에서 미반영 판정과 정확히 반대임을 순회로 검증)
- 테스트: `src/tests/core/usecases/montecarlo/hardGoalSuccess.test.ts`의 「HARD 조건만
  요구하므로 전체 성공률보다 높다」(HARD 비율이 전체 비율과 달라지는 픽스처) 및 「확정 HARD
  목표가 없으면 모든 시행이 통과해 1이다」
- 테스트: `src/tests/core/usecases/montecarlo/resolveSimulationVerdict.test.ts`의 「확정
  HARD 목표가 없으면 hardGoalSuccess는 null이다」, 「판정하지 못한 HARD 목표를 unjudged로
  드러낸다」(`HOUSING_STABILITY`가 `unjudged`에, `ASSET_SURVIVAL`이 `judged`에 각각
  들어가는 것을 검증)

## 관련

[[원장 불변식]] — HARD 생활비 바닥과 `assertSpendingShortfallExplained`의 관계.
[[도달 가능성 5단계]]
