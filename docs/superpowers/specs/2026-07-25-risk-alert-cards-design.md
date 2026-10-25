# 리스크 알림 카드 (Phase 2 — 1/5) 설계

## Context

결과 화면 IA 재구조화(Phase 1)를 진행하면서 "리스크 알림: 건강보험료 증가, 금융소득종합과세 진입
가능성, 세금 급증 구간 등을 별도 경고 카드로 표시"라는 요구사항을 Phase 2로 명시적으로 미뤄뒀다.
현재 이 세 가지 리스크는 `ExpertDetailsPanel`의 "연금 구성 및 리스크" 섹션 안에 평범한 텍스트
목록(`<li>`)으로만 존재하고, 기본적으로 닫혀 있는 Collapse 패널 안에 있어 사용자가 놓치기 쉽다.
Phase 2 전체(민감도 분석/실행 로드맵/PDF 동기화/입력 패널 재설계)를 한 번에 다루기엔 범위가 커서,
이미 계산된 데이터를 재사용할 수 있어 가장 작고 빠르게 가치를 낼 수 있는 이 항목부터 착수한다.

목표: 사용자가 결과 화면 상단 KPI를 본 직후, 스크롤 없이 바로 "내가 주의해야 할 위험이 있는가"를
알 수 있게 만든다.

## 범위

이번 스펙은 리스크 알림 카드 3종(건강보험료 증가 구간 / 금융소득종합과세 진입 가능성 / 사적연금
저율과세 한도 초과로 인한 세금 급증 구간)만 다룬다. 민감도 분석, 실행 로드맵, PDF 동기화, 입력
패널 재설계는 별도 스펙으로 이후 진행한다.

## 데이터 계산: `computeRiskAlerts`

새 usecase 함수 `src/core/usecases/dashboard/computeRiskAlerts.ts`:

```ts
export interface RiskAlert {
  key: 'comprehensiveTax' | 'privatePensionLimit' | 'healthInsurance';
  title: string;
  message: string; // 구체적 연령대/금액 포함
}

export function computeRiskAlerts(
  result: SimulationResult,
  params: SimulationParams,
  cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG
): RiskAlert[]
```

세 리스크 모두 이미 `computeExpertAnalytics.ts`/`generateChartCaptions.ts`에 있는 boolean 판정
로직(`everComprehensiveTax`, `hasHighPrivatePensionRisk`)과 동일한 조건식을 재사용하되, 이번에는
"해당 조건이 true인 첫 연속 구간(start~end age)"까지 계산해서 메시지에 포함한다.

- **금융소득종합과세 진입 가능성**: `hasTaxWarning`이 true인 첫 연도. 메시지: `"{첫연도}세 이후
  배당·이자소득이 연 2,000만원을 초과하는 해가 있습니다."` (2,000만원은 기존 IncomeCompositionChart
  캡션과 동일한 고정 임계값 문구를 재사용).
- **사적연금 저율과세 한도 초과(세금 급증 구간)**: `privatePensionIncome + pensionTaxPaid >
  privatePensionLimit`인 첫 연속 구간 `[start, end]`. 메시지: `"{start}~{end}세 구간, 사적연금이
  저율과세 한도(연 {formatManwon(privatePensionLimit)})를 초과해 세금 부담이 늘어납니다."`
- **건강보험료 증가 구간**: `healthInsurancePaid / totalIncome ≥ cfg.healthInsuranceCeiling`(기본
  0.05)인 첫 연속 구간. `totalIncome`이 0 이하인 해는 비율 계산에서 제외(0으로 나누기 방지, 해당
  연도는 조건 불충족으로 취급). 메시지: `"{start}~{end}세 구간, 건강보험료가 소득의
  {ceiling*100}%를 초과합니다."`
  - **주의**: `UtilityEngine.ts`(146-149행)는 이 동일한 `healthInsuranceCeiling` 값을 **은퇴 전체
    기간 합산** 비율(`healthInsuranceTotal / totalIncomeAll`)에 적용해 taxationRisk 컴포넌트
    점수를 매긴다. 이 카드는 "몇 세부터 몇 세까지"라는 요구사항을 만족시키기 위해 **동일한
    임계값을 연도별로** 적용한다 — 즉 임계값(0.05)은 재사용하지만 집계 단위(연도별 vs 전체 합산)는
    다르다. 그 결과 이론상 "카드는 위험 구간을 보여주는데 Utility 점수의 taxationRisk는 만점"인
    경우가 있을 수 있다(개별 연도는 넘지만 전체 평균은 넘지 않는 경우). 이는 의도된 차이이며 버그가
    아니라는 점을 코드 주석에도 남긴다.

세 조건 모두 해당 사항이 없으면 배열에서 제외된다(0~3개 반환). 반환 순서는 **가장 이른 시작
연령 순**으로 정렬해 더 급한 리스크를 먼저 보여준다.

연속 구간 탐색은 작은 내부 헬퍼(`findFirstContiguousRange(yearlyResults, predicate)`)로 분리해
세 리스크가 로직을 공유한다.

## 컴포넌트: `RiskAlertCards`

`src/web/features/Dashboard/risk/RiskAlertCards.tsx` (신규, Tailwind 사용):

```tsx
interface RiskAlertCardsProps {
  alerts: RiskAlert[];
}
export function RiskAlertCards({ alerts }: RiskAlertCardsProps)
```

- `alerts.length === 0`이면 `null` 반환(섹션 자체가 사라짐).
- 각 카드는 `⚠️` 아이콘 + `title`(강조) + `message`(본문), danger 색상 계열(`border-danger`,
  `text-danger` — Phase 1에서 `@theme`로 이미 매핑된 토큰) 사용.
- 카드가 여러 개면 세로로 쌓는다(반응형 그리드까지는 필요 없음 — 최대 3개, 각 카드가 문장형
  메시지라 가로 배치보다 세로가 가독성이 좋음).

## 배치: `DashboardSection.tsx`

```
Header
 ↓
AiSummaryHero
 ↓
CoreKpiGrid
 ↓
SecondaryKpiCollapse
 ↓
RiskAlertCards          ← 신규 삽입 위치
 ↓
RecommendationChecklist
 ↓
차트 3종
 ↓
ExpertDetailsPanel
```

`computeRiskAlerts(displayedResult, params)`를 호출한다 — `displayedResult`는 Phase 1에서 이미
Before/After 토글에 따라 `result` 또는 `recommendation.recommendedResult`로 바뀌는 값이므로,
**추천 전략을 적용했을 때 리스크가 사라지는지 자동으로 반영**된다(추가 배선 불필요).

## `ExpertDetailsPanel` 정리

"연금 구성 및 리스크" 섹션의 `<li>` 중 이번에 카드로 승격되는 2개 항목(금융소득종합과세 경고,
사적연금 한도초과 경고)은 카드와 중복되므로 제거한다. 카드로 승격되지 않는 항목(국민연금 개시
나이 안내 문장, 배당소득 비중 안내)은 그대로 유지한다. `computeExpertAnalytics`의
`everComprehensiveTax`/`hasHighPrivatePensionRisk` 필드 자체는 그대로 두되(다른 소비처가 없는지
확인 후 필요 시 제거), `ExpertDetailsPanel`의 렌더링에서만 뺀다.

## 테스트 전략

- `computeRiskAlerts.test.ts`: 3개 리스크 각각 단독 발생 케이스, 복합 발생 시 정렬 순서, 0개
  케이스, 경계값(정확히 ceiling과 같을 때), `totalIncome=0`인 해를 제외하는지.
- `RiskAlertCards.test.tsx`: 0개면 아무것도 렌더링 안 함, 1~3개일 때 각각 title/message 렌더링.
- `DashboardSection.test.tsx`: After 모드 전환 시 리스크 알림이 사라지거나 바뀌는 회귀 테스트
  추가(추천 전략 적용 시나리오).

## 검증 방법

`npm test`(신규 테스트 포함 전체 통과), `npx tsc --noEmit`, `npm run build`. 리스크 3종이 모두
발생하는 시나리오와 0개인 시나리오를 각각 브라우저(또는 테스트)에서 확인.
