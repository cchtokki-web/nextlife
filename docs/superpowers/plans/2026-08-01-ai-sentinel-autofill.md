# AI 센티널 자동 채움 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 국민연금 수령 전략이 `'ai_optimized'`(미정)로 남아 있으면, 시뮬레이션 시점에만 AI 추천 나이로 채워 계산한다. 사용자 `params`는 절대 바뀌지 않는다.

**Architecture:** `compileStrategy` 뒤에 순수 함수 `applyAiSentinels(compiled, recommendation)`를 한 단계 덧붙인다. `compileStrategy`가 추천을 반영하려면 추천이 필요한데 `recommendStrategy`는 이미 컴파일된 params를 입력으로 요구하는 시그니처 순환이 있어 한 함수로 합칠 수 없으므로 별도 단계로 둔다. 추천 계산의 입력은 항상 센티널 미적용 원본이고, 채워진 결과는 `engine.run`과 화면 표시로만 흘러가므로 되먹임 루프가 구조적으로 불가능하다. UI는 `FieldRow`의 AI 배지 접두어를 "AI 추천"/"AI 적용"으로 갈라 화면과 엔진이 어긋나지 않게 한다.

**Tech Stack:** TypeScript(strict), React 19 / Next.js App Router, Vitest + Testing Library

**설계 문서:** `docs/superpowers/specs/2026-08-01-ai-sentinel-autofill-design.md`

## Global Constraints

- 주석·커밋 메시지·문서는 한국어로 작성한다. 변수명/함수명은 영어.
- TypeScript `strict: true`. `any` 사용 금지.
- core 계층(`src/core/**`)은 순수 함수로 유지한다. React·DOM·외부 라이브러리에 의존하지 않는다.
- TDD: 실패하는 테스트를 먼저 쓰고, 실패를 확인한 뒤, 최소 구현으로 통과시킨다.
- 테스트 실행은 `npx vitest run <path>` (watch 모드 아님).
- **워크트리 주의:** 작업이 끝나 병합한 뒤에는 `git worktree remove`를 먼저 하고 나서 전체 테스트를 돌린다. `.worktrees/`를 남겨둔 채 메인에서 `npm test`를 돌리면 React가 중복 로드되어 대량 실패한다.

## 범위 밖 (건드리지 말 것)

- 사적연금 인출량(`privatePensionMonthlyTarget`), 목표 생활비 배수(`monthlySpendingMultiplier`), 배당 재투자, ISA 만기 처리 — 모두 설계 문서의 비목표다.
- 비교 시나리오(`page.tsx`의 `compareResults`) — 각 비교 시나리오는 자기 추천을 계산하지 않으므로 채울 값이 없다.
- `ItemizedContribution` 타입 — marginal 검증을 두지 않기로 했으므로 변경 불필요.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/core/usecases/strategy/applyAiSentinels.ts` (신규) | 센티널 축을 추천값으로 채우는 순수 함수. 채울 것이 없으면 입력 참조를 그대로 반환한다. |
| `src/tests/core/usecases/strategy/applyAiSentinels.test.ts` (신규) | 위 함수의 단위 테스트 |
| `src/app/simulator/page.tsx` (수정) | `engine.run` 입력을 `applyAiSentinels` 결과로 교체. `result`를 `recommendation` 아래로 이동. |
| `src/web/components/form/FieldRow.tsx` (수정) | AI 배지 접두어를 "AI 추천"/"AI 적용"으로 전환하는 `aiHintApplied` prop 추가 |
| `src/tests/web/components/form/FieldRow.test.tsx` (수정) | 접두어 전환 케이스 추가 |
| `src/web/features/StrategySettings/sections/PensionStrategySection.tsx` (수정) | 센티널일 때 힌트를 "적용" 표시로 전환 |
| `src/tests/web/features/StrategySettings/sections/PensionStrategySection.test.tsx` (수정) | 힌트 분기 케이스 추가 |

---

### Task 1: `applyAiSentinels` 순수 함수

**Files:**
- Create: `src/core/usecases/strategy/applyAiSentinels.ts`
- Test: `src/tests/core/usecases/strategy/applyAiSentinels.test.ts`

**Interfaces:**
- Consumes: `CompiledStrategy`(`compileStrategy.ts:19-22`), `resolveStrategy(params)`, `StrategyRecommendation`(`core/entities/types.ts:300`)
- Produces: `applyAiSentinels(compiled: CompiledStrategy, recommendation: StrategyRecommendation | undefined): CompiledStrategy`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/core/usecases/strategy/applyAiSentinels.test.ts` 전체 내용:

```typescript
import { describe, test, expect } from 'vitest';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import {
  CompleteWithdrawalPlan, NationalPensionStrategy, SimulationParams, StrategyRecommendation,
  UtilityBreakdown,
} from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1000, averagePrice: 100000,
      annualGrowthRate: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const compiledFor = (nationalPensionStrategy: NationalPensionStrategy) =>
  compileStrategy({
    ...baseParams,
    strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy },
  });

const utility: UtilityBreakdown = {
  score: 76,
  components: {
    consumption: 27, depletionSafety: 20, pensionUtilization: 13,
    taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0,
  },
};

const plan = (nationalPensionStartAge: number): CompleteWithdrawalPlan => ({
  privatePensionMonthlyTarget: 0,
  nationalPensionStartAge,
  assetSellOrderStrategy: 'input_order',
  isaMaturityDestination: 'pension',
  generalAssetWithdrawalStartAge: 60,
  monthlySpendingMultiplier: 1,
});

function makeRecommendation(
  recommendedPlan: CompleteWithdrawalPlan | null,
  improved = true
): StrategyRecommendation {
  return {
    currentUtility: utility,
    recommendedUtility: utility,
    recommendedPlan,
    recommendedAssetReinvestment: null,
    recommendedPrivatePensionChanneling: null,
    recommendedNewPensionContribution: null,
    channelingIncludesAccountTransfer: false,
    improved,
    reasons: [],
    deltas: {
      lifetimeConsumption: 0, totalTax: 0, endingAssets: 0, pensionEndingBalance: 0,
      comprehensiveTaxYears: 0, healthInsuranceTotal: 0, nationalPensionTotal: 0,
    },
    totalCandidateCount: 0,
    failedCandidateCount: 0,
    recommendedResult: {
      yearlyResults: [], fireAge: null, depletionAge: null, endingAssets: 0,
      retirementScore: 0, retirementGrade: '보통', goalAchievementRate: 100,
      retirementAssetsAtRetirement: 0, householdEndAge: 90,
    },
    itemizedContributions: [],
  };
}

describe('applyAiSentinels', () => {
  test("nationalPensionStrategy가 'ai_optimized'이면 추천 나이로 채운다", () => {
    const compiled = compiledFor('ai_optimized');
    expect(compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(65);

    const applied = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied.params.withdrawalPlan?.nationalPensionStartAge).toBe(68);
  });

  test('확정 enum이면 추천이 있어도 채우지 않는다', () => {
    const compiled = compiledFor('defer_max');
    const applied = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied).toBe(compiled);
    expect(applied.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
  });

  test('추천이 없으면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, undefined)).toBe(compiled);
  });

  test('recommendedPlan이 null이면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, makeRecommendation(null))).toBe(compiled);
  });

  test('improved가 false이면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, makeRecommendation(plan(68), false))).toBe(compiled);
  });

  test('추천 나이가 이미 컴파일된 값과 같으면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, makeRecommendation(plan(65)))).toBe(compiled);
  });

  test('withdrawalPlan의 다른 필드와 utilityConfig는 보존된다', () => {
    const compiled = compileStrategy({
      ...baseParams,
      withdrawalPlan: { generalAssetWithdrawalStartAge: 62 },
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' },
    });

    const applied = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied.params.withdrawalPlan?.generalAssetWithdrawalStartAge).toBe(62);
    expect(applied.params.withdrawalPlan?.isaMaturityDestination).toBe('pension');
    expect(applied.utilityConfig).toBe(compiled.utilityConfig);
  });

  test('params의 다른 최상위 필드는 그대로 유지된다', () => {
    const compiled = compiledFor('ai_optimized');
    const applied = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied.params.userProfile).toBe(compiled.params.userProfile);
    expect(applied.params.assets).toBe(compiled.params.assets);
    expect(applied.params.strategy).toBe(compiled.params.strategy);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/applyAiSentinels.test.ts`
Expected: FAIL — `Failed to resolve import "@/core/usecases/strategy/applyAiSentinels"`

- [ ] **Step 3: 최소 구현 작성**

`src/core/usecases/strategy/applyAiSentinels.ts` 전체 내용:

```typescript
import { StrategyRecommendation } from '../../entities/types';
import { CompiledStrategy, resolveStrategy } from './compileStrategy';

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
): CompiledStrategy {
  // improved가 false이면 recommendedPlan은 "baseline 유지 권장"이라 채울 것이 없다.
  if (!recommendation?.improved) return compiled;

  const recommendedPlan = recommendation.recommendedPlan;
  if (!recommendedPlan) return compiled;

  const strategy = resolveStrategy(compiled.params);
  if (strategy.nationalPensionStrategy !== 'ai_optimized') return compiled;

  const recommendedAge = recommendedPlan.nationalPensionStartAge;
  const currentAge = compiled.params.withdrawalPlan?.nationalPensionStartAge;
  // 값이 같으면 새 객체를 만들지 않는다. 참조가 바뀌면 page.tsx의 하위 useMemo가 전부
  // 무효화되어 이 화면에서 가장 무거운 렌더(engine.run)가 매번 다시 돈다.
  if (recommendedAge === currentAge) return compiled;

  return {
    ...compiled,
    params: {
      ...compiled.params,
      withdrawalPlan: {
        ...(compiled.params.withdrawalPlan ?? {}),
        nationalPensionStartAge: recommendedAge,
      },
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/applyAiSentinels.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/usecases/strategy/applyAiSentinels.ts src/tests/core/usecases/strategy/applyAiSentinels.test.ts
git commit -m "feat: AI 센티널 자동 채움 순수 함수 추가

국민연금 전략이 'ai_optimized'로 남아 있으면 추천 나이로 채운다.
채울 것이 없으면 입력 참조를 그대로 반환해 하위 useMemo 무효화를 막는다."
```

---

### Task 2: `page.tsx` 배선

**Files:**
- Modify: `src/app/simulator/page.tsx:142-177`

**Interfaces:**
- Consumes: Task 1의 `applyAiSentinels(compiled, recommendation)`
- Produces: 없음 (내부 배선)

**중요한 제약:** 현재 `result`(142행)가 `recommendation`(163행)보다 **위에** 선언되어 있다. `result`가 이제 `recommendation`에 의존하므로 순서를 뒤집어야 한다 — 그대로 두면 TDZ 참조 에러가 난다. 142~162행 사이에 `result`를 읽는 코드는 없으므로(주석과 `useBackgroundValue` 호출뿐) 이동은 안전하다. `result`의 첫 소비처는 180행의 analytics `useEffect`다.

- [ ] **Step 1: import 추가**

`src/app/simulator/page.tsx`의 `compileStrategy` import 옆에 추가한다. 기존 import 라인을 찾아 그 아래에 넣는다:

```typescript
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
```

(기존 파일이 `@/` 별칭이 아닌 상대 경로를 쓰고 있다면 이웃 import와 같은 표기를 따른다.)

- [ ] **Step 2: `result` 블록을 잘라내 `recommendation` 아래로 옮기고 `effective`를 끼워 넣는다**

142~145행의 `const result = useMemo(...)` 선언을 그 위의 주석(128~141행) 째로 통째로 잘라낸다. 그러면 `compiled`(126행) 다음에 곧바로 `useBackgroundValue`(159행)가 오게 된다.

잘라낸 블록을 `recommendation` `useMemo`가 끝나는 177행 **아래**에 붙이고, 그 앞에 `effective`를 추가한다:

```typescript
  // 미정으로 남은 센티널 축을 추천값으로 채운다. 사용자 params는 그대로 두고 계산에만
  // 반영하므로, 추천의 입력(compiled)과 시뮬레이션의 입력(effective)이 분리된다 —
  // 이 분리가 "적용 → 재계산 → 재적용" 되먹임을 구조적으로 막는다.
  const effective = useMemo(
    () => applyAiSentinels(compiled, recommendation),
    [compiled, recommendation]
  );

  // (여기에 잘라낸 128~141행 주석을 그대로 붙인다)
  const result = useMemo(
    () => engine.run(effective.params, effective.utilityConfig),
    [engine, effective.params, effective.utilityConfig]
  );
```

`engine.run`의 인자가 `compiled.*`에서 `effective.*`로 바뀐 것이 유일한 실질 변경이다.

- [ ] **Step 3: 타입 체크와 기존 테스트 통과 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (특히 `result`/`effective` 관련 TDZ·미정의 에러가 없어야 한다)

Run: `npx vitest run src/tests/app src/tests/web/features/Dashboard`
Expected: PASS — 기존 동작이 깨지지 않았음을 확인한다

- [ ] **Step 4: 커밋**

```bash
git add src/app/simulator/page.tsx
git commit -m "feat: 시뮬레이션 입력에 AI 센티널 자동 채움 배선

result를 recommendation 아래로 옮기고 engine.run 입력을 effective로 교체한다.
추천 계산의 입력은 여전히 센티널 미적용 원본(compiled)이라 되먹임이 생기지 않는다."
```

---

### Task 3: `FieldRow`의 AI 배지 접두어 분기

**Files:**
- Modify: `src/web/components/form/FieldRow.tsx:14-15,24,32-36`
- Test: `src/tests/web/components/form/FieldRow.test.tsx:44-47`

**Interfaces:**
- Consumes: 없음
- Produces: `FieldRowProps.aiHintApplied?: boolean` — `true`면 배지 접두어가 `"AI 적용: "`, 기본값(`false`)이면 `"AI 추천: "`

**배경:** 현재 `FieldRow`가 `"AI 추천: "` 접두어를 하드코딩하고 있고, prop 주석도 *"표시만 하며 자동 적용하지 않는다"*라고 적혀 있다. 자동 채움이 붙으면 그 주석이 거짓이 되고 "AI 추천: 68세부터 수령"이 실제로는 적용된 값을 가리키게 된다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/web/components/form/FieldRow.test.tsx`의 기존 `aiHint` 테스트(44~47행) **아래**에 추가한다:

```typescript
  test('aiHintApplied가 true이면 "AI 적용" 접두어로 표시한다', () => {
    render(<FieldRow label="수령 시작" aiHint="68세부터 수령" aiHintApplied><input /></FieldRow>);

    expect(screen.getByText('AI 적용: 68세부터 수령')).toBeInTheDocument();
    expect(screen.queryByText('AI 추천: 68세부터 수령')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/components/form/FieldRow.test.tsx`
Expected: FAIL — `aiHintApplied` prop이 존재하지 않아 타입 에러가 나거나, 렌더 결과가 여전히 "AI 추천: ..."이라 `getByText`가 실패한다

- [ ] **Step 3: 최소 구현**

`FieldRow.tsx`의 prop 주석과 선언을 교체한다. 기존 14~15행:

```typescript
  // AI가 제안한 값의 표시 문자열(예: "70세"). 표시만 하며 자동 적용하지 않는다.
  aiHint?: string;
```

를 다음으로 바꾼다:

```typescript
  // AI가 제안한 값의 표시 문자열(예: "70세").
  aiHint?: string;
  // 이 값이 계산에 실제로 반영됐는지. 전략이 'ai_optimized'(미정)로 남아 있으면
  // applyAiSentinels가 추천값을 시뮬레이션에 넣으므로 "추천"이 아니라 "적용"이다.
  // 배지 문구가 둘을 구분하지 않으면 화면은 "AI 최적화"라고만 말하는데 엔진은 68세로
  // 계산하는 상태와, 추천만 있고 반영되지 않은 상태를 사용자가 구분할 수 없다.
  aiHintApplied?: boolean;
```

24행의 구조 분해에 `aiHintApplied = false`를 추가한다:

```typescript
  label, tooltipTerm, tooltipText, changed, aiHint, aiHintApplied = false, className = '', children,
```

32~36행의 배지 렌더를 교체한다:

```typescript
        {aiHint && (
          <span className="text-xs font-semibold text-primary/90 bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5">
            {aiHintApplied ? 'AI 적용' : 'AI 추천'}: {aiHint}
          </span>
        )}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/components/form/FieldRow.test.tsx`
Expected: PASS — 신규 케이스와 기존 `"AI 추천: 70세"` 케이스가 모두 통과한다(기본값이 `false`라 기존 동작 유지)

- [ ] **Step 5: 커밋**

```bash
git add src/web/components/form/FieldRow.tsx src/tests/web/components/form/FieldRow.test.tsx
git commit -m "feat: FieldRow AI 배지에 '적용/추천' 구분 추가

자동 채움된 값과 단순 제안을 같은 문구로 보여주면 화면과 엔진이 어긋난다."
```

---

### Task 4: `PensionStrategySection` 힌트 분기

**Files:**
- Modify: `src/web/features/StrategySettings/sections/PensionStrategySection.tsx:34-37,57`
- Test: `src/tests/web/features/StrategySettings/sections/PensionStrategySection.test.tsx`

**Interfaces:**
- Consumes: Task 3의 `FieldRow`의 `aiHintApplied` prop
- Produces: 없음 (최종 소비처)

**주의:** 이 컴포넌트는 이미 `resolveStrategy(params)`로 `strategy`를 읽고 있다(13행). 센티널 여부를 알기 위한 추가 prop은 필요 없다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/web/features/StrategySettings/sections/PensionStrategySection.test.tsx` 파일 끝의 `describe` 블록 안에 추가한다. 파일 상단의 기존 import(`initialParams`, `DEFAULT_RETIREMENT_STRATEGY`, `within`, `screen`, `render`, `vi`)를 그대로 쓰고, 다음 타입 import를 한 줄 추가한다:

```typescript
import { NationalPensionStrategy } from '@/core/entities/types';
```

그리고 아래 케이스를 추가한다:

```typescript
  describe('국민연금 AI 힌트', () => {
    // recommendedPlan 중 이 컴포넌트가 읽는 필드는 nationalPensionStartAge 하나뿐이라,
    // 나머지 필드는 타입을 만족시키기 위한 최소값으로 채운다.
    const aiWithAge = (nationalPensionStartAge: number) => ({
      recommendation: {
        recommendedPlan: {
          privatePensionMonthlyTarget: 0,
          nationalPensionStartAge,
          assetSellOrderStrategy: 'input_order',
          isaMaturityDestination: 'pension',
          generalAssetWithdrawalStartAge: 60,
          monthlySpendingMultiplier: 1,
        },
      },
      error: null,
      improved: true,
    } as unknown as Parameters<typeof PensionStrategySection>[0]['ai']);

    const paramsWith = (nationalPensionStrategy: NationalPensionStrategy) => ({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy },
    });

    test("'AI 최적화'(센티널)이면 '적용' 문구로 표시한다", () => {
      render(
        <PensionStrategySection
          params={paramsWith('ai_optimized')} onChangeParams={vi.fn()}
          mode="standard" changed={new Set()} ai={aiWithAge(68)}
        />
      );

      expect(screen.getByText('AI 적용: 68세부터 수령')).toBeInTheDocument();
    });

    test('확정 전략을 고른 상태면 "추천" 문구로 표시한다', () => {
      render(
        <PensionStrategySection
          params={paramsWith('defer_max')} onChangeParams={vi.fn()}
          mode="standard" changed={new Set()} ai={aiWithAge(68)}
        />
      );

      expect(screen.getByText('AI 추천: 68세부터 수령')).toBeInTheDocument();
    });

    test('추천이 없으면 힌트를 표시하지 않는다', () => {
      render(
        <PensionStrategySection
          params={paramsWith('ai_optimized')} onChangeParams={vi.fn()}
          mode="standard" changed={new Set()} ai={noAi}
        />
      );

      expect(screen.queryByText(/68세부터 수령/)).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/sections/PensionStrategySection.test.tsx`
Expected: FAIL — 첫 번째 케이스가 `Unable to find an element with the text: AI 적용: 68세부터 수령`으로 실패한다(현재는 항상 "AI 추천: ..."이 렌더된다)

- [ ] **Step 3: 최소 구현**

`PensionStrategySection.tsx`의 34~37행을 교체한다:

```typescript
  const plan = ai.improved ? ai.recommendation?.recommendedPlan : undefined;
  const nationalHint = plan?.nationalPensionStartAge !== undefined
    ? `${plan.nationalPensionStartAge}세부터 수령`
    : undefined;
  // 전략이 'ai_optimized'(미정)로 남아 있으면 applyAiSentinels가 이 나이를 시뮬레이션에
  // 실제로 넣는다. 확정 전략을 고른 사용자에게는 같은 값이 단순 제안일 뿐이다.
  const nationalHintApplied = strategy.nationalPensionStrategy === 'ai_optimized';
```

57행의 `aiHint={nationalHint}` 아래에 한 줄 추가한다:

```typescript
          aiHint={nationalHint}
          aiHintApplied={nationalHintApplied}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/sections/PensionStrategySection.test.tsx`
Expected: PASS — 신규 3건과 기존 케이스 전부

- [ ] **Step 5: 커밋**

```bash
git add src/web/features/StrategySettings/sections/PensionStrategySection.tsx src/tests/web/features/StrategySettings/sections/PensionStrategySection.test.tsx
git commit -m "feat: 국민연금 AI 힌트를 '적용/추천'으로 구분 표시

센티널이면 그 나이가 계산에 실제로 들어가므로 '적용'으로 알린다."
```

---

### Task 5: 통합 검증과 되먹임 회귀 테스트

**Files:**
- Test: `src/tests/core/usecases/strategy/applyAiSentinels.test.ts` (Task 1에서 만든 파일에 추가)

**Interfaces:**
- Consumes: Task 1의 `applyAiSentinels`, `SimulationEngine`
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트 작성**

Task 1에서 만든 테스트 파일 상단 import에 추가한다:

```typescript
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
```

파일 끝의 `describe('applyAiSentinels', ...)` 블록 **밖**에 새 describe를 추가한다:

```typescript
describe('applyAiSentinels 통합', () => {
  test('센티널을 채운 결과가 나이를 직접 지정한 params의 결과와 동일하다', () => {
    const engine = new SimulationEngine();

    const sentinel = compiledFor('ai_optimized');
    const applied = applyAiSentinels(sentinel, makeRecommendation(plan(68)));
    const appliedResult = engine.run(applied.params, applied.utilityConfig);

    // 같은 나이를 withdrawalPlan에 직접 넣은 경우. compileStrategy가 센티널을 65로 덮으므로
    // 컴파일 뒤에 넣어야 한다 — 컴파일 전에 넣으면 그 값이 다시 65로 뒤집힌다.
    const direct = compiledFor('ai_optimized');
    const directResult = engine.run(
      {
        ...direct.params,
        withdrawalPlan: { ...(direct.params.withdrawalPlan ?? {}), nationalPensionStartAge: 68 },
      },
      direct.utilityConfig
    );

    // 필드가 실제로 존재하는지 먼저 확인한다. SimulationResult.utility는 UtilityBreakdown
    // ({ score, components })이고 totalScore 같은 필드는 없다 — 없는 필드를 비교하면
    // undefined === undefined로 무의미하게 통과한다.
    expect(typeof appliedResult.utility?.score).toBe('number');

    expect(appliedResult.utility?.score).toBe(directResult.utility?.score);
    // score만으로는 집계값이라 변별력이 약할 수 있어 components까지 비교해 강화한다.
    expect(appliedResult.utility?.components).toEqual(directResult.utility?.components);
    // endingAssets는 비교하지 않는다 — 이 픽스처는 66세경 자산이 완전 소진되어 항상 0으로
    // 고정되므로, applyAiSentinels가 완전히 망가져 no-op이 되어도 이 값은 통과해 버린다.
    // 바로 아래 yearlyResults 비교가 이 검증을 온전히 대신한다.
    expect(JSON.stringify(appliedResult.yearlyResults)).toBe(JSON.stringify(directResult.yearlyResults));
  });

  test('센티널을 채우면 baseline(65세)과 결과가 달라진다', () => {
    const engine = new SimulationEngine();
    const compiled = compiledFor('ai_optimized');

    const baseline = engine.run(compiled.params, compiled.utilityConfig);
    const applied = applyAiSentinels(compiled, makeRecommendation(plan(70)));
    const appliedResult = engine.run(applied.params, applied.utilityConfig);

    // 빈 배열끼리 비교하면 "[]" === "[]"로 무의미하게 통과하므로 먼저 내용이 있는지 확인한다.
    // 한쪽만 비어 있어도 .not.toBe는 통과해 버리므로 양쪽 모두 확인해야 한다.
    expect(baseline.yearlyResults.length).toBeGreaterThan(0);
    expect(appliedResult.yearlyResults.length).toBeGreaterThan(0);

    // endingAssets는 이 시나리오에서 지표가 되지 못한다 — 자산이 66세경 완전 소진되어
    // 국민연금을 언제 받든 65세/70세 모두 0으로 고정된다. 연도별 결과 전체를 비교해야
    // "자동 채움이 시뮬레이션을 실제로 바꿨다"를 검증할 수 있다.
    expect(JSON.stringify(appliedResult.yearlyResults))
      .not.toBe(JSON.stringify(baseline.yearlyResults));
  });

  test('센티널을 채워도 원본 compiled는 변형되지 않는다(되먹임 방지)', () => {
    const compiled = compiledFor('ai_optimized');
    const before = compiled.params.withdrawalPlan?.nationalPensionStartAge;

    applyAiSentinels(compiled, makeRecommendation(plan(68)));

    // 추천 계산(recommendStrategy)의 입력은 언제나 이 원본이다. 여기가 오염되면
    // 다음 추천이 이미 적용된 값 위에서 계산되어 되먹임이 시작된다.
    expect(compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(before);
    expect(before).toBe(65);
  });
});
```

- [ ] **Step 2: 테스트 실행**

Run: `npx vitest run src/tests/core/usecases/strategy/applyAiSentinels.test.ts`
Expected: PASS — Task 1의 구현이 이미 불변성을 지키므로 두 케이스 모두 바로 통과한다. **하나라도 실패하면 Task 1의 구현이 입력을 변형하고 있다는 뜻이므로 되돌아가 고친다.**

- [ ] **Step 3: 전체 테스트 실행**

Run: `npx vitest run`
Expected: PASS — 기존 테스트가 하나도 깨지지 않아야 한다. 실패가 있으면 그 파일을 열어 원인을 확인하고, 이 계획의 변경 때문이면 고친다.

- [ ] **Step 4: 커밋**

```bash
git add src/tests/core/usecases/strategy/applyAiSentinels.test.ts
git commit -m "test: AI 센티널 자동 채움 통합·되먹임 회귀 테스트 추가"
```

---

## 완료 기준

- [ ] `npx vitest run` 전체 통과
- [ ] `npx tsc --noEmit` 에러 없음
- [ ] 국민연금 전략을 'AI 최적화'로 둔 시나리오에서 배지가 `AI 적용: N세부터 수령`으로 뜨고, 그 N이 대시보드 계산에 반영된다
- [ ] 확정 전략(예: '최대 연기')을 고르면 배지가 `AI 추천: N세부터 수령`으로 바뀌고 계산은 70세 기준으로 돈다
- [ ] 사용자 시나리오를 저장했다 다시 열어도 `strategy.nationalPensionStrategy`가 여전히 `'ai_optimized'`다 (params가 오염되지 않았다는 확인)
