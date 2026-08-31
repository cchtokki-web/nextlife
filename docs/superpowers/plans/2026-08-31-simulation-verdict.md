# SimulationVerdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monte Carlo 판정을 파생 셀렉터 한 곳으로 모으고, HARD 목표 성공률을 판정 범위를 밝히는 새 KPI로 더한다.

**Architecture:** `resolveGoalSuccessConditions()`에 HARD 강도 축을 싣고, `MonteCarloEngine`이 기존 세 술어를 재사용해 HARD 비율 하나를 더 낸다. 소비처는 새 파생 셀렉터 `resolveSimulationVerdict()`만 호출하고, PDF·화면의 폴백 체인을 제거한다. `MonteCarloResult`의 기존 필드는 하나도 지우지 않는다.

**Tech Stack:** TypeScript, vitest 4. 신규 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-08-31-simulation-verdict-design.md`

## Global Constraints

- `MonteCarloResult`의 기존 필드를 삭제하거나 이름을 바꾸지 않는다. `simulationSuccessRate` 별칭도 그대로 둔다.
- `/api/ai-advisor`의 요청 필드(`monteCarloSuccessRate`, `monteCarloSpendingSuccessRate`)와 서버 라우트를 바꾸지 않는다. HARD 성공률을 LLM 프롬프트에 넣지 않는다.
- `MEASURABLE_GOALS`·`PLAN_EMBEDDED_GOALS` 집합을 넓히지 않는다. 판정 불가능한 목표를 판정 가능하게 만들지 않는다.
- 세 KPI(목표·생활비·자산) 사이에 폴백을 만들지 않는다. 하나가 없으면 없다고 표시한다.
- 판정 불가는 `0`이 아니라 `available: false`로 표현한다.
- **HARD 판정은 「확정된 HARD」만 센다** — `goal.constraintType === 'HARD' && !hardGoalAwaitsTargetConfirmation(goal)`. `terminalAssetGoalOf`가 이미 `confirmedTargetValue`로 같은 게이트를 걸고 있어, 다른 술어를 쓰면 단일 출처가 갈라진다.
- 새 술어를 만들지 않는다. `MonteCarloEngine`의 `failsSpending`/`failsSurvival`/`failsTerminal`을 재사용한다.
- 매 Task는 `npm test`가 통과하는 상태로 커밋한다. 현재 기준선은 255 files / 2995 tests.
- PDF 골든 픽스처를 재캡처하지 않는다. 골든이 깨지면 그 자체가 발견이다.

---

### Task 1: GoalSuccessConditions에 HARD 강도 축

**Files:**
- Modify: `src/core/usecases/goals/goalSuccessConditions.ts`
- Test: `src/tests/core/usecases/goals/goalSuccessConditions.test.ts` (없으면 생성)

**Interfaces:**
- Produces: `GoalSuccessConditions.hardRequirements: { spendingTarget: boolean; assetSurvival: boolean; terminalAsset: boolean }`. Task 2가 이 세 플래그를 읽고, Task 3이 `judged`/`unjudged` 계산에 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`resolveGoalSuccessConditions`는 세 갈래로 반환한다. 각 갈래의 `hardRequirements`를 고정한다.

```ts
import { describe, expect, test } from 'vitest';
import { resolveGoalSuccessConditions } from '@/core/usecases/goals/goalSuccessConditions';
import { initialParams } from '@/infrastructure/storage/localStore';
import type { SimulationParams } from '@/core/entities/types';
import type { RetirementGoal } from '@/core/entities/retirementGoal';

function paramsWithGoals(goals: RetirementGoal[] | undefined): SimulationParams {
  const base = structuredClone(initialParams);
  if (goals === undefined) delete (base as { retirementGoals?: unknown }).retirementGoals;
  else base.retirementGoals = goals;
  return base;
}

const goal = (over: Partial<RetirementGoal>): RetirementGoal => ({
  id: over.id ?? 'g1',
  type: over.type ?? 'ASSET_SURVIVAL',
  constraintType: over.constraintType ?? 'SOFT',
  priority: over.priority ?? 1,
  ...over,
} as RetirementGoal);

describe('resolveGoalSuccessConditions — hardRequirements', () => {
  test('레거시 시나리오(목표 배열 없음)는 HARD 요구가 하나도 없다', () => {
    // 판정 조건은 예전 세 조건 그대로지만, 그것은 목표에서 온 것이 아니다.
    const conditions = resolveGoalSuccessConditions(paramsWithGoals(undefined));

    expect(conditions.basis).toBe('legacy_plan');
    expect(conditions.hardRequirements).toEqual({
      spendingTarget: false, assetSurvival: false, terminalAsset: false,
    });
  });

  test('활성 조건이 없어 계획 기본값으로 떨어지면 HARD 요구가 없다', () => {
    // plan_defaults 갈래는 생활비·자산생존을 켜지만 사용자가 HARD로 고른 결과가 아니다.
    // 여기서 true를 주면 「사용자가 못박은 조건」이라고 거짓말하게 된다.
    const conditions = resolveGoalSuccessConditions(
      paramsWithGoals([goal({ type: 'TAX_OPTIMIZATION', constraintType: 'HARD' })]),
    );

    expect(conditions.basis).toBe('plan_defaults');
    expect(conditions.hardRequirements).toEqual({
      spendingTarget: false, assetSurvival: false, terminalAsset: false,
    });
  });

  test('HARD로 고른 판정 가능 목표만 해당 축을 켠다', () => {
    const conditions = resolveGoalSuccessConditions(paramsWithGoals([
      goal({ id: 'a', type: 'ASSET_SURVIVAL', constraintType: 'HARD' }),
      goal({ id: 'b', type: 'LIVING_EXPENSE_STABILITY', constraintType: 'SOFT' }),
    ]));

    expect(conditions.basis).toBe('selected_goals');
    expect(conditions.hardRequirements.assetSurvival).toBe(true);
    expect(conditions.hardRequirements.spendingTarget).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/tests/core/usecases/goals/goalSuccessConditions.test.ts`
Expected: FAIL — `hardRequirements`가 `undefined`.

- [ ] **Step 3: 구현**

`GoalSuccessConditions` 인터페이스에 필드를 추가하고, 세 반환 갈래를 모두 채운다.

```ts
export interface GoalSuccessConditions {
  // ...기존 필드 유지...

  /**
   * 위 세 조건 중 어느 것이 «확정된 HARD 목표»에서 왔는가.
   *
   * legacy_plan과 plan_defaults 갈래에서는 전부 false다 — 그 갈래의 조건은 계획 기본값이지
   * 사용자가 못박은 것이 아니다. 여기서 true를 주면 HARD 성공률이 「사용자가 요구한 적 없는
   * 조건」을 요구로 보고하게 된다.
   *
   * 「확정된」의 뜻은 retirementGoal.ts와 같다 — 강도만 고르고 기준이 씨앗이면 HARD가
   * 성립하지 않는다(hardGoalAwaitsTargetConfirmation). terminalAssetGoalOf가 이미
   * confirmedTargetValue로 같은 게이트를 걸고 있어, 여기서만 다른 술어를 쓰면 갈라진다.
   */
  hardRequirements: {
    spendingTarget: boolean;
    assetSurvival: boolean;
    terminalAsset: boolean;
  };
}

const NO_HARD_REQUIREMENTS = {
  spendingTarget: false, assetSurvival: false, terminalAsset: false,
} as const;
```

`legacy_plan`과 `plan_defaults` 반환에 `hardRequirements: { ...NO_HARD_REQUIREMENTS }`를 넣는다.

`selected_goals` 반환 앞에 다음을 계산한다. `hardGoalAwaitsTargetConfirmation`을 `@/core/entities/retirementGoal`에서 import한다.

```ts
  const isConfirmedHard = (goal: RetirementGoal): boolean =>
    goal.constraintType === 'HARD' && !hardGoalAwaitsTargetConfirmation(goal);

  const hardRequirements = {
    spendingTarget: measurable.some((goal) =>
      (goal.type === 'LIVING_EXPENSE_STABILITY' || goal.type === 'COMFORTABLE_SPENDING')
      && isConfirmedHard(goal)),
    assetSurvival: measurable.some((goal) =>
      goal.type === 'ASSET_SURVIVAL' && isConfirmedHard(goal)),
    // 기말자산 축은 조건이 실제로 살아 있을 때만 의미가 있다. terminalAssetGoalOf가 0을
    // 돌려주면(확정 목표액이 없음) HARD로 골랐어도 판정할 것이 없다.
    terminalAsset: terminalAssetGoal > 0 && measurable.some((goal) =>
      (goal.type === 'INHERITANCE' || goal.type === 'ASSET_GROWTH') && isConfirmedHard(goal)),
  };
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/tests/core/usecases/goals/goalSuccessConditions.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: 전체 테스트**

Run: `npm test`
Expected: PASS. 필드 추가만이므로 기존 255 files / 2995 tests 유지 + 신규 3건.

- [ ] **Step 6: 커밋**

```bash
git add src/core/usecases/goals/goalSuccessConditions.ts src/tests/core/usecases/goals/goalSuccessConditions.test.ts
git commit -m "feat: 목표 판정 조건에 확정 HARD 강도 축을 싣는다"
```

---

### Task 2: MonteCarloEngine의 HARD 성공률

**Files:**
- Modify: `src/core/entities/montecarlo.ts` (`MonteCarloResult`에 optional 필드)
- Modify: `src/core/usecases/montecarlo/MonteCarloEngine.ts`
- Test: `src/tests/core/usecases/montecarlo/hardGoalSuccess.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `conditions.hardRequirements`
- Produces: `MonteCarloResult.hardGoalSuccessProbability?: number`. Task 3의 셀렉터가 읽는다. optional이므로 없으면 판정 부재다.

- [ ] **Step 1: 실패하는 테스트 작성**

**판별력이 핵심이다.** HARD 비율이 전체 비율과 «달라지는» 픽스처여야 한다. 두 값이 같은 픽스처는 아무것도 검증하지 못한다.

진입점은 클래스 메서드가 아니라 `runMonteCarlo(params, engine, config)` 함수다. 기존 `src/tests/core/usecases/montecarlo/MonteCarloEngine.test.ts`의 `params()`·`config()` 헬퍼와 같은 형태를 쓴다 — 그 파일을 먼저 읽고 픽스처를 맞춘다.

```ts
import { describe, expect, test } from 'vitest';
import { runMonteCarlo } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import type { SimulationParams } from '@/core/entities/types';
import type { MonteCarloConfig } from '@/core/entities/montecarlo';

const engine = new SimulationEngine();

const config = (over: Partial<MonteCarloConfig> = {}): MonteCarloConfig =>
  ({ trials: 200, seed: 2026, annualStdDev: 15, ...over });

// 생활비는 SOFT, 자산 고갈 방지만 HARD인 계획.
// 전체 성공률은 두 조건을 모두 요구하고 HARD 성공률은 고갈만 보므로,
// 생활비가 부족한 시행이 존재하면 두 값이 갈라진다.
function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 5_000_000 },
    assets: [
      { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 200, averagePrice: 500000,
        totalReturn: 9, dividendYield: 2, monthlyContribution: 0, reinvestDividend: true, currency: 'KRW' },
    ],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 1000000 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    retirementGoals: [
      { id: 'a', type: 'ASSET_SURVIVAL', constraintType: 'HARD', priority: 1 },
      { id: 'b', type: 'LIVING_EXPENSE_STABILITY', constraintType: 'SOFT', priority: 2 },
    ],
    ...overrides,
  } as SimulationParams;
}

describe('runMonteCarlo — HARD 목표 성공률', () => {
  test('HARD 조건만 요구하므로 전체 성공률보다 높다', () => {
    const result = runMonteCarlo(params(), engine, config());

    expect(result.hardGoalSuccessProbability).toBeDefined();
    // 두 값이 같으면 픽스처가 판별력을 잃은 것이다 — 그 자체가 실패다.
    expect(result.hardGoalSuccessProbability!).toBeGreaterThan(result.goalSuccessProbability);
  });

  test('확정 HARD 목표가 없으면 모든 시행이 통과해 1이다', () => {
    const result = runMonteCarlo(
      params({ retirementGoals: [
        { id: 'a', type: 'ASSET_SURVIVAL', constraintType: 'SOFT', priority: 1 },
      ] } as Partial<SimulationParams>),
      engine, config({ trials: 100 }),
    );

    // 엔진은 언제나 숫자를 낸다. 「HARD가 없다」는 판단은 셀렉터가
    // conditions.hardRequirements를 보고 내린다 — 엔진이 undefined를 내면
    // 「계산 안 함」과 「HARD 없음」이 구분되지 않는다.
    expect(result.hardGoalSuccessProbability).toBe(1);
  });
});
```

첫 테스트가 `toBeGreaterThan`에서 실패하면 픽스처가 두 값을 갈라놓지 못한 것이다. 목표 생활비를 올리거나 자산을 줄여 생활비 부족 시행이 실제로 생기게 한다. **단언을 약화시키지 않는다.**

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/tests/core/usecases/montecarlo/hardGoalSuccess.test.ts`
Expected: FAIL — `hardGoalSuccessProbability`가 `undefined`.

- [ ] **Step 3: 구현**

`src/core/entities/montecarlo.ts`의 `MonteCarloResult`에 추가한다.

```ts
  /**
   * 확정 HARD 목표가 요구하는 조건만 모두 충족한 시행 비율.
   *
   * goalSuccessProbability의 조건 부분집합이므로 언제나 그 값 이상이다. HARD 요구가 하나도
   * 없으면 모든 시행이 통과해 1이 된다 — 그 숫자를 그대로 보여주면 안 되며,
   * resolveSimulationVerdict가 conditions.hardRequirements를 보고 「판정 대상 없음」으로
   * 바꾼다. 엔진이 undefined를 내면 「계산하지 않음」과 구분되지 않으므로 언제나 값을 낸다.
   */
  hardGoalSuccessProbability?: number;
```

`MonteCarloEngine.ts`에서 `goalSucceeded` 계산 바로 아래에 넣는다. **세 술어를 그대로 재사용한다.**

```ts
  // 같은 술어를 재사용한다. 여기서 조건을 다시 쓰면 판정하지 않은 조건이 사유로만 보고되어
  // 확률과 화면이 어긋난다(위 goalSucceeded 주석과 같은 이유).
  const hard = conditions.hardRequirements;
  const hardSucceeded = trials.filter((t) =>
    (!hard.spendingTarget || !failsSpending(t))
    && (!hard.assetSurvival || !failsSurvival(t))
    && (!hard.terminalAsset || !failsTerminal(t)));
```

결과 객체에 `hardGoalSuccessProbability: trials.length > 0 ? hardSucceeded.length / trials.length : 0`을 더한다. `goalSuccessProbability`를 만드는 자리(251행 부근) 바로 옆에 둔다.

Worker 프로토콜(`src/web/workers/monteCarloProtocol.ts`)이 결과를 필드 단위로 복사한다면 그곳에도 추가한다 — 먼저 읽고 확인한다. 통째로 넘긴다면 변경이 필요 없다.

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/tests/core/usecases/montecarlo/hardGoalSuccess.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: 전체 테스트**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/core/entities/montecarlo.ts src/core/usecases/montecarlo/MonteCarloEngine.ts src/tests/core/usecases/montecarlo/hardGoalSuccess.test.ts
git commit -m "feat: Monte Carlo에 확정 HARD 목표 성공률을 더한다"
```

---

### Task 3: resolveSimulationVerdict 셀렉터

**Files:**
- Create: `src/core/usecases/montecarlo/resolveSimulationVerdict.ts`
- Test: `src/tests/core/usecases/montecarlo/resolveSimulationVerdict.test.ts`

**Interfaces:**
- Consumes: Task 1의 `hardRequirements`, Task 2의 `hardGoalSuccessProbability`
- Produces: `resolveSimulationVerdict(input: { monteCarlo?: MonteCarloResult; params: SimulationParams }): SimulationVerdict`. Task 4의 PDF·화면이 이것만 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, test } from 'vitest';
import { resolveSimulationVerdict } from '@/core/usecases/montecarlo/resolveSimulationVerdict';
import { initialParams } from '@/infrastructure/storage/localStore';
import type { MonteCarloResult } from '@/core/entities/montecarlo';
import type { SimulationParams } from '@/core/entities/types';

const mc = (over: Partial<MonteCarloResult> = {}): MonteCarloResult => ({
  trials: 1000, seed: 42, successAge: 90,
  successRate: 0.92, spendingSuccessRate: 0.82, averageSpendingFulfillmentRate: 0.97,
  goalSuccessProbability: 0.78, hardGoalSuccessProbability: 0.91,
  goalFailure: { spendingShortfall: 0, assetDepletion: 0 },
  goalConditions: { basis: 'selected_goals', requireSpendingTarget: true,
    requireAssetSurvival: true, terminalAssetGoal: 0, unmeasuredGoals: [],
    hardRequirements: { spendingTarget: false, assetSurvival: true, terminalAsset: false } },
  plannedMonthlySpending: 3_000_000,
  endingAssets: { p10: 0, p50: 0, p90: 0 }, assetBands: [],
  depletion: { count: 0, earliestAge: null, medianAge: null },
  deterministicEndingAssets: 0,
  ...over,
} as MonteCarloResult);

const goalParams = (goals: unknown[]): SimulationParams => {
  const base = structuredClone(initialParams);
  base.retirementGoals = goals as SimulationParams['retirementGoals'];
  return base;
};

describe('resolveSimulationVerdict', () => {
  test('Monte Carlo 결과가 없으면 available=false이고 어떤 비율도 0으로 짜내지 않는다', () => {
    const verdict = resolveSimulationVerdict({ monteCarlo: undefined, params: initialParams });

    expect(verdict.available).toBe(false);
    expect(verdict.goalSuccess.rate).toBeNaN();
  });

  test('세 지표는 서로 대체하지 않는다', () => {
    // spendingSuccessRate가 goalSuccess를 메우던 옛 폴백이 되살아나면 이 단언이 깨진다.
    const verdict = resolveSimulationVerdict({ monteCarlo: mc(), params: initialParams });

    expect(verdict.goalSuccess.rate).toBe(0.78);
    expect(verdict.spendingFulfillment.fullRate).toBe(0.82);
    expect(verdict.assetSurvival.rate).toBe(0.92);
  });

  test('success/failure 개수가 trials와 맞는다', () => {
    const verdict = resolveSimulationVerdict({ monteCarlo: mc(), params: initialParams });

    expect(verdict.goalSuccess.succeeded + verdict.goalSuccess.failed).toBe(1000);
    expect(verdict.goalSuccess.succeeded).toBe(780);
  });

  test('확정 HARD 목표가 없으면 hardGoalSuccess는 null이다', () => {
    const verdict = resolveSimulationVerdict({
      monteCarlo: mc({ goalConditions: { ...mc().goalConditions,
        hardRequirements: { spendingTarget: false, assetSurvival: false, terminalAsset: false } } }),
      params: goalParams([{ id: 'a', type: 'ASSET_SURVIVAL', constraintType: 'SOFT', priority: 1 }]),
    });

    expect(verdict.hardGoalSuccess).toBeNull();
  });

  test('판정하지 못한 HARD 목표를 unjudged로 드러낸다', () => {
    // 주거 안정은 MEASURABLE_GOALS에 없어 HARD로 골라도 이 비율이 판정하지 않는다.
    // 이것을 숨기면 known-issues 1번을 지표 하나 더 만들어 되풀이한다.
    const verdict = resolveSimulationVerdict({
      monteCarlo: mc(),
      params: goalParams([
        { id: 'a', type: 'ASSET_SURVIVAL', constraintType: 'HARD', priority: 1 },
        { id: 'b', type: 'HOUSING_STABILITY', constraintType: 'HARD', priority: 2 },
      ]),
    });

    expect(verdict.hardGoalSuccess).not.toBeNull();
    expect(verdict.hardGoalSuccess!.judged).toContain('ASSET_SURVIVAL');
    expect(verdict.hardGoalSuccess!.unjudged).toContain('HOUSING_STABILITY');
    expect(verdict.hardGoalSuccess!.judged).not.toContain('HOUSING_STABILITY');
  });
});
```

`HOUSING_STABILITY`가 실제 `RetirementGoalType`인지 `src/core/entities/retirementGoal.ts`의 `RETIREMENT_GOAL_TYPES`에서 확인하고, 다르면 판정 불가 유형 중 실제로 있는 것으로 바꾼다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/tests/core/usecases/montecarlo/resolveSimulationVerdict.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
import { isQuantitativelyJudgedGoal } from '../goals/goalSuccessConditions';
import { hardGoalAwaitsTargetConfirmation, normalizeRetirementGoals } from '../../entities/retirementGoal';
import type { RetirementGoalType } from '../../entities/retirementGoal';
import type { MonteCarloResult } from '../../entities/montecarlo';
import type { SimulationParams } from '../../entities/types';

/**
 * Monte Carlo 판정의 단일 출처.
 *
 * **폴백을 만들지 않는 것이 이 파일의 존재 이유다.** 예전에는 PDF가 네 단계 폴백을 탔고
 * (simulationSuccessRate ?? goalSuccessProbability ?? confidence.rates?.goalSuccessProbability
 * ?? confidence.rates?.spendingSuccessRate ?? 0), 그 중 하나는 「고갈 여부를 묻지 않는」
 * 다른 지표였다. 화면은 같은 체인을 짧게 다시 썼다. 두 곳이 다른 숫자를 보일 수 있었다.
 *
 * describeSuccessRates와 같은 자리에, 같은 이유로 둔다 — 판정 규칙은 전부 core의 것이고
 * 화면과 PDF는 같은 답을 인쇄해야 한다.
 */
export interface SimulationVerdict {
  available: boolean;
  trials: number;
  seed: number;
  goalSuccess: { rate: number; succeeded: number; failed: number };
  spendingFulfillment: { fullRate: number; averageRate: number | null };
  assetSurvival: { rate: number; throughAge: number };
  hardGoalSuccess: {
    rate: number;
    succeeded: number;
    failed: number;
    judged: RetirementGoalType[];
    unjudged: RetirementGoalType[];
  } | null;
}

const counts = (rate: number, trials: number) => ({
  rate,
  succeeded: Math.round(rate * trials),
  failed: trials - Math.round(rate * trials),
});

export function resolveSimulationVerdict(input: {
  monteCarlo?: MonteCarloResult;
  params: SimulationParams;
}): SimulationVerdict {
  const { monteCarlo, params } = input;

  if (!monteCarlo) {
    // 0을 내지 않는다. 0은 「전멸」이라는 다른 사실이다.
    const none = { rate: Number.NaN, succeeded: 0, failed: 0 };
    return {
      available: false, trials: 0, seed: 0,
      goalSuccess: none,
      spendingFulfillment: { fullRate: Number.NaN, averageRate: null },
      assetSurvival: { rate: Number.NaN, throughAge: 0 },
      hardGoalSuccess: null,
    };
  }

  const { trials } = monteCarlo;
  const hard = monteCarlo.goalConditions.hardRequirements;
  const anyHardRequirement = hard.spendingTarget || hard.assetSurvival || hard.terminalAsset;

  // 사용자가 확정 HARD로 고른 목표를 판정 여부로 가른다. 엔진에 필드를 더 만들지 않고
  // 여기서 계산하는 이유는, 이 분류의 출처가 isQuantitativelyJudgedGoal 하나뿐이어야 하기
  // 때문이다(goalSuccessConditions.ts의 해당 주석 참조).
  const confirmedHardGoals = Array.isArray(params.retirementGoals)
    ? normalizeRetirementGoals(params.retirementGoals)
        .filter((goal) => goal.constraintType === 'HARD' && !hardGoalAwaitsTargetConfirmation(goal))
    : [];
  const judged = confirmedHardGoals
    .filter((goal) => isQuantitativelyJudgedGoal(goal.type)).map((goal) => goal.type);
  const unjudged = confirmedHardGoals
    .filter((goal) => !isQuantitativelyJudgedGoal(goal.type)).map((goal) => goal.type);

  return {
    available: true,
    trials,
    seed: monteCarlo.seed,
    goalSuccess: counts(monteCarlo.goalSuccessProbability, trials),
    spendingFulfillment: {
      fullRate: monteCarlo.spendingSuccessRate,
      averageRate: monteCarlo.averageSpendingFulfillmentRate ?? null,
    },
    assetSurvival: { rate: monteCarlo.successRate, throughAge: monteCarlo.successAge },
    // 요구하는 HARD 조건이 하나도 없으면 모든 시행이 통과해 1이 된다. 그 숫자는 참이지만
    // 「HARD 목표를 다 지켰다」로 읽혀 오해를 부른다. 숫자가 아니라 부재로 표현한다.
    hardGoalSuccess: anyHardRequirement && monteCarlo.hardGoalSuccessProbability !== undefined
      ? { ...counts(monteCarlo.hardGoalSuccessProbability, trials), judged, unjudged }
      : null,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/tests/core/usecases/montecarlo/resolveSimulationVerdict.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: 전체 테스트 · 커밋**

Run: `npm test` → PASS

```bash
git add src/core/usecases/montecarlo/resolveSimulationVerdict.ts src/tests/core/usecases/montecarlo/resolveSimulationVerdict.test.ts
git commit -m "feat: Monte Carlo 판정의 단일 출처 셀렉터를 만든다"
```

---

### Task 4: PDF·화면이 셀렉터만 본다

**Files:**
- Modify: `src/web/features/Pdf/pdfReportSections.ts` (170행 부근 폴백 체인)
- Modify: `src/web/features/Dashboard/DashboardSection.tsx` (236행 부근)
- Test: `src/tests/web/features/Pdf/pdfReportSections.test.ts` (또는 해당 경로의 기존 파일)

**Interfaces:**
- Consumes: Task 3의 `resolveSimulationVerdict`

- [ ] **Step 1: 폴백 제거 전 골든 상태 기록**

Run: `npx vitest run src/tests/web/features/Pdf/buildReportHtml.test.ts`
Expected: PASS. 이 골든이 `성공률 82%`·`92%`를 담고 있다. 폴백 제거 후에도 같아야 한다.

- [ ] **Step 2: 실패하는 테스트 작성**

MC 결과가 없을 때 「0%」가 아니라 판정 없음이 나오는지 고정한다.

```ts
test('Monte Carlo 결과가 없으면 0%가 아니라 판정 없음을 인쇄한다', () => {
  const html = /* monteCarlo를 넘기지 않고 해당 섹션을 생성 */;

  expect(html).not.toContain('성공률 0%');
  expect(html).toContain('판정 없음');
});

test('판정하지 못한 HARD 목표가 있으면 비율 옆에 그 사실을 밝힌다', () => {
  // 이 단서가 빠지면 known-issues 1번이 재발한다 — 사용자가 못박은 조건을 계산이
  // 지킬 것이라 믿게 된다.
  const html = /* 주거 안정을 HARD로 고른 params + hardGoalSuccessProbability 있는 mc */;

  expect(html).toMatch(/HARD 목표 .*중 .*기준|판정하지 않/);
});
```

해당 테스트 파일의 기존 헬퍼(입력 생성 방식)를 먼저 읽고 그 형태에 맞춘다.

- [ ] **Step 3: 실패 확인 → 구현**

`pdfReportSections.ts` 170행의 네 단계 폴백을 삭제하고 셀렉터 호출로 바꾼다.

```ts
const verdict = resolveSimulationVerdict({ monteCarlo, params });
```

`?? 0`으로 만들던 `simulationSuccessRate` 지역변수를 없애고, 표시 지점마다 `verdict.available`을 먼저 본다. `DashboardSection.tsx:236`의 짧은 체인도 같은 방식으로 바꾼다.

`verdict.hardGoalSuccess?.unjudged`가 비어 있지 않으면 비율 옆에 단서를 낸다. 문구는 기존 `unmeasuredGoals` 표시(`pdfReportSections.ts:243`, `DashboardSection.tsx:676`)의 어투를 따른다 — 새 어투를 만들지 않는다.

- [ ] **Step 4: 골든 회귀 확인**

Run: `npx vitest run src/tests/web/features/Pdf/buildReportHtml.test.ts`
Expected: PASS, 골든 무변경.

**골든이 깨지면 재캡처하지 말고 멈춘다.** 폴백이 실제로 다른 값을 주고 있었다는 뜻이며, 어느 값이 옳은지 판단이 필요하다. 그 판단을 보고한다.

- [ ] **Step 5: 전체 테스트 · 커밋**

Run: `npm test` → PASS

```bash
git add src/web/features/Pdf/pdfReportSections.ts src/web/features/Dashboard/DashboardSection.tsx src/tests/web/features/Pdf/
git commit -m "fix: PDF·화면의 Monte Carlo 판정 폴백 체인을 단일 셀렉터로 대체한다"
```

---

### Task 5: 위키 갱신과 완료 기준 대조

**Files:**
- Modify: `docs/wiki/concepts/HARD와 SOFT 목표.md`

**Interfaces:**
- Consumes: Task 1~4 전부

- [ ] **Step 1: 위키 노트 갱신**

`AGENTS.md` 문서 현행화 원칙이 "계산 계약을 바꾸면 해당 개념 노트를 같은 커밋에서 갱신한다"를 요구한다. 이 작업이 그 규칙의 첫 적용이다.

`docs/wiki/스키마.md`를 먼저 읽고 형식을 따른다. `## 계약`에 다음을 추가한다.

- 확정 HARD 목표는 Monte Carlo 성공률에도 반영된다 — `hardGoalSuccessProbability`는 확정 HARD가 요구하는 조건만 모두 충족한 시행 비율이다.
- 판정 가능한 목표(`MEASURABLE_GOALS`)만 그 비율에 들어간다. 주거 안정처럼 판정 불가능한 목표를 HARD로 골라도 비율을 바꾸지 않으며 `unjudged`로 드러난다.

`## 근거`와 프런트매터 `code`/`tests`에 다음을 더한다. **각 항목이 어느 불릿을 방어하는지 확인하고 적는다** — 이름만 보고 인용하지 않는다.

- `src/core/usecases/montecarlo/resolveSimulationVerdict.ts`
- `src/tests/core/usecases/montecarlo/resolveSimulationVerdict.test.ts`
- `src/tests/core/usecases/montecarlo/hardGoalSuccess.test.ts`

- [ ] **Step 2: 무결성 테스트**

Run: `npx vitest run src/tests/docs/wikiIntegrity.test.ts`
Expected: 10/10. 노트를 추가하지 않았으므로 인벤토리는 그대로다.

- [ ] **Step 3: 완료 기준 대조**

spec `docs/superpowers/specs/2026-08-31-simulation-verdict-design.md`의 §완료 기준을 하나씩 확인해 보고서에 결과를 적는다.

- [ ] `resolveSimulationVerdict`가 존재하고 PDF·화면이 이 셀렉터만 호출한다 (`grep -n "goalSuccessProbability" src/web`로 폴백 잔존 확인)
- [ ] `hardGoalSuccess`가 `judged`/`unjudged`를 함께 싣고, `unjudged`가 비어 있지 않으면 화면·PDF가 단서를 표시한다
- [ ] MC 결과가 없을 때 「판정 없음」이 표시되고 「0%」가 표시되지 않는다
- [ ] PDF 골든이 정상 경로에서 변하지 않는다
- [ ] HARD 성공률이 전체 성공률과 달라지는 픽스처가 테스트에 있다
- [ ] `HARD와 SOFT 목표` 노트가 갱신됐다

- [ ] **Step 4: 전체 테스트 · 커밋**

Run: `npm test` → PASS

```bash
git add "docs/wiki/concepts/HARD와 SOFT 목표.md"
git commit -m "docs(wiki): HARD 목표가 Monte Carlo 성공률에 반영되는 계약을 추가한다"
```
