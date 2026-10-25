# 실행 로드맵 타임라인 (Execution Roadmap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 추천 계획(또는 현재 설정 폴백) 기준으로 퇴직/일반자산 인출/사적연금/국민연금 수령 개시 나이를 수직 타임라인으로 `RecommendationChecklist` 바로 아래에 표시한다.

**Architecture:** `computeRiskAlerts.ts`/`computeExpertAnalytics.ts`와 동일한 "순수 함수 usecase" 패턴. `StrategyCandidateGenerator.ts`가 이미 export하는 `getIdentityPlan()`을 재사용해 추천 없음/개선 없음 케이스의 폴백을 새로 만들지 않는다. 계산 결과는 `ExecutionRoadmap`이라는 얇은 presentational 컴포넌트(수직 스테퍼)가 렌더링한다.

**Tech Stack:** TypeScript(strict, `any` 금지), React 19, Vitest + Testing Library, Tailwind CSS v4.

## Global Constraints

- 이벤트는 정확히 4개: 퇴직, 일반자산 인출 개시, 사적연금 수령 개시, 국민연금 수령 개시. `depletionAge`/`fireAge`/ISA 만기는 포함하지 않는다.
- 기준 계획은 `recommendation?.recommendedPlan ?? getIdentityPlan(params)` — `recommendedPlan`은 `CompleteWithdrawalPlan | null` 타입이므로 `??`가 `undefined`(추천 없음)와 `null`(개선안 없음) 두 경우를 모두 처리한다.
- 국민연금 이벤트 제목은 `plan.nationalPensionStartAge`를 `NATIONAL_PENSION_NORMAL_START_AGE`(65, `src/core/usecases/pension/nationalPensionRules.ts`에서 export)와 비교해 "국민연금 수령 개시" / "국민연금 수령 개시 (조기)" / "국민연금 수령 개시 (연기)"로 분기한다.
- 같은 나이에 여러 이벤트가 겹치면 하나의 노드(`RoadmapEvent`)에 여러 `items`로 병합한다.
- `expectancy`(기대수명)는 4개 이벤트에 포함하지 않고 별도 필드로 반환해, 타임라인 끝에 속이 빈 마커로 표시한다.
- 로드맵은 **Before/After 토글과 무관**하게 항상 AI 추천(또는 폴백) 계획 기준으로 고정 표시된다. `DashboardSection`의 `displayedResult`/토글 상태를 참조하지 않는다.
- 배치는 `RecommendationChecklist` 바로 다음, 차트 3종 앞. 항상 노출(조건부 숨김 없음).
- 표시 형식은 recharts를 쓰지 않는 순수 `div` 기반 수직 스테퍼다.
- `RecommendationEngine.buildReasons()`의 기존 문구를 재사용하지 않고, 로드맵 전용의 새 문구를 작성한다(목적이 다름 — "왜 추천하는지" vs "언제 무슨 일이 일어나는지"). `RecommendationEngine.ts` 파일 자체는 수정하지 않는다.

---

## File Structure

- `src/core/usecases/dashboard/computeExecutionRoadmap.ts` (신규) — 4개 이벤트 계산, 나이별 병합, 정렬, 국민연금 조기/연기 판정을 담당하는 단일 순수 함수 모듈.
- `src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts` (신규)
- `src/web/features/Dashboard/roadmap/ExecutionRoadmap.tsx` (신규) — `ExecutionRoadmap`(usecase 반환 타입)을 받아 수직 스테퍼를 렌더링하는 presentational 컴포넌트. 계산 로직 0%.
- `src/tests/web/features/Dashboard/roadmap/ExecutionRoadmap.test.tsx` (신규)
- `src/web/features/Dashboard/DashboardSection.tsx` (수정) — `RecommendationChecklist` 다음에 `ExecutionRoadmap` 배치.
- `src/tests/web/features/Dashboard/DashboardSection.test.tsx` (수정 — 기존 파일에 렌더 위치 회귀 테스트 추가)

---

## Task 1: `computeExecutionRoadmap` usecase

**Files:**
- Create: `src/core/usecases/dashboard/computeExecutionRoadmap.ts`
- Test: `src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts`

**Interfaces:**
- Consumes: `SimulationParams`, `StrategyRecommendation`, `CompleteWithdrawalPlan`(`src/core/entities/types.ts`, 기존, 변경 없음), `getIdentityPlan(params: SimulationParams): CompleteWithdrawalPlan`(`src/core/usecases/strategy/StrategyCandidateGenerator.ts`, 기존, 변경 없음), `NATIONAL_PENSION_NORMAL_START_AGE`(`src/core/usecases/pension/nationalPensionRules.ts`, 기존 값 `65`, 변경 없음).
- Produces:
  ```ts
  export interface RoadmapEventItem {
    title: string;
    description: string;
  }

  export interface RoadmapEvent {
    age: number;
    items: RoadmapEventItem[];
  }

  export interface ExecutionRoadmap {
    events: RoadmapEvent[];
    expectancy: number;
  }

  export function computeExecutionRoadmap(
    params: SimulationParams,
    recommendation: StrategyRecommendation | undefined,
  ): ExecutionRoadmap
  ```
  Task 2(컴포넌트)와 Task 3(DashboardSection 배선)이 이 `ExecutionRoadmap`/`RoadmapEvent`/`RoadmapEventItem` 타입과 `computeExecutionRoadmap` 함수 시그니처를 그대로 소비한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { computeExecutionRoadmap } from '@/core/usecases/dashboard/computeExecutionRoadmap';
import {
  CompleteWithdrawalPlan,
  SimulationParams,
  StrategyRecommendation,
  UtilityBreakdown,
} from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
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

const utility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0 },
};

const zeroDeltas: StrategyRecommendation['deltas'] = {
  lifetimeConsumption: 0,
  totalTax: 0,
  endingAssets: 0,
  pensionEndingBalance: 0,
  comprehensiveTaxYears: 0,
  healthInsuranceTotal: 0,
  nationalPensionTotal: 0,
};

function makeRecommendation(recommendedPlan: CompleteWithdrawalPlan | null): StrategyRecommendation {
  return {
    currentUtility: utility,
    recommendedUtility: utility,
    recommendedPlan,
    improved: recommendedPlan !== null,
    reasons: [],
    deltas: zeroDeltas,
    totalCandidateCount: 0,
    failedCandidateCount: 0,
    recommendedResult: {
      yearlyResults: [],
      fireAge: null,
      depletionAge: null,
      endingAssets: 0,
      retirementScore: 0,
      retirementGrade: '보통',
      goalAchievementRate: 100,
      retirementAssetsAtRetirement: 0,
    },
    itemizedContributions: [],
  };
}

describe('computeExecutionRoadmap', () => {
  test('recommendedPlan이 채워진 경우 4개 이벤트가 정확한 나이/제목으로 생성된다', () => {
    const plan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 63,
      privatePensionMonthlyTarget: 2000000,
      nationalPensionStartAge: 68,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan));

    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([60, 63, 68]); // 60세: 퇴직+일반자산(같은 나이 병합), 63세: 사적연금, 68세: 국민연금

    const age60 = roadmap.events.find((e) => e.age === 60)!;
    expect(age60.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시']);

    const age63 = roadmap.events.find((e) => e.age === 63)!;
    expect(age63.items[0].title).toBe('사적연금 수령 개시');

    const age68 = roadmap.events.find((e) => e.age === 68)!;
    expect(age68.items[0].title).toBe('국민연금 수령 개시 (연기)');
  });

  test('recommendation이 undefined이면 getIdentityPlan(params) 기준으로 폴백한다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined);
    // getIdentityPlan: privatePensionStartAge=retirementAge=60, nationalPensionStartAge=65, generalAssetWithdrawalStartAge=60
    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([60, 65]);
    const age60 = roadmap.events.find((e) => e.age === 60)!;
    expect(age60.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시', '사적연금 수령 개시']);
    const age65 = roadmap.events.find((e) => e.age === 65)!;
    expect(age65.items[0].title).toBe('국민연금 수령 개시');
  });

  test('recommendation.recommendedPlan이 null이면(improved: false) getIdentityPlan(params) 기준으로 폴백한다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null));
    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([60, 65]);
  });

  test('국민연금 수령 개시 나이가 65세보다 이르면 "(조기)"를 표기한다', () => {
    const plan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 60,
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 62,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan));
    const age62 = roadmap.events.find((e) => e.age === 62)!;
    expect(age62.items.find((i) => i.title.includes('국민연금'))!.title).toBe('국민연금 수령 개시 (조기)');
  });

  test('국민연금 수령 개시 나이가 정확히 65세면 접미사 없이 표기한다', () => {
    const plan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 60,
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 65,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan));
    const age65 = roadmap.events.find((e) => e.age === 65)!;
    expect(age65.items.find((i) => i.title.includes('국민연금'))!.title).toBe('국민연금 수령 개시');
  });

  test('events는 나이 오름차순으로 정렬된다', () => {
    const plan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 70,
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 62,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 61,
      monthlySpendingMultiplier: 1,
    };
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan));
    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([...ages].sort((a, b) => a - b));
    expect(ages).toEqual([60, 61, 62, 70]);
  });

  test('expectancy는 params.userProfile.expectancy 그대로 반환된다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined);
    expect(roadmap.expectancy).toBe(90);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts`
Expected: FAIL — `Cannot find module '@/core/usecases/dashboard/computeExecutionRoadmap'`

- [ ] **Step 3: 구현**

`src/core/usecases/dashboard/computeExecutionRoadmap.ts`:

```ts
import { getIdentityPlan } from '../strategy/StrategyCandidateGenerator';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../pension/nationalPensionRules';
import { SimulationParams, StrategyRecommendation } from '../../entities/types';

export interface RoadmapEventItem {
  title: string;
  description: string;
}

export interface RoadmapEvent {
  age: number;
  items: RoadmapEventItem[];
}

export interface ExecutionRoadmap {
  events: RoadmapEvent[];
  expectancy: number;
}

// 국민연금 수령 개시 나이를 정상 개시 나이(65)와 비교해 조기/연기 여부를 제목에 표기한다.
function describeNationalPensionTitle(age: number): string {
  if (age < NATIONAL_PENSION_NORMAL_START_AGE) return '국민연금 수령 개시 (조기)';
  if (age > NATIONAL_PENSION_NORMAL_START_AGE) return '국민연금 수령 개시 (연기)';
  return '국민연금 수령 개시';
}

// AI 추천 계획(또는 추천이 없거나 개선안이 없을 때는 getIdentityPlan로 현재 설정값) 기준으로 퇴직/
// 일반자산 인출/사적연금/국민연금 수령 개시 나이 4개 이벤트를 계산한다. 같은 나이에 여러 이벤트가
// 겹치면 하나의 노드로 병합하고, 나이 오름차순으로 정렬해 반환한다.
export function computeExecutionRoadmap(
  params: SimulationParams,
  recommendation: StrategyRecommendation | undefined
): ExecutionRoadmap {
  const plan = recommendation?.recommendedPlan ?? getIdentityPlan(params);
  const { retirementAge, expectancy } = params.userProfile;

  const rawEvents: { age: number; item: RoadmapEventItem }[] = [
    {
      age: retirementAge,
      item: { title: '퇴직', description: '상용소득이 종료되고 자산 인출 계획이 시작됩니다.' },
    },
    {
      age: plan.generalAssetWithdrawalStartAge,
      item: { title: '일반자산 인출 개시', description: '주식/ETF 등 일반 자산의 인출을 시작합니다.' },
    },
    {
      age: plan.privatePensionStartAge,
      item: { title: '사적연금 수령 개시', description: '사적연금(퇴직연금·연금저축 등) 인출을 시작합니다.' },
    },
    {
      age: plan.nationalPensionStartAge,
      item: { title: describeNationalPensionTitle(plan.nationalPensionStartAge), description: '국민연금 수령을 시작합니다.' },
    },
  ];

  const byAge = new Map<number, RoadmapEventItem[]>();
  for (const { age, item } of rawEvents) {
    const items = byAge.get(age) ?? [];
    items.push(item);
    byAge.set(age, items);
  }

  const events: RoadmapEvent[] = Array.from(byAge.entries())
    .map(([age, items]) => ({ age, items }))
    .sort((a, b) => a.age - b.age);

  return { events, expectancy };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/usecases/dashboard/computeExecutionRoadmap.ts src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts
git commit -m "feat: 실행 로드맵 타임라인 usecase 추가"
```

---

## Task 2: `ExecutionRoadmap` 컴포넌트

**Files:**
- Create: `src/web/features/Dashboard/roadmap/ExecutionRoadmap.tsx`
- Test: `src/tests/web/features/Dashboard/roadmap/ExecutionRoadmap.test.tsx`

**Interfaces:**
- Consumes: `ExecutionRoadmap`, `RoadmapEvent`, `RoadmapEventItem` (Task 1에서 생성, `src/core/usecases/dashboard/computeExecutionRoadmap.ts`).
- Produces:
  ```ts
  interface ExecutionRoadmapProps {
    roadmap: ExecutionRoadmap; // usecase의 반환 타입
  }
  export function ExecutionRoadmap(props: ExecutionRoadmapProps): JSX.Element
  ```
  Task 3(`DashboardSection`)이 이 컴포넌트를 그대로 import해서 사용한다. 주의: usecase가 export하는 타입 이름도 `ExecutionRoadmap`이고 컴포넌트 이름도 `ExecutionRoadmap`이다 — import 시 타입에는 `as ExecutionRoadmapData` 별칭을 붙여 이름 충돌을 피한다(아래 테스트 코드 예시 참고).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/web/features/Dashboard/roadmap/ExecutionRoadmap.test.tsx`:

```tsx
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionRoadmap } from '@/web/features/Dashboard/roadmap/ExecutionRoadmap';
import { ExecutionRoadmap as ExecutionRoadmapData } from '@/core/usecases/dashboard/computeExecutionRoadmap';

const roadmap: ExecutionRoadmapData = {
  events: [
    {
      age: 60,
      items: [
        { title: '퇴직', description: '상용소득이 종료되고 자산 인출 계획이 시작됩니다.' },
        { title: '일반자산 인출 개시', description: '주식/ETF 등 일반 자산의 인출을 시작합니다.' },
      ],
    },
    {
      age: 63,
      items: [{ title: '사적연금 수령 개시', description: '사적연금(퇴직연금·연금저축 등) 인출을 시작합니다.' }],
    },
    {
      age: 68,
      items: [{ title: '국민연금 수령 개시 (연기)', description: '국민연금 수령을 시작합니다.' }],
    },
  ],
  expectancy: 90,
};

describe('ExecutionRoadmap', () => {
  test('각 이벤트의 나이/제목/설명이 표시된다', () => {
    render(<ExecutionRoadmap roadmap={roadmap} />);
    expect(screen.getByText('60세')).toBeInTheDocument();
    expect(screen.getByText('퇴직')).toBeInTheDocument();
    expect(screen.getByText('63세')).toBeInTheDocument();
    expect(screen.getByText('사적연금 수령 개시')).toBeInTheDocument();
    expect(screen.getByText('68세')).toBeInTheDocument();
    expect(screen.getByText('국민연금 수령 개시 (연기)')).toBeInTheDocument();
  });

  test('병합된 노드(60세)는 여러 items를 모두 렌더링한다', () => {
    render(<ExecutionRoadmap roadmap={roadmap} />);
    expect(screen.getByText('퇴직')).toBeInTheDocument();
    expect(screen.getByText('일반자산 인출 개시')).toBeInTheDocument();
  });

  test('이벤트 마커는 채워진(filled) 스타일, 기대수명 마커는 속이 빈(hollow) 스타일이다', () => {
    const { container } = render(<ExecutionRoadmap roadmap={roadmap} />);
    const filledMarkers = container.querySelectorAll('[data-marker="filled"]');
    const hollowMarkers = container.querySelectorAll('[data-marker="hollow"]');
    expect(filledMarkers).toHaveLength(3); // 60/63/68세 3개 노드
    expect(hollowMarkers).toHaveLength(1);
  });

  test('기대수명 텍스트가 표시된다', () => {
    render(<ExecutionRoadmap roadmap={roadmap} />);
    expect(screen.getByText(/90세/)).toBeInTheDocument();
    expect(screen.getByText(/기대수명/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/roadmap/ExecutionRoadmap.test.tsx`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`src/web/features/Dashboard/roadmap/ExecutionRoadmap.tsx`:

```tsx
import { ExecutionRoadmap as ExecutionRoadmapData } from '../../../../core/usecases/dashboard/computeExecutionRoadmap';

interface ExecutionRoadmapProps {
  roadmap: ExecutionRoadmapData;
}

// AI 추천(또는 현재 설정 폴백) 계획 기준으로 "언제 무슨 일이 일어나는지"를 수직 타임라인으로
// 보여준다. RecommendationChecklist("무엇을")와 짝을 이루며, Before/After 토글과는 무관하게
// 항상 고정된 기준(계산은 컴포넌트 밖 computeExecutionRoadmap)으로 렌더링만 담당한다.
export function ExecutionRoadmap({ roadmap }: ExecutionRoadmapProps) {
  return (
    <section className="mb-6">
      <h3 className="mb-1 text-base font-semibold">실행 로드맵</h3>
      <p className="mb-3 text-xs text-foreground-muted">AI 추천 전략 기준 — 나이별로 무엇이 바뀌는지 보여줍니다.</p>
      <div className="flex flex-col">
        {roadmap.events.map((event) => (
          <div key={event.age} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span data-marker="filled" className="h-3 w-3 shrink-0 rounded-full bg-primary" />
              <span className="w-px flex-1 bg-foreground/15" />
            </div>
            <div className="pb-6">
              <p className="text-sm font-semibold">{event.age}세</p>
              {event.items.map((item) => (
                <div key={item.title} className="mt-1">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-foreground-muted">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="flex gap-3">
          <span data-marker="hollow" className="h-3 w-3 shrink-0 rounded-full border-2 border-foreground/40" />
          <p className="text-sm font-semibold text-foreground-muted">{roadmap.expectancy}세 기대수명</p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/roadmap/ExecutionRoadmap.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/web/features/Dashboard/roadmap/ExecutionRoadmap.tsx src/tests/web/features/Dashboard/roadmap/ExecutionRoadmap.test.tsx
git commit -m "feat: 실행 로드맵을 수직 타임라인으로 보여주는 ExecutionRoadmap 컴포넌트 추가"
```

---

## Task 3: `DashboardSection`에 실행 로드맵 연결

**Files:**
- Modify: `src/web/features/Dashboard/DashboardSection.tsx`
- Test: `src/tests/web/features/Dashboard/DashboardSection.test.tsx` (기존 파일에 테스트 추가)

**Interfaces:**
- Consumes: `computeExecutionRoadmap(params, recommendation)` (Task 1), `ExecutionRoadmap` 컴포넌트 (Task 2).
- Produces: 없음(최종 배선 — 다른 태스크가 이 파일을 소비하지 않음).

**주의:** `DashboardSection`은 이미 `params`(baseline, `React.useMemo`로 메모이즈됨)와 `recommendation`을 갖고 있으므로 새 prop이 필요 없다. `computeExecutionRoadmap`은 순수 계산(엔진 재실행 없음, 비용 사실상 0)이므로 `computeRiskAlerts`/`generateChartCaptions`와 동일하게 memo 없이 렌더 본문에서 직접 호출한다. **의도적으로 `displayedResult`나 Before/After 토글 상태를 참조하지 않는다** — 항상 baseline `params`와 원본 `recommendation`을 사용한다.

- [ ] **Step 1: 실패하는 테스트 추가**

먼저 `src/web/features/Dashboard/DashboardSection.tsx`의 현재 import 목록과 `RecommendationChecklist` 배치 지점이 아래 Step 3에서 설명하는 것과 일치하는지 확인한다:

Run: `grep -n "RecommendationChecklist\|^import" src/web/features/Dashboard/DashboardSection.tsx`

`src/tests/web/features/Dashboard/DashboardSection.test.tsx`의 `describe('DashboardSection - IA 순서', ...)` 블록 안, 기존 `'Hero → KPI → 추천 체크리스트 → 차트 → 전문가 상세 순서로 렌더링된다'` 테스트 바로 뒤에 아래 테스트를 추가한다(이 파일은 이미 `params`/`result`/`recommendation` 모듈 스코프 fixture를 갖고 있으므로 그대로 재사용):

```tsx
  test('실행 로드맵이 렌더링되고 체크리스트 다음, 차트 이전에 위치한다', () => {
    const { container } = render(
      <DashboardSection params={params} result={result} recommendation={recommendation} />
    );
    const text = container.textContent ?? '';
    const checklistIdx = text.indexOf('AI 추천 전략');
    const roadmapIdx = text.indexOf('실행 로드맵');
    const chartIdx = text.indexOf('자산 추이 시뮬레이션');

    expect(roadmapIdx).toBeGreaterThan(checklistIdx);
    expect(chartIdx).toBeGreaterThan(roadmapIdx);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/DashboardSection.test.tsx`
Expected: FAIL — `roadmapIdx`가 `-1`이라 `toBeGreaterThan(checklistIdx)` 실패

- [ ] **Step 3: 구현**

`src/web/features/Dashboard/DashboardSection.tsx` 상단 import 목록(`import { RiskAlertCards } from './risk/RiskAlertCards';` 근처)에 추가:

```ts
import { ExecutionRoadmap } from './roadmap/ExecutionRoadmap';
import { computeExecutionRoadmap } from '../../../core/usecases/dashboard/computeExecutionRoadmap';
```

`<RecommendationChecklist ... />` 바로 다음(`{/* STEP 4: 그래프 3종 ... */}` 주석 앞)에 추가:

```tsx
      {/* AI 추천 전략 실행 로드맵 (Before/After 토글과 무관하게 항상 고정 기준) */}
      <ExecutionRoadmap roadmap={computeExecutionRoadmap(params, recommendation)} />
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/DashboardSection.test.tsx`
Expected: PASS (기존 테스트 전부 + 신규 테스트, 회귀 없음)

전체 회귀도 확인:

Run: `npx vitest run`
Expected: 기존 테스트 전부 PASS (신규 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git add src/web/features/Dashboard/DashboardSection.tsx src/tests/web/features/Dashboard/DashboardSection.test.tsx
git commit -m "feat: DashboardSection에 실행 로드맵 섹션 연결"
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

`npm run dev`로 결과 화면 접속 → "AI 추천 전략" 체크리스트 바로 아래에 "실행 로드맵" 섹션이 보이는지, 나이/제목/설명이 올바르게 표시되는지, 국민연금 조기/연기 표기가 실제 추천값에 따라 바뀌는지, Before/After 토글을 눌러도 로드맵 내용이 바뀌지 않는지(의도된 동작) 확인.
