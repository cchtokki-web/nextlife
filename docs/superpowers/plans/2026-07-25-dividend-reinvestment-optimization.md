# 배당 재투자 탐색 (Dividend Reinvestment Optimization) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 추천 엔진(`recommendStrategy`)에 Phase 3(배당 재투자 최적화)을 추가해, `InvestmentAsset.reinvestDividend`를 자산별로 독립 평가(O(N)) + 통합 검증해 추천하고, 기존 `recommendedResult`/`itemizedContributions`/`reasons`에 병합한다.

**Architecture:** 새 파일 `DividendReinvestmentOptimizer.ts`가 순수 탐색/의사결정 로직(시뮬레이션 실행 + 비교)만 담당하고, 라벨 문구·delta 계산은 기존처럼 `RecommendationEngine.ts`가 소유한다(순환 참조 방지 — `RecommendationEngine.ts`가 export하는 `computeDeltas`를 새 파일이 import하면 순환 참조가 생기므로, 새 파일은 원시 평가 결과만 반환하고 문구/델타 조립은 호출부에서 한다). 화면/PDF/AI 어드바이저 UI 코드는 전혀 수정하지 않는다 — 이미 `itemizedContributions`/`reasons`를 그대로 소비하고 있어 자동 반영된다.

**Tech Stack:** TypeScript(strict, `any` 금지), Vitest.

## Global Constraints

- 범위는 `InvestmentAsset.reinvestDividend`뿐이다. `PrivatePension`/`IsaAccount`로의 확장은 범위 밖.
- 탐색 방식은 자산별 독립 평가(O(N), 자산 N개 → N번 시뮬레이션) + 유리한 자산 전체를 합친 통합 검증(1회 추가 시뮬레이션). 2^N 전체 조합 그리드는 절대 사용하지 않는다.
- `params.assets.length === 0`이면 Phase 3 전체를 스킵한다(추가 시뮬레이션 0회).
- 개별 평가에서 유리하다고 나온 자산들을 합쳤을 때 통합 검증에서 오히려 baseline(Phase 1+2 결과)보다 나쁘면, 아무 것도 추천하지 않는다(완전한 no-op으로 폴백 — 부분 적용하지 않음).
- `StrategyRecommendation`에 새 필드 `recommendedAssetReinvestment: Record<string, boolean> | null`를 **필수**(옵셔널 아님)로 추가한다 — 기존 `recommendedPlan`/`itemizedContributions`/`recommendedResult`와 동일하게, 값을 채우지 못하는 케이스가 없으므로 optional일 이유가 없다는 이 프로젝트의 기존 원칙을 따른다.
- Phase 3의 결과는 `itemizedContributions` 배열에 항목을 추가하고 `reasons` 배열에 대응 문장을 추가하는 방식으로만 병합한다 — `RecommendationChecklist.tsx`/`renderItemizedChecklistSection`(PDF)/`route.ts`(AI 어드바이저)는 코드를 한 줄도 수정하지 않는다.
- `recommendedUtility`/`recommendedResult`/최상위 `deltas`는 Phase 3까지 반영한 **최종** 값이어야 한다(Phase 1+2 값이 아님). 단, `buildReasons()`에 전달하는 `deltas`와 `improved`는 Phase 1+2 전용 값을 그대로 유지해 기존 WithdrawalPlan 관련 문구가 부정확해지지 않게 한다(Phase 3가 없을 때와 완전히 동일한 문구가 나와야 함).
- TypeScript strict, `any` 사용 금지.

---

## File Structure

- `src/core/usecases/strategy/DividendReinvestmentOptimizer.ts` (신규) — Phase 3 탐색/의사결정 순수 함수.
- `src/tests/core/usecases/strategy/DividendReinvestmentOptimizer.test.ts` (신규)
- `src/core/entities/types.ts` (수정) — `StrategyRecommendation.recommendedAssetReinvestment` 필드 추가.
- 아래 7개 테스트 파일 (수정) — 새 필수 필드로 인한 컴파일 에러 수정(전부 `recommendedAssetReinvestment: null,` 한 줄 추가):
  - `src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts`
  - `src/tests/app/api/ai-advisor/route.test.ts`
  - `src/tests/app/api/ai-advisor/ruleBasedAdvisor.test.ts`
  - `src/tests/web/features/Pdf/pdfReportSections.test.ts`
  - `src/tests/web/features/Dashboard/DashboardSection.test.tsx`
  - `src/tests/web/features/Dashboard/recommendation/RecommendationChecklist.test.tsx`
  - `src/tests/web/features/Dashboard/hero/AiSummaryHero.test.tsx`
- `src/core/usecases/strategy/RecommendationEngine.ts` (수정) — Phase 3 호출 + 병합 로직.
- `src/tests/core/usecases/strategy/RecommendationEngine.test.ts` (수정 — Phase 3 통합 characterization 테스트 추가, 기존 테스트 회귀 확인).

---

## Task 1: `DividendReinvestmentOptimizer.ts` — Phase 3 탐색 로직

**Files:**
- Create: `src/core/usecases/strategy/DividendReinvestmentOptimizer.ts`
- Test: `src/tests/core/usecases/strategy/DividendReinvestmentOptimizer.test.ts`

**Interfaces:**
- Consumes: `SimulationParams`, `SimulationResult`, `CompleteWithdrawalPlan`, `UtilityBreakdown`, `UtilityConfig` (`src/core/entities/types.ts`, 기존, 변경 없음), `SimulationEngine.runForUtility`(기존, 변경 없음), `computeLifetimeUtility`(`src/core/usecases/utility/UtilityEngine.ts`, 기존, 변경 없음), `getIdentityPlan`(`src/core/usecases/strategy/StrategyCandidateGenerator.ts`, 기존, 변경 없음).
- Produces:
  ```ts
  export interface DividendReinvestmentPerAssetResult {
    assetId: string;
    assetName: string;
    flippedValue: boolean;
    utilityDelta: number;
    individualResult: SimulationResult;
  }

  export interface DividendReinvestmentOptimizationResult {
    recommendedAssetReinvestment: Record<string, boolean> | null;
    perAssetResults: DividendReinvestmentPerAssetResult[];
    finalResult: SimulationResult;
    finalUtility: UtilityBreakdown;
  }

  export function optimizeDividendReinvestment(
    params: SimulationParams,
    bestPlan: CompleteWithdrawalPlan | null,
    bestResult: SimulationResult,
    bestUtility: UtilityBreakdown,
    engine: SimulationEngine,
    cfg: UtilityConfig
  ): DividendReinvestmentOptimizationResult
  ```
  Task 3(`RecommendationEngine.ts` 통합)가 이 함수와 두 인터페이스를 그대로 소비한다. **주의**: 이 함수는 `computeDeltas`를 호출하지 않는다(순환 참조 방지) — 각 자산의 `deltas`/문구는 Task 3에서 `perAssetResults`의 `individualResult`를 받아 `RecommendationEngine.ts`가 직접 `computeDeltas(bestResult, individualResult)`로 계산한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/core/usecases/strategy/DividendReinvestmentOptimizer.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
import { optimizeDividendReinvestment } from '@/core/usecases/strategy/DividendReinvestmentOptimizer';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import {
  CompleteWithdrawalPlan,
  InvestmentAsset,
  SimulationParams,
  SimulationResult,
  UtilityBreakdown,
} from '@/core/entities/types';

vi.mock('@/core/usecases/utility/UtilityEngine', () => ({
  computeLifetimeUtility: vi.fn((result: SimulationResult) => ({
    score: result.retirementScore,
    components: { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 },
  })),
}));

const zeroComponents = { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 };

function makeAsset(overrides: Partial<InvestmentAsset>): InvestmentAsset {
  return {
    id: 'a1',
    type: 'etf',
    ticker: 'SPY',
    name: 'S&P500',
    quantity: 10,
    averagePrice: 400000,
    annualGrowthRate: 7,
    dividendYield: 3,
    monthlyContribution: 0,
    reinvestDividend: true,
    currency: 'KRW',
    ...overrides,
  };
}

const baseParams: SimulationParams = {
  userProfile: { currentAge: 40, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

function makeResult(retirementScore: number): SimulationResult {
  return {
    yearlyResults: [],
    fireAge: null,
    depletionAge: null,
    endingAssets: 0,
    retirementScore,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

const bestUtility: UtilityBreakdown = { score: 70, components: zeroComponents };
const bestResult = makeResult(70);

describe('optimizeDividendReinvestment', () => {
  test('assets가 없으면 그대로 no-op을 반환하고 시뮬레이션을 전혀 실행하지 않는다', () => {
    const runForUtility = vi.fn();
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(baseParams, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toBeNull();
    expect(result.perAssetResults).toEqual([]);
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
    expect(runForUtility).not.toHaveBeenCalled();
  });

  test('자산 하나뿐이고 뒤집어도 개선되지 않으면 no-op을 반환한다', () => {
    const params = { ...baseParams, assets: [makeAsset({ id: 'a1', reinvestDividend: true })] };
    const runForUtility = vi.fn(() => makeResult(65));
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toBeNull();
    expect(result.perAssetResults).toEqual([]);
    expect(runForUtility).toHaveBeenCalledTimes(1);
  });

  test('자산 하나뿐이고 뒤집으면 개선되면 추천하고 통합 검증도 통과시킨다', () => {
    const params = { ...baseParams, assets: [makeAsset({ id: 'a1', reinvestDividend: true })] };
    const individualResult = makeResult(75);
    const combinedResult = makeResult(75);
    const runForUtility = vi.fn().mockReturnValueOnce(individualResult).mockReturnValueOnce(combinedResult);
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toEqual({ a1: false });
    expect(result.perAssetResults).toHaveLength(1);
    expect(result.perAssetResults[0]).toMatchObject({
      assetId: 'a1',
      assetName: 'S&P500',
      flippedValue: false,
      utilityDelta: 5,
    });
    expect(result.finalResult).toBe(combinedResult);
    expect(result.finalUtility.score).toBe(75);
    expect(runForUtility).toHaveBeenCalledTimes(2);
  });

  test('여러 자산 중 일부만 개선되면 유리한 자산만 뒤집어 통합 검증한다', () => {
    const params = {
      ...baseParams,
      assets: [
        makeAsset({ id: 'a1', name: 'Asset A', reinvestDividend: true }),
        makeAsset({ id: 'a2', name: 'Asset B', reinvestDividend: false }),
      ],
    };
    const runForUtility = vi
      .fn()
      .mockReturnValueOnce(makeResult(72)) // a1 뒤집기: 개선
      .mockReturnValueOnce(makeResult(68)) // a2 뒤집기: 악화
      .mockReturnValueOnce(makeResult(73)); // 통합 검증(a1만 적용)
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toEqual({ a1: false });
    expect(result.perAssetResults).toHaveLength(1);
    expect(result.perAssetResults[0].assetId).toBe('a1');
    expect(runForUtility).toHaveBeenCalledTimes(3);
  });

  test('개별로는 개선되지만 통합 검증에서 오히려 악화되면 아무 것도 추천하지 않는다', () => {
    const params = {
      ...baseParams,
      assets: [
        makeAsset({ id: 'a1', reinvestDividend: true }),
        makeAsset({ id: 'a2', reinvestDividend: true }),
      ],
    };
    const runForUtility = vi
      .fn()
      .mockReturnValueOnce(makeResult(72)) // a1 뒤집기: 개선
      .mockReturnValueOnce(makeResult(71)) // a2 뒤집기: 개선
      .mockReturnValueOnce(makeResult(69)); // 통합 검증: 상호작용으로 오히려 악화
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toBeNull();
    expect(result.perAssetResults).toEqual([]);
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
  });

  test('bestPlan이 null이면 getIdentityPlan 기반 withdrawalPlan으로 후보를 만든다', () => {
    const params = { ...baseParams, assets: [makeAsset({ id: 'a1', reinvestDividend: true })] };
    const runForUtility = vi.fn(() => makeResult(65));
    const engine = { runForUtility } as unknown as SimulationEngine;

    optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const calledParams = runForUtility.mock.calls[0][0] as SimulationParams;
    expect(calledParams.withdrawalPlan?.privatePensionStartAge).toBe(params.userProfile.retirementAge);
  });

  test('bestPlan이 주어지면 그 계획을 그대로 사용한다', () => {
    const params = { ...baseParams, assets: [makeAsset({ id: 'a1', reinvestDividend: true })] };
    const plan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 65,
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 68,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const runForUtility = vi.fn(() => makeResult(65));
    const engine = { runForUtility } as unknown as SimulationEngine;

    optimizeDividendReinvestment(params, plan, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const calledParams = runForUtility.mock.calls[0][0] as SimulationParams;
    expect(calledParams.withdrawalPlan?.nationalPensionStartAge).toBe(68);
  });

  test('특정 자산 평가 중 예외가 발생해도 나머지는 계속 평가된다', () => {
    const params = {
      ...baseParams,
      assets: [
        makeAsset({ id: 'a1', reinvestDividend: true }),
        makeAsset({ id: 'a2', reinvestDividend: true }),
      ],
    };
    const runForUtility = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('시뮬레이션 실패');
      })
      .mockReturnValueOnce(makeResult(72))
      .mockReturnValueOnce(makeResult(73));
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toEqual({ a2: false });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/DividendReinvestmentOptimizer.test.ts`
Expected: FAIL — `Cannot find module '@/core/usecases/strategy/DividendReinvestmentOptimizer'`

- [ ] **Step 3: 구현**

`src/core/usecases/strategy/DividendReinvestmentOptimizer.ts`:

```ts
import { CompleteWithdrawalPlan, SimulationParams, SimulationResult, UtilityBreakdown, UtilityConfig } from '../../entities/types';
import { SimulationEngine } from '../SimulationEngine';
import { computeLifetimeUtility } from '../utility/UtilityEngine';
import { getIdentityPlan } from './StrategyCandidateGenerator';

export interface DividendReinvestmentPerAssetResult {
  assetId: string;
  assetName: string;
  flippedValue: boolean;
  utilityDelta: number;
  individualResult: SimulationResult;
}

export interface DividendReinvestmentOptimizationResult {
  recommendedAssetReinvestment: Record<string, boolean> | null;
  perAssetResults: DividendReinvestmentPerAssetResult[];
  finalResult: SimulationResult;
  finalUtility: UtilityBreakdown;
}

function buildParamsWithReinvestmentOverrides(
  params: SimulationParams,
  plan: CompleteWithdrawalPlan,
  overrides: Record<string, boolean>
): SimulationParams {
  return {
    ...params,
    withdrawalPlan: plan,
    assets: params.assets.map((a) => (a.id in overrides ? { ...a, reinvestDividend: overrides[a.id] } : a)),
  };
}

function noOpResult(bestResult: SimulationResult, bestUtility: UtilityBreakdown): DividendReinvestmentOptimizationResult {
  return {
    recommendedAssetReinvestment: null,
    perAssetResults: [],
    finalResult: bestResult,
    finalUtility: bestUtility,
  };
}

// bestPlan/bestResult/bestUtility(Phase 1+2 결과) 기준으로 자산별 reinvestDividend 반전을
// 독립 평가(O(N), 자산 N개 -> N번 시뮬레이션)하고, 유리한 자산들을 한꺼번에 적용한 조합을
// 한 번 더 검증한다(자산 간 비가산적 상호작용에 대한 안전장치). 개선이 없으면 완전한 no-op을
// 반환해(finalResult===bestResult, finalUtility===bestUtility) 호출부가 항상 동일한 형태로
// 값을 소비할 수 있게 한다.
export function optimizeDividendReinvestment(
  params: SimulationParams,
  bestPlan: CompleteWithdrawalPlan | null,
  bestResult: SimulationResult,
  bestUtility: UtilityBreakdown,
  engine: SimulationEngine,
  cfg: UtilityConfig
): DividendReinvestmentOptimizationResult {
  if (params.assets.length === 0) return noOpResult(bestResult, bestUtility);

  const plan = bestPlan ?? getIdentityPlan(params);
  const beneficial: DividendReinvestmentPerAssetResult[] = [];

  for (const asset of params.assets) {
    const flippedValue = !asset.reinvestDividend;
    try {
      const candidateParams = buildParamsWithReinvestmentOverrides(params, plan, { [asset.id]: flippedValue });
      const candidateResult = engine.runForUtility(candidateParams);
      const candidateUtility = computeLifetimeUtility(candidateResult, candidateParams, cfg);
      if (candidateUtility.score > bestUtility.score) {
        beneficial.push({
          assetId: asset.id,
          assetName: asset.name,
          flippedValue,
          utilityDelta: candidateUtility.score - bestUtility.score,
          individualResult: candidateResult,
        });
      }
    } catch (err) {
      console.warn('Skipping dividend reinvestment candidate that failed to simulate', asset.id, err);
    }
  }

  if (beneficial.length === 0) return noOpResult(bestResult, bestUtility);

  const overrides: Record<string, boolean> = {};
  for (const r of beneficial) overrides[r.assetId] = r.flippedValue;

  let combinedResult: SimulationResult;
  let combinedUtility: UtilityBreakdown;
  try {
    const combinedParams = buildParamsWithReinvestmentOverrides(params, plan, overrides);
    combinedResult = engine.runForUtility(combinedParams);
    combinedUtility = computeLifetimeUtility(combinedResult, combinedParams, cfg);
  } catch (err) {
    console.warn('Skipping combined dividend reinvestment verification', err);
    return noOpResult(bestResult, bestUtility);
  }

  if (combinedUtility.score <= bestUtility.score) return noOpResult(bestResult, bestUtility);

  return {
    recommendedAssetReinvestment: overrides,
    perAssetResults: beneficial,
    finalResult: combinedResult,
    finalUtility: combinedUtility,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/DividendReinvestmentOptimizer.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/usecases/strategy/DividendReinvestmentOptimizer.ts src/tests/core/usecases/strategy/DividendReinvestmentOptimizer.test.ts
git commit -m "feat: 배당 재투자 최적화(Phase 3) 탐색 로직 추가"
```

---

## Task 2: `StrategyRecommendation` 타입 확장 및 기존 fixture 수정

**Files:**
- Modify: `src/core/entities/types.ts`
- Modify: `src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts`
- Modify: `src/tests/app/api/ai-advisor/route.test.ts`
- Modify: `src/tests/app/api/ai-advisor/ruleBasedAdvisor.test.ts`
- Modify: `src/tests/web/features/Pdf/pdfReportSections.test.ts`
- Modify: `src/tests/web/features/Dashboard/DashboardSection.test.tsx`
- Modify: `src/tests/web/features/Dashboard/recommendation/RecommendationChecklist.test.tsx`
- Modify: `src/tests/web/features/Dashboard/hero/AiSummaryHero.test.tsx`

**Interfaces:**
- Produces: `StrategyRecommendation.recommendedAssetReinvestment: Record<string, boolean> | null` (신규 필수 필드). Task 3이 이 필드를 실제로 채운다.

**이 태스크는 순수 컴파일 수정이다** — 모든 fixture에 `recommendedAssetReinvestment: null,`을 추가할 뿐 어떤 테스트의 동작/기대값도 바꾸지 않는다. 각 파일을 수정한 뒤 `npx tsc --noEmit`으로 해당 컴파일 에러가 사라지는지 확인해가며 진행한다.

- [ ] **Step 1: 타입 확장**

`src/core/entities/types.ts`에서 아래 블록을 찾는다:

```ts
  // baseline보다 Utility가 개선되는 후보를 찾았을 때만 해당 WithdrawalPlan이 채워지고, 그렇지
  // 않으면 null(= baseline 유지 권장). "부분 override 패치"인 WithdrawalPlan과 달리 여기서는
  // "AI가 확정한 완결된 결정" 또는 "결정 없음"이라는 의미로만 쓰인다.
  recommendedPlan: CompleteWithdrawalPlan | null;
  improved: boolean; // recommendedUtility.score > currentUtility.score 여부를 미리 계산해 둔 값. 소비처마다 재계산하지 않는다.
```

아래로 교체:

```ts
  // baseline보다 Utility가 개선되는 후보를 찾았을 때만 해당 WithdrawalPlan이 채워지고, 그렇지
  // 않으면 null(= baseline 유지 권장). "부분 override 패치"인 WithdrawalPlan과 달리 여기서는
  // "AI가 확정한 완결된 결정" 또는 "결정 없음"이라는 의미로만 쓰인다.
  recommendedPlan: CompleteWithdrawalPlan | null;
  // assetId -> 권장 reinvestDividend 값(Phase 3: 배당 재투자 최적화). recommendedPlan과 달리
  // WithdrawalPlan이 아니라 은퇴 "전" 축적기 파라미터(자산 배열 내부 값)라 별도 필드로 분리했다.
  // 변경 권장이 없으면(자산 없음/개선 없음/통합 검증 실패) null.
  recommendedAssetReinvestment: Record<string, boolean> | null;
  improved: boolean; // recommendedUtility.score > currentUtility.score 여부를 미리 계산해 둔 값. 소비처마다 재계산하지 않는다.
```

- [ ] **Step 2: `computeExecutionRoadmap.test.ts` 수정**

아래 블록을 찾는다:

```ts
function makeRecommendation(recommendedPlan: CompleteWithdrawalPlan | null): StrategyRecommendation {
  return {
    currentUtility: utility,
    recommendedUtility: utility,
    recommendedPlan,
    improved: recommendedPlan !== null,
```

아래로 교체:

```ts
function makeRecommendation(recommendedPlan: CompleteWithdrawalPlan | null): StrategyRecommendation {
  return {
    currentUtility: utility,
    recommendedUtility: utility,
    recommendedPlan,
    recommendedAssetReinvestment: null,
    improved: recommendedPlan !== null,
```

- [ ] **Step 3: `route.test.ts` 수정 (2곳)**

첫 번째 — 아래 블록을 찾는다:

```ts
      recommendedPlan: {
        privatePensionStartAge: 62,
        privatePensionMonthlyTarget: 0,
        nationalPensionStartAge: 65,
        assetSellOrderStrategy: 'input_order',
        isaMaturityDestination: 'pension',
        generalAssetWithdrawalStartAge: 65,
        monthlySpendingMultiplier: 1,
      },
      improved: true,
      reasons: ['62세부터 사적연금 인출을 시작합니다.'],
```

아래로 교체:

```ts
      recommendedPlan: {
        privatePensionStartAge: 62,
        privatePensionMonthlyTarget: 0,
        nationalPensionStartAge: 65,
        assetSellOrderStrategy: 'input_order',
        isaMaturityDestination: 'pension',
        generalAssetWithdrawalStartAge: 65,
        monthlySpendingMultiplier: 1,
      },
      recommendedAssetReinvestment: null,
      improved: true,
      reasons: ['62세부터 사적연금 인출을 시작합니다.'],
```

두 번째 — 아래 블록을 찾는다:

```ts
      recommendedPlan: null,
      improved: false,
      reasons: ['현재 전략이 이미 합리적입니다.'],
```

아래로 교체:

```ts
      recommendedPlan: null,
      recommendedAssetReinvestment: null,
      improved: false,
      reasons: ['현재 전략이 이미 합리적입니다.'],
```

- [ ] **Step 4: `ruleBasedAdvisor.test.ts` 수정**

아래 블록을 찾는다:

```ts
    } : null,
    improved,
    reasons: ['62세부터 사적연금 인출을 시작합니다.'],
```

아래로 교체:

```ts
    } : null,
    recommendedAssetReinvestment: null,
    improved,
    reasons: ['62세부터 사적연금 인출을 시작합니다.'],
```

- [ ] **Step 5: `pdfReportSections.test.ts` 수정 (2곳)**

첫 번째 — 아래 블록을 찾는다:

```ts
      recommendedPlan: null,
      improved: false,
      reasons: [],
      deltas: zeroDeltas,
      totalCandidateCount: 0,
```

아래로 교체:

```ts
      recommendedPlan: null,
      recommendedAssetReinvestment: null,
      improved: false,
      reasons: [],
      deltas: zeroDeltas,
      totalCandidateCount: 0,
```

두 번째 — 아래 블록을 찾는다:

```ts
      recommendedPlan: null,
      improved: true,
      reasons: [],
      deltas: zeroDeltas,
      totalCandidateCount: 12,
```

아래로 교체:

```ts
      recommendedPlan: null,
      recommendedAssetReinvestment: null,
      improved: true,
      reasons: [],
      deltas: zeroDeltas,
      totalCandidateCount: 12,
```

- [ ] **Step 6: `DashboardSection.test.tsx` 수정**

아래 블록을 찾는다:

```ts
  recommendedPlan: null,
  improved: true,
  reasons: ['국민연금을 70세부터 수령합니다.'],
```

아래로 교체:

```ts
  recommendedPlan: null,
  recommendedAssetReinvestment: null,
  improved: true,
  reasons: ['국민연금을 70세부터 수령합니다.'],
```

- [ ] **Step 7: `RecommendationChecklist.test.tsx` 수정**

아래 블록을 찾는다:

```ts
    recommendedPlan: null,
    improved: false,
    reasons: ['현재 전략이 이미 합리적입니다.'],
```

아래로 교체:

```ts
    recommendedPlan: null,
    recommendedAssetReinvestment: null,
    improved: false,
    reasons: ['현재 전략이 이미 합리적입니다.'],
```

- [ ] **Step 8: `AiSummaryHero.test.tsx` 수정**

아래 블록을 찾는다:

```ts
      recommendedPlan: null,
      improved: true,
      reasons: ['국민연금을 70세부터 수령합니다.'],
```

아래로 교체:

```ts
      recommendedPlan: null,
      recommendedAssetReinvestment: null,
      improved: true,
      reasons: ['국민연금을 70세부터 수령합니다.'],
```

- [ ] **Step 9: 컴파일 및 전체 테스트 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음(위 8곳 전부 수정 완료 시 `recommendedAssetReinvestment` 누락으로 인한 타입 에러가 모두 사라짐)

Run: `npm test`
Expected: 전체 PASS, 실패 0건(동작 변경 없는 순수 컴파일 수정이므로 회귀 없어야 함)

- [ ] **Step 10: 커밋**

```bash
git add src/core/entities/types.ts src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts src/tests/app/api/ai-advisor/route.test.ts src/tests/app/api/ai-advisor/ruleBasedAdvisor.test.ts src/tests/web/features/Pdf/pdfReportSections.test.ts src/tests/web/features/Dashboard/DashboardSection.test.tsx src/tests/web/features/Dashboard/recommendation/RecommendationChecklist.test.tsx src/tests/web/features/Dashboard/hero/AiSummaryHero.test.tsx
git commit -m "feat: StrategyRecommendation에 recommendedAssetReinvestment 필드 추가"
```

---

## Task 3: `RecommendationEngine.ts`에 Phase 3 통합

**Files:**
- Modify: `src/core/usecases/strategy/RecommendationEngine.ts`
- Modify: `src/tests/core/usecases/strategy/RecommendationEngine.test.ts`

**Interfaces:**
- Consumes: `optimizeDividendReinvestment`, `DividendReinvestmentPerAssetResult` (Task 1, `src/core/usecases/strategy/DividendReinvestmentOptimizer.ts`), `recommendedAssetReinvestment` 필드 (Task 2).
- Produces: 없음(최종 통합 — 다른 태스크가 이 파일을 소비하지 않음).

**가장 중요한 불변 조건**: `params.assets.length === 0`이거나 Phase 3이 아무 개선도 찾지 못하면, `optimizeDividendReinvestment`는 `finalResult === bestResult`(참조 동일), `finalUtility === bestUtility`(참조 동일), `perAssetResults: []`를 반환한다. 이 경우 아래 통합 로직을 거쳐도 **기존(Phase 3 도입 이전) 동작과 100% 동일한 결과**가 나와야 한다 — `RecommendationEngine.test.ts`의 기존 테스트 전부가 자산이 없는 fixture를 쓰므로, Task 3 완료 후에도 기존 테스트가 전부 그대로 통과해야 한다(문자열 1바이트도 안 바뀌어야 함).

- [ ] **Step 1: 현재 파일 상태 확인**

Run: `grep -n "^import\|const { bestResult, bestUtility, bestPlan\|const deltas = computeDeltas\|const improved = bestPlan\|const reasons = buildReasons\|const itemizedContributions = bestPlan\|return {" src/core/usecases/strategy/RecommendationEngine.ts`

아래 Step들의 old_string이 현재 파일과 일치하는지 확인한다.

- [ ] **Step 2: import 추가**

아래 줄을 찾는다:

```ts
import { generateCandidatePlans, generateSpendingAdjustmentCandidates, getIdentityPlan } from './StrategyCandidateGenerator';
```

바로 다음 줄에 추가:

```ts
import { optimizeDividendReinvestment } from './DividendReinvestmentOptimizer';
```

- [ ] **Step 3: Phase 3 호출 및 병합 로직으로 교체**

아래 블록을 찾는다(`recommendStrategy` 함수의 마지막 부분, `state` 구조 분해부터 `return`까지):

```ts
  const { bestResult, bestUtility, bestPlan, failedCandidateCount } = state;
  const deltas = computeDeltas(baselineResult, bestResult);
  const improved = bestPlan !== null;
  const candidateStats = { total: candidates.length + spendingCandidates.length, failed: failedCandidateCount };
  const reasons = buildReasons(bestPlan, deltas, improved, candidateStats, {
    currentUtility,
    recommendedUtility: bestUtility,
    cfg,
    originalMonthlyTarget: params.userProfile.targetMonthlySpending,
    identityPlan,
  });
  const itemizedContributions = bestPlan
    ? computeItemizedContributions(params, identityPlan, bestPlan, currentUtility, baselineResult, engine, cfg)
    : [];

  return {
    currentUtility,
    recommendedUtility: bestUtility,
    recommendedPlan: bestPlan,
    improved,
    reasons,
    totalCandidateCount: candidateStats.total,
    failedCandidateCount: candidateStats.failed,
    deltas,
    recommendedResult: bestResult,
    itemizedContributions,
  };
}
```

아래로 교체:

```ts
  const { bestResult, bestUtility, bestPlan, failedCandidateCount } = state;
  const withdrawalPlanDeltas = computeDeltas(baselineResult, bestResult);
  const withdrawalPlanImproved = bestPlan !== null;
  const candidateStats = { total: candidates.length + spendingCandidates.length, failed: failedCandidateCount };
  const baseReasons = buildReasons(bestPlan, withdrawalPlanDeltas, withdrawalPlanImproved, candidateStats, {
    currentUtility,
    recommendedUtility: bestUtility,
    cfg,
    originalMonthlyTarget: params.userProfile.targetMonthlySpending,
    identityPlan,
  });
  const withdrawalItemizedContributions = bestPlan
    ? computeItemizedContributions(params, identityPlan, bestPlan, currentUtility, baselineResult, engine, cfg)
    : [];

  // Phase 3: 배당 재투자 최적화 (신규). Phase 1+2 결과 위에서 자산별 reinvestDividend를
  // 독립 평가(O(N)) + 통합 검증한다. WithdrawalPlan(bestPlan)과는 다른 축(축적기 파라미터)이라
  // bestPlan 자체는 바꾸지 않고, 최종 결과와 추가 itemized 항목/reasons만 병합한다.
  const reinvestOpt = optimizeDividendReinvestment(params, bestPlan, bestResult, bestUtility, engine, cfg);
  const additionalItemizedContributions: ItemizedContribution[] = reinvestOpt.perAssetResults.map((r) => ({
    label: r.flippedValue
      ? `"${r.assetName}"의 배당을 재투자로 전환합니다.`
      : `"${r.assetName}"의 배당 재투자를 중단하고 현금으로 인출합니다.`,
    utilityDelta: r.utilityDelta,
    deltas: computeDeltas(bestResult, r.individualResult),
  }));
  const additionalReasons = additionalItemizedContributions.map((c) => c.label);

  // withdrawalPlanImproved면 기존 reasons 뒤에 자연스럽게 이어붙이고, WithdrawalPlan 차원에서는
  // 개선이 없었는데 Phase 3만 개선을 찾았다면 "개선 없음" 문구(baseReasons) 대신 Phase 3
  // 문구만 보여준다(둘 다 없으면 기존 baseReasons의 "개선 없음" 문구를 그대로 유지).
  const reasons = withdrawalPlanImproved
    ? [...baseReasons, ...additionalReasons]
    : additionalReasons.length > 0
      ? additionalReasons
      : baseReasons;
  const itemizedContributions = [...withdrawalItemizedContributions, ...additionalItemizedContributions];
  const improved = reinvestOpt.finalUtility.score > currentUtility.score;
  const deltas = computeDeltas(baselineResult, reinvestOpt.finalResult);

  return {
    currentUtility,
    recommendedUtility: reinvestOpt.finalUtility,
    recommendedPlan: bestPlan,
    recommendedAssetReinvestment: reinvestOpt.recommendedAssetReinvestment,
    improved,
    reasons,
    totalCandidateCount: candidateStats.total,
    failedCandidateCount: candidateStats.failed,
    deltas,
    recommendedResult: reinvestOpt.finalResult,
    itemizedContributions,
  };
}
```

- [ ] **Step 4: 기존 회귀 테스트 실행**

Run: `npx vitest run src/tests/core/usecases/strategy/RecommendationEngine.test.ts`
Expected: 전체 PASS. **이 파일의 기존 fixture는 전부 `assets: []`(빈 배열)이므로 Phase 3는 항상 스킵되고, 결과는 Phase 3 도입 이전과 완전히 동일해야 한다.** 만약 실패하는 테스트가 있다면, `withdrawalPlanDeltas`/`withdrawalPlanImproved`로의 변수명 변경이나 병합 로직에 실수가 없는지 다시 확인한다 — assets가 비어 있는 한 어떤 기존 테스트도 값이 달라지면 안 된다.

- [ ] **Step 5: 성능 회귀 테스트 실행**

Run: `npx vitest run src/tests/core/usecases/strategy/RecommendationEngine.performance.test.ts`
Expected: PASS. Phase 3는 자산이 있을 때만 자산 개수+1회의 추가 시뮬레이션을 더하므로, 기존 5초 예산에 미미한 영향만 준다.

- [ ] **Step 6: Phase 3 통합 characterization 테스트 추가**

`src/tests/core/usecases/strategy/RecommendationEngine.test.ts` 파일 하단에 아래 테스트를 추가한다(이 파일은 이미 실제 `SimulationEngine` 인스턴스를 사용하는 관례를 따른다 — 기존 파일 상단의 `import { SimulationEngine } from '@/core/usecases/SimulationEngine';`와 실제 엔진 인스턴스 생성 패턴을 그대로 재사용):

```ts
describe('recommendStrategy - Phase 3 배당 재투자 통합', () => {
  test('assets가 비어 있으면 recommendedAssetReinvestment는 null이다', () => {
    const engine = new SimulationEngine();
    const result = recommendStrategy(paramsWithLargePension, engine);
    expect(result.recommendedAssetReinvestment).toBeNull();
  });

  test('자산이 있으면 itemizedContributions/reasons에 배당 재투자 항목이 추가될 수 있다(구조 검증)', () => {
    const engine = new SimulationEngine();
    const paramsWithAssets: SimulationParams = {
      ...paramsWithLargePension,
      assets: [
        {
          id: 'asset-1',
          type: 'etf',
          ticker: 'SPY',
          name: '테스트자산',
          quantity: 100,
          averagePrice: 50000,
          annualGrowthRate: 7,
          dividendYield: 4,
          monthlyContribution: 0,
          reinvestDividend: false,
          currency: 'KRW',
        },
      ],
    };
    const result = recommendStrategy(paramsWithAssets, engine);
    // recommendedAssetReinvestment는 null이거나 { 'asset-1': boolean } 형태만 가능하다.
    if (result.recommendedAssetReinvestment !== null) {
      expect(Object.keys(result.recommendedAssetReinvestment)).toEqual(['asset-1']);
      expect(result.itemizedContributions.some((c) => c.label.includes('테스트자산'))).toBe(true);
    }
  });
});
```

**주의**: 두 번째 테스트는 실제 엔진으로 자산이 실제로 개선을 가져오는지 여부에 따라 `recommendedAssetReinvestment`가 `null`이거나 실제 값이거나 둘 다 가능하므로, 이 테스트는 어느 쪽이 나오든 "구조가 올바른가"만 검증한다(정확히 어느 방향으로 결정될지는 실제 실행 결과를 봐야 알 수 있다 — 이 테스트를 실행해보고 만약 항상 `null`만 나온다면, `dividendYield`를 더 높이거나(예: 8%) `annualGrowthRate`를 낮추는(예: 3%) 식으로 재투자 방향에 따른 차이가 뚜렷해지도록 fixture를 조정한다).

- [ ] **Step 7: 전체 테스트 실행**

Run: `npm test`
Expected: 전체 PASS, 실패 0건

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add src/core/usecases/strategy/RecommendationEngine.ts src/tests/core/usecases/strategy/RecommendationEngine.test.ts
git commit -m "feat: RecommendationEngine에 배당 재투자 최적화(Phase 3) 통합"
```

---

## Task 4: 최종 검증

**Files:** 없음(변경 없이 검증만 수행)

- [ ] **Step 1: 전체 테스트 스위트**

Run: `npm test`
Expected: 전체 PASS, 실패 0건

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 빌드**

Run: `npm run build`
Expected: 성공

- [ ] **Step 4: lint**

Run: `npm run lint`
Expected: 이번 브랜치에서 새로 추가/수정된 파일에 대해 에러 없음(기존에 존재하던, 이 브랜치와 무관한 warning은 무시)

- [ ] **Step 5: 브라우저 수동 확인 (권장)**

`npm run dev`로 결과 화면 접속 → 배당수익률이 높고 `reinvestDividend`가 켜져/꺼져 있는 자산을 몇 개 등록 → "AI 추천 전략" 체크리스트에 배당 재투자 관련 항목이 뜨는지, "결과 다운로드" PDF에도 동일하게 반영되는지 확인. 자산이 은퇴 시점 자산 규모에 영향을 주려면 은퇴까지 기간이 충분히 남아있는 시나리오(예: 현재 나이 35세, 은퇴 60세)로 테스트하는 것이 효과를 확인하기 쉽다(Phase 3는 은퇴 "전" 축적기에만 영향을 준다).
