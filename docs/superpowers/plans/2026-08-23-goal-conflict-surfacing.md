# 목표 충돌을 사용자에게 보여준다 — 구현 계획

> **에이전트에게:** `superpowers:subagent-driven-development`로 태스크별로 진행한다.

**목표:** `GoalEvaluationEngine`이 이미 만들고 있는 `goalConflict` / `conflictingGoals` /
`yieldedGoal`을 화면과 PDF에 «같은 문장으로» 내보낸다.

**스펙:** `docs/superpowers/specs/2026-08-22-goal-constraint-hierarchy-design.md`의
「목표 충돌의 표시 정책 (2026-08-23 확정)」 절. **문구는 그 절이 확정한 것을 그대로 쓴다.**

**기술 스택:** TypeScript / React 19 / Next.js 16 / Vitest 4

## Global Constraints

- 금액 단위는 원(KRW), 비율은 퍼센트. 새 금융 가정·세율·수익률을 만들지 않는다(AGENTS.md).
- 동일한 계산식은 하나만 둔다(SSOT). **화면과 PDF는 같은 함수의 같은 문장을 쓴다** —
  78d19dc·7ef33c0이 세운 규칙이고, 문구를 두 벌로 두면 반드시 갈라진다.
- `SimulationEngine.ts`는 `retirementGoals`/`constraintType`/목표 유형을 **0건**으로 유지한다.
- 커밋 메시지와 주석은 한국어, 저장소의 기존 목소리로 «왜»를 적는다.
- 저장 값은 `'HARD' | 'SOFT'`, 내부 도메인명 `GOAL_CONFLICT` 유지. 한글은 표시 계층에서만.

---

## 지금 배선이 어디까지 있나 (조사 완료 — 다시 조사하지 말 것)

| 사실 | 근거 |
|---|---|
| `goalConflict`는 `DefaultGoalEvaluationEngine`만 채운다 | `GoalEvaluationEngine.ts:631-655` |
| 그 엔진은 **`StrategyOptimizer` 안에서 «후보마다»** 돈다 | `StrategyOptimizer.ts:489` |
| 화면이 부르는 `LegacyEvaluationEngine`은 **전혀 다른 것**을 돌려준다 | `LegacyEvaluationEngine.ts:27-60` |
| → **사용자의 «현재 계획»에 대한 충돌 판정은 아직 아무데서도 계산되지 않는다** | |

**이것이 이 작업의 본체다.** 표시는 그 다음이다.

화면에 이미 있는 재료:
- `domainInput = LegacySimulationAdapter.fromLegacy(params, utilityConfig)` (`DashboardSection.tsx:169`)
  → `.profile` / `.goals` / `.strategy`
- `result: SimulationResult` (`:49`)

`DefaultGoalEvaluationEngine.evaluate(profile, goals, strategy, result)`가 요구하는 것은
`StrategySimulationResult`다. 화면의 `result`는 `SimulationResult`이므로 **형이 다르다.**
`StrategyOptimizer`는 `simulationEngine.simulate(profile, strategy)`로 만든 것을 넘긴다.
1단계가 이 간극을 어떻게 메울지 «측정해서» 정한다 — 새 시뮬레이션을 돌리는 것은 마지막 수단이다.

렌더 위치(조사 완료):
- 화면 — `DashboardSection.tsx:351`의 `</DashboardGroup>`(진단 닫힘)과
  `:353`의 `<DashboardGroup title="NextLife 추천">` **사이**
- PDF — `src/app/simulator/page.tsx:253`의 `renderPlanVerdictSection` 결과와
  `renderStrategyRecommendationSection` 결과 **사이**

---

## 1단계: 현재 계획의 충돌을 계산한다

**Files**
- Modify: `src/core/evaluation/LegacyEvaluationEngine.ts`
- Modify: `src/core/evaluation/EvaluationEngine.ts` (`RetirementEvaluation`에 필드 추가)
- Test: `src/tests/core/evaluation/legacyGoalConflict.test.ts` (신규)

**Interfaces**
- Produces: `RetirementEvaluation.goalConflict?: { goalConflict, conflictingGoals, yieldedGoal }`
  — `GoalEvaluationResult`에서 그 셋만 뽑은 것. 전체를 노출하지 «않는다»(화면이 필요한 것만).

**단계**

- [x] **1-1.** `SimulationResult` → `StrategySimulationResult` 간극을 «측정»한다.
      기존 어댑터로 변환 가능한가, 아니면 `DefaultGoalEvaluationEngine`이 실제로 읽는 필드가
      `SimulationResult`에 이미 다 있는가. **새 시뮬레이션을 돌려야 한다면 그 비용을 재고
      보고하라** — 화면은 매 입력마다 재계산되므로 한 번의 추가 시뮬레이션이 체감된다.
- [x] **1-2.** 실패하는 테스트를 쓴다: HARD 생활비 + HARD 상속으로 충돌이 서는 계획에서
      `evaluation.goalConflict.goalConflict === true`이고 `conflictingGoals`에 양쪽이 들어간다.
      충돌이 없는 평범한 계획에서는 `goalConflict === false`이고 `conflictingGoals`가 빈 배열이다.
- [x] **1-3.** 구현한다. `DefaultGoalEvaluationEngine.evaluate`를 통째로 부르는 것이
      가장 단순하지만 효용 계산까지 함께 돈다. **비용을 재고 정하라** — 무시할 만하면
      단순한 쪽이 옳고, 무겁다면 `detectGoalConflict`가 필요로 하는 것만 좁혀 뽑는다.
      어느 쪽이든 «판정 규칙을 복제하지 마라». 규칙은 `GoalEvaluationEngine.ts`에만 있어야 한다.
- [x] **1-4.** 테스트 통과 확인 → 커밋.

**1-1 측정 결과 (2026-08-23).** 간극은 «없었다». `StrategySimulationResult`가 요구하는 셋
(`yearlyResults`·`depletionAge`·`endingAssets`)을 `SimulationResult`가 이미 전부 같은 형으로
가지고 있어 그대로 넘어간다 — 어댑터도, 두 번째 시뮬레이션도 필요 없다.
`DefaultGoalEvaluationEngine.evaluate`를 통째로 부르는 비용은 실측 0.040ms/회로,
화면이 이미 돌리는 `LegacyEvaluationEngine.evaluate`(0.068ms)의 절반이고
시뮬레이션 한 번(0.83ms)의 5%다. 그래서 좁히지 않고 통째로 불러 세 필드만 받는다.

**3·4단계가 읽을 자리:** `evaluation.goalConflict`
(`RetirementEvaluation.goalConflict: GoalConflictVerdict`, 필수 필드) →
`describeGoalConflict(evaluation.goalConflict)` → `undefined`면 그리지 않는다.

---

## 2단계: 문구를 만드는 함수 (화면·PDF 공용)

**Files**
- Create: `src/core/usecases/goals/describeGoalConflict.ts`
- Test: `src/tests/core/usecases/goals/describeGoalConflict.test.ts` (신규)

**Interfaces**
- Consumes: 1단계의 `goalConflict` 묶음
- Produces:
  ```ts
  export interface GoalConflictDescription {
    title: string;              // 「동시에 달성하기 어려운 목표가 있습니다」
    lead: string;               // yieldedGoal 유무로 갈리는 두 문장 중 하나
    shortfalls: string[];       // 「생활비 월 12만원 부족」 같은 항목들
  }
  export function describeGoalConflict(input: {...}): GoalConflictDescription | undefined;
  ```
  **충돌이 없으면 `undefined`를 돌려준다.** 소비자가 그것으로 「블록을 그리지 않는다」를 판정한다 —
  빈 문자열이나 빈 배열을 돌려주면 소비자마다 「비었다」의 기준을 새로 정하게 된다.

**문구는 스펙이 확정한 것을 그대로 쓴다.**

`yieldedGoal`이 «있으면»:
> 「반드시 지키기」로 설정한 생활비를 상속 목표보다 우선했습니다.
> 그래도 두 목표를 모두 충족하기에는 자산이 부족합니다.

`yieldedGoal`이 «없으면»:
> 현재 조건에서는 아래 목표를 모두 충족할 수 없어 어느 하나를 임의로 우선하지 않았습니다.

**「지켰다/달성했다」로 쓰지 마라.** 이긴 쪽도 미달일 수 있다
(`ConflictingGoal.shortfall` 주석). **「우선했다」가 정확한 말이다.**

**단계**

- [x] **2-1.** 실패하는 테스트를 쓴다 — 네 가지를 «문장 전문»으로 고정한다:
      (a) `yieldedGoal` 있음 → 「우선했습니다」 문장 + 양쪽 미달이 «모두» 들어간다
      (b) `yieldedGoal` 없음 → 「임의로 우선하지 않았습니다」 문장 + 미달 «전부»
      (c) 충돌 없음 → `undefined`
      (d) 이긴 쪽 미달이 0인 경우 → 그 항목은 목록에서 빠지되 문장은 그대로다
      **enum이나 배열 길이만 검사하지 마라** — 문구가 틀려도 통과한다.
- [x] **2-2.** 미달 서식을 «목표 유형»으로 가른다. 스펙의 표:

      | 목표 | `unit` | 문구 |
      |---|---|---|
      | 생활비 | `MONTHLY_MONEY` | 월 12만원 부족 |
      | 상속 | `MONEY` | 8,400만원 부족 |
      | 자산 고갈 방지 | `YEARS` | 목표보다 3년 짧음 |

      **`unit`으로 분기하지 마라.** `YEARS`는 자산 고갈에서 「짧음」, 은퇴 나이에서 「늦음」으로
      «반대 방향»이다. 단위로 가르면 둘 중 하나가 반드시 틀린 말을 한다.
      **은퇴 나이 분기는 만들지 않는다** — `EARLY_RETIREMENT`는 planning constraint라
      `conflictingGoals`에 들어오지 않는다(스펙). 도달하지 않는 분기는 검증할 수 없다.
- [x] **2-3.** 목표 이름은 `RETIREMENT_GOAL_CONSTRAINT_LABELS`와 같은 단일 출처를 쓴다.
      새 라벨을 «선언하지 마라» — 1502876이 세 벌이던 어휘를 하나로 합친 곳이다.
- [x] **2-4.** 통과 확인 → 커밋.

---

## 3단계: 화면 블록

**Files**
- Modify: `src/web/features/Dashboard/DashboardSection.tsx`
- Modify: `src/web/features/Dashboard/Dashboard.module.css`
- Test: `src/tests/web/features/Dashboard/DashboardSection.test.tsx`

**단계**

- [ ] **3-1.** 실패하는 테스트: 충돌이 있는 계획에서 제목과 두 미달 항목이 렌더된다.
      충돌이 없으면 **블록 자체가 DOM에 없다**(빈 껍데기도 「충돌 없음」 문구도 두지 않는다).
- [ ] **3-2.** `:351`의 `</DashboardGroup>`과 `:353`의 추천 그룹 «사이»에 삽입한다.
      **「현재 계획 진단」 카드 «안»이 아니다** — 그 카드는 「내 계획이 어떤가」를 말하고
      충돌은 「내가 고른 목표들이 서로 맞지 않는다」는 다른 층위다(스펙).
- [ ] **3-3.** 스타일은 기존 경고 계열 블록을 재사용한다. 새 시각 언어를 만들지 마라.
      카드 수에 따라 칸이 달라지는 `.recommendationGrid`(625b37e)처럼 «고정 열 수»를
      가정하는 규칙을 새로 만들지 않는다.
- [ ] **3-4.** 통과 확인 → 커밋.

---

## 4단계: PDF 블록

**Files**
- Modify: `src/web/features/Pdf/pdfReportSections.ts`
- Modify: `src/app/simulator/page.tsx`
- Test: `src/tests/web/features/Pdf/pdfReportSections.test.ts`

**단계**

- [ ] **4-1.** 실패하는 테스트: 충돌이 있으면 같은 문장이 나오고, 없으면 «빈 문자열»이다.
- [ ] **4-2.** `renderGoalConflictSection`을 만들어 2단계 함수의 결과를 그린다.
      **문구를 다시 만들지 마라** — 2단계 함수를 부른다.
- [ ] **4-3.** `page.tsx:253`의 `planVerdictSectionHtml`과 추천 섹션 «사이»에 끼운다.
      `renderMonteCarloSection`이 `params`를 «필수»로 받게 한 전례(7ef33c0)를 따라,
      새 인자도 선택 인자로 두지 마라 — 빠뜨리면 조용히 사라진다.
- [ ] **4-4.** 통과 확인 → 커밋.

---

## 5단계: 전체 검증

```bash
npx tsc --noEmit
npm test
npm run harness:personas
```

**움직이면 «안» 되는 것**
- `src/tests/fixtures/engineRegression.json` — 표시 전용 변경이다.
- 페르소나 CSV — 같은 이유.
- 확률·시뮬레이션 값 «전부». 1단계가 새 시뮬레이션을 돌리더라도 «읽기»만 해야 한다.

움직이면 **멈추고 보고하라.** 표시 작업이 계산을 건드렸다는 뜻이다.

**되돌림 검증:** 각 단계의 새 테스트가 그 단계를 되돌렸을 때 실패하는지 확인하고
개수를 보고한다. 양쪽 다 통과하는 테스트는 없는 것과 같다.
