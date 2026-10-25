# 리스크 알림 카드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결과 화면 KPI 아래에 건강보험료 증가/금융소득종합과세 진입/사적연금 저율과세 한도초과
3종 리스크를 구체적 연령대·금액과 함께 보여주는 경고 카드를 추가한다.

**Architecture:** 순수 함수 usecase(`computeRiskAlerts`)가 `SimulationResult`/`SimulationParams`를
받아 0~3개의 `RiskAlert`를 계산하고, 프레젠테이션 컴포넌트(`RiskAlertCards`)가 이를 그대로
렌더링한다. `DashboardSection`이 이미 Before/After 토글에 따라 관리하는 `displayedResult`를
그대로 넘기기만 하면 되므로 새 상태 관리는 필요 없다.

**Tech Stack:** TypeScript, React 19, Tailwind v4(신규 컴포넌트), vitest + @testing-library/react.

## Global Constraints

- `any` 타입 사용 금지 (프로젝트 CLAUDE.md).
- TDD: 각 신규 함수/컴포넌트는 실패하는 테스트를 먼저 작성한 뒤 구현한다.
- 신규 컴포넌트는 Tailwind 유틸리티 클래스로 작성한다(Phase 1에서 도입, `@theme`로 `text-danger`
  등 색상 토큰이 이미 매핑되어 있음).
- 기존 `computeExpertAnalytics`/`ExpertDetailsPanel`의 다른 필드·섹션(avgPreTaxIncome 등, 국민연금
  안내 문장, 배당비중 안내)은 이번 작업 범위가 아니므로 건드리지 않는다.
- 참고 스펙: `docs/superpowers/specs/2026-07-25-risk-alert-cards-design.md`

---

### Task 1: `computeRiskAlerts` usecase

**Files:**
- Create: `src/core/usecases/dashboard/computeRiskAlerts.ts`
- Test: `src/tests/core/usecases/dashboard/computeRiskAlerts.test.ts`

**Interfaces:**
- Consumes: `SimulationResult`, `SimulationParams`, `SimulationYearlyResult`, `UtilityConfig`
  (`src/core/entities/types.ts`), `DEFAULT_UTILITY_CONFIG`
  (`src/core/usecases/utility/utilityWeights.ts`), `formatManwon`
  (`src/core/usecases/utility/utilityAnalysis.ts`).
- Produces: `export interface RiskAlert { key: 'comprehensiveTax' | 'privatePensionLimit' |
  'healthInsurance'; title: string; message: string; }` 및
  `export function computeRiskAlerts(result: SimulationResult, params: SimulationParams, cfg:
  UtilityConfig = DEFAULT_UTILITY_CONFIG): RiskAlert[]`. Task 2/3이 이 타입과 함수를 그대로 가져다
  쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/core/usecases/dashboard/computeRiskAlerts.test.ts` 파일을 새로 만든다:

```ts
import { describe, test, expect } from 'vitest';
import { computeRiskAlerts } from '@/core/usecases/dashboard/computeRiskAlerts';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';

function makeYearlyResult(overrides: Partial<SimulationYearlyResult>): SimulationYearlyResult {
  return {
    age: 60,
    year: 2026,
    totalAssets: 0,
    stockAssets: 0,
    pensionAssets: 0,
    dividendIncome: 0,
    nationalPensionIncome: 0,
    privatePensionIncome: 0,
    pensionIncome: 0,
    otherIncome: 0,
    totalIncome: 0,
    preTaxTotalIncome: 0,
    dividendTaxPaid: 0,
    pensionTaxPaid: 0,
    nationalPensionTaxPaid: 0,
    healthInsurancePaid: 0,
    comprehensiveTaxPaid: 0,
    privatePensionTaxMethod: 'none',
    spending: 0,
    hasTaxWarning: false,
    ...overrides,
  };
}

function makeResult(yearlyResults: SimulationYearlyResult[]): SimulationResult {
  return {
    yearlyResults,
    fireAge: 60,
    depletionAge: null,
    endingAssets: 0,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const paramsWithPensionLimit: SimulationParams = {
  ...baseParams,
  taxSettings: {
    enableComprehensiveTax: true,
    enableHealthInsurance: true,
    usDividendTaxRate: 15,
    domesticDividendTaxRate: 15.4,
    comprehensiveTaxRate: 15,
    healthInsuranceRate: 5,
    privatePensionLimit: 15000000,
  },
};

describe('computeRiskAlerts', () => {
  test('금융소득종합과세 위험이 있으면 첫 발생 연령을 포함한 알림을 반환한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 65, hasTaxWarning: false }),
      makeYearlyResult({ age: 70, hasTaxWarning: true }),
    ];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('comprehensiveTax');
    expect(alerts[0].message).toContain('70세');
    expect(alerts[0].message).toContain('2,000만원');
  });

  test('사적연금이 저율과세 한도를 초과하는 연속 구간이 있으면 연령대와 한도 금액을 포함한 알림을 반환한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 65, privatePensionIncome: 20000000, pensionTaxPaid: 1000000 }),
      makeYearlyResult({ age: 66, privatePensionIncome: 20000000, pensionTaxPaid: 1000000 }),
      makeYearlyResult({ age: 67, privatePensionIncome: 5000000, pensionTaxPaid: 0 }),
    ];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), paramsWithPensionLimit);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('privatePensionLimit');
    expect(alerts[0].message).toContain('65~66세');
    expect(alerts[0].message).toContain('1,500만원');
  });

  test('건강보험료가 소득 대비 임계값(5%)을 초과하는 연도가 있으면 알림을 반환한다', () => {
    const yearlyResults = [makeYearlyResult({ age: 70, totalIncome: 10000000, healthInsurancePaid: 600000 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('healthInsurance');
    expect(alerts[0].message).toContain('70세');
    expect(alerts[0].message).toContain('5%');
  });

  test('건강보험료 비율이 정확히 임계값과 같으면 포함한다(>=)', () => {
    const yearlyResults = [makeYearlyResult({ age: 70, totalIncome: 10000000, healthInsurancePaid: 500000 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('healthInsurance');
  });

  test('totalIncome이 0인 해는 건강보험료 비율 계산에서 제외한다(0으로 나누기 방지)', () => {
    const yearlyResults = [makeYearlyResult({ age: 70, totalIncome: 0, healthInsurancePaid: 100 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(0);
  });

  test('여러 리스크가 동시에 발생하면 시작 연령이 이른 순으로 정렬한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 65, totalIncome: 10000000, healthInsurancePaid: 600000 }),
      makeYearlyResult({ age: 70, hasTaxWarning: true, totalIncome: 10000000, healthInsurancePaid: 0 }),
      makeYearlyResult({
        age: 75,
        privatePensionIncome: 20000000,
        pensionTaxPaid: 1000000,
        totalIncome: 10000000,
        healthInsurancePaid: 0,
      }),
    ];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), paramsWithPensionLimit);

    expect(alerts.map((a) => a.key)).toEqual(['healthInsurance', 'comprehensiveTax', 'privatePensionLimit']);
  });

  test('아무 리스크도 없으면 빈 배열을 반환한다', () => {
    const yearlyResults = [makeYearlyResult({ age: 65, totalIncome: 10000000, healthInsurancePaid: 100000 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/dashboard/computeRiskAlerts.test.ts`
Expected: FAIL — `Failed to resolve import "@/core/usecases/dashboard/computeRiskAlerts"`

- [ ] **Step 3: 최소 구현 작성**

`src/core/usecases/dashboard/computeRiskAlerts.ts` 파일을 새로 만든다:

```ts
import { SimulationParams, SimulationResult, SimulationYearlyResult, UtilityConfig } from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from '../utility/utilityWeights';
import { formatManwon } from '../utility/utilityAnalysis';

export interface RiskAlert {
  key: 'comprehensiveTax' | 'privatePensionLimit' | 'healthInsurance';
  title: string;
  message: string;
}

interface RiskAlertCandidate {
  alert: RiskAlert;
  sortAge: number;
}

// 조건을 만족하는 첫 연속 구간의 [시작 나이, 끝 나이]를 반환한다. yearlyResults는 나이 오름차순으로
// 정렬되어 있다고 가정한다(SimulationEngine의 산출 순서와 동일). 만족하는 연도가 없으면 null.
// 조건을 만족하는 구간이 끝난 뒤(startAge가 채워진 뒤) 조건이 다시 꺼지면 그 시점에서 멈춘다 —
// 이후 다시 조건을 만족하는 두 번째 구간이 있어도 무시하고 "첫 구간"만 본다.
function findFirstContiguousRange(
  yearlyResults: SimulationYearlyResult[],
  predicate: (year: SimulationYearlyResult) => boolean
): { startAge: number; endAge: number } | null {
  let startAge: number | null = null;
  let endAge: number | null = null;

  for (const year of yearlyResults) {
    if (predicate(year)) {
      if (startAge === null) startAge = year.age;
      endAge = year.age;
    } else if (startAge !== null) {
      break;
    }
  }

  if (startAge === null || endAge === null) return null;
  return { startAge, endAge };
}

function formatAgeRange(startAge: number, endAge: number): string {
  return startAge === endAge ? `${startAge}세` : `${startAge}~${endAge}세`;
}

function buildComprehensiveTaxAlert(yearlyResults: SimulationYearlyResult[]): RiskAlertCandidate | null {
  const firstWarningYear = yearlyResults.find((y) => y.hasTaxWarning);
  if (!firstWarningYear) return null;
  return {
    sortAge: firstWarningYear.age,
    alert: {
      key: 'comprehensiveTax',
      title: '금융소득종합과세 진입 가능성',
      message: `${firstWarningYear.age}세 이후 배당·이자소득이 연 2,000만원을 초과하는 해가 있습니다.`,
    },
  };
}

function buildPrivatePensionLimitAlert(
  yearlyResults: SimulationYearlyResult[],
  privatePensionLimit: number
): RiskAlertCandidate | null {
  const range = findFirstContiguousRange(
    yearlyResults,
    (y) => y.privatePensionIncome + y.pensionTaxPaid > privatePensionLimit
  );
  if (!range) return null;
  return {
    sortAge: range.startAge,
    alert: {
      key: 'privatePensionLimit',
      title: '세금 급증 구간 (사적연금 저율과세 한도 초과)',
      message: `${formatAgeRange(range.startAge, range.endAge)} 구간, 사적연금이 저율과세 한도(연 ${formatManwon(privatePensionLimit)})를 초과해 세금 부담이 늘어납니다.`,
    },
  };
}

function buildHealthInsuranceAlert(
  yearlyResults: SimulationYearlyResult[],
  healthInsuranceCeiling: number
): RiskAlertCandidate | null {
  const range = findFirstContiguousRange(
    yearlyResults,
    (y) => y.totalIncome > 0 && y.healthInsurancePaid / y.totalIncome >= healthInsuranceCeiling
  );
  if (!range) return null;
  const ceilingPercent = Math.round(healthInsuranceCeiling * 100);
  return {
    sortAge: range.startAge,
    alert: {
      key: 'healthInsurance',
      title: '건강보험료 증가 구간',
      message: `${formatAgeRange(range.startAge, range.endAge)} 구간, 건강보험료가 소득의 ${ceilingPercent}%를 초과합니다.`,
    },
  };
}

// 이미 존재하는 임계값(healthInsuranceCeiling/privatePensionLimit)과 판정 조건을 재사용하되, 이번엔
// boolean이 아니라 "몇 세부터 몇 세까지" 구간까지 계산해 반환한다.
//
// 주의: UtilityEngine.ts는 healthInsuranceCeiling을 은퇴 전체 기간 "합산" 비율에 적용해 taxationRisk
// 점수를 매기지만, 여기서는 같은 임계값을 "연도별"로 적용한다(연령대를 보여줘야 하므로). 따라서 개별
// 연도는 이 카드에 걸리지만 전체 평균은 임계값 밑이라 Utility 점수는 만점인 경우가 있을 수 있다 —
// 의도된 차이이며 버그가 아니다.
//
// 반환 순서는 가장 이른 시작 연령 순이며, 해당 사항이 없는 리스크는 배열에서 제외된다(0~3개).
export function computeRiskAlerts(
  result: SimulationResult,
  params: SimulationParams,
  cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG
): RiskAlert[] {
  const { yearlyResults } = result;
  const privatePensionLimit = params.taxSettings?.privatePensionLimit ?? 15000000;

  const candidates = [
    buildComprehensiveTaxAlert(yearlyResults),
    buildPrivatePensionLimitAlert(yearlyResults, privatePensionLimit),
    buildHealthInsuranceAlert(yearlyResults, cfg.healthInsuranceCeiling),
  ].filter((c): c is RiskAlertCandidate => c !== null);

  return candidates.sort((a, b) => a.sortAge - b.sortAge).map((c) => c.alert);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/dashboard/computeRiskAlerts.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/usecases/dashboard/computeRiskAlerts.ts src/tests/core/usecases/dashboard/computeRiskAlerts.test.ts
git commit -m "feat: 리스크 알림 3종(건보료/종합과세/사적연금한도) 계산 usecase 추가"
```

---

### Task 2: `RiskAlertCards` 컴포넌트

**Files:**
- Create: `src/web/features/Dashboard/risk/RiskAlertCards.tsx`
- Test: `src/tests/web/features/Dashboard/risk/RiskAlertCards.test.tsx`

**Interfaces:**
- Consumes: `RiskAlert` (Task 1의 `src/core/usecases/dashboard/computeRiskAlerts.ts`).
- Produces: `export function RiskAlertCards({ alerts }: { alerts: RiskAlert[] }): JSX.Element | null`.
  Task 3이 이 컴포넌트를 `DashboardSection.tsx`에서 가져다 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/web/features/Dashboard/risk/RiskAlertCards.test.tsx` 파일을 새로 만든다:

```tsx
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskAlertCards } from '@/web/features/Dashboard/risk/RiskAlertCards';
import { RiskAlert } from '@/core/usecases/dashboard/computeRiskAlerts';

describe('RiskAlertCards', () => {
  test('알림이 없으면 아무것도 렌더링하지 않는다', () => {
    const { container } = render(<RiskAlertCards alerts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('알림이 있으면 각각의 title/message를 렌더링한다', () => {
    const alerts: RiskAlert[] = [
      {
        key: 'healthInsurance',
        title: '건강보험료 증가 구간',
        message: '65~72세 구간, 건강보험료가 소득의 5%를 초과합니다.',
      },
      {
        key: 'comprehensiveTax',
        title: '금융소득종합과세 진입 가능성',
        message: '70세 이후 배당·이자소득이 연 2,000만원을 초과하는 해가 있습니다.',
      },
    ];
    render(<RiskAlertCards alerts={alerts} />);

    expect(screen.getByText('건강보험료 증가 구간')).toBeInTheDocument();
    expect(screen.getByText('65~72세 구간, 건강보험료가 소득의 5%를 초과합니다.')).toBeInTheDocument();
    expect(screen.getByText('금융소득종합과세 진입 가능성')).toBeInTheDocument();
    expect(
      screen.getByText('70세 이후 배당·이자소득이 연 2,000만원을 초과하는 해가 있습니다.')
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/risk/RiskAlertCards.test.tsx`
Expected: FAIL — `Failed to resolve import "@/web/features/Dashboard/risk/RiskAlertCards"`

- [ ] **Step 3: 최소 구현 작성**

`src/web/features/Dashboard/risk/RiskAlertCards.tsx` 파일을 새로 만든다:

```tsx
import { AlertTriangle } from 'lucide-react';
import { RiskAlert } from '../../../../core/usecases/dashboard/computeRiskAlerts';

interface RiskAlertCardsProps {
  alerts: RiskAlert[];
}

// computeRiskAlerts가 반환한 리스크를 눈에 띄는 경고 카드로 보여준다. 해당 사항이 없으면(0개)
// 섹션 자체를 렌더링하지 않는다.
export function RiskAlertCards({ alerts }: RiskAlertCardsProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="mb-6 flex flex-col gap-3">
      {alerts.map((alert) => (
        <div key={alert.key} className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger/5 p-4">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-danger">{alert.title}</p>
            <p className="mt-1 text-sm text-foreground-muted">{alert.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/risk/RiskAlertCards.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/web/features/Dashboard/risk/RiskAlertCards.tsx src/tests/web/features/Dashboard/risk/RiskAlertCards.test.tsx
git commit -m "feat: RiskAlertCards 컴포넌트 추가"
```

---

### Task 3: `DashboardSection`에 배치

**Files:**
- Modify: `src/web/features/Dashboard/DashboardSection.tsx`
- Modify: `src/tests/web/features/Dashboard/DashboardSection.test.tsx`

**Interfaces:**
- Consumes: `computeRiskAlerts` (Task 1), `RiskAlertCards` (Task 2).
- Produces: 변경 없음 (내부 배치만 추가, `DashboardSectionProps`는 그대로).

- [ ] **Step 1: 실패하는 회귀 테스트 작성**

`src/tests/web/features/Dashboard/DashboardSection.test.tsx`에서, 기존 `describe('DashboardSection -
IA 순서', ...)` 블록의 마지막 테스트(`'추천안에 생활비 배수(monthlySpendingMultiplier)가...'`) 바로
뒤, `});`(describe를 닫는 줄) 앞에 아래 테스트를 추가한다:

```tsx
  test('Before 상태에서 리스크 알림이 보이고, 추천 적용(After) 시 리스크가 해소되면 알림이 사라진다', () => {
    const riskyResult: SimulationResult = {
      ...result,
      yearlyResults: [makeYearlyResult({ age: 60 }), makeYearlyResult({ age: 65, nationalPensionIncome: 12000000, hasTaxWarning: true })],
    };
    const cleanAfterResult: SimulationResult = { ...result, endingAssets: 999000000, utility: { ...utility, score: 81 } };
    const rec: StrategyRecommendation = { ...recommendation, recommendedResult: cleanAfterResult };

    render(<DashboardSection params={params} result={riskyResult} recommendation={rec} />);

    expect(screen.getByText('금융소득종합과세 진입 가능성')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '추천 적용하기' }));

    expect(screen.queryByText('금융소득종합과세 진입 가능성')).not.toBeInTheDocument();
  });
```

(이 파일은 이미 `makeYearlyResult`, `result`, `utility`, `recommendation`, `params`,
`StrategyRecommendation`, `SimulationResult`를 임포트/정의하고 있으므로 추가 임포트는 필요 없다.)

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/DashboardSection.test.tsx`
Expected: FAIL — `Unable to find an element with the text: 금융소득종합과세 진입 가능성`

- [ ] **Step 3: `DashboardSection.tsx`에 배치**

`src/web/features/Dashboard/DashboardSection.tsx`의 import 블록에서 `import { ExpertDetailsPanel }
from './expert/ExpertDetailsPanel';` 다음 줄에 추가:

```ts
import { RiskAlertCards } from './risk/RiskAlertCards';
import { computeRiskAlerts } from '../../../core/usecases/dashboard/computeRiskAlerts';
```

`const captions = generateChartCaptions(displayedResult, params);` 바로 다음 줄에 추가:

```ts
  const riskAlerts = computeRiskAlerts(displayedResult, params);
```

JSX에서 `{/* STEP 2: 핵심 KPI */}` 블록(`<SecondaryKpiCollapse ... />`까지)과 `{/* STEP 3: AI 추천
전략 체크리스트 */}` 사이에 아래를 삽입:

```tsx
      {/* 리스크 알림 (해당되는 것만, 0~3개) */}
      <RiskAlertCards alerts={riskAlerts} />

```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/Dashboard/DashboardSection.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: 전체 스위트 + 타입체크 확인**

Run: `npm test`
Expected: 모든 테스트 파일 PASS. 이 시점의 총 테스트 수는 작업 시작 시점(315개) + Task 1에서 추가한
7개 + Task 2에서 추가한 2개 + 이번 Task 3에서 추가한 1개 = 325개.

Run: `npx tsc --noEmit`
Expected: 출력 없음(에러 0건)

- [ ] **Step 6: 커밋**

```bash
git add src/web/features/Dashboard/DashboardSection.tsx src/tests/web/features/Dashboard/DashboardSection.test.tsx
git commit -m "feat: DashboardSection에 리스크 알림 카드 배치 (KPI 아래, 추천체크리스트 위)"
```

---

### Task 4: `ExpertDetailsPanel`의 중복 항목 정리

**Files:**
- Modify: `src/web/features/Dashboard/expert/ExpertDetailsPanel.tsx`
- Modify: `src/core/usecases/dashboard/computeExpertAnalytics.ts`
- Modify: `src/tests/core/usecases/dashboard/computeExpertAnalytics.test.ts`

**Interfaces:**
- 변경 없음(외부에서 이 파일들을 더 소비하는 곳은 Task 3까지 완료된 시점 기준으로 없음 — Step 1에서
  다시 확인한다).

- [ ] **Step 1: 다른 소비처가 없는지 확인**

Run: `grep -rn "everComprehensiveTax\|hasHighPrivatePensionRisk" src --include="*.ts" --include="*.tsx" | grep -v "/tests/"`

Expected 출력(정확히 이 목록과 일치해야 한다 — 다른 파일이 섞여 있으면 Step 2/3을 건너뛰고 먼저
확인할 것):

```
src/core/usecases/dashboard/generateChartCaptions.ts:10:// pensionGapYears/everComprehensiveTax/hasHighPrivatePensionRisk 등)과 동일한 규칙으로 캡션을
src/core/usecases/dashboard/generateChartCaptions.ts:20:  const hasHighPrivatePensionRisk = yearlyResults.some(
src/core/usecases/dashboard/generateChartCaptions.ts:27:    spendingComposition: buildSpendingCompositionCaption(hasHighPrivatePensionRisk),
src/core/usecases/dashboard/generateChartCaptions.ts:53:function buildSpendingCompositionCaption(hasHighPrivatePensionRisk: boolean): string {
src/core/usecases/dashboard/generateChartCaptions.ts:54:  if (hasHighPrivatePensionRisk) {
src/core/usecases/dashboard/computeExpertAnalytics.ts:12:  everComprehensiveTax: boolean;
src/core/usecases/dashboard/computeExpertAnalytics.ts:13:  hasHighPrivatePensionRisk: boolean;
src/core/usecases/dashboard/computeExpertAnalytics.ts:40:  const everComprehensiveTax = yearlyResults.some((r) => r.comprehensiveTaxPaid > 0 || r.hasTaxWarning);
src/core/usecases/dashboard/computeExpertAnalytics.ts:43:  const hasHighPrivatePensionRisk = yearlyResults.some((r) => r.privatePensionIncome + r.pensionTaxPaid > pensionLimit);
src/core/usecases/dashboard/computeExpertAnalytics.ts:54:    everComprehensiveTax,
src/core/usecases/dashboard/computeExpertAnalytics.ts:55:    hasHighPrivatePensionRisk,
src/web/features/Dashboard/expert/ExpertDetailsPanel.tsx:82:            {analytics.everComprehensiveTax && (
src/web/features/Dashboard/expert/ExpertDetailsPanel.tsx:85:            {analytics.hasHighPrivatePensionRisk && (
```

`generateChartCaptions.ts`의 `hasHighPrivatePensionRisk`는 **자체적으로 다시 계산하는 지역 변수**로
`computeExpertAnalytics`의 필드와 무관하다(이름만 같음) — 그대로 둔다. 실제로 정리 대상인 것은
`computeExpertAnalytics.ts`의 필드 정의/계산/반환 3곳과 `ExpertDetailsPanel.tsx`의 렌더링 2곳뿐이다.

- [ ] **Step 2: `ExpertDetailsPanel.tsx`에서 중복 항목 제거**

`src/web/features/Dashboard/expert/ExpertDetailsPanel.tsx`에서 아래 블록을 찾아:

```tsx
            {analytics.everComprehensiveTax && (
              <li className="text-danger">⚠️ 금융소득종합과세 대상이 되는 연도가 있습니다.</li>
            )}
            {analytics.hasHighPrivatePensionRisk && (
              <li className="text-warning">⚠️ 사적연금 저율과세 한도를 초과하는 연도가 있어 세금 부담이 늘어날 수 있습니다.</li>
            )}
```

통째로 삭제한다(앞뒤의 `<li>국민연금은...</li>`와 `{analytics.hasSignificantDividends && (...)}`
블록은 그대로 유지).

- [ ] **Step 3: `computeExpertAnalytics.ts`에서 필드 제거**

`src/core/usecases/dashboard/computeExpertAnalytics.ts`에서 `ExpertAnalytics` 인터페이스의
`everComprehensiveTax: boolean;`과 `hasHighPrivatePensionRisk: boolean;` 두 줄을 삭제한다.

함수 본문에서 `const everComprehensiveTax = yearlyResults.some((r) => r.comprehensiveTaxPaid > 0 ||
r.hasTaxWarning);` 줄과 `const hasHighPrivatePensionRisk = yearlyResults.some((r) =>
r.privatePensionIncome + r.pensionTaxPaid > pensionLimit);` 줄을 삭제한다. 단, `pensionLimit`
변수(`const pensionLimit = params.taxSettings?.privatePensionLimit ?? 15000000;`)는
`hasHighPrivatePensionRisk` 계산에만 쓰였으므로 이 줄도 함께 삭제한다.

`return { ... }` 객체 리터럴에서 `everComprehensiveTax,`와 `hasHighPrivatePensionRisk,` 두 줄을
삭제한다.

- [ ] **Step 4: 기존 테스트 중 삭제된 필드를 검증하던 2개 제거**

`src/tests/core/usecases/dashboard/computeExpertAnalytics.test.ts`에서 아래 두 테스트를 통째로
삭제한다:

```ts
  test('금융소득종합과세 납부 또는 경고가 있던 해가 있으면 everComprehensiveTax가 true다', () => {
    const analytics = computeExpertAnalytics(
      makeResult([makeYearlyResult({ age: 65, hasTaxWarning: true })]),
      baseParams
    );
    expect(analytics.everComprehensiveTax).toBe(true);
  });

  test('사적연금 소득+세금 합이 저율과세 한도를 초과하는 해가 있으면 hasHighPrivatePensionRisk가 true다', () => {
    const params: SimulationParams = {
      ...baseParams,
      taxSettings: {
        enableComprehensiveTax: true,
        enableHealthInsurance: true,
        usDividendTaxRate: 15,
        domesticDividendTaxRate: 15.4,
        comprehensiveTaxRate: 15,
        healthInsuranceRate: 5,
        privatePensionLimit: 15000000,
      },
    };
    const analytics = computeExpertAnalytics(
      makeResult([makeYearlyResult({ age: 65, privatePensionIncome: 20000000, pensionTaxPaid: 1000000 })]),
      params
    );
    expect(analytics.hasHighPrivatePensionRisk).toBe(true);
  });
```

(이 두 테스트 사이/앞뒤의 다른 테스트는 그대로 둔다.)

- [ ] **Step 5: 타입체크 + 전체 테스트 통과 확인**

Run: `npx tsc --noEmit`
Expected: 출력 없음(에러 0건) — `ExpertDetailsPanel.tsx`가 삭제된 필드를 더 이상 참조하지 않는지
포함해 확인된다.

Run: `npm test`
Expected: 모든 테스트 PASS. `computeExpertAnalytics.test.ts`는 기존 7개에서 2개 줄어든 5개.

- [ ] **Step 6: 커밋**

```bash
git add src/web/features/Dashboard/expert/ExpertDetailsPanel.tsx src/core/usecases/dashboard/computeExpertAnalytics.ts src/tests/core/usecases/dashboard/computeExpertAnalytics.test.ts
git commit -m "refactor: 리스크 알림 카드로 승격된 항목을 ExpertDetailsPanel에서 제거(중복 정리)"
```

---

### Task 5: 최종 검증

**Files:** 없음(전체 확인만)

- [ ] **Step 1: 전체 테스트 스위트**

Run: `npm test`
Expected: 모든 테스트 파일 PASS, 실패 0건.

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음.

- [ ] **Step 3: 프로덕션 빌드**

Run: `npm run build`
Expected: `✓ Compiled successfully`, `✓ Generating static pages` 포함 정상 종료(에러 없음).

- [ ] **Step 4: ESLint**

Run: `npm run lint`
Expected: 이번 작업으로 새로 만들거나 수정한 5개 파일(`computeRiskAlerts.ts`, `RiskAlertCards.tsx`,
`DashboardSection.tsx`, `ExpertDetailsPanel.tsx`, `computeExpertAnalytics.ts`)에서 새 warning/error가
없어야 한다(기존에 있던 다른 파일의 pre-existing 경고는 무관).
