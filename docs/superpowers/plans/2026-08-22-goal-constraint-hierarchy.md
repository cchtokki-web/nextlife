# 목표 제약 계층 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목표의 HARD/SOFT 강도가 «후보 선택과 채점»만이 아니라 «연도별 인출 행동»까지 지배하게 하고, 그 결과 감사에서 나온 결함 셋(AUDIT-001·002·003)을 닫는다.

**Architecture:** 엔진은 목표를 계속 «모른다». 목표는 파생 파라미터로만 도달한다 — 이번에 더하는 것은 `SimulationParams.hardSpendingFloor` 하나다. 인출 루프는 두 벌로 나누지 않고, 기존 루프에 「지금 채우는 것이 HARD 바닥인가」 플래그를 넘겨 클램프 적용 여부만 가른다. 원장은 엔진 어휘로만 사실을 적고, 그것을 목표 유형으로 번역하는 일은 평가 계층이 맡는다.

**Tech Stack:** TypeScript, Next.js 16, Vitest 4, React 19

**Spec:** `docs/superpowers/specs/2026-08-22-goal-constraint-hierarchy-design.md` (`852831d`)

## Global Constraints

- 새 금융 제도·세율·수익률 가정을 만들지 않는다 (AGENTS.md).
- `YIELD_PRESET_RATES`(5/3·7/4·9/6)와 `ECONOMIC_SCENARIO_PROFILES`(2.5/base·1.5/usd_up·5/usd_up·2/base)를 바꾸지 않는다.
- **`goalCatalog.ts`의 `defaultConstraintType`을 바꾸지 않는다.** 「생활비 안정」은 `SOFT`로 남는다.
- **저장된 `constraintType`을 마이그레이션하거나 자동 변경하지 않는다.**
- **`strategy.minMonthlySpending`의 뜻·소비처·삭제 동작을 바꾸지 않는다.** 런타임 바닥은 별도 파라미터다.
- 금액 단위는 원(KRW), 수익률·물가 단위는 %(7% → `7`).
- 커밋 메시지는 한국어로 「무엇을 왜」를 적는다.
- `npx vitest run <경로>`, 전체는 `npm test`. 타입은 `npx tsc --noEmit`.
- 브랜치 `develop-2`, HEAD `852831d`.
- `src/tests/core/usecases/SimulationEngine.auditFindings.test.ts`는 **미추적 파일**이며 4건이 의도적으로 실패 중이다. Task 2·3이 그 4건을 통과시킨다. Task 8에서 커밋한다.

---

### Task 1: `hardSpendingFloor`를 목표에서 유도한다

**Files:**
- Modify: `src/core/entities/types.ts` (`SimulationParams`에 `hardSpendingFloor?: number` 추가, `assetFloor` 선언 근처 324행)
- Modify: `src/core/usecases/strategy/compileStrategy.ts` (354-382행 근처에서 유도, 459-460행 패턴으로 방출)
- Modify: `src/core/usecases/goals/normalizeGoalDrivenParams.ts` (`targetMonthlySpending`을 max 기반으로)
- Test: `src/tests/core/usecases/strategy/compileStrategy.spendingFloor.test.ts` (신규)

**Interfaces:**
- Produces: `SimulationParams.hardSpendingFloor?: number` — HARD 생활비 목표에서 유도된 월 금액(원). 없으면 키 자체가 없다.
- Produces: `compileStrategy(params)` — 위 필드를 실은 `params`.
- 뒤 태스크가 의존: Task 3(인출 1단계), Task 6(탐색에서 제거), Task 4(원장 진단).

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/tests/core/usecases/strategy/compileStrategy.spendingFloor.test.ts` 생성:

```ts
import { describe, test, expect } from 'vitest';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { SimulationParams } from '@/core/entities/types';
import type { RetirementGoal } from '@/core/entities/retirementGoal';

function paramsWithGoals(goals: RetirementGoal[]): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    assets: [], privatePensions: [], isaAccounts: [], otherIncomes: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 2.5, inflationMode: 'real', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    retirementGoals: goals,
  } as unknown as SimulationParams;
}

const stability = (v: number, c: 'HARD' | 'SOFT'): RetirementGoal =>
  ({ type: 'LIVING_EXPENSE_STABILITY', priority: 1, targetValue: v, constraintType: c });
const comfortable = (v: number, c: 'HARD' | 'SOFT'): RetirementGoal =>
  ({ type: 'COMFORTABLE_SPENDING', priority: 2, targetValue: v, constraintType: c });

describe('hardSpendingFloor는 강도에서 나온다', () => {
  // 유형으로 강도를 추론하지 않는다. constraintType은 사용자가 모든 목표에 대해 자유롭게
  // 고르는 실제 도메인 값이고(RetirementGoalSelector의 select), defaultConstraintType은
  // 처음 고를 때의 씨앗일 뿐이다.
  test('생활비 안정만 SOFT — 바닥 없음 (기본 상태)', () => {
    const compiled = compileStrategy(paramsWithGoals([stability(2_500_000, 'SOFT')]));

    expect(compiled.params.hardSpendingFloor).toBeUndefined();
    expect('hardSpendingFloor' in compiled.params).toBe(false);
    expect(compiled.params.userProfile.targetMonthlySpending).toBe(2_500_000);
  });

  test('생활비 안정만 HARD — 바닥 = 목표', () => {
    const compiled = compileStrategy(paramsWithGoals([stability(2_500_000, 'HARD')]));

    expect(compiled.params.hardSpendingFloor).toBe(2_500_000);
    expect(compiled.params.userProfile.targetMonthlySpending).toBe(2_500_000);
  });

  test('안정 HARD + 여유 SOFT — 바닥과 목표가 갈린다', () => {
    const compiled = compileStrategy(
      paramsWithGoals([stability(2_500_000, 'HARD'), comfortable(3_500_000, 'SOFT')])
    );

    expect(compiled.params.hardSpendingFloor).toBe(2_500_000);
    expect(compiled.params.userProfile.targetMonthlySpending).toBe(3_500_000);
  });

  test('안정 SOFT + 여유 HARD — 바닥이 목표까지 올라간다', () => {
    const compiled = compileStrategy(
      paramsWithGoals([stability(2_500_000, 'SOFT'), comfortable(3_500_000, 'HARD')])
    );

    expect(compiled.params.hardSpendingFloor).toBe(3_500_000);
    expect(compiled.params.userProfile.targetMonthlySpending).toBe(3_500_000);
  });

  test('바닥은 언제나 목표 이하다', () => {
    for (const goals of [
      [stability(2_500_000, 'HARD')],
      [stability(2_500_000, 'HARD'), comfortable(3_500_000, 'SOFT')],
      [stability(2_500_000, 'SOFT'), comfortable(3_500_000, 'HARD')],
      [stability(3_500_000, 'HARD'), comfortable(2_500_000, 'HARD')],
    ]) {
      const compiled = compileStrategy(paramsWithGoals(goals));
      const floor = compiled.params.hardSpendingFloor;
      if (floor !== undefined) {
        expect(floor).toBeLessThanOrEqual(compiled.params.userProfile.targetMonthlySpending);
      }
    }
  });

  test('0은 목표값으로 인정하지 않는다 (기존 가드 유지)', () => {
    const compiled = compileStrategy(paramsWithGoals([stability(0, 'HARD')]));

    expect(compiled.params.hardSpendingFloor).toBeUndefined();
  });

  test('목표를 고르지 않은 시나리오는 바닥이 없다', () => {
    const bare = paramsWithGoals([]);
    delete (bare as Record<string, unknown>).retirementGoals;

    expect(compileStrategy(bare).params.hardSpendingFloor).toBeUndefined();
  });

  test('멱등 — 두 번 컴파일해도 같다', () => {
    const once = compileStrategy(paramsWithGoals([stability(2_500_000, 'HARD')])).params;
    const twice = compileStrategy(once).params;

    expect(twice.hardSpendingFloor).toBe(once.hardSpendingFloor);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/tests/core/usecases/strategy/compileStrategy.spendingFloor.test.ts`
Expected: FAIL — `hardSpendingFloor`가 존재하지 않아 전부 `undefined`. 「안정만 HARD」·「안정 HARD + 여유 SOFT」 등이 깨진다.

- [ ] **Step 3: 타입을 더한다**

`src/core/entities/types.ts`의 `assetFloor?: number;`(324행) 바로 아래에 추가:

```ts
  // HARD 생활비 목표에서 유도된 월 생활비 바닥(displayCurrency 기준). 이 금액까지는
  // 전략 선호(계좌 순서·월 인출 목표·일반자산 개시 나이)와 세제 최적화(저율과세 한도)를
  // 깨고 채운다. 미지정이면 바닥이 없고 인출 동작은 기존과 비트 단위로 동일하다.
  //
  // **strategy.minMonthlySpending과 다르다.** 그쪽은 화면 경고용이며 엔진에 내려가지
  // 않는다(그 필드의 주석 참조). 한 이름에 두 뜻을 붙이지 않으려고 별도 필드를 둔다.
  //
  // assetFloor와 같은 이유로 withdrawalPlan이 아니라 최상위에 둔다 — 후보 탐색이
  // withdrawalPlan을 통째로 교체하므로 그 안에 두면 모든 후보에서 조용히 사라진다.
  hardSpendingFloor?: number;
```

- [ ] **Step 4: 유도를 넣는다**

`src/core/usecases/strategy/compileStrategy.ts`에서 `hasHardAssetSurvivalGoal`(375행) 근처, `assetFloor` 계산 뒤에 추가:

```ts
  // 생활비 목표에서 «강도»로 바닥을 유도한다. 유형으로 강도를 추론하지 않는다 —
  // constraintType은 사용자가 모든 목표에 대해 자유롭게 고르는 값이고, goalCatalog의
  // defaultConstraintType은 처음 고를 때의 씨앗일 뿐이다.
  //
  // targetValue > 0 가드는 normalizeGoalDrivenParams.firstGoalWithTarget의 것과 같다:
  // 0은 「입력창을 비웠다」이지 「생활비 0원이 목표」가 아니다.
  const SPENDING_GOAL_TYPES: readonly RetirementGoalType[] =
    ['LIVING_EXPENSE_STABILITY', 'COMFORTABLE_SPENDING'];
  const hardSpendingTargets = (params.retirementGoals ?? [])
    .filter((goal) => SPENDING_GOAL_TYPES.includes(goal.type)
      && goal.constraintType === 'HARD'
      && goal.targetValue !== undefined
      && goal.targetValue > 0)
    .map((goal) => goal.targetValue as number);
  const hardSpendingFloor = hardSpendingTargets.length > 0
    ? Math.max(...hardSpendingTargets)
    : undefined;
```

그리고 459-460행의 패턴을 그대로 따라 방출한다:

```ts
  if (hardSpendingFloor === undefined) delete compiledParams.hardSpendingFloor;
  else compiledParams.hardSpendingFloor = hardSpendingFloor;
```

필요한 import(`RetirementGoalType`)를 상단에 추가한다.

**주의**: `compileStrategy`에는 「아무것도 바꾸지 않은 시나리오는 입력이 비트 단위로 보존된다」는 통과 경로가 있다(303행). `retirementGoals`가 없으면 그 경로를 타므로 이 유도가 아예 돌지 않아야 한다 — 위 코드는 `?? []`로 빈 배열이 되어 `undefined`를 내므로 통과 경로가 유지된다. 테스트가 그것을 고정한다.

- [ ] **Step 5: `targetMonthlySpending`을 max 기반으로 바꾼다**

`src/core/usecases/goals/normalizeGoalDrivenParams.ts:98-100`을 교체한다.

```ts
  // 생활비 목표가 여럿이면 «가장 큰» 값이 목표다. 예전에는 우선순위가 높은 쪽이 이겨
  // (firstGoalWithTarget) 「생활비 안정」을 1순위에 둔 사용자의 「여유 있는 소비」 금액이
  // 계산에 닿지 못했다. 사용자가 고른 두 값이 둘 다 계산에 닿게 한다.
  //
  // 목표가 하나도 없으면 저장값을 그대로 둔다 — 목표 금액은 모든 생활비 전략에서 소비
  // 만족도의 «분모»라 계산에 계속 필요하고, 이 축에는 「권장」 상수가 없다.
  const spendingTargets = goals
    .filter((goal) =>
      (goal.type === 'LIVING_EXPENSE_STABILITY' || goal.type === 'COMFORTABLE_SPENDING')
      && goal.targetValue !== undefined && goal.targetValue > 0)
    .map((goal) => goal.targetValue as number);
  const targetMonthlySpending = spendingTargets.length > 0
    ? Math.max(...spendingTargets)
    : current.targetMonthlySpending;
```

- [ ] **Step 6: 컴파일 + 테스트**

Run: `npx tsc --noEmit && npx vitest run src/tests/core/usecases/strategy/ src/tests/core/usecases/goals/`
Expected: PASS. 우선순위 순서로 목표 금액을 단언하던 기존 테스트가 있으면 max 규칙으로 갱신한다 — 깨졌다는 것 자체가 그 테스트가 옛 규칙을 검증하고 있었다는 신호다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: HARD 생활비 목표에서 인출 바닥을 유도한다

목표의 강도가 채점에만 쓰이고 인출에는 닿지 않았다. HARD 생활비 목표가 있으면
그 금액을 hardSpendingFloor로 유도해 엔진에 내린다(다음 커밋에서 소비).

strategy.minMonthlySpending을 재사용하지 않는다. 그 필드의 주석이 「엔진 params로
내려가지 않는다」를 못박고 있고, 이진탐색의 성공 조건이 되면 「얼마까지 쓸 수 있는가」의
답 자체가 사라지기 때문이다. 한 이름에 두 뜻을 붙이지 않는다.

유형이 아니라 강도로 유도한다 — constraintType은 사용자가 모든 목표에서 자유롭게
고르는 값이고 defaultConstraintType은 씨앗일 뿐이다. 「생활비 안정」의 기본값이
SOFT이므로 대부분의 저장 시나리오는 바닥이 서지 않고 결과가 그대로다.

목표 금액도 우선순위가 아니라 max로 정한다. 예전에는 「생활비 안정」을 1순위에 둔
사용자의 「여유 있는 소비」 금액이 계산에 닿지 못했다."
```

---

### Task 2: ISA 인출 등록 게이트를 제거한다 (AUDIT-001)

**Files:**
- Modify: `src/core/usecases/SimulationEngine.ts:1471-1497`
- Test: `src/tests/core/usecases/SimulationEngine.auditFindings.test.ts` (기존 미추적 파일 — 통과시킨다)

**Interfaces:**
- Consumes: 없음 (독립)
- Produces: 인출 정책이 미지정이어도 ISA가 인출 계좌로 등록된다.

- [ ] **Step 1: 현재 실패를 확인한다**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.auditFindings.test.ts -t "AUDIT-001"`
Expected: 대조군 1건 통과, 나머지 2건 FAIL (`expected 36000000 to be +0`).

- [ ] **Step 2: 게이트를 지운다**

`SimulationEngine.ts:1475`의 `if (withdrawalPlan?.accountWithdrawalPolicy !== undefined) {` 조건문을 제거하고 그 안의 `for (const isa of activeIsas)` 루프를 한 단계 밖으로 꺼낸다. 위의 주석 블록(1471-1474행)을 다음으로 교체한다:

```ts
          // ISA도 인출 계좌로 등록한다. 예전에는 계좌군 정책을 «명시»한 경로에서만
          // 등록했는데(옛 시나리오 호환), 그 게이트가 정책 기본값과 모순이었다 —
          // 아래 withdrawalEngine 호출은 정책 미지정 시 'GENERAL_FIRST'를 쓰고
          // 그 순서에는 ISA가 마지막으로 들어 있다(WithdrawalEngine의 POLICY_ORDER).
          // 즉 엔진은 「GENERAL_FIRST를 쓴다」고 말하면서 정렬할 ISA를 주지 않았고,
          // ISA만 들고 있는 계획은 잔액이 그대로인 채 매년 생활비 전액이 미충족으로
          // 기록됐다(총자산이 줄지 않아 고갈로도 잡히지 않는다).
          //
          // 중도인출은 프로젝트가 확실히 추적하는 납입원금(totalInvested) 범위로
          // 제한한다 — 한국 ISA가 그 범위의 중도인출을 허용하므로 모델이 현실과 맞고,
          // 수익금은 만기까지 남아 비과세 한도 계산에 그대로 들어간다.
          // 순서상 마지막이므로 다른 계좌를 다 쓴 뒤에만 헐린다.
```

- [ ] **Step 3: 테스트 통과를 확인한다**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.auditFindings.test.ts -t "AUDIT-001"`
Expected: 3건 전부 PASS.

- [ ] **Step 4: 회귀 확인**

Run: `npx tsc --noEmit && npx vitest run src/tests/core/usecases/SimulationEngine.regressionFixture.test.ts`
Expected: PASS **변경 없이**. 골든의 두 케이스는 ISA를 만기 전에 헐 상황이 아니다. 값이 움직였다면 그 이유를 밝히고 보고한다 — 숫자를 갱신하지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "fix: ISA를 인출 계좌로 등록한다

인출 정책이 미지정이면 ISA가 인출 후보로 등록조차 되지 않았다. 그 게이트는 옛
시나리오 호환을 위한 것이었지만 정책 기본값과 모순이었다 — 엔진은 정책이 없으면
GENERAL_FIRST를 쓰는데 그 순서에는 ISA가 들어 있다. 정렬할 계좌를 주지 않으면서
정렬하겠다고 말하고 있었다.

실측: ISA 2억을 들고 목표 월 300만원인 계획이 매년 3,600만원 «전액»을 미충족으로
기록하면서 잔액은 2억 그대로였고, 총자산이 줄지 않아 고갈로도 잡히지 않아
리포트에는 「평생 유지」로 나왔다.

중도인출 한도는 그대로 납입원금 범위다. 순서상 마지막이라 다른 계좌를 다 쓴 뒤에만
헐린다."
```

---

### Task 3: 인출을 2단계로 가른다 (AUDIT-002)

**Files:**
- Modify: `src/core/usecases/SimulationEngine.ts` — 예정 인출 한도(1190-1194), 부족분 인출 `availableGross`(1512-1532), 일반자산 개시 나이(1385-1394), 인출 호출부(1568-1578)
- Test: `src/tests/core/usecases/SimulationEngine.auditFindings.test.ts` (AUDIT-002)
- Test: `src/tests/core/usecases/SimulationEngine.spendingFloor.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `params.hardSpendingFloor`.
- Produces: 한 해의 인출이 두 번 일어난다 — 1단계(바닥, 선호 무시)와 2단계(목표, 선호 준수).

**설계 지시 (이 태스크가 이 계획에서 가장 위험하다):**

인출 루프를 **두 벌로 복제하지 않는다.** 세금 누적·원장 집계가 그 위에 서 있어 두 벌이 되면
반드시 갈라진다. 대신 계좌 등록과 인출 호출을 「단계」로 파라미터화한다.

- 1단계에서 **무시할 클램프** 셋:
  - `availableGross`의 `if (currentTaxSettings.limitPrivatePensionToTaxLimit) { available = Math.min(available, …) }` (1517-1522행)
  - 같은 함수의 `if (remainingMonthlyPensionTargetKRW !== undefined) { available = Math.min(available, …) }` (1523-1528행)
  - 일반자산 계좌의 `minimumWithdrawalAge: generalAssetWithdrawalStartAge` (1394행) → 1단계에서는 `0`
- 1단계에서도 **계속 차감할 것**: `monthlyPensionPreTaxLimitRemainingKRW`(1541행 부근). 연말
  16.5% 정산이 총 인출액을 봐야 초과분에 세금이 제대로 붙는다. 차감은 남기고 «클램프»만 끈다.
- 1단계에서도 **지킬 것**: 법정 제약(`PRIVATE_PENSION_MIN_START_AGE` 게이트 1508행, ISA
  `min(currentBalance, totalInvested)`), 그리고 `assetFloor`에서 나오는 `protectedHeadroom`은
  Task 5에서 다룬다 — **이 태스크에서는 그대로 둔다.**
- `hardSpendingFloor`가 `undefined`면 1단계를 아예 실행하지 않는다. 그때 동작은 지금과
  비트 단위로 같아야 한다.

인출 금액 배분: 그 달의 필요액을 `floorNeed = min(필요액, 바닥의 월분)`과
`targetNeed = 필요액 - floorNeed`로 나눠, 1단계는 `floorNeed`를, 2단계는 남은 `targetNeed`를
채운다. 두 단계의 인출 결과는 기존과 같은 변수에 누적한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/tests/core/usecases/SimulationEngine.spendingFloor.test.ts` 생성:

```ts
import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

function pensionOnly(over: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 62, targetMonthlySpending: 5_000_000 },
    assets: [], isaAccounts: [], otherIncomes: [],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
      balance: 500_000_000, monthlyContribution: 0,
      totalReturn: 0, dividendYield: 0, currency: 'KRW',
    }],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    taxSettings: { limitPrivatePensionToTaxLimit: true },
    ...over,
  } as unknown as SimulationParams;
}

describe('HARD 바닥은 전략 선호와 세제 최적화를 깬다', () => {
  test('저율과세 한도가 바닥을 막지 못한다', () => {
    // 한도(연 1,500만원)를 켠 채 바닥 월 400만원(연 4,800만원)을 요구한다.
    const result = new SimulationEngine().runSingle(
      pensionOnly({ hardSpendingFloor: 4_000_000 } as Partial<SimulationParams>)
    );

    for (const year of result.yearlyResults) {
      expect(year.spending, `${year.age}세`).toBeGreaterThanOrEqual(48_000_000 - 1);
    }
  });

  test('월 인출 목표가 바닥을 막지 못한다', () => {
    const result = new SimulationEngine().runSingle(pensionOnly({
      hardSpendingFloor: 4_000_000,
      withdrawalPlan: { privatePensionMonthlyTarget: 300_000 },
    } as Partial<SimulationParams>));

    for (const year of result.yearlyResults) {
      expect(year.spending, `${year.age}세`).toBeGreaterThanOrEqual(48_000_000 - 1);
    }
  });

  test('일반자산 인출 개시 나이가 바닥을 막지 못한다', () => {
    const result = new SimulationEngine().runSingle({
      ...pensionOnly(),
      privatePensions: [],
      assets: [{
        id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 500_000_000,
        totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
        reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
      }],
      withdrawalPlan: { generalAssetWithdrawalStartAge: 80 },
      hardSpendingFloor: 4_000_000,
    } as unknown as SimulationParams);

    for (const year of result.yearlyResults) {
      expect(year.spending, `${year.age}세`).toBeGreaterThanOrEqual(48_000_000 - 1);
    }
  });
});

describe('2단계는 선호를 지킨다', () => {
  test('바닥을 넘는 몫에는 저율과세 한도가 그대로 걸린다', () => {
    // 바닥 100만원/월(연 1,200만원), 목표 500만원/월(연 6,000만원), 한도 연 1,500만원.
    // 1단계가 1,200만원을 꺼내고, 2단계는 한도 잔량 300만원까지만 더 꺼낸다.
    const result = new SimulationEngine().runSingle(
      pensionOnly({ hardSpendingFloor: 1_000_000 } as Partial<SimulationParams>)
    );

    const first = result.yearlyResults[0];
    expect(first.spending).toBeGreaterThanOrEqual(12_000_000 - 1);
    expect(first.spending).toBeLessThan(60_000_000);
    expect(first.unmetSpending).toBeGreaterThan(0);
  });
});

describe('바닥이 없으면 아무것도 바뀌지 않는다', () => {
  test('hardSpendingFloor 미지정 시 한도가 그대로 인출을 막는다', () => {
    const result = new SimulationEngine().runSingle(pensionOnly());

    for (const year of result.yearlyResults) {
      expect(year.unmetSpending, `${year.age}세`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.spendingFloor.test.ts`
Expected: 「바닥이 없으면」 1건만 통과, 나머지 4건 FAIL.

- [ ] **Step 3: 구현한다**

위 「설계 지시」대로 단계 파라미터화를 넣는다. 구현 중 판단이 필요한 지점(예: 월 배분의
반올림, 두 단계의 세금 누적 순서)은 **보고서에 근거와 함께 남긴다.**

- [ ] **Step 4: 테스트 통과 + AUDIT-002 확인**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.spendingFloor.test.ts src/tests/core/usecases/SimulationEngine.auditFindings.test.ts`
Expected: 신규 5건 PASS. AUDIT-002 2건 중 「한도 꺼짐」 대조군은 계속 통과하고, 「한도 켜짐」은 그 픽스처에 `hardSpendingFloor`가 없으므로 **여전히 실패한다** — 그 테스트는 Task 8에서 픽스처에 HARD 목표를 넣어 통과시킨다. 이 사실을 보고서에 적는다.

- [ ] **Step 5: 원장·세금 회귀**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.ledger.test.ts src/tests/core/usecases/SimulationEngine.conservation.test.ts src/tests/core/usecases/SimulationEngine.regressionFixture.test.ts`
Expected: 전부 PASS **변경 없이**. 원장 항등식이 깨지면 두 단계의 세금·인출 누적이 어긋난 것이다.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "fix: HARD 생활비 바닥은 전략 선호와 세제 최적화보다 우선한다

저율과세 한도가 인출 자체를 막고 있었다. 실측: 연금 5억을 두고 목표 월 500만원인
계획이 연 1,500만원만 꺼내 4,582만원을 부족으로 기록하고 잔액 4.4억이 남았다.
세금을 아끼려고 굶는 계획을 엔진이 만들고 있었다.

한도를 넘으면 세율이 오를 뿐이다. 초과분 정산 경로(연말 16.5% 분리과세 vs 종합과세
비교)는 이미 있다. 한도는 HARD 제약이 아니라 최적화 선호다.

인출을 두 단계로 가른다. 1단계는 HARD 생활비 바닥을 채우며 저율과세 한도·월 인출
목표·일반자산 개시 나이를 무시하고, 2단계는 목표까지 채우되 그 선호를 지킨다.
한도 잔량 카운터는 양쪽에서 계속 차감한다 — 연말 정산이 총 인출액을 봐야 초과분에
세금이 제대로 붙는다.

바닥이 없으면 1단계는 돌지 않는다. 「생활비 안정」 기본값이 SOFT이므로 대부분의
저장 시나리오는 결과가 그대로다."
```

---

### Task 4: 원장 진단과 「설명되지 않는 부족 금지」 불변식

**Files:**
- Modify: `src/core/entities/types.ts` (`YearlyLedger`에 `diagnostics`)
- Modify: `src/core/usecases/ledger/YearLedger.ts`
- Modify: `src/core/usecases/SimulationEngine.ts` (진단 수집)
- Test: `src/tests/core/usecases/SimulationEngine.spendingFloorDiagnostics.test.ts` (신규)

**Interfaces:**
- Consumes: Task 3의 2단계 인출.
- Produces: `YearlyLedger.diagnostics` — 아래 다섯 필드. Task 5가 이것을 읽어 목표 유형으로 번역한다.

```ts
export interface YearLedgerDiagnostics {
  brokenPreferences: ReadonlyArray<
    'pensionTaxLimit' | 'pensionMonthlyTarget' | 'generalAssetStartAge' | 'assetFloor'>;
  overrideReason?: 'hardSpendingFloor';
  unmetHardSpending: number;
  unmetTargetSpending: number;
  blockedWithdrawalReason?: 'legalAge' | 'isaPrincipalExhausted' | 'assetFloor';
}
```

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// 연금만 있고 55세 미만이라 «법적으로» 인출할 수 없는 해를 만든다.
function tooYoungForPension(): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 50, expectancy: 52, targetMonthlySpending: 3_000_000 },
    assets: [], isaAccounts: [], otherIncomes: [],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
      balance: 500_000_000, monthlyContribution: 0,
      totalReturn: 0, dividendYield: 0, currency: 'KRW',
    }],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    hardSpendingFloor: 3_000_000,
  } as unknown as SimulationParams;
}

describe('설명되지 않는 부족은 남지 않는다', () => {
  test('법정 나이에 막힌 해는 사유가 남는다', () => {
    const result = new SimulationEngine().runSingle(tooYoungForPension());

    for (const year of result.yearlyResults) {
      const d = year.ledger!.diagnostics;
      if (d.unmetHardSpending > 0) {
        expect(d.blockedWithdrawalReason, `${year.age}세`).toBe('legalAge');
      }
    }
  });

  test('바닥을 채우려고 선호를 깬 해는 그 사실이 남는다', () => {
    const result = new SimulationEngine().runSingle({
      ...tooYoungForPension(),
      userProfile: { currentAge: 60, retirementAge: 60, expectancy: 62, targetMonthlySpending: 5_000_000 },
      taxSettings: { limitPrivatePensionToTaxLimit: true },
      hardSpendingFloor: 4_000_000,
    } as unknown as SimulationParams);

    const first = result.yearlyResults[0];
    expect(first.ledger!.diagnostics.brokenPreferences).toContain('pensionTaxLimit');
    expect(first.ledger!.diagnostics.overrideReason).toBe('hardSpendingFloor');
  });

  test('바닥이 없으면 진단이 비어 있다', () => {
    const params = tooYoungForPension();
    delete (params as Record<string, unknown>).hardSpendingFloor;

    const result = new SimulationEngine().runSingle(params);

    for (const year of result.yearlyResults) {
      expect(year.ledger!.diagnostics.brokenPreferences).toEqual([]);
      expect(year.ledger!.diagnostics.unmetHardSpending).toBe(0);
    }
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 불변식 추가**

`YearLedger.ts`에 `assertLedgerConsistent`와 나란히 둔다:

```ts
/**
 * 인출 가능한 자산이 있는데 HARD 생활비 바닥이 부족하면 «반드시» 사유가 있어야 한다.
 *
 * **조용히 보정하지 않는 이유는 assertLedgerConsistent와 같다.** 이유 없는 생활비 부족은
 * 그 자체가 결함이고, 화면에 그대로 흘러가면 사용자가 설명을 요구할 수 없다.
 *
 * 전제의 「인출 가능」은 원시 잔액이 아니라 그 시점에 법적·정책상 꺼낼 수 있는 금액이다.
 * 1단계는 일반자산 개시 나이를 깨므로 그 제한을 빼고 센다.
 */
export function assertSpendingShortfallExplained(
  ledger: YearlyLedger,
  withdrawableNowAtFloorPhase: number,
): void {
  const d = ledger.diagnostics;
  if (d.unmetHardSpending <= 0) return;
  if (withdrawableNowAtFloorPhase <= 0) return;
  if (d.blockedWithdrawalReason !== undefined) return;

  throw new SimulationConsistencyError(
    `${ledger.age}세: 인출 가능 자산 ${Math.round(withdrawableNowAtFloorPhase).toLocaleString()}원이 `
    + `있는데 HARD 생활비 ${Math.round(d.unmetHardSpending).toLocaleString()}원이 부족한데 `
    + `사유가 기록되지 않았습니다.`
  );
}
```

`withdrawableNow`는 엔진에 단계를 파라미터로 받는 헬퍼 하나로 둔다(두 벌로 갈라지지 않게).

- [ ] **Step 3: 테스트 + 회귀 + 커밋**

Run: `npx tsc --noEmit && npx vitest run src/tests/core/usecases/`
Expected: PASS. 커밋 메시지는 「왜 던지는가」를 적는다.

---

### Task 5: 목표 충돌 판정 (평가 계층)

**Files:**
- Modify: `src/core/evaluation/GoalEvaluationEngine.ts` (기존 `HardConstraintFailure` 확장)
- Modify: `src/core/usecases/SimulationEngine.ts` (`assetFloor`가 바닥을 막을 때 `brokenPreferences`/`blockedWithdrawalReason`에 `'assetFloor'` 기록)
- Test: `src/tests/core/evaluation/goalConflict.test.ts` (신규)

**Interfaces:**
- Consumes: Task 4의 `diagnostics`.
- Produces: 평가 결과에 `goalConflict` / `conflictingGoals` / `yieldedGoal`.

**규칙:**
- **계층이 다르면 자동 해소.** HARD 생활비 바닥(계층 1)이 `assetFloor`(계층 2)를 이긴다. 바닥을
  채우려고 `assetFloor`를 깨고, 그 사실을 충돌로 기록한다.
- **같은 계층이면 임의 희생 금지.** 둘 다 깨지 않고, 더 강하게 묶는 쪽이 구속되며, 두 목표와
  부족액을 기록한다. (오늘 계층 2의 두 런타임 제약은 `Math.max`로 합쳐져 충돌하지 않는다 —
  규칙만 명문화하고 테스트로 그 사실을 고정한다.)
- **엔진은 목표 이름을 말하지 않는다.** 원장의 `'assetFloor'`를 「그 하한선이 어느 목표에서
  나왔는가」로 번역하는 것은 이 계층의 일이다.

- [ ] **Step 1: 테스트를 쓴다 — HARD 생활비 ↔ HARD 상속 충돌**

HARD 상속 목표로 `assetFloor`를 세우고 HARD 생활비 바닥을 함께 준 시나리오에서
`goalConflict`가 서고, 상속이 양보하며, 미달액이 기록되는지 단언한다.
동일 계층(상속 HARD + 자산 고갈 방지 HARD)에서는 충돌이 서지 «않고» 하나의 바닥으로
합쳐지는지도 함께 고정한다.

- [ ] **Step 2~4: 구현 → 테스트 → 커밋**

---

### Task 6: 탐색에서 바닥을 떼고, 사후 비교로 보고한다

**Files:**
- Modify: `src/core/usecases/SimulationEngine.ts:234-241` (`sustainabilityTrialParams`)
- Modify: 지속가능 생활비 결과에 바닥 미달을 싣는 자리 (`computeSustainableSpendingAdvice` 또는 평가 계층)
- Test: `src/tests/core/usecases/SimulationEngine.spendingFloorSearch.test.ts` (신규)

- [ ] **Step 1: 실패하는 테스트**

```ts
test('바닥은 이진탐색을 붕괴시키지 않는다', () => {
  // 지속가능 생활비가 바닥보다 «낮은» 계획.
  const result = new SimulationEngine().run({
    /* 지속가능 ≈ 227만원이 나오도록 구성하고 hardSpendingFloor: 2_500_000 */
  } as unknown as SimulationParams);

  // 탐색이 0으로 붕괴하지 않는다.
  expect(result.calculatedTargetSpending).toBeGreaterThan(0);
  // 바닥 미달이 «평가»로 보고된다.
  expect(result.calculatedTargetSpending!).toBeLessThan(2_500_000);
});
```

- [ ] **Step 2: 구현**

`sustainabilityTrialParams`에 한 줄을 더한다:

```ts
    // assetFloor와 같은 이유로 바닥도 뗀다. 생활비 자체가 자유변수인 탐색에서 생활비
    // 바닥을 제약으로 걸면 바닥 미만의 모든 시행이 실패로 읽혀 탐색이 0으로 붕괴한다.
    // 바닥은 탐색의 «성공 조건»이 아니라 탐색 «결과»와 비교할 기준이다.
    delete trial.hardSpendingFloor;
```

그리고 탐색이 끝난 뒤 `calculatedTargetSpending`과 `hardSpendingFloor`를 비교해 미달을 싣는다
(예: 지속가능 227만원 / 바닥 250만원 → 「월 23만원 부족」).

- [ ] **Step 3~4: 테스트 → 커밋**

---

### Task 7: AUDIT-003 불변식 정정

**Files:**
- Modify: `src/tests/core/retirement-domain-invariants/monte-carlo.test.ts:83-97`
- Modify: `src/core/usecases/spending/spendingShortfall.ts` (두 술어의 차이를 한 곳에 적는다)
- Test: 같은 파일

- [ ] **Step 1: 불변식을 고친다**

`≤ spendingSuccessRate` 단언을 지우고 그 자리에 왜 성립하지 않는지를 적는다. `≤ successRate`는
유지한다(같은 술어를 쓰므로).

```ts
  // 목표 성공은 「생활비 충족 ∧ 자산 생존 ∧ 기말자산 목표」의 교집합이지만, 생활비 조건이
  // spendingSuccessRate와 «다른 술어»다 —
  //   spendingSuccessRate            : year.unmetSpending > 0        (엔진 원장, 엡실론 없음, 계획 대비)
  //   goalSuccessProbability의 생활비 : goalShortfall ≥ 월 1만원      (재구성, 엡실론 있음, 목표 대비)
  // 두 집합은 포함관계가 아니므로 부등식이 성립하지 않는다. 실측(2026-08-22): 목표 30.4% >
  // 생활 유지 30.2%. 자산 생존은 같은 술어(isSuccessfulTrial)를 쓰므로 그쪽만 남긴다.
  expect(mc.goalSuccessProbability).toBeLessThanOrEqual(mc.successRate);
```

- [ ] **Step 2: `spendingShortfall.ts`에 두 술어의 차이를 적는다** → **Step 3: 테스트 → 커밋**

---

### Task 8: 라벨·안내 문구·전체 검증

**Files:**
- Modify: `src/core/entities/retirementGoal.ts` (`RETIREMENT_GOAL_CONSTRAINT_LABELS` 신규)
- Modify: `src/web/features/RetirementGoals/RetirementGoalSelector.tsx` (라벨 사용 + 강도 안내 문구)
- Modify: `src/web/features/Dashboard/recommendation/StrategyRecommendationCards.tsx:170`, `src/web/features/Pdf/pdfReportSections.ts:463` (중복 `HARD_CONSTRAINT_LABELS` 통합)
- Modify: `src/tests/fixtures/auditReportCase.json` 또는 감사 테스트 픽스처 (AUDIT-002가 통과하도록 HARD 생활비 목표 추가)
- Commit: `src/tests/core/usecases/SimulationEngine.auditFindings.test.ts` (미추적 → 추적)

- [ ] **Step 1: 라벨 단일 출처**

```ts
/** 조건 강도의 표시 이름. **여기가 유일한 출처다** — 목표 선택 화면·추천 카드·PDF가 같은 말을 쓴다. */
export const RETIREMENT_GOAL_CONSTRAINT_LABELS: Record<RetirementGoalConstraintType, string> = {
  HARD: '반드시 지키기',
  SOFT: '가능하면 달성',
};
```

`RetirementGoalSelector.tsx:186-187`의 하드코딩 `<option>` 문자열을 이 상수에서 뽑아 쓴다.
두 파일에 «각각» 선언된 `HARD_CONSTRAINT_LABELS`도 같은 출처를 보게 합친다.

- [ ] **Step 2: 강도의 행동 차이를 화면이 설명한다**

조건 강도 셀렉터 아래에, **생활비 목표에만** 다음을 붙인다:

> **가능하면 달성** — 목표 생활비에 미달해도 허용합니다. 세금이나 인출 순서를 강제로 깨지 않습니다.
>
> **반드시 지키기** — 법적으로 인출 가능한 자산이 있다면 계좌 순서·월 인출 목표·세제 최적화보다 생활비 충당을 우선합니다.

다른 목표 유형에는 붙이지 않는다 — 강도의 뜻이 다르다.

- [ ] **Step 3: 감사 테스트를 커밋 가능한 상태로**

AUDIT-002 케이스에 HARD 생활비 목표를 넣어 통과시킨다. 6건 전부 통과해야 커밋한다.

- [ ] **Step 4: 전체 검증**

```bash
npx tsc --noEmit
npm test
LEDGER_INPUT=src/tests/fixtures/auditReportCase.json HARNESS_OUT=/tmp/after \
  npx vitest run --config vitest.harness.config.ts scripts/harness/ledger.harness.ts
npm run harness:personas
```

**움직이면 «안» 되는 것** (사전 확인 완료)
- `engineRegression.json` 두 케이스 — `retirementGoals` 키가 아예 없어 바닥이 서지 않는다.
- **페르소나 하니스 CSV — 54명 전원.** `scripts/harness/personas.ts`에 `retirementGoals`가
  **0건**이다(확인함). 따라서 어떤 페르소나에도 바닥이 서지 않고, CSV는 **한 줄도 움직여서는
  안 된다.** 움직였다면 1단계가 목표 없는 계획까지 건드린 것이다.

둘 중 하나라도 움직이면 **숫자를 갱신하지 말고 원인을 찾아 보고한다.**

**움직여야 «하는» 것**
- `auditReportCase.json` — 이 픽스처는 `LIVING_EXPENSE_STABILITY`를 **`constraintType: 'HARD'`,
  목표 300만원**으로 갖고 있다(확인함). 따라서 `hardSpendingFloor = 3,000,000`이 서고
  결정론 결과가 **바뀐다.** 특히 60~64세 구간은 AI 센티널이
  `generalAssetWithdrawalStartAge: 70`을 걸어 월 73만원이 부족했는데, 1단계가 그 선호를
  깨므로 **부족이 줄거나 사라져야 한다.** 그러지 않으면 1단계가 작동하지 않은 것이다.

  Task 8은 before/after를 비교해 다음을 보고한다: 60~64세 `unmetSpending`, 고갈 나이,
  총 부족액, 그리고 원장의 `brokenPreferences`에 `'generalAssetStartAge'`가 찍혔는지.
- HARD 생활비 목표를 가진 다른 시나리오의 부족액·고갈 나이 (과소보고가 멈추는 방향)

- [ ] **Step 5: 커밋**

---

## Self-Review

**스펙 커버리지**

| 스펙 절 | 태스크 |
|---|---|
| 제약 계층 / 계층 밖 분리 | Task 3(1단계가 깨는 것), Task 4(계층 밖은 사유로) |
| 동일 계층 HARD 충돌 | Task 5 |
| 빠른 은퇴는 planning constraint | 변경 없음 — 스펙에 기록만 (엔진이 이미 읽지 않는다) |
| 유형/강도 분리 · 강도 기반 유도 | Task 1 |
| `hardSpendingFloor` 신규 파라미터 | Task 1 |
| 탐색에서 바닥 제거 + 사후 비교 | Task 6 |
| 인출 2단계 | Task 3 |
| 엔진은 목표를 모른다 | Task 4(원장은 엔진 어휘), Task 5(번역은 평가 계층) |
| 연도별 진단 + 불변식 | Task 4 |
| 판정 (AUDIT-003) | Task 7 |
| 표시 + 강도 안내 | Task 8 |
| 호환성 (기본값·마이그레이션 없음) | Global Constraints + Task 8 검증 |

**실행 중 확인할 것**
- Task 3의 행 번호(1190·1385·1512·1568)는 앞 태스크의 편집으로 밀릴 수 있다. 심볼로 찾는다.
- Task 5·6은 다른 태스크보다 코드가 덜 구체적이다. 구현자가 판단한 지점은 보고서에 근거와
  함께 남기고, 스펙과 어긋나면 멈추고 보고한다.
- 사전 확인 완료: 페르소나에 `retirementGoals`가 0건이므로 CSV는 불변이어야 하고,
  `auditReportCase.json`은 HARD 생활비 목표를 가지므로 «반드시» 움직여야 한다.
  이 두 기대는 서로 반대 방향이라 1단계의 작동 여부를 양쪽에서 검증한다.
