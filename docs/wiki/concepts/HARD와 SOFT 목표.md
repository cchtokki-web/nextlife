---
type: concept
status: enforced
sources: ["[[AGENTS]] 현행 제품 계약", "[[PRD]] §6", "[[PRD]] §7.2"]
code: [src/core/entities/retirementGoal.ts, src/core/strategy/HardConstraintFilter.ts, src/core/usecases/goals/goalSuccessConditions.ts, src/core/usecases/montecarlo/resolveSimulationVerdict.ts, src/core/usecases/montecarlo/describeSuccessRates.ts]
tests: [src/tests/core/strategy/HardConstraintFilter.test.ts, src/tests/core/usecases/goals/targetValueProvenance.test.ts, src/tests/core/entities/retirementGoal.test.ts, src/tests/core/usecases/goals/goalSuccessConditions.test.ts, src/tests/core/usecases/montecarlo/hardGoalSuccess.test.ts, src/tests/core/usecases/montecarlo/resolveSimulationVerdict.test.ts, src/tests/web/features/Dashboard/DashboardSection.test.tsx, src/tests/web/features/Pdf/pdfReportSections.test.ts]
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
- 입력 UI에서 제안 금액은 목표값 입력창에 직접 입력을 마친 경우에만 확정된다(Enter 또는
  포커스 이동). 제안값을 그대로 받아들이는 별도 확정 버튼은 제공하지 않는다.
- 제안 금액 안내 문단은 카드에 표시하지 않는다. 목표 금액은 참고값과 수정 동작으로 보여 주며,
  미확정 HARD 목표에는 금액 확인 요구를 계속 표시한다.
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
  가르는 여섯 유형(생활비 안정·여유 있는 소비·자산 고갈 방지·상속·자산 성장·빠른 은퇴)은
  «같은 뜻»이 아니다 — 앞의 다섯(`MEASURABLE_GOALS`)만 시행 하나로 성공·실패를 «물을 수»
  있다. 빠른 은퇴는 다르다: 목표 은퇴 나이는 계획에 이미 반영되어 모든 시행이 이미 그
  나이에 은퇴한 채로 시작하므로 물을 것이 없다 — 조건으로 세면 언제나 전 시행 통과라
  확률이 부풀고, 미판정으로 세면 반영된 목표를 반영되지 않았다고 말하게 된다. 그래서 빠른
  은퇴는 `hardGoalSuccess.judged`도 `unjudged`도 아닌 `planEmbedded`(`PLAN_EMBEDDED_GOALS`)
  로 따로 드러난다 — 「이미 반영되어 모든 시행이 지킨다」는 뜻이지 「반영되지 않았다」는
  뜻이 아니다.
- HARD로 고른 목표가 이 비율의 조건이 되려면 유형만으로는 부족하다 — 그 목표가 «실제로
  축을 켜야» 한다(`hardRequirementGoals`, `resolveSimulationVerdict`의 `judged` 산출 근거).
  「자산 성장」은 `MEASURABLE_GOALS`에 속한 «판정 가능한 유형»이지만 목표액이 «선택
  입력»이라(`goalCatalog.ts`의 `target.optional`) 비워 둘 수 있고, 비워 두면 다른 자산
  목표(상속) 없이 혼자 골라서는 기말자산 조건을 전혀 만들지 못한다 — 그런 경우 확정
  HARD로 골라도 `judged`가 아니라 `unjudged`로 떨어진다. **다만 새 시나리오에서 그
  조합을 만들 수는 없다** — 금액이 비어 있는 동안 `RetirementGoalSelector.tsx`가
  「반드시 지키기」를 잠근다(`awaitingOptionalTarget`). 이 경로로 `unjudged`가 채워지는
  것은 그 잠금 이전에 저장된 시나리오뿐이고, 선택기는 그 값을 조용히 SOFT로 고쳐 쓰지
  않으므로 살아 있는 경로다.
- 주거 안정처럼 유형 자체가 `MEASURABLE_GOALS`·`PLAN_EMBEDDED_GOALS` 어디에도 없는 목표를
  HARD로 고르는 것도 같은 결과(`unjudged`)로 드러난다 — 화면·PDF는 「이 비율이 판정하지
  않은 HARD 목표가 있다」는 사실을 반드시 함께 적는다(known-issues 1번 — 계산은 이미
  옳았고 결함은 화면이 못박지 않은 조건을 지킨 것처럼 보인 데 있었다는 결론을 그대로
  따른다). **다만 이쪽 경로는 새 시나리오에서는 막혀 있다** — known-issues 1번 해결 이후
  `RetirementGoalSelector.tsx`가 정량 판정 대상이 아닌 목표의 HARD 선택지를 잠갔기
  때문이다(`isQuantitativelyJudgedGoal`이 거짓인 유형). 이쪽 경로로 `unjudged`가 채워지는
  것은 그 잠금 이전에 저장된 레거시 시나리오뿐이다 — 선택기는 그 값을 조용히 SOFT로 고쳐
  쓰지 않고 있는 그대로 보여주므로, 화면·PDF의 안내 문구는 지금도 살아 있는 경로다.
- 목표에서 «활성 조건»이 하나도 나오지 않으면 `resolveGoalSuccessConditions`는 계획
  기본값(생활비 유지·자산 생존)으로 되돌아가고, 이때 `hardRequirements`는 세 축 모두
  `false`다 — 사용자가 아무것도 못박지 않았기 때문이다.
- **목표액이 «선택»인 목표는 「자산 성장」 하나뿐이다**(`goalCatalog.ts`의
  `target.optional`). 이 목표만 예외인 이유는 금액이 없어도 잴 기준이 자기 안에 있기
  때문이다 — `assetGrowthEvaluation`이 기말자산을 «은퇴 시점 자산»과 견준다. 상속은
  다르다: 확정 금액이 없으면 `terminalAssetGoalOf`가 `targetBequest ?? 0`으로 떨어져
  기준 자체가 무너지므로, 금액이 비면 `RetirementInputFlow`가 분석을 막는다. 그래서
  「금액을 «묻는» 목표」와 「금액을 «요구하는» 목표」는 같은 집합이 아니다.

### 기말자산 문턱은 «둘»이다 — 질문이 둘이기 때문

기말자산 조건을 묻는 질문은 두 개이고 대상 목표가 다르다.

| 질문 | 필드 | 대상 |
|---|---|---|
| 고른 목표를 다 채웠는가 | `terminalAssetGoal` | 확정된 자산 목표 전부(HARD·SOFT) |
| 못박은 조건을 지켰는가 | `hardTerminalAssetGoal` | 확정 **HARD** 자산 목표만 |

**문턱을 여럿 추적할 필요는 없다.** 자산 조건은 모두 `기말자산 ≥ Ti` 꼴이고 그 논리곱은
`기말자산 ≥ max(Ti)`와 정확히 동치다. 그래서 각 질문 안에서는 최댓값 하나로 충분하고,
기여한 목표«전부»를 `hardRequirementGoals.terminalAsset`에 실어 판정된 목표가 빠지지 않게
한다. 두 문턱은 언제나 `hardTerminalAssetGoal ≤ terminalAssetGoal`이다 — HARD 집합이
전체의 부분집합이기 때문이고, 이 부등식이 깨지면 「HARD 판정은 목표 달성의 완화」라는
관계(`describeHardGoalRelationship`)가 뒤집힌다.

한때 이 자리에 한 숫자만 있었고 「그 값을 준 목표 하나」에 HARD를 귀속시켰다. 그래서
**HARD 상속 3억과 SOFT 자산성장 5억**을 함께 고르면 5억이 이기고 출처가 SOFT라 HARD 축이
통째로 꺼졌다 — 기말자산 2억으로 끝나는 시행이 확정 HARD 3억을 명백히 어겼는데도
「HARD 위반 없음」으로 집계됐다. 둘 다 HARD일 때도 귀속이 하나뿐이라, 나머지 목표는
판정됐는데도 `unjudged`(판정하지 못함)로 보고됐다. 자세한 경위는
[[2026-09-02-기말자산 문턱을 목표 달성과 HARD 판정으로 나눈다]]에 있다.

**여전히 하지 않는 것**: 목표별 부분 달성률(「3억은 지켰고 5억은 놓쳤다」를 따로 세는 것)은
이 비율의 일이 아니다. HARD 판정은 못박은 조건의 논리곱을 묻고, 목표마다의 달성 정도는
`GoalEvaluationEngine`이 목표별 점수로 따로 낸다.

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
  (정량 판정 대상 여섯 유형을 가른다), `isPlanEmbeddedGoal()`(그중 계획에 이미 반영되어
  조건으로 세지 않는 쪽만 가른다), `isConfirmedHardGoal()`(「확정된 HARD」 술어의 유일한
  출처), `resolveGoalSuccessConditions()`의 `hardRequirements`·`hardRequirementGoals`
  산출부(확정 HARD만 요구 축을 켜고, «그 축을 켠 목표»를 함께 싣는다 — 유형 멤버십이 아니라
  이 목록이 판정 여부의 근거다), `terminalAssetGoalOf()`(기말자산 문턱이 단일 값이고 그
  기여한 HARD 목표 전부에 귀속을 준다 — 위 「기말자산 문턱은 둘이다」의 근거)
- 코드: `src/core/usecases/montecarlo/resolveSimulationVerdict.ts`의 `judged`/`unjudged`/
  `planEmbedded` 세 갈래 분류부. `judged`는 `isQuantitativelyJudgedGoal`(유형)이 아니라
  `goalConditions.hardRequirementGoals`(그 목표가 실제로 축을 켰는가)에서 나온다 —
  유형만 보면 목표액을 비워 둔 ASSET_GROWTH가 아무 조건도 못 만들었는데 「판정됨」으로
  잘못 분류된다. `planEmbedded`는 `isPlanEmbeddedGoal`로 가른다. `hardGoalSuccess`가 요구
  축이 하나도 없으면 `null`이 되는 분기
- 코드: `src/core/usecases/montecarlo/describeSuccessRates.ts`의
  `describeHardGoalRelationship()` — HARD 목표 판정 확률이 목표 달성 확률의 «완화»라서
  항상 그 값 이상이라는 관계를 밝히는 한 문장. 화면·PDF가 같은 문장을 인쇄해야 하므로
  한 곳에 둔다(`describeCompositeNote`와 같은 이유)
- 코드: `src/core/usecases/goals/goalSuccessConditions.ts`의 `hardTerminalAssetOf()` —
  세 파생값(`hardTerminalAssetGoal`·`hardRequirements.terminalAsset`·
  `hardRequirementGoals.terminalAsset`)이 모두 여기서 나온다. 따로 유도하면 「축은 켜졌는데
  문턱이 0」 같은 모순 상태가 생기고, 그 상태에서 화면은 위반을 설명할 이름을 갖지 못한다.
  `failsTerminalAsset`(목표 달성)과 `failsHardTerminalAsset`(HARD 판정)이 서로 다른 문턱을
  읽는 것도 여기서 갈린다
- 테스트: `src/tests/core/usecases/goals/goalSuccessConditions.test.ts`의
  「기말자산 HARD 문턱」 describe — SOFT가 더 커도 HARD 위반을 잡는가, HARD 둘이면 귀속이
  둘인가, 0원 확정이 축을 세우지 않는가, 세 파생값이 어긋날 수 없는가(조합 순회)
- 테스트: `src/tests/core/usecases/goals/targetValueProvenance.test.ts`의 「기말자산 HARD —
  결정론 평가와 몬테카를로가 같은 답을 한다」 — 한 경로만 고치면 두 경로가 같은 계획에
  반대로 답하게 된다
- 테스트: `src/tests/web/features/RetirementGoals/goalCatalog.test.ts` — 「금액으로
  판정하는 유형은 모두 금액 입력칸을 갖는다」(`hasMoneyTarget`과 카탈로그의 `currency`
  입력칸이 양방향으로 같은 집합인지 검사한다. 금액으로 판정하면서 그 금액을 넣을 칸이
  없는 유형이 생기면 사용자가 영원히 확정할 수 없는 HARD가 만들어진다), 「금액을 비워 둘
  수 있는 목표는 엔진이 정량 판정하는 유형이다」(그 카드가 「비워 두어도 채점됩니다」라고
  말하므로)
- 테스트: `src/tests/web/features/RetirementGoals/RetirementInputFlow.test.tsx`의
  「금액을 비워 둔 「자산 성장」은 분석을 막지 않는다」·「금액이 필수인 「상속 자산
  확보」는 비어 있으면 여전히 막는다」 — 묻는 것과 요구하는 것의 구분이 관문에 실제로
  반영됐는지
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
  들어가는 것을 검증), 「재현 사례 1」(목표액이 빈 `ASSET_GROWTH`는 유형상 판정
  가능해도 축을 못 켜 `unjudged`), 「재현 사례 2」(SOFT 목표가 기말자산 문턱을 가로채면
  확정 HARD 상속 목표가 `unjudged`), 「EARLY_RETIREMENT는 judged도 unjudged도 아닌
  planEmbedded다」
- 테스트: `src/tests/web/features/Dashboard/DashboardSection.test.tsx`와
  `src/tests/web/features/Pdf/pdfReportSections.test.ts`의 「확정 HARD 목표가 모두 이
  비율에 반영되면 "모두 포함됩니다"라고 밝힌다」·「계획에 이미 반영된 HARD 목표(빠른
  은퇴)는 반영되지 않았다고 말하지 않는다」 — 화면·PDF가 세 갈래(judged/unjudged/
  planEmbedded)를 같은 문장으로 인쇄하는지, HARD 비율과 목표 달성 확률의 관계 문구가
  함께 찍히는지 검증한다

## 관련

[[원장 불변식]] — HARD 생활비 바닥과 `assertSpendingShortfallExplained`의 관계.
[[도달 가능성 5단계]]
