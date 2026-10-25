# PDF 리포트 디자인 동기화 설계

## Context

Phase 2 백로그의 마지막 항목. 결과 화면(Phase 1 IA)과 리스크 알림 카드(Phase 2-1), 입력 패널 재설계(Phase 2-2), 민감도 분석(Phase 2-3), 실행 로드맵(Phase 2-4) 이후, `src/app/simulator/page.tsx`의 PDF 리포트 생성 로직(`handleDownload`, 약 490줄)이 Phase 1/2 이전(Phase 3-A 시점)의 구 UI 기준으로 만들어져 있어 화면과 크게 어긋나 있다.

## 조사 결과 요약

- PDF는 화면 DOM을 캡처하는 것이 아니라, `handleDownload` 내부에서 완전히 별도로 조립하는 숨겨진 HTML 문자열(`position: absolute; left: -9999px`)을 html2canvas로 캡처 → jsPDF로 페이지를 나눠 붙인다.
- Phase 1(`d839889`, 결과 화면 IA 재구조화)과 Phase 2(민감도 분석/실행 로드맵 등)는 `page.tsx`를 전혀 건드리지 않았다 — PDF 로직은 그 이전 상태(Phase 3-A, "Lifetime Utility Score 통합" 커밋)에 멈춰 있다.
- `StrategyRecommendation.itemizedContributions`/`recommendedResult`(Phase 1에서 추가)는 PDF 코드에서 전혀 참조되지 않는다(grep 매치 0건).
- 화면의 Phase 1/2 신규 기능(리스크 알림 카드/추천 체크리스트의 itemizedContributions/실행 로드맵/민감도 분석/Before-After 토글/AI 조언 텍스트)은 PDF에 하나도 없다.
- 반대로 PDF에만 있는 유용한 정보도 많다: 시뮬레이션 설정 텍스트 요약, 연금·자산·ISA·기타소득 항목별 상세 리스트, 세금 설정 상세, 연령별 소득원·자산 추이 표(30행/페이지 청크), 월 생활비 재원 구성 표, 법적 면책 고지.

## 확정 사항 (브레인스토밍 결과)

- **범위: 콘텐츠 동기화** — PDF에만 있던 기존 유용한 정보(설정 요약/연금자산상세/세금설정/연령별표/생활비표/법적고지)는 그대로 유지한다. 화면의 Phase 1~2 신규 개념 4가지(리스크 알림, itemizedContributions 체크리스트, 실행 로드맵, 민감도 분석)를 PDF에 추가한다. Hero 카드/별점/진행 애니메이션 같은 화면 전용 시각 요소를 PDF에 그대로 재현하려는 시도는 하지 않는다. CSS는 색상/톤 정도만 화면과 맞추는 경량 조정에 그친다.
- **민감도 분석 포함**: 6개 시나리오를 가로 막대가 아닌 간단한 표(시나리오명 | 자산고갈나이)로 축약해 포함한다.
- **AI 추천 이유 교체**: 기존 `recommendation.reasons`(문장 리스트) 대신 `recommendation.itemizedContributions`(항목별 utilityDelta 포함) 체크리스트로 교체한다. `improved: false`이거나 `itemizedContributions`가 빈 배열이면 기존과 동일하게 "현재 설정이 이미 최적입니다" 류 문구로 폴백한다.

## 1. 핵심 발견: 새 usecase가 필요 없다

리스크 알림(`computeRiskAlerts`), 실행 로드맵(`computeExecutionRoadmap`), 민감도 분석(`computeSensitivityAnalysis`)은 이미 Phase 2에서 순수 함수 usecase로 구현되어 있다. `itemizedContributions`도 `StrategyRecommendation` 타입에 이미 존재한다. 이번 작업은 새 비즈니스 로직을 만드는 것이 아니라, **기존 Phase 2 usecase 4개를 PDF 생성 코드에 연결하고 그 결과를 HTML 문자열로 렌더링하는 배선 작업**이다.

```ts
// page.tsx의 handleDownload 내부에서 (engine 인스턴스는 이미 useState로 존재)
const riskAlerts = computeRiskAlerts(result, activeParams);
const roadmap = computeExecutionRoadmap(activeParams, recommendation);
const sensitivityScenarios = computeSensitivityAnalysis(activeParams, result, engine);
```

## 2. 아키텍처: PDF 섹션 렌더러 추출

파일: `src/web/features/Pdf/pdfReportSections.ts` (신규)

신규 섹션 4개의 "데이터 → HTML 문자열" 변환만 순수 함수로 추출해 단위 테스트를 붙인다:

```ts
export function renderRiskAlertsSection(alerts: RiskAlert[]): string;
export function renderItemizedChecklistSection(recommendation: StrategyRecommendation | undefined): string;
export function renderExecutionRoadmapSection(roadmap: ExecutionRoadmap): string;
export function renderSensitivityTableSection(scenarios: SensitivityScenario[]): string;
```

- 각 함수는 해당 데이터가 비어 있으면(`alerts.length === 0` 등) 빈 문자열을 반환해 그 섹션 자체가 PDF에 나타나지 않는다(화면의 `RiskAlertCards`가 0개면 렌더링하지 않는 것과 동일한 관례).
- `renderItemizedChecklistSection`은 `recommendation`이 `undefined`이거나 `itemizedContributions`가 빈 배열이면 "현재 설정이 이미 최적입니다" 류 폴백 문구를 반환한다.
- HTML 문자열을 반환하는 이유는 기존 490줄짜리 `handleDownload`가 템플릿 리터럴로 전체 `pagesHtml`을 조립하는 기존 패턴과 일관성을 유지하기 위함이다 — 새 섹션만 별도 컴포넌트/렌더러 체계를 도입하지 않는다.
- 기존에 이미 동작 중인 나머지 로직(설정 요약/연금자산/세금/연령별 표/생활비표/페이지 분할/jsPDF 호출부)은 건드리지 않는다 — 관련 없는 리팩터링을 벌이지 않는다.

## 3. 배치 순서 (화면 순서를 따름)

- **페이지 1**(종합 결과 요약) 바로 아래에 `renderRiskAlertsSection` 콜아웃 추가 — 화면에서 KPI 다음에 `RiskAlertCards`가 오는 순서와 동일.
- **페이지 2**(Utility Score & AI 추천 전략):
  - 기존 "AI 추천 이유"(`reasons` 문장 리스트) 블록을 `renderItemizedChecklistSection` 결과로 교체.
  - 그 아래 `renderExecutionRoadmapSection` 추가 — 화면에서 체크리스트 다음에 `ExecutionRoadmap`이 오는 순서와 동일.
  - 그 아래 `renderSensitivityTableSection` 추가.
  - 기존 Before/After 델타(4개 숫자) 블록은 위치·내용 변경 없이 유지.
- 페이지 3 이후(연금자산현황/세금설정/연령별표/생활비구성표)는 순서·내용 변경 없음(페이지 번호만 뒤로 밀릴 수 있음).

**구현 시 확인 필요**: `.pdf-page`가 고정 높이 캔버스인지 콘텐츠에 맞춰 늘어나는지에 따라 페이지 2에 4개 신규 섹션을 전부 넣을 수 있는지, 아니면 새 페이지(예: "페이지 2-B")로 분리해야 하는지가 갈린다. 플랜 작성 단계에서 실제 `.pdf-page`/`.pdf-content` CSS와 html2canvas 캡처 로직(`page.tsx` 273~308줄 및 656~675줄 부근)을 읽고 결정한다. 페이지가 넘치면 잘리는 것보다 페이지를 분리하는 쪽을 기본값으로 한다.

## 4. 테스트 전략

- `pdfReportSections.ts`의 4개 함수는 순수 문자열 반환 함수이므로 일반 vitest로 단위 테스트한다: 빈 배열/폴백 케이스, 여러 항목 렌더, 특수문자 이스케이프(HTML 인젝션 방지 — 사용자 입력이 직접 섞이는 필드는 없지만 방어적으로 확인).
- **html2canvas/jsPDF를 통한 실제 PDF 렌더링(페이지 분할, 레이아웃 오버플로 여부)은 jsdom에서 검증 불가능한 영역이다.** `npm run dev`로 실제 브라우저에서 "결과 다운로드" 버튼을 눌러 생성된 PDF를 열어 보는 수동 확인이 필수이며, 자동화된 테스트로 대체할 수 없다. 이 검증은 구현 계획의 마지막 단계로 명시한다.

## Critical Files

- `src/web/features/Pdf/pdfReportSections.ts` (신규) — 4개 섹션 렌더러
- `src/app/simulator/page.tsx` (수정 — `handleDownload` 내부에 기존 usecase 4개 호출 + 새 렌더러 호출 + `pagesHtml` 조립부에 삽입)
- `src/core/usecases/dashboard/computeRiskAlerts.ts` / `computeExecutionRoadmap.ts` / `computeSensitivityAnalysis.ts` (참고 — 기존 Phase 2 usecase, 수정 없이 재사용)
- `src/core/entities/types.ts`의 `StrategyRecommendation.itemizedContributions` (참고 — 기존 필드, 수정 없이 재사용)

## 범위 밖

- Hero 카드, 별점(`RetirementLikelihoodStars`), Before/After 토글 UI, AI 어드바이저(LLM) 조언 텍스트를 PDF에 재현하는 것은 범위 밖이다 — PDF는 정적 스냅샷이라 토글 개념 자체가 맞지 않고, LLM 텍스트는 재현 가치 대비 복잡도가 높다.
- 기존 PDF 페이지(설정 요약/연금자산상세/세금설정/연령별표/생활비표/법적고지)의 시각적 재설계는 범위 밖이다 — 콘텐츠는 유지, 색상 톤 경량 조정만 한다.
- `handleDownload`의 490줄 전체를 별도 모듈로 리팩터링하는 것은 범위 밖이다 — 이번에 추가하는 신규 섹션 4개의 렌더러만 추출한다.
