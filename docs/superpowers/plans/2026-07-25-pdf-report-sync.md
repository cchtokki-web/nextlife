# PDF 리포트 디자인 동기화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `page.tsx`의 PDF 생성 로직(`handleDownload`)에 Phase 2 신규 기능 4가지(리스크 알림/itemizedContributions 체크리스트/실행 로드맵/민감도 분석)를 반영해 화면과 콘텐츠를 동기화한다.

**Architecture:** 4개 신규 섹션의 "데이터 → HTML 문자열" 변환을 `src/web/features/Pdf/pdfReportSections.ts`(신규)의 순수 함수로 추출해 단위 테스트를 붙인다. 데이터 계산은 새로 만들지 않고 Phase 2에서 이미 구현된 `computeRiskAlerts`/`computeExecutionRoadmap`/`computeSensitivityAnalysis`와 기존 `StrategyRecommendation.itemizedContributions` 필드를 그대로 재사용한다. `page.tsx`의 기존 490줄짜리 `handleDownload`는 새 섹션을 위한 최소한의 배선만 추가하고, 그 외 로직(설정 요약/연금자산/세금/연령별표/생활비표/페이지 분할)은 건드리지 않는다.

**Tech Stack:** TypeScript(strict, `any` 금지), Vitest, html2canvas/jsPDF(기존 의존성, 신규 추가 없음).

## Global Constraints

- 범위는 콘텐츠 동기화다 — 기존 PDF 페이지(설정 요약/연금자산상세/세금설정/연령별표/생활비표/법적고지)의 시각적 재설계는 하지 않는다.
- 새 섹션 4개의 렌더 함수는 순수 함수(데이터 → HTML 문자열)로 `src/web/features/Pdf/pdfReportSections.ts`에 둔다.
- 데이터가 비어 있으면(`alerts.length === 0`, `scenarios.length === 0`) 해당 섹션은 빈 문자열을 반환해 PDF에 나타나지 않는다.
- `recommendation`이 없거나 `improved: false`이거나 `itemizedContributions`가 빈 배열이면 "현재 설정이 이미 최적입니다" 류 폴백 문구를 반환한다.
- `.pdf-page`는 **고정 높이(1123px, A4)** 캔버스다(`justify-content: space-between`이지만 요소 자체 높이는 고정) — 콘텐츠가 넘치면 잘리거나 다음 페이지와 겹쳐 보일 위험이 있으므로, 페이지 2("Lifetime Utility Score & AI 추천 전략")에 4개 신규 섹션을 전부 밀어넣지 않고 실행 로드맵/민감도 분석은 **새 페이지("페이지 2B")로 분리**한다.
- 새 페이지를 추가하면 이후 모든 페이지 번호(`페이지 N / {total_pages}` 푸터)와 문서 내 번호 매겨진 섹션 제목("N. 제목")이 뒤로 밀린다 — 정확히 1개 페이지를 추가하므로 기존 페이지 3 이후 전부 +1, `totalPages` 계산식도 `4` → `5`로 변경한다.
- 리스크 알림은 페이지 1에 번호 없는 서브섹션(`<h3>`)으로 추가한다(전역 섹션 번호 재조정을 피하기 위해 의도적으로 번호를 매기지 않음).
- html2canvas/jsPDF를 통한 실제 PDF 렌더링은 jsdom에서 검증 불가능하다 — 자동화 테스트는 `pdfReportSections.ts`의 순수 함수까지만 커버하고, 실제 PDF 레이아웃(페이지 분할/오버플로 여부)은 사람이 브라우저에서 직접 다운로드해 확인해야 한다.
- TypeScript strict, `any` 사용 금지.

---

## File Structure

- `src/web/features/Pdf/pdfReportSections.ts` (신규) — 4개 섹션 렌더러: `renderRiskAlertsSection`, `renderItemizedChecklistSection`, `renderExecutionRoadmapSection`, `renderSensitivityTableSection`.
- `src/tests/web/features/Pdf/pdfReportSections.test.ts` (신규)
- `src/app/simulator/page.tsx` (수정) — Task 2: 리스크 알림 + itemized 체크리스트 배선(페이지 1/2, 페이지 번호 변경 없음). Task 3: 실행 로드맵 + 민감도 분석용 새 페이지 2B 삽입 + 이후 페이지 전체 renumbering.

---

## Task 1: `pdfReportSections.ts` — 4개 섹션 렌더러

**Files:**
- Create: `src/web/features/Pdf/pdfReportSections.ts`
- Test: `src/tests/web/features/Pdf/pdfReportSections.test.ts`

**Interfaces:**
- Consumes: `RiskAlert`(`src/core/usecases/dashboard/computeRiskAlerts.ts`, 기존), `ExecutionRoadmap`(`src/core/usecases/dashboard/computeExecutionRoadmap.ts`, 기존), `SensitivityScenario`(`src/core/usecases/dashboard/computeSensitivityAnalysis.ts`, 기존), `StrategyRecommendation`(`src/core/entities/types.ts`, 기존, `itemizedContributions`/`improved` 필드 포함).
- Produces:
  ```ts
  export function renderRiskAlertsSection(alerts: RiskAlert[]): string
  export function renderItemizedChecklistSection(recommendation: StrategyRecommendation | undefined): string
  export function renderExecutionRoadmapSection(roadmap: ExecutionRoadmap): string
  export function renderSensitivityTableSection(scenarios: SensitivityScenario[]): string
  ```
  Task 2가 `renderRiskAlertsSection`/`renderItemizedChecklistSection`을, Task 3가 `renderExecutionRoadmapSection`/`renderSensitivityTableSection`을 그대로 import해서 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/web/features/Pdf/pdfReportSections.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import {
  renderRiskAlertsSection,
  renderItemizedChecklistSection,
  renderExecutionRoadmapSection,
  renderSensitivityTableSection,
} from '@/web/features/Pdf/pdfReportSections';
import { RiskAlert } from '@/core/usecases/dashboard/computeRiskAlerts';
import { ExecutionRoadmap } from '@/core/usecases/dashboard/computeExecutionRoadmap';
import { SensitivityScenario } from '@/core/usecases/dashboard/computeSensitivityAnalysis';
import { StrategyRecommendation, UtilityBreakdown } from '@/core/entities/types';

describe('renderRiskAlertsSection', () => {
  test('빈 배열이면 빈 문자열을 반환한다', () => {
    expect(renderRiskAlertsSection([])).toBe('');
  });

  test('알림 목록을 HTML로 렌더링한다', () => {
    const alerts: RiskAlert[] = [
      {
        key: 'comprehensiveTax',
        title: '금융소득종합과세 진입 가능성',
        message: '65세 이후 배당·이자소득이 연 2,000만원을 초과하는 해가 있습니다.',
      },
    ];
    const html = renderRiskAlertsSection(alerts);
    expect(html).toContain('금융소득종합과세 진입 가능성');
    expect(html).toContain('65세 이후 배당·이자소득이 연 2,000만원을 초과하는 해가 있습니다.');
  });
});

describe('renderItemizedChecklistSection', () => {
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
  const baseRecommendedResult = {
    yearlyResults: [],
    fireAge: null,
    depletionAge: null,
    endingAssets: 0,
    retirementScore: 0,
    retirementGrade: '보통' as const,
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };

  test('recommendation이 undefined이면 폴백 문구를 반환한다', () => {
    const html = renderItemizedChecklistSection(undefined);
    expect(html).toContain('현재 설정이 이미 최적입니다');
  });

  test('improved가 false이면 폴백 문구를 반환한다', () => {
    const recommendation: StrategyRecommendation = {
      currentUtility: utility,
      recommendedUtility: utility,
      recommendedPlan: null,
      improved: false,
      reasons: [],
      deltas: zeroDeltas,
      totalCandidateCount: 0,
      failedCandidateCount: 0,
      recommendedResult: baseRecommendedResult,
      itemizedContributions: [],
    };
    const html = renderItemizedChecklistSection(recommendation);
    expect(html).toContain('현재 설정이 이미 최적입니다');
  });

  test('itemizedContributions를 항목별 +/-Utility와 함께 렌더링한다', () => {
    const recommendation: StrategyRecommendation = {
      currentUtility: utility,
      recommendedUtility: { ...utility, score: 81 },
      recommendedPlan: null,
      improved: true,
      reasons: [],
      deltas: zeroDeltas,
      totalCandidateCount: 12,
      failedCandidateCount: 0,
      recommendedResult: baseRecommendedResult,
      itemizedContributions: [
        { label: '국민연금을 70세까지 연기 수령합니다.', utilityDelta: 5, deltas: { ...zeroDeltas, totalTax: -1000000 } },
        { label: '사적연금을 63세부터 인출합니다.', utilityDelta: -1.2, deltas: zeroDeltas },
      ],
    };
    const html = renderItemizedChecklistSection(recommendation);
    expect(html).toContain('국민연금을 70세까지 연기 수령합니다.');
    expect(html).toContain('+5.0 Utility');
    expect(html).toContain('사적연금을 63세부터 인출합니다.');
    expect(html).toContain('-1.2 Utility');
  });
});

describe('renderExecutionRoadmapSection', () => {
  test('이벤트와 기대수명을 렌더링한다', () => {
    const roadmap: ExecutionRoadmap = {
      events: [
        { age: 60, items: [{ title: '퇴직', description: '상용소득이 종료되고 자산 인출 계획이 시작됩니다.' }] },
        { age: 68, items: [{ title: '국민연금 수령 개시 (연기)', description: '국민연금 수령을 시작합니다.' }] },
      ],
      expectancy: 90,
    };
    const html = renderExecutionRoadmapSection(roadmap);
    expect(html).toContain('60세');
    expect(html).toContain('퇴직');
    expect(html).toContain('68세');
    expect(html).toContain('국민연금 수령 개시 (연기)');
    expect(html).toContain('90세');
    expect(html).toContain('기대수명');
  });
});

describe('renderSensitivityTableSection', () => {
  test('빈 배열이면 빈 문자열을 반환한다', () => {
    expect(renderSensitivityTableSection([])).toBe('');
  });

  test('시나리오를 표 행으로 렌더링하며, depletionAge가 null이면 "평생 유지"를 표시한다', () => {
    const scenarios: SensitivityScenario[] = [
      { key: 'returnDown', label: '투자수익률 -2%p', depletionAge: 82, deltaYears: -6 },
      { key: 'returnUp', label: '투자수익률 +2%p', depletionAge: null, deltaYears: 4 },
    ];
    const html = renderSensitivityTableSection(scenarios);
    expect(html).toContain('투자수익률 -2%p');
    expect(html).toContain('82세');
    expect(html).toContain('투자수익률 +2%p');
    expect(html).toContain('평생 유지');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/web/features/Pdf/pdfReportSections.test.ts`
Expected: FAIL — `Cannot find module '@/web/features/Pdf/pdfReportSections'`

- [ ] **Step 3: 구현**

`src/web/features/Pdf/pdfReportSections.ts`:

```ts
import { RiskAlert } from '../../../core/usecases/dashboard/computeRiskAlerts';
import { ExecutionRoadmap } from '../../../core/usecases/dashboard/computeExecutionRoadmap';
import { SensitivityScenario } from '../../../core/usecases/dashboard/computeSensitivityAnalysis';
import { StrategyRecommendation } from '../../../core/entities/types';

// PDF는 화면과 별개로 완전히 독립된 정적 HTML 문자열을 html2canvas로 캡처하는 구조라(page.tsx의
// handleDownload), 화면 컴포넌트를 재사용할 수 없다 — 동일한 usecase 데이터를 받아 PDF 전용
// 인라인 스타일 HTML 문자열로 변환하는 순수 함수만 여기 둔다. 기존 handleDownload가 이미 자산/
// 연금 이름 등을 이스케이프 없이 직접 보간하는 것과 동일한 관례를 따른다(신규 도입 아님).

export function renderRiskAlertsSection(alerts: RiskAlert[]): string {
  if (alerts.length === 0) return '';
  const itemsHtml = alerts
    .map(
      (alert) => `
        <div style="border: 1px solid #fecaca; background-color: #fef2f2; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px;">
          <p style="margin: 0; font-size: 12px; font-weight: 700; color: #ef4444;">⚠ ${alert.title}</p>
          <p style="margin: 3px 0 0; font-size: 11px; color: #7f1d1d;">${alert.message}</p>
        </div>
      `
    )
    .join('');
  return `
    <h3 style="font-size: 13px; color: #0f172a; margin-top: 20px; margin-bottom: 8px;">⚠ 리스크 알림</h3>
    ${itemsHtml}
  `;
}

export function renderItemizedChecklistSection(recommendation: StrategyRecommendation | undefined): string {
  const items = recommendation?.itemizedContributions ?? [];
  if (!recommendation || !recommendation.improved || items.length === 0) {
    return '<p style="font-size: 12px; color: #64748b;">현재 설정이 이미 최적입니다. 추가로 추천할 변경 사항이 없습니다.</p>';
  }
  return items
    .map((item) => {
      const sign = item.utilityDelta >= 0 ? '+' : '';
      const color = item.utilityDelta >= 0 ? '#10B981' : '#EF4444';
      return `
        <div style="display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-size: 12px;">
          <span>✓ ${item.label}</span>
          <span style="font-weight: 700; color: ${color}; white-space: nowrap; margin-left: 10px;">${sign}${item.utilityDelta.toFixed(1)} Utility</span>
        </div>
      `;
    })
    .join('');
}

export function renderExecutionRoadmapSection(roadmap: ExecutionRoadmap): string {
  const eventsHtml = roadmap.events
    .map((event) => {
      const itemsHtml = event.items
        .map(
          (item) => `
            <div style="margin-bottom: 2px;">
              <strong style="font-size: 12px; color: #0f172a;">${item.title}</strong>
              <span style="font-size: 11px; color: #64748b;"> — ${item.description}</span>
            </div>
          `
        )
        .join('');
      return `
        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
          <div style="width: 50px; flex-shrink: 0; font-size: 13px; font-weight: 700; color: #3b82f6;">${event.age}세</div>
          <div style="flex-grow: 1;">${itemsHtml}</div>
        </div>
      `;
    })
    .join('');
  return `
    ${eventsHtml}
    <div style="display: flex; gap: 10px; margin-top: 4px;">
      <div style="width: 50px; flex-shrink: 0; font-size: 13px; font-weight: 700; color: #94a3b8;">${roadmap.expectancy}세</div>
      <div style="flex-grow: 1; font-size: 12px; color: #94a3b8;">기대수명</div>
    </div>
  `;
}

export function renderSensitivityTableSection(scenarios: SensitivityScenario[]): string {
  if (scenarios.length === 0) return '';
  const rowsHtml = scenarios
    .map((s) => {
      const depletionText = s.depletionAge === null ? '평생 유지' : `${s.depletionAge}세`;
      return `
        <tr>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px;">${s.label}</td>
          <td style="border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; text-align: right;">${depletionText}</td>
        </tr>
      `;
    })
    .join('');
  return `
    <table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
      <thead>
        <tr>
          <th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">시나리오</th>
          <th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; background-color: #f1f5f9; font-size: 11px; font-weight: 700; color: #334155;">자산 고갈 나이</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/Pdf/pdfReportSections.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/web/features/Pdf/pdfReportSections.ts src/tests/web/features/Pdf/pdfReportSections.test.ts
git commit -m "feat: PDF 리포트 신규 섹션 4종 렌더러 추가"
```

---

## Task 2: 페이지 1/2에 리스크 알림 + itemized 체크리스트 배선

**Files:**
- Modify: `src/app/simulator/page.tsx`

**Interfaces:**
- Consumes: `renderRiskAlertsSection`, `renderItemizedChecklistSection` (Task 1), `computeRiskAlerts(result, params, cfg?)`(기존, `src/core/usecases/dashboard/computeRiskAlerts.ts`).
- Produces: 없음(페이지 번호 변경 없음 — Task 3가 이 파일을 이어서 수정).

**주의**: `handleDownload`는 자동화 테스트가 없는 함수다(html2canvas/jsPDF가 동적 import되고 실제 DOM/Canvas API에 의존하는 브라우저 전용 코드라 jsdom에서 실행 불가 — 이는 이 태스크 이전부터 존재하던 상태이며 이번 작업으로 새로 생기는 커버리지 공백이 아니다). 이 태스크의 검증은 `tsc --noEmit`(타입 체크)과 전체 테스트 스위트 회귀 확인까지이며, 실제 PDF 레이아웃 확인은 Task 4에서 사람이 브라우저로 직접 한다.

- [ ] **Step 1: 현재 파일 상태 확인**

Run: `grep -n "^import\|recommendationReasonsHtml\|AI 추천 전략 — \|2. 시뮬레이션 설정 상태" src/app/simulator/page.tsx`

아래 Step에서 설명하는 `old_string`들이 현재 파일에 그대로 존재하는지(Phase 2까지 이 파일이 수정되지 않았으므로 그대로일 것으로 예상됨) 확인한다. 다르면 실제 현재 내용에 맞춰 동일한 의도로 적용한다.

- [ ] **Step 2: import 추가**

`src/app/simulator/page.tsx`에서 아래 줄을 찾는다:

```ts
import { computeMonthlySpendingComposition } from '../../core/usecases/MonthlySpendingComposition';
```

바로 다음 줄에 추가:

```ts
import { computeRiskAlerts } from '../../core/usecases/dashboard/computeRiskAlerts';
import { renderRiskAlertsSection, renderItemizedChecklistSection } from '../../web/features/Pdf/pdfReportSections';
```

- [ ] **Step 3: 리스크 알림 / itemized 체크리스트 데이터 계산 추가**

`src/app/simulator/page.tsx`에서 아래 블록을 찾는다(`recommendationReasonsHtml` 정의):

```ts
      const recommendationReasonsHtml = recommendation
        ? recommendation.reasons.map(r => `<li style="margin-bottom: 4px;">${r}</li>`).join('')
        : '<li>AI 추천 전략 계산에 실패했습니다.</li>';
```

아래로 교체(이 필드는 더 이상 쓰이지 않으므로 제거하고, 새 데이터 계산으로 대체):

```ts
      const itemizedChecklistHtml = renderItemizedChecklistSection(recommendation);
```

그리고 같은 함수 안, `deltaRowsHtml` 정의가 끝나는 지점(`: ''\n        : '';` 다음 줄) 바로 뒤, `// Create a temporary container` 주석 바로 앞에 추가:

```ts
      const riskAlerts = computeRiskAlerts(result, activeParams);
      const riskAlertsSectionHtml = renderRiskAlertsSection(riskAlerts);
```

- [ ] **Step 4: 페이지 1에 리스크 알림 삽입**

아래 블록을 찾는다("종합 결과 요약" 카드가 끝나고 "2. 시뮬레이션 설정 상태" 섹션이 시작되는 지점):

```ts
                <div style="grid-column: span 2; font-size: 13.5px; padding-top: 8px;">
                  <span style="font-weight: 600; color: #475569;">사망 시(기대수명 ${userProfile.expectancy}세) 잔여 자산</span>
                  <span style="float: right; font-size: 16px; color: #3b82f6; font-weight: 700;">${formatValuePrint(endingAssets)}</span>
                </div>
              </div>
            </div>

            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 25px; margin-bottom: 10px;">2. 시뮬레이션 설정 상태</h2>
```

아래로 교체(카드 닫힘과 "2. 시뮬레이션 설정 상태" 사이에 `${riskAlertsSectionHtml}` 삽입):

```ts
                <div style="grid-column: span 2; font-size: 13.5px; padding-top: 8px;">
                  <span style="font-weight: 600; color: #475569;">사망 시(기대수명 ${userProfile.expectancy}세) 잔여 자산</span>
                  <span style="float: right; font-size: 16px; color: #3b82f6; font-weight: 700;">${formatValuePrint(endingAssets)}</span>
                </div>
              </div>
            </div>
            ${riskAlertsSectionHtml}

            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 25px; margin-bottom: 10px;">2. 시뮬레이션 설정 상태</h2>
```

- [ ] **Step 5: 페이지 2의 AI 추천 이유 목록을 itemized 체크리스트로 교체**

아래 블록을 찾는다:

```ts
            <h3 style="font-size: 13px; color: #0f172a; margin-bottom: 4px;">🤖 AI 추천 전략 — ${recommendationSummaryText}</h3>
            ${hasImprovement ? '<p style="font-size: 10px; color: #94a3b8; margin: 0 0 6px;">※ 아래 추천안은 시뮬레이션 결과이며 실제 설정에는 자동 반영되지 않습니다. 적용하려면 설정을 직접 변경하세요.</p>' : ''}
            <ul style="padding-left: 18px; margin-top: 6px; margin-bottom: 0; font-size: 12px; line-height: 1.6;">${recommendationReasonsHtml}</ul>
            ${deltaRowsHtml}
```

아래로 교체:

```ts
            <h3 style="font-size: 13px; color: #0f172a; margin-bottom: 4px;">🤖 AI 추천 전략 — ${recommendationSummaryText}</h3>
            ${hasImprovement ? '<p style="font-size: 10px; color: #94a3b8; margin: 0 0 6px;">※ 아래 추천안은 시뮬레이션 결과이며 실제 설정에는 자동 반영되지 않습니다. 적용하려면 설정을 직접 변경하세요.</p>' : ''}
            <div style="margin-top: 6px;">${itemizedChecklistHtml}</div>
            ${deltaRowsHtml}
```

- [ ] **Step 6: 타입 체크 및 회귀 테스트**

Run: `npx tsc --noEmit`
Expected: 에러 없음(특히 `recommendationReasonsHtml`을 참조하던 곳이 남아있지 않은지 — 위 Step 5에서 교체했으므로 미사용 변수 에러가 없어야 함)

Run: `npm test`
Expected: 전체 PASS, 실패 0건(이 파일은 기존에도 자동화 테스트가 없으므로 회귀 없음 확인 목적)

- [ ] **Step 7: 커밋**

```bash
git add src/app/simulator/page.tsx
git commit -m "feat: PDF 리포트에 리스크 알림과 itemized 추천 체크리스트 반영"
```

---

## Task 3: 실행 로드맵 + 민감도 분석용 새 페이지 2B 삽입 및 페이지 renumbering

**Files:**
- Modify: `src/app/simulator/page.tsx`

**Interfaces:**
- Consumes: `renderExecutionRoadmapSection`, `renderSensitivityTableSection` (Task 1), `computeExecutionRoadmap(params, recommendation)`(기존, `src/core/usecases/dashboard/computeExecutionRoadmap.ts`), `computeSensitivityAnalysis(params, baselineResult, engine)`(기존, `src/core/usecases/dashboard/computeSensitivityAnalysis.ts`), `engine`(컴포넌트 최상단 `const [engine] = useState(() => new SimulationEngine())`로 이미 존재하는 인스턴스, `handleDownload`와 같은 클로저 안이라 별도 전달 불필요).
- Produces: 없음(최종 배선 — 다른 태스크가 이 파일을 소비하지 않음).

**중요**: 이 태스크는 페이지를 1개 추가하므로 기존 페이지 3("연금 및 자산 현황") 이후 모든 페이지 번호(`페이지 N`)와 문서 섹션 번호("N. 제목")를 +1 renumbering해야 한다. 아래 Step들을 순서대로, 빠짐없이 적용한다 — 하나라도 빠지면 PDF 푸터의 페이지 번호가 실제 페이지와 어긋난다.

- [ ] **Step 1: 현재 파일 상태 확인**

Run: `grep -n "^import\|4\. 연금 및 자산 현황\|5\. 세금 설정\|6\. 연령별\|7\. 은퇴 후\|페이지 [0-9]* /\|const pageNum\|const totalPages" src/app/simulator/page.tsx`

Task 2가 완료된 이후의 파일 기준으로 아래 old_string들이 그대로 존재하는지 확인한다.

- [ ] **Step 2: import 확장**

Task 2에서 추가한 아래 import 줄을 찾는다:

```ts
import { renderRiskAlertsSection, renderItemizedChecklistSection } from '../../web/features/Pdf/pdfReportSections';
```

아래로 교체(같은 모듈에서 2개 더 가져오도록 확장):

```ts
import { renderRiskAlertsSection, renderItemizedChecklistSection, renderExecutionRoadmapSection, renderSensitivityTableSection } from '../../web/features/Pdf/pdfReportSections';
```

그리고 `import { computeRiskAlerts } from '../../core/usecases/dashboard/computeRiskAlerts';` 바로 다음 줄에 추가:

```ts
import { computeExecutionRoadmap } from '../../core/usecases/dashboard/computeExecutionRoadmap';
import { computeSensitivityAnalysis } from '../../core/usecases/dashboard/computeSensitivityAnalysis';
```

- [ ] **Step 3: 실행 로드맵 / 민감도 분석 데이터 계산 추가**

Task 2에서 추가한 아래 블록을 찾는다:

```ts
      const riskAlerts = computeRiskAlerts(result, activeParams);
      const riskAlertsSectionHtml = renderRiskAlertsSection(riskAlerts);
```

아래로 교체:

```ts
      const riskAlerts = computeRiskAlerts(result, activeParams);
      const riskAlertsSectionHtml = renderRiskAlertsSection(riskAlerts);
      const roadmap = computeExecutionRoadmap(activeParams, recommendation);
      const executionRoadmapSectionHtml = renderExecutionRoadmapSection(roadmap);
      const sensitivityScenarios = computeSensitivityAnalysis(activeParams, result, engine);
      const sensitivityTableSectionHtml = renderSensitivityTableSection(sensitivityScenarios);
```

- [ ] **Step 4: 새 페이지 2B 삽입**

아래 블록을 찾는다(페이지 2의 끝과 "4. 연금 및 자산 현황" 페이지의 시작 사이):

```ts
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 2 / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">4. 연금 및 자산 현황</h2>
```

아래로 교체(페이지 2 종료 직후, 새 페이지 2B를 통째로 삽입):

```ts
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 2 / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">4. 실행 로드맵 및 민감도 분석</h2>
            <p style="font-size: 11px; color: #64748b; margin-top: 0; margin-bottom: 14px;">AI 추천 전략(또는 현재 설정) 기준으로 나이별 실행 시점과, 핵심 가정이 바뀌었을 때 결과가 얼마나 민감한지를 보여줍니다.</p>

            <h3 style="font-size: 13px; color: #0f172a; margin-bottom: 8px;">실행 로드맵</h3>
            ${executionRoadmapSectionHtml}

            <h3 style="font-size: 13px; color: #0f172a; margin-top: 20px; margin-bottom: 8px;">민감도 분석 (자산 고갈 나이 기준)</h3>
            ${sensitivityTableSectionHtml}
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 3 / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">5. 연금 및 자산 현황</h2>
```

- [ ] **Step 5: 이후 페이지 번호/섹션 번호 renumbering (6곳)**

Step 4를 적용하면 파일에 `페이지 3 / {total_pages}`가 2곳 생긴다(방금 삽입한 페이지 2B의 푸터 — 이미 최종 형태로 작성됨, 그리고 "5. 연금 및 자산 현황" 페이지의 기존 푸터 — 아직 `페이지 4`로 바뀌지 않음). 아래 5-A는 후자만 정확히 가리키도록 "기타 소득" 목록이 닫히는 지점까지 문맥을 포함한다.

**5-A.** 아래 블록을 찾는다("기타 소득" 항목이 닫히고 "연금 및 자산 현황" 페이지가 끝나는 지점):

```
      pagesHtml += `
                </ul>
              </div>
            </div>
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 3 / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
```

아래로 교체:

```
      pagesHtml += `
                </ul>
              </div>
            </div>
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 4 / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
```

**5-B.** 아래 문자열을 찾는다(파일 내 고유):

```
5. 세금 설정</h2>
```

아래로 교체:

```
6. 세금 설정</h2>
```

**5-C.** 주의: 5-A를 적용하고 나면 `페이지 4 / {total_pages}`가 파일에 2곳(방금 5-A에서 바꾼 연금자산 페이지, 그리고 세금 설정 페이지 원본) 존재하게 된다. 아래는 "사적연금 저율과세 한도 내 인출" 항목이 닫히는 지점까지 포함해 세금 설정 페이지의 것만 가리키는 old_string이다:

```
              <li style="margin-bottom: 6px;"><strong>사적연금 저율과세 한도 내 인출:</strong> ${currentTaxSettings.limitPrivatePensionToTaxLimit ? '한도 내 인출 (절세 최적화)' : '기본 인출 (일반 인출 계획)'}</li>
            </ul>
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 4 / {total_pages}</span>
          </div>
        </div>
```

아래로 교체:

```
              <li style="margin-bottom: 6px;"><strong>사적연금 저율과세 한도 내 인출:</strong> ${currentTaxSettings.limitPrivatePensionToTaxLimit ? '한도 내 인출 (절세 최적화)' : '기본 인출 (일반 인출 계획)'}</li>
            </ul>
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 5 / {total_pages}</span>
          </div>
        </div>
```

**5-D.** 아래 문자열을 찾는다(파일 내 고유):

```
        const pageNum = chunkIdx + 5;
```

아래로 교체:

```
        const pageNum = chunkIdx + 6;
```

**5-E.** 아래 문자열을 찾는다(파일 내 고유):

```
                6. 연령별 소득원 및 자산 추이 (페이지 ${chunkIdx + 1})
```

아래로 교체:

```
                7. 연령별 소득원 및 자산 추이 (페이지 ${chunkIdx + 1})
```

**5-F.** 아래 문자열을 찾는다(파일 내 고유):

```
        const pageNum = chunks.length + 5 + chunkIdx;
```

아래로 교체:

```
        const pageNum = chunks.length + 6 + chunkIdx;
```

**5-G.** 아래 문자열을 찾는다(파일 내 고유):

```
                7. 은퇴 후 월 생활비 재원 구성 (페이지 ${chunkIdx + 1})
```

아래로 교체:

```
                8. 은퇴 후 월 생활비 재원 구성 (페이지 ${chunkIdx + 1})
```

**5-H.** 아래 문자열을 찾는다(파일 내 고유):

```
      const totalPages = 4 + chunks.length + spendingChunks.length;
```

아래로 교체:

```
      const totalPages = 5 + chunks.length + spendingChunks.length;
```

위 코드 블록들의 들여쓰기는 실제 파일의 들여쓰기 그대로다 — Edit 도구의 `old_string`/`new_string`에 그대로 사용한다(마크다운 표시상의 추가 들여쓰기 없음).

- [ ] **Step 6: 전체 페이지/섹션 번호 검증**

Run: `grep -n "페이지 [0-9]* / {total_pages}\|^\s*[0-9]\. [가-힣]" src/app/simulator/page.tsx`

Expected 출력에서 순서대로 다음이 모두 확인되어야 한다:
- 섹션 번호: `1. 종합 결과 요약`, `2. 시뮬레이션 설정 상태`, `3. Lifetime Utility Score`, `4. 실행 로드맵 및 민감도 분석`, `5. 연금 및 자산 현황`, `6. 세금 설정`, `7. 연령별 소득원 및 자산 추이`, `8. 은퇴 후 월 생활비 재원 구성`
- 고정 푸터: `페이지 1`, `페이지 2`, `페이지 3`(신규), `페이지 4`, `페이지 5`

- [ ] **Step 7: 타입 체크 및 회귀 테스트**

Run: `npx tsc --noEmit`
Expected: 에러 없음

Run: `npm test`
Expected: 전체 PASS, 실패 0건

- [ ] **Step 8: 커밋**

```bash
git add src/app/simulator/page.tsx
git commit -m "feat: PDF 리포트에 실행 로드맵/민감도 분석 페이지 추가 및 페이지 번호 재정렬"
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

- [ ] **Step 5: PDF 시각적 확인 (필수 — 자동화 불가능)**

이 단계는 자동화된 테스트로 대체할 수 없다. html2canvas/jsPDF는 실제 브라우저 렌더링/Canvas API에 의존하므로 jsdom에서 검증할 수 없다. `npm run dev`로 접속해 시뮬레이터 화면에서 "결과 다운로드" 버튼을 눌러 PDF를 생성하고 직접 열어, 다음을 확인한다:
- 총 페이지 수와 각 페이지 하단 "페이지 N / 총 M" 표기가 실제 페이지 순서와 일치하는지
- 새 "4. 실행 로드맵 및 민감도 분석" 페이지가 온전히 한 페이지 안에 들어가는지(글자가 페이지 하단에서 잘리거나 넘치지 않는지) — 리스크 알림/사적연금/투자자산 등이 많은 시나리오(여러 자산·연금 계좌 등록)로도 한 번 확인
- 페이지 1의 리스크 알림 섹션이 "종합 결과 요약" 카드 아래, "2. 시뮬레이션 설정 상태" 위에 올바르게 위치하고 페이지 넘침이 없는지
- 리스크 알림이 0건인 시나리오에서는 해당 섹션이 아예 나타나지 않는지
- 페이지 2의 "AI 추천 전략" 항목이 itemized 체크리스트(+/-Utility 포함)로 보이는지, `improved: false` 시나리오에서는 "현재 설정이 이미 최적입니다" 문구가 보이는지
