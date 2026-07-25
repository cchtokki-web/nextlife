# 민감도 분석 (Sensitivity Analysis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 투자수익률/물가상승률/은퇴시점을 각각 살짝 바꿨을 때 자산 고갈 나이가 얼마나 민감하게 변하는지 `ExpertDetailsPanel`(기본 접힘)에 6개 가로 막대로 보여준다.

**Architecture:** `computeRiskAlerts.ts`와 동일한 "순수 함수 usecase" 패턴을 따르되, 시나리오별로 `SimulationEngine.runForUtility()`를 재실행해야 하므로 engine 인스턴스를 인자로 받는다(`RecommendationEngine.recommendStrategy(params, engine, cfg)`와 동일한 DI 방식). 계산 결과는 `SensitivityAnalysisSection`이라는 얇은 presentational 컴포넌트가 렌더링하며, `ExpertDetailsPanel`이 자체적으로 `SimulationEngine` 인스턴스를 생성해 계산을 소유한다(`computeExpertAnalytics`가 이미 이 패널 안에서 자기 계산을 스스로 책임지는 것과 동일 관례).

**Tech Stack:** TypeScript(strict, `any` 금지), React 19, Vitest + Testing Library, Tailwind CSS v4(신규 컴포넌트에 한해).

## Global Constraints

- 비교 지표는 자산 고갈 나이(`depletionAge`) 단일 지표. `null`은 "평생 유지"로 표시한다.
- 시나리오는 정확히 6개: 투자수익률 -2%p/+2%p, 물가상승률 +1%p/-1%p, 은퇴시점 -3년/+3년. 조합 시나리오는 범위 밖이다.
- 표시 형식은 recharts를 쓰지 않는 순수 `div` 기반 가로 막대 목록이다.
- 배치 위치는 `ExpertDetailsPanel` 내부(기본 접힘 Collapse 안)다 — 항상 노출되는 별도 섹션이 아니다.
- 정렬은 가장 위험한(고갈이 가장 빠른) 시나리오가 먼저 오도록 하며, `depletionAge === null`(평생 유지)인 시나리오는 항상 뒤로 보낸다(`computeRiskAlerts`의 정렬 관례와 동일).
- 은퇴시점 시나리오는 `currentAge + 1` 미만, `expectancy - 1` 초과로 넘어가지 않도록 clamp한다.
- 개별 시나리오 실행이 예외를 던지면 해당 시나리오만 제외하고 나머지는 정상 반환한다.
- `engine: SimulationEngine`은 `ExpertDetailsPanel`이 `useMemo(() => new SimulationEngine(), [])`로 로컬 생성하며, page.tsx의 엔진 인스턴스를 prop으로 끌어오지 않는다.

---

## File Structure

- `src/core/usecases/dashboard/computeSensitivityAnalysis.ts` (신규) — 6개 시나리오 정의, 파라미터 override, 재실행, 정렬, 실패 격리를 담당하는 단일 순수 함수 모듈.
- `src/tests/core/usecases/dashboard/computeSensitivityAnalysis.test.ts` (신규)
- `src/web/features/Dashboard/expert/SensitivityAnalysisSection.tsx` (신규) — `SensitivityScenario[]`를 받아 가로 막대 목록을 렌더링하는 presentational 컴포넌트. 계산 로직 0%.
- `src/tests/web/features/Dashboard/expert/SensitivityAnalysisSection.test.tsx` (신규)
- `src/web/features/Dashboard/expert/ExpertDetailsPanel.tsx` (수정) — engine 인스턴스 생성 + `computeSensitivityAnalysis` 호출(useMemo) + `SensitivityAnalysisSection` 배치.
- `src/tests/web/features/Dashboard/expert/ExpertDetailsPanel.test.tsx` (수정 — 기존 파일에 통합 테스트 추가)

---

## Task 1: `computeSensitivityAnalysis` usecase

**Files:**
- Create: `src/core/usecases/dashboard/computeSensitivityAnalysis.ts`
- Test: `src/tests/core/usecases/dashboard/computeSensitivityAnalysis.test.ts`

**Interfaces:**
- Consumes: `SimulationParams`, `SimulationResult` (`src/core/entities/types.ts`, 기존 타입, 변경 없음), `SimulationEngine`의 `runForUtility(params: SimulationParams): SimulationResult` 메서드(`src/core/usecases/SimulationEngine.ts`, 기존, 변경 없음).
- Produces:
  ```ts
  export interface SensitivityScenario {
    key: 'returnDown' | 'returnUp' | 'inflationUp' | 'inflationDown' | 'retirementEarlier' | 'retirementLater';
    label: string;
    depletionAge: number | null;
    deltaYears: number | null;
  }

  export function computeSensitivityAnalysis(
    params: SimulationParams,
    baselineResult: SimulationResult,
    engine: SimulationEngine,
  ): SensitivityScenario[]
  ```
  Task 2(컴포넌트)와 Task 3(ExpertDetailsPanel 배선)이 이 `SensitivityScenario` 타입과 `computeSensitivityAnalysis` 함수 시그니처를 그대로 소비한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/core/usecases/dashboard/computeSensitivityAnalysis.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
import { computeSensitivityAnalysis, SensitivityScenario } from '@/core/usecases/dashboard/computeSensitivityAnalysis';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams, SimulationResult } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 40, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [
    { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 10, averagePrice: 400000,
      annualGrowthRate: 7, dividendYield: 1.5, monthlyContribution: 500000, reinvestDividend: true, currency: 'KRW' },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 50000000, monthlyContribution: 300000, annualReturn: 4, currency: 'KRW' },
  ],
  isaAccounts: [
    { id: 'i1', type: 'general', balance: 20000000, monthlyContribution: 200000,
      annualReturn: 5, dividendYield: 2, currency: 'KRW', maturityYears: 3 },
  ],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

function makeResult(depletionAge: number | null): SimulationResult {
  return {
    yearlyResults: [],
    fireAge: 60,
    depletionAge,
    endingAssets: 0,
    retirementScore: 70,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

function makeMockEngine(depletionAgeByLabel: Record<string, number | null>): SimulationEngine {
  const runForUtility = vi.fn((params: SimulationParams) => {
    if (params.assets[0]?.annualGrowthRate === 5) return makeResult(depletionAgeByLabel['returnDown']);
    if (params.assets[0]?.annualGrowthRate === 9) return makeResult(depletionAgeByLabel['returnUp']);
    if (params.inflationRate === 3) return makeResult(depletionAgeByLabel['inflationUp']);
    if (params.inflationRate === 1) return makeResult(depletionAgeByLabel['inflationDown']);
    if (params.userProfile.retirementAge === 57) return makeResult(depletionAgeByLabel['retirementEarlier']);
    if (params.userProfile.retirementAge === 63) return makeResult(depletionAgeByLabel['retirementLater']);
    throw new Error(`unexpected params: ${JSON.stringify(params)}`);
  });
  return { runForUtility } as unknown as SimulationEngine;
}

describe('computeSensitivityAnalysis', () => {
  test('투자수익률 시나리오는 assets/privatePensions/isaAccounts 수익률에 동일하게 델타를 적용한다', () => {
    const engine = makeMockEngine({
      returnDown: 85, returnUp: 90, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    });
    computeSensitivityAnalysis(baseParams, makeResult(88), engine);

    const calls = (engine.runForUtility as unknown as { mock: { calls: SimulationParams[][] } }).mock.calls;
    const returnDownCall = calls.find((c) => c[0].assets[0].annualGrowthRate === 5)![0];
    expect(returnDownCall.privatePensions[0].annualReturn).toBe(2); // 4 - 2
    expect(returnDownCall.isaAccounts![0].annualReturn).toBe(3); // 5 - 2

    const returnUpCall = calls.find((c) => c[0].assets[0].annualGrowthRate === 9)![0];
    expect(returnUpCall.privatePensions[0].annualReturn).toBe(6); // 4 + 2
    expect(returnUpCall.isaAccounts![0].annualReturn).toBe(7); // 5 + 2
  });

  test('물가상승률/은퇴시점 시나리오는 해당 필드만 바꾸고 나머지는 baseParams와 동일하다', () => {
    const engine = makeMockEngine({
      returnDown: 88, returnUp: 88, inflationUp: 85, inflationDown: 90,
      retirementEarlier: 86, retirementLater: 89,
    });
    computeSensitivityAnalysis(baseParams, makeResult(88), engine);

    const calls = (engine.runForUtility as unknown as { mock: { calls: SimulationParams[][] } }).mock.calls;
    const inflationUpCall = calls.find((c) => c[0].inflationRate === 3)![0];
    expect(inflationUpCall.assets[0].annualGrowthRate).toBe(7); // 변경 없음
    expect(inflationUpCall.userProfile.retirementAge).toBe(60); // 변경 없음

    const retirementEarlierCall = calls.find((c) => c[0].userProfile.retirementAge === 57)![0];
    expect(retirementEarlierCall.inflationRate).toBe(2); // 변경 없음
  });

  test('retirementEarlier는 currentAge + 1 미만으로 내려가지 않도록 clamp된다', () => {
    const params: SimulationParams = {
      ...baseParams,
      userProfile: { currentAge: 58, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
    };
    const runForUtility = vi.fn((p: SimulationParams) => makeResult(85));
    const engine = { runForUtility } as unknown as SimulationEngine;

    computeSensitivityAnalysis(params, makeResult(88), engine);

    const calls = (runForUtility as unknown as { mock: { calls: SimulationParams[][] } }).mock.calls;
    const earlierCall = calls.find((c) => c[0].userProfile.retirementAge < 60);
    expect(earlierCall![0].userProfile.retirementAge).toBe(59); // max(58+1, 60-3=57) = 59
  });

  test('retirementLater는 expectancy - 1을 넘지 않도록 clamp된다', () => {
    const params: SimulationParams = {
      ...baseParams,
      userProfile: { currentAge: 40, retirementAge: 88, expectancy: 90, targetMonthlySpending: 3000000 },
    };
    const runForUtility = vi.fn((p: SimulationParams) => makeResult(85));
    const engine = { runForUtility } as unknown as SimulationEngine;

    computeSensitivityAnalysis(params, makeResult(88), engine);

    const calls = (runForUtility as unknown as { mock: { calls: SimulationParams[][] } }).mock.calls;
    const laterCall = calls.find((c) => c[0].userProfile.retirementAge > 88);
    expect(laterCall![0].userProfile.retirementAge).toBe(89); // min(90-1=89, 88+3=91) = 89
  });

  test('depletionAge가 빠른(위험한) 시나리오부터 정렬되고, null(평생 유지)은 항상 뒤로 간다', () => {
    const engine = makeMockEngine({
      returnDown: 82, returnUp: null, inflationUp: 86, inflationDown: null,
      retirementEarlier: 84, retirementLater: 89,
    });
    const scenarios = computeSensitivityAnalysis(baseParams, makeResult(88), engine);

    const nonNullKeys = scenarios.filter((s) => s.depletionAge !== null).map((s) => s.key);
    expect(nonNullKeys).toEqual(['returnDown', 'retirementEarlier', 'inflationUp', 'retirementLater']);
    const nullKeys = scenarios.filter((s) => s.depletionAge === null).map((s) => s.key);
    expect(nullKeys.sort()).toEqual(['inflationDown', 'returnUp'].sort());
    expect(scenarios.slice(-2).every((s) => s.depletionAge === null)).toBe(true);
  });

  test('deltaYears는 baseline/시나리오의 null 조합 4가지를 모두 올바르게 계산한다', () => {
    // baseline=88(둘 다 숫자), returnDown=82 -> delta = 82-88 = -6
    // baseline=88, returnUp=null(시나리오만 null, 평생 유지로 개선) -> delta = expectancy(90)-88 = +2
    const engine = makeMockEngine({
      returnDown: 82, returnUp: null, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    });
    const scenarios = computeSensitivityAnalysis(baseParams, makeResult(88), engine);
    expect(scenarios.find((s) => s.key === 'returnDown')!.deltaYears).toBe(-6);
    expect(scenarios.find((s) => s.key === 'returnUp')!.deltaYears).toBe(2);
  });

  test('baseline도 null(평생 유지)이고 시나리오도 null이면 deltaYears는 null이다', () => {
    const engine = makeMockEngine({
      returnDown: null, returnUp: null, inflationUp: null, inflationDown: null,
      retirementEarlier: null, retirementLater: null,
    });
    const scenarios = computeSensitivityAnalysis(baseParams, makeResult(null), engine);
    scenarios.forEach((s) => {
      expect(s.depletionAge).toBeNull();
      expect(s.deltaYears).toBeNull();
    });
  });

  test('baseline은 숫자인데 시나리오가 null(평생 유지로 개선)이면 deltaYears는 expectancy - baseline이다', () => {
    const engine = makeMockEngine({
      returnDown: 88, returnUp: null, inflationUp: 88, inflationDown: 88,
      retirementEarlier: 88, retirementLater: 88,
    });
    const scenarios = computeSensitivityAnalysis(baseParams, makeResult(80), engine);
    expect(scenarios.find((s) => s.key === 'returnUp')!.deltaYears).toBe(10); // 90 - 80
  });

  test('특정 시나리오가 예외를 던져도 나머지 5개는 정상 반환된다', () => {
    const runForUtility = vi.fn((params: SimulationParams) => {
      if (params.assets[0]?.annualGrowthRate === 5) throw new Error('시뮬레이션 실패');
      return makeResult(85);
    });
    const engine = { runForUtility } as unknown as SimulationEngine;

    const scenarios = computeSensitivityAnalysis(baseParams, makeResult(88), engine);

    expect(scenarios).toHaveLength(5);
    expect(scenarios.find((s) => s.key === 'returnDown')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/core/usecases/dashboard/computeSensitivityAnalysis.test.ts`
Expected: FAIL — `Cannot find module '@/core/usecases/dashboard/computeSensitivityAnalysis'`

- [ ] **Step 3: 구현**

`src/core/usecases/dashboard/computeSensitivityAnalysis.ts`:

```ts
import { SimulationEngine } from '../SimulationEngine';
import { SimulationParams, SimulationResult } from '../../entities/types';

export interface SensitivityScenario {
  key: 'returnDown' | 'returnUp' | 'inflationUp' | 'inflationDown' | 'retirementEarlier' | 'retirementLater';
  label: string;
  depletionAge: number | null;
  deltaYears: number | null;
}

interface ScenarioDefinition {
  key: SensitivityScenario['key'];
  label: string;
  buildParams: (params: SimulationParams) => SimulationParams;
}

// 투자수익률 시나리오는 "시장 전체가 함께 움직인다"는 가정 하에 주식/ETF 자산, 사적연금, ISA
// 수익률을 전부 동일 폭(delta)만큼 가산한다. applyYieldPreset이 프리셋 적용 시 자산/연금에
// 동일 수익률을 일괄 적용하는 것과 같은 관례를 따르되, 값을 고정하는 대신 기존 값에 가산한다.
function shiftReturn(params: SimulationParams, delta: number): SimulationParams {
  return {
    ...params,
    assets: params.assets.map((a) => ({ ...a, annualGrowthRate: a.annualGrowthRate + delta })),
    privatePensions: params.privatePensions.map((p) => ({ ...p, annualReturn: p.annualReturn + delta })),
    isaAccounts: params.isaAccounts?.map((i) => ({ ...i, annualReturn: i.annualReturn + delta })),
  };
}

function shiftInflation(params: SimulationParams, delta: number): SimulationParams {
  return { ...params, inflationRate: params.inflationRate + delta };
}

// currentAge+1 미만, expectancy-1 초과로 은퇴시점이 넘어가지 않도록 clamp한다 — 그렇지 않으면
// "은퇴 기간이 없거나(현재나이보다 빠른 은퇴)" "은퇴 후 생존 기간이 없는(기대수명 이후 은퇴)"
// 무의미한 시나리오가 만들어진다.
function shiftRetirementAge(params: SimulationParams, delta: number): SimulationParams {
  const { currentAge, expectancy, retirementAge } = params.userProfile;
  const clamped = Math.min(expectancy - 1, Math.max(currentAge + 1, retirementAge + delta));
  return { ...params, userProfile: { ...params.userProfile, retirementAge: clamped } };
}

const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  { key: 'returnDown', label: '투자수익률 -2%p', buildParams: (p) => shiftReturn(p, -2) },
  { key: 'returnUp', label: '투자수익률 +2%p', buildParams: (p) => shiftReturn(p, 2) },
  { key: 'inflationUp', label: '물가상승률 +1%p', buildParams: (p) => shiftInflation(p, 1) },
  { key: 'inflationDown', label: '물가상승률 -1%p', buildParams: (p) => shiftInflation(p, -1) },
  { key: 'retirementEarlier', label: '은퇴시점 -3년', buildParams: (p) => shiftRetirementAge(p, -3) },
  { key: 'retirementLater', label: '은퇴시점 +3년', buildParams: (p) => shiftRetirementAge(p, 3) },
];

// null(평생 유지)을 expectancy로 치환해 비교 가능한 숫자로 만든 뒤 차이를 낸다. 단, baseline과
// 시나리오가 둘 다 null이면 "변화 없음"을 명확히 하기 위해 0이 아닌 null을 반환한다.
function computeDeltaYears(
  baselineDepletionAge: number | null,
  depletionAge: number | null,
  expectancy: number
): number | null {
  if (baselineDepletionAge === null && depletionAge === null) return null;
  const baselineEffective = baselineDepletionAge ?? expectancy;
  const scenarioEffective = depletionAge ?? expectancy;
  return scenarioEffective - baselineEffective;
}

// 6개 시나리오(투자수익률/물가상승률/은퇴시점 각 ±)를 재실행해 자산 고갈 나이가 얼마나
// 민감하게 변하는지 반환한다. 개별 시나리오가 예외를 던지면 해당 시나리오만 제외한다.
// 반환 순서는 가장 위험한(고갈이 빠른) 시나리오가 먼저이며, 평생 유지(null)는 항상 뒤로 간다.
export function computeSensitivityAnalysis(
  params: SimulationParams,
  baselineResult: SimulationResult,
  engine: SimulationEngine
): SensitivityScenario[] {
  const { expectancy } = params.userProfile;
  const baselineDepletionAge = baselineResult.depletionAge;

  const withSortKey: (SensitivityScenario & { sortAge: number })[] = [];

  for (const def of SCENARIO_DEFINITIONS) {
    try {
      const modifiedParams = def.buildParams(params);
      const result = engine.runForUtility(modifiedParams);
      const depletionAge = result.depletionAge;
      withSortKey.push({
        key: def.key,
        label: def.label,
        depletionAge,
        deltaYears: computeDeltaYears(baselineDepletionAge, depletionAge, expectancy),
        sortAge: depletionAge ?? Infinity,
      });
    } catch {
      // 개별 시나리오 실패는 무시하고 나머지는 계속 계산한다 (RecommendationEngine의
      // 후보별 실패 격리와 동일 원칙).
    }
  }

  return withSortKey
    .sort((a, b) => a.sortAge - b.sortAge)
    .map(({ sortAge, ...scenario }) => scenario);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/dashboard/computeSensitivityAnalysis.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/usecases/dashboard/computeSensitivityAnalysis.ts src/tests/core/usecases/dashboard/computeSensitivityAnalysis.test.ts
git commit -m "feat: 자산 고갈 나이 민감도 분석 usecase 추가"
```

---

## Task 2: `SensitivityAnalysisSection` 컴포넌트

**Files:**
- Create: `src/web/features/Dashboard/expert/SensitivityAnalysisSection.tsx`
- Test: `src/tests/web/features/Dashboard/expert/SensitivityAnalysisSection.test.tsx`

**Interfaces:**
- Consumes: `SensitivityScenario` (Task 1에서 생성, `src/core/usecases/dashboard/computeSensitivityAnalysis.ts`).
- Produces:
  ```ts
  interface SensitivityAnalysisSectionProps {
    baselineDepletionAge: number | null;
    scenarios: SensitivityScenario[];
  }
  export function SensitivityAnalysisSection(props: SensitivityAnalysisSectionProps): JSX.Element
  ```
  Task 3(`ExpertDetailsPanel`)이 이 컴포넌트를 그대로 import해서 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/web/features/Dashboard/expert/SensitivityAnalysisSection.test.tsx`:

```tsx
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SensitivityAnalysisSection } from '@/web/features/Dashboard/expert/SensitivityAnalysisSection';
import { SensitivityScenario } from '@/core/usecases/dashboard/computeSensitivityAnalysis';

const scenarios: SensitivityScenario[] = [
  { key: 'returnDown', label: '투자수익률 -2%p', depletionAge: 82, deltaYears: -6 },
  { key: 'retirementEarlier', label: '은퇴시점 -3년', depletionAge: 84, deltaYears: -4 },
  { key: 'inflationUp', label: '물가상승률 +1%p', depletionAge: 86, deltaYears: -2 },
  { key: 'inflationDown', label: '물가상승률 -1%p', depletionAge: 90, deltaYears: 2 },
  { key: 'retirementLater', label: '은퇴시점 +3년', depletionAge: null, deltaYears: 4 },
  { key: 'returnUp', label: '투자수익률 +2%p', depletionAge: null, deltaYears: 4 },
];

describe('SensitivityAnalysisSection', () => {
  test('6개 시나리오 행이 모두 렌더된다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} scenarios={scenarios} />);
    scenarios.forEach((s) => {
      expect(screen.getByText(s.label)).toBeInTheDocument();
    });
  });

  test('depletionAge가 null이면 "평생 유지"를 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} scenarios={scenarios} />);
    const lifetimeTexts = screen.getAllByText('평생 유지');
    expect(lifetimeTexts.length).toBeGreaterThanOrEqual(2);
  });

  test('숫자 depletionAge는 "N세"와 델타(N년)를 함께 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} scenarios={scenarios} />);
    expect(screen.getByText(/82세/)).toBeInTheDocument();
    expect(screen.getByText(/-6년/)).toBeInTheDocument();
  });

  test('악화(deltaYears < 0) 막대는 danger 색상 클래스를, 개선(deltaYears > 0)은 success 색상 클래스를 갖는다', () => {
    const { container } = render(<SensitivityAnalysisSection baselineDepletionAge={88} scenarios={scenarios} />);
    const bars = container.querySelectorAll('[data-testid="sensitivity-bar"]');
    expect(bars).toHaveLength(6);

    const worseBar = Array.from(bars).find((b) => b.getAttribute('data-key') === 'returnDown')!;
    expect(worseBar.className).toContain('bg-danger');

    const betterBar = Array.from(bars).find((b) => b.getAttribute('data-key') === 'inflationDown')!;
    expect(betterBar.className).toContain('bg-success');
  });

  test('기준선(baselineDepletionAge) 텍스트를 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={88} scenarios={scenarios} />);
    expect(screen.getByText(/현재 설정 기준/)).toBeInTheDocument();
    expect(screen.getByText(/88세/)).toBeInTheDocument();
  });

  test('baselineDepletionAge가 null이면 기준선에도 "평생 유지"를 표시한다', () => {
    render(<SensitivityAnalysisSection baselineDepletionAge={null} scenarios={scenarios} />);
    expect(screen.getByText(/현재 설정 기준/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/expert/SensitivityAnalysisSection.test.tsx`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`src/web/features/Dashboard/expert/SensitivityAnalysisSection.tsx`:

```tsx
import { SensitivityScenario } from '../../../../core/usecases/dashboard/computeSensitivityAnalysis';

interface SensitivityAnalysisSectionProps {
  baselineDepletionAge: number | null;
  scenarios: SensitivityScenario[];
}

function formatDepletionAge(depletionAge: number | null): string {
  return depletionAge === null ? '평생 유지' : `${depletionAge}세`;
}

function formatDeltaYears(deltaYears: number | null): string | null {
  if (deltaYears === null) return null;
  const sign = deltaYears > 0 ? '+' : '';
  return `${sign}${deltaYears}년`;
}

// 6개 시나리오의 자산 고갈 나이 변화를 가로 막대로 보여준다. deltaYears의 절대값을 막대
// 길이(최대값 기준 정규화)로, 부호를 색상(악화=danger/개선=success)으로 표현한다.
// "평생 유지"(depletionAge===null) 시나리오는 괄호 델타를 표시하지 않는다 — deltaYears가
// expectancy 치환으로 계산된 근사치라 "평생 유지(+4년)" 같은 문구는 오히려 혼란을 준다.
export function SensitivityAnalysisSection({ baselineDepletionAge, scenarios }: SensitivityAnalysisSectionProps) {
  const maxAbsDelta = Math.max(1, ...scenarios.map((s) => Math.abs(s.deltaYears ?? 0)));

  return (
    <section>
      <h4 className="mb-1 text-sm font-semibold">민감도 분석 (핵심 가정 변화에 따른 자산 고갈 나이)</h4>
      <p className="mb-3 text-xs text-foreground-muted">
        현재 설정 기준: {formatDepletionAge(baselineDepletionAge)}
      </p>
      <div className="flex flex-col gap-2">
        {scenarios.map((scenario) => {
          const deltaText = formatDeltaYears(scenario.deltaYears);
          const isWorse = (scenario.deltaYears ?? 0) < 0;
          const isBetter = (scenario.deltaYears ?? 0) > 0;
          const widthPercent = Math.min(100, (Math.abs(scenario.deltaYears ?? 0) / maxAbsDelta) * 100);

          return (
            <div key={scenario.key} className="flex items-center gap-3 text-xs">
              <span className="w-28 shrink-0 text-foreground-muted">{scenario.label}</span>
              <div className="h-2 flex-1 rounded-full bg-foreground/5">
                <div
                  data-testid="sensitivity-bar"
                  data-key={scenario.key}
                  className={`h-2 rounded-full ${isWorse ? 'bg-danger' : isBetter ? 'bg-success' : 'bg-foreground/20'}`}
                  style={{ width: `${widthPercent}%` }}
                />
              </div>
              <span className="w-32 shrink-0 text-right font-semibold">
                {formatDepletionAge(scenario.depletionAge)}
                {scenario.depletionAge !== null && deltaText && (
                  <span className="ml-1 font-normal text-foreground-muted">({deltaText})</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/expert/SensitivityAnalysisSection.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/web/features/Dashboard/expert/SensitivityAnalysisSection.tsx src/tests/web/features/Dashboard/expert/SensitivityAnalysisSection.test.tsx
git commit -m "feat: 민감도 분석 결과를 가로 막대로 보여주는 SensitivityAnalysisSection 추가"
```

---

## Task 3: `ExpertDetailsPanel`에 민감도 분석 연결

**Files:**
- Modify: `src/web/features/Dashboard/expert/ExpertDetailsPanel.tsx`
- Test: `src/tests/web/features/Dashboard/expert/ExpertDetailsPanel.test.tsx` (기존 파일에 테스트 추가)

**Interfaces:**
- Consumes: `computeSensitivityAnalysis(params, baselineResult, engine)` (Task 1), `SensitivityAnalysisSection` (Task 2), `SimulationEngine`(기존, `src/core/usecases/SimulationEngine.ts`).
- Produces: 없음(최종 배선 — 다른 태스크가 이 파일을 소비하지 않음).

**주의:** `ExpertDetailsPanel`은 이미 `result`(Before/After 토글이 반영된 `displayedResult`)와 `params`(보정된 파라미터)를 prop으로 받고 있으므로, 이 두 값을 그대로 `computeSensitivityAnalysis`에 전달하면 Before/After 토글이 자동으로 반영된다. 별도 배선이 필요 없다.

- [ ] **Step 1: 실패하는 테스트 추가**

기존 파일 `src/tests/web/features/Dashboard/expert/ExpertDetailsPanel.test.tsx`은 이미 파일 상단에 `result`(`depletionAge: null`), `params`(`assets: []`, `privatePensions: []`), `utility`, `formatValue`를 모듈 스코프 상수로 정의해두고 있다(각 테스트가 재사용). 이 상수들을 그대로 재사용해 `describe('ExpertDetailsPanel', ...)` 블록의 마지막 테스트(`'국민연금이 전혀 없으면...'`) 바로 뒤에 아래 테스트를 추가한다:

```tsx
  test('민감도 분석 섹션(SensitivityAnalysisSection)이 렌더된다', () => {
    render(
      <ExpertDetailsPanel result={result} params={params} utility={utility} formatValue={formatValue} isPro={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: '전문가용 상세 분석 더 보기' }));

    expect(screen.getByText('민감도 분석 (핵심 가정 변화에 따른 자산 고갈 나이)')).toBeInTheDocument();
    expect(screen.getByText('투자수익률 -2%p')).toBeInTheDocument();
    expect(screen.getByText('은퇴시점 +3년')).toBeInTheDocument();
  });
```

`params.assets`/`params.privatePensions`가 빈 배열이라도 `computeSensitivityAnalysis`는 빈 배열을 그대로 매핑(`[].map(...)` → `[]`)하므로 에러 없이 6개 시나리오를 모두 반환한다 — 이 fixture로도 정상 동작을 검증할 수 있다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/expert/ExpertDetailsPanel.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 민감도 분석 (핵심 가정 변화에 따른 자산 고갈 나이)`

- [ ] **Step 3: 구현**

`src/web/features/Dashboard/expert/ExpertDetailsPanel.tsx` 상단 import에 추가:

```ts
import { useMemo } from 'react';
import { SimulationEngine } from '../../../../core/usecases/SimulationEngine';
import { computeSensitivityAnalysis } from '../../../../core/usecases/dashboard/computeSensitivityAnalysis';
import { SensitivityAnalysisSection } from './SensitivityAnalysisSection';
```

컴포넌트 본문(`const analytics = computeExpertAnalytics(result, params);` 바로 아래)에 추가:

```ts
  const engine = useMemo(() => new SimulationEngine(), []);
  const sensitivityScenarios = useMemo(
    () => computeSensitivityAnalysis(params, result, engine),
    [params, result, engine]
  );
```

"연금 구성 및 리스크" `<section>` 바로 다음(`{isPro && (...)}` 블록 앞)에 추가:

```tsx
        <SensitivityAnalysisSection baselineDepletionAge={result.depletionAge} scenarios={sensitivityScenarios} />
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/expert/ExpertDetailsPanel.test.tsx`
Expected: PASS

전체 회귀도 확인:

Run: `npx vitest run`
Expected: 기존 테스트 전부 PASS (신규 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git add src/web/features/Dashboard/expert/ExpertDetailsPanel.tsx src/tests/web/features/Dashboard/expert/ExpertDetailsPanel.test.tsx
git commit -m "feat: ExpertDetailsPanel에 민감도 분석 섹션 연결"
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
Expected: 이번 브랜치에서 새로 추가된 파일에 대해 에러 없음(기존에 존재하던, 이 브랜치와 무관한 warning은 무시)

- [ ] **Step 5: 브라우저 수동 확인 (권장, 필수는 아님)**

`npm run dev`로 결과 화면 접속 → "전문가용 상세 분석 더 보기" 펼치기 → "민감도 분석" 섹션에서 6개 막대가 보이고, 은퇴시점/투자수익률/물가상승률 입력값을 바꿔가며 값이 갱신되는지, Before/After 토글 시에도 반영되는지 확인.
