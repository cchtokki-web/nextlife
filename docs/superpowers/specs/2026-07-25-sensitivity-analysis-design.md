# 민감도 분석 (Sensitivity Analysis) 설계

## Context

Phase 2 백로그의 세 번째 항목(원 백로그 순서상 두 번째). 결과 화면(Phase 1 IA)과 리스크 알림 카드(Phase 2-1), 입력 패널 재설계(Phase 2-2) 위에 이어서, 사용자가 핵심 가정(투자수익률, 물가상승률, 은퇴시점)을 살짝 바꿨을 때 결과가 얼마나 민감하게 변하는지 보여줌으로써 "이 계획이 얼마나 견고한가"에 대한 신뢰를 준다.

## 확정 사항 (브레인스토밍 결과)

- **비교 지표**: 자산 고갈 나이(depletionAge) 단일 지표. `null`(고갈 없음)은 "평생 유지"로 표시.
- **시나리오**: 투자수익률 ±2%p, 물가상승률 ±1%p, 은퇴시점 ±3년 — 총 6개.
- **표시 형식**: 가로 막대 목록(recharts 미사용, 순수 div 기반).
- **배치**: `ExpertDetailsPanel` 내부(기본 접힘 Collapse 안), 세금/건보료 상세 섹션과 나란히.

## 1. 데이터 계산: `computeSensitivityAnalysis` (신규 usecase)

파일: `src/core/usecases/dashboard/computeSensitivityAnalysis.ts`

`computeRiskAlerts.ts`와 동일한 "순수 함수 usecase" 패턴을 따르되, 시뮬레이션 재실행이 필요하므로 `SimulationEngine` 인스턴스를 인자로 받는다(`RecommendationEngine.evaluateCandidate`가 `engine.runForUtility()`를 재사용하는 것과 동일 패턴).

```ts
export interface SensitivityScenario {
  key: 'returnDown' | 'returnUp' | 'inflationUp' | 'inflationDown' | 'retirementEarlier' | 'retirementLater';
  label: string;                // 예: "투자수익률 -2%p"
  depletionAge: number | null;  // null = 기대수명까지 고갈 없음("평생 유지")
  deltaYears: number | null;    // baseline 대비 차이. baseline과 시나리오 둘 다 null이면 null(=변화 없음)
}

export function computeSensitivityAnalysis(
  params: SimulationParams,
  baselineResult: SimulationResult,
  engine: SimulationEngine,
): SensitivityScenario[]
```

### 시나리오별 파라미터 변형

각 시나리오는 `params`를 얕은 복사(override)한 뒤 재실행한다.

| key | 변경 필드 | 방향 |
|---|---|---|
| `returnDown` / `returnUp` | `assets[].annualGrowthRate`, `privatePensions[].annualReturn`, `isaAccounts[].annualReturn` 전부 동일하게 | -2 / +2 |
| `inflationUp` / `inflationDown` | `inflationRate` | +1 / -1 |
| `retirementEarlier` | `userProfile.retirementAge` | -3, 단 `currentAge + 1` 미만으로 내려가지 않도록 `Math.max(params.userProfile.currentAge + 1, retirementAge - 3)`로 clamp |
| `retirementLater` | `userProfile.retirementAge` | +3, 단 `expectancy - 1`을 넘지 않도록 `Math.min(params.userProfile.expectancy - 1, retirementAge + 3)`로 clamp |

투자수익률 시나리오는 "시장 전체가 함께 움직인다"는 경제적 가정 하에 자산/사적연금/ISA 수익률을 모두 동일 폭으로 이동시킨다 — `applyYieldPreset`(입력 패널 재설계에서 추출한 공유 함수)이 프리셋 적용 시 자산/연금에 동일 수익률을 일괄 적용하는 기존 관례와 일치한다. 단 `applyYieldPreset`처럼 값을 특정 상수로 "설정"하는 것이 아니라 기존 값에 델타를 "가산"한다는 점이 다르다.

### 실행 및 실패 격리

각 시나리오는 `engine.runForUtility(modifiedParams)`(이진탐색 없는 경량 버전)로 재실행하고 개별 `try/catch`로 감싼다. 한 시나리오가 예외를 던지면 해당 시나리오는 배열에서 제외하고 나머지는 정상 반환한다(`RecommendationEngine`이 후보별 실패를 격리하는 것과 동일 원칙).

### 정렬

`RiskAlertCards`의 관례를 따라, **가장 위험한(고갈이 가장 빨라지는) 시나리오가 먼저 오도록** 정렬한다. 정렬 키:
- `depletionAge`가 있는 시나리오끼리는 오름차순(빨리 고갈될수록 먼저)
- `depletionAge === null`(평생 유지)인 시나리오는 항상 뒤로

### 성능

`RecommendationEngine`의 성능 회귀 테스트가 864개 후보를 5초 이내로 처리함을 검증하고 있으므로(약 5.8ms/후보), 6개 시나리오 추가 실행은 약 35ms 내외로 무시 가능한 비용이다. 별도의 지연 로딩(lazy evaluation)은 두지 않는다.

## 2. UI: `SensitivityAnalysisSection` (신규 컴포넌트)

파일: `src/web/features/Dashboard/expert/SensitivityAnalysisSection.tsx`

```ts
interface SensitivityAnalysisSectionProps {
  baselineDepletionAge: number | null;
  scenarios: SensitivityScenario[];
}
```

- 이미 `ExpertDetailsPanel`의 `Collapse` 내부(펼쳤을 때만 보이는 영역)이므로 추가 접힘 없이 6개 행을 바로 렌더링한다.
- 각 행: `label` + 가로 막대(길이 = `|deltaYears|`에 비례, 최대값 기준 정규화) + 우측 결과 텍스트(`"82세 (-8년)"` 또는 `"평생 유지"`).
- 막대 색상: `deltaYears < 0`(더 빨리 고갈, 악화)이면 `bg-danger` 계열, `deltaYears > 0`(더 오래 유지, 개선)이면 `bg-success` 계열, `deltaYears === null`(둘 다 평생 유지, 변화 없음)이면 중립색.
- `baselineDepletionAge`는 상단에 "현재 설정 기준: OO세 / 평생 유지"로 1줄 표시해 막대들의 기준점을 명시한다.
- Recharts는 사용하지 않는다(6개 고정 항목에 대한 상대 비교이므로 단순 `div` 너비로 충분 — `AiSummaryHero`의 칩/막대류와 동일한 경량 구현 방향).

## 3. 연결 지점

`ExpertDetailsPanel.tsx` 수정:

```ts
import { SimulationEngine } from '../../../../core/usecases/SimulationEngine';
import { computeSensitivityAnalysis } from '../../../../core/usecases/dashboard/computeSensitivityAnalysis';
import { SensitivityAnalysisSection } from './SensitivityAnalysisSection';

// 컴포넌트 내부
const engine = React.useMemo(() => new SimulationEngine(), []);
const sensitivityScenarios = React.useMemo(
  () => computeSensitivityAnalysis(params, result, engine),
  [params, result, engine],
);
```

- `SimulationEngine`은 이 패널이 로컬로 생성한다(`computeExpertAnalytics`처럼 이 패널이 자기 계산을 스스로 책임지는 기존 관례 유지 — page.tsx의 엔진 인스턴스를 prop으로 끌어올 필요 없음).
- `result`/`params`는 `ExpertDetailsPanel`이 이미 받는 prop을 그대로 사용한다. `DashboardSection`이 `displayedResult`/보정된 `params`를 넘기므로, Before/After 토글 시 민감도 분석도 자동으로 토글된 시나리오 기준으로 재계산된다 — 별도 배선이 필요 없다.
- `useMemo` 의존성을 `[params, result, engine]`로 제한해, `hiddenKeys`(차트 범례 토글) 같은 무관한 상태 변경으로 인한 `ExpertDetailsPanel` 리렌더 시 불필요하게 6회 재계산되지 않도록 한다.
- 렌더 위치: "세금 및 건강보험료" 섹션과 "연금 구성 및 리스크" 섹션 사이(또는 그 아래) — 전문가용 상세 분석의 다른 섹션들과 동일한 `<section>` 블록 패턴을 따른다.

## 4. 테스트 전략

- **`computeSensitivityAnalysis.test.ts`** (`src/tests/core/usecases/dashboard/`):
  - 각 시나리오의 override 파라미터가 정확한지 — 모킹된 `engine.runForUtility`가 받은 인자를 검증(수익률 시나리오가 assets/privatePensions/isaAccounts 전부에 델타를 적용하는지, 물가상승률/은퇴시점 시나리오가 해당 필드만 바꾸는지)
  - `retirementEarlier`가 `currentAge + 1` 미만으로 내려가지 않도록 clamp되는지 (예: `currentAge=58, retirementAge=60`일 때 `retirementAge - 3 = 57 < 59`이므로 `59`로 clamp)
  - `retirementLater`가 `expectancy - 1`을 넘지 않도록 clamp되는지 (예: `retirementAge=88, expectancy=90`일 때 `retirementAge + 3 = 91 > 89`이므로 `89`로 clamp)
  - 정렬 순서: `depletionAge`가 빠른 것부터, `null`(평생 유지)은 항상 뒤
  - 실패 격리: 특정 시나리오에서 `engine.runForUtility`가 throw할 때 나머지 5개는 정상 반환되는지
  - `deltaYears` 계산: baseline과 시나리오 각각의 `null`/숫자 조합 4가지 케이스(둘 다 숫자, baseline만 null, 시나리오만 null, 둘 다 null)

- **`SensitivityAnalysisSection.test.tsx`** (`src/tests/web/features/Dashboard/expert/`):
  - 6개 행이 모두 렌더되는지
  - `depletionAge === null`일 때 "평생 유지" 텍스트 렌더
  - 악화/개선에 따른 색상 클래스 분기(`bg-danger`/`bg-success`)가 올바른 `deltaYears` 부호에 매칭되는지
  - `baselineDepletionAge` 기준선 텍스트 렌더

## Critical Files

- `src/core/usecases/dashboard/computeSensitivityAnalysis.ts` (신규)
- `src/web/features/Dashboard/expert/SensitivityAnalysisSection.tsx` (신규)
- `src/web/features/Dashboard/expert/ExpertDetailsPanel.tsx` (수정 — 계산 훅 추가 + 섹션 배치)
- `src/core/usecases/SimulationEngine.ts` (참고 — `runForUtility` 재사용, 수정 없음)
- `src/core/usecases/dashboard/computeRiskAlerts.ts` (참고 패턴 — 순수 함수 usecase + 정렬 관례)

## 범위 밖

- 여러 변수를 동시에 조합한 시나리오(예: 수익률 -2%p + 물가 +1%p 동시 적용)는 포함하지 않는다 — one-at-a-time 민감도만 다룬다.
- Lifetime Utility Score 등 다른 지표로의 민감도 확장은 이번 범위 밖(향후 필요 시 별도 sub-project).
- PDF 리포트에 민감도 분석 결과를 포함하는 것은 별도 Phase 2 항목(PDF 리포트 디자인 동기화)에서 다룬다.
