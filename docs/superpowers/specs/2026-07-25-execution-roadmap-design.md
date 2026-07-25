# 실행 로드맵 타임라인 (Execution Roadmap) 설계

## Context

Phase 2 백로그의 네 번째 항목. 결과 화면(Phase 1 IA)과 리스크 알림 카드(Phase 2-1), 입력 패널 재설계(Phase 2-2), 민감도 분석(Phase 2-3) 위에 이어서, "무엇을 해야 하는지"를 보여주는 `RecommendationChecklist` 바로 아래에 "언제 해야 하는지"를 나이 기반 타임라인으로 보여준다. 원 마스터 프롬프트 예시: "55세: IRP 납입 확대 → 60세: 퇴직 → 65세: 국민연금 수령 → 70세: ISA 인출".

## 확정 사항 (브레인스토밍 결과)

- **기준 계획**: AI 추천 계획(`recommendation.recommendedPlan`) 기준. 추천이 없거나(`recommendationFailed`) 이미 최적(`recommendedPlan === null`, 즉 `improved: false`)이면 `getIdentityPlan(params)`(현재 설정값 그대로의 계획)로 자동 폴백.
- **이벤트 범위**: 계획 필드 4개만(퇴직/일반자산 인출 개시/사적연금 수령 개시/국민연금 수령 개시) + 기대수명을 타임라인 종료 마커로 표시. `depletionAge`/`fireAge` 등은 범위 밖.
- **배치**: `RecommendationChecklist` 바로 다음, 차트 3종 앞. 항상 노출(리스크 알림 카드와 동일한 always-visible 성격).
- **시각 형태**: 수직 스테퍼(타임라인) 리스트. Recharts 미사용, `div` 기반.
- **Before/After 토글과 무관**: 로드맵은 항상 "AI 추천(또는 현재 설정 폴백) 계획" 기준으로 고정 표시되며, `DashboardSection`의 Before/After 토글(KPI·차트·전문가상세가 따르는 `displayedResult`/토글 상태)과는 **의도적으로 분리**되어 있다. 민감도 분석 구현 시 발견됐던 "toggle과 params/result 불일치" 버그와 같은 함정을 피하기 위해, 로드맵 계산은 애초에 toggle 상태를 아예 참조하지 않는다.

## 1. 데이터 계산: `computeExecutionRoadmap` (신규 usecase)

파일: `src/core/usecases/dashboard/computeExecutionRoadmap.ts`

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
  events: RoadmapEvent[]; // 나이 오름차순, 같은 나이는 items 배열에 병합
  expectancy: number; // 타임라인 종료 마커용 (기대수명)
}

export function computeExecutionRoadmap(
  params: SimulationParams,
  recommendation: StrategyRecommendation | undefined
): ExecutionRoadmap
```

### 계획 소스

```ts
const plan = recommendation?.recommendedPlan ?? getIdentityPlan(params);
```

`recommendedPlan`은 `CompleteWithdrawalPlan | null` 타입이므로(추천이 없거나 개선안이 없으면 `null`), `??` 연산자가 `undefined`(추천 자체가 없는 경우)와 `null`(추천은 있지만 개선안 없음) 두 경우를 모두 자연스럽게 잡아낸다.

### 4개 이벤트와 문구

| 이벤트 | 나이 | 제목 | 설명 |
|---|---|---|---|
| 퇴직 | `params.userProfile.retirementAge` (AI가 조정하지 않는 고정 입력값) | "퇴직" | "상용소득이 종료되고 자산 인출 계획이 시작됩니다." |
| 일반자산 인출 개시 | `plan.generalAssetWithdrawalStartAge` | "일반자산 인출 개시" | "주식/ETF 등 일반 자산의 인출을 시작합니다." |
| 사적연금 수령 개시 | `plan.privatePensionStartAge` | "사적연금 수령 개시" | "사적연금(퇴직연금·연금저축 등) 인출을 시작합니다." |
| 국민연금 수령 개시 | `plan.nationalPensionStartAge` | `plan.nationalPensionStartAge`를 `NATIONAL_PENSION_NORMAL_START_AGE`(65)와 비교해 "국민연금 수령 개시" / "국민연금 수령 개시 (조기)" / "국민연금 수령 개시 (연기)" | "국민연금 수령을 시작합니다." |

이 문구들은 `RecommendationEngine.buildReasons()`의 문구("국민연금을 68세까지 연기 수령해 수령액을 늘립니다")와 **의도적으로 다르다** — `buildReasons`는 "왜 이 변경을 추천하는지"(체크리스트용)를 설명하고, 로드맵은 "이 나이에 무슨 일이 일어나는지"(타임라인 라벨용)를 설명하는, 서로 다른 UI 목적의 문구다. `RecommendationEngine.ts`의 문자열은 Phase 1에서 characterization 테스트로 고정되어 있어 이번 작업에서 건드리지 않는다.

### 같은 나이 병합

4개 이벤트를 `age`로 그룹핑해 같은 나이에 여러 이벤트가 겹치면 하나의 `RoadmapEvent`(`items` 배열에 여러 줄)로 합친다. 예: `getIdentityPlan` 기본값(퇴직=일반자산 인출 개시가 항상 같은 나이)이면 한 노드에 "퇴직" + "일반자산 인출 개시" 두 줄이 표시된다. 결과는 `age` 오름차순으로 정렬한다.

### 종료 마커

`expectancy: params.userProfile.expectancy`를 별도 필드로 반환한다. 4개 이벤트(`events`)에는 포함하지 않고, 컴포넌트가 타임라인 맨 끝에 속이 빈 마커(`○`)로 렌더링한다 — 4개 이벤트와 달리 "일어나는 일"이 아니라 타임라인의 시각적 경계이기 때문이다.

## 2. UI: `ExecutionRoadmap` (신규 컴포넌트)

파일: `src/web/features/Dashboard/roadmap/ExecutionRoadmap.tsx`

```ts
interface ExecutionRoadmapProps {
  roadmap: ExecutionRoadmap; // computeExecutionRoadmap의 반환 타입
}
```

세로 점-선 타임라인. 각 `RoadmapEvent` 노드는 채워진 원(`●`) 마커 + 나이 + `items`를 순회한 제목(진한 글씨)/설명(회색 텍스트) 목록. 마지막에 `expectancy`를 속이 빈 원(`○`) 마커로 별도 렌더링. 섹션 제목에 "AI 추천 전략 기준"임을 명시해, 화면의 다른 부분(Before/After 토글에 따라 달라질 수 있는)과 혼동되지 않게 한다.

## 3. 연결 지점

`DashboardSection.tsx`의 `RecommendationChecklist` 바로 다음, 차트 3종 앞에 추가:

```tsx
<RecommendationChecklist
  recommendation={recommendation}
  recommendationFailed={recommendationFailed}
  isComputingRecommendation={isComputingRecommendation}
  formatValue={formatValue}
/>

<ExecutionRoadmap roadmap={computeExecutionRoadmap(params, recommendation)} />

{/* STEP 4: 그래프 3종 ... */}
```

`computeExecutionRoadmap`은 순수 계산(엔진 재실행 없이 계획 필드 값을 그대로 조합)이라 계산 비용이 사실상 0이므로, `computeRiskAlerts`/`generateChartCaptions`와 동일하게 memo 없이 렌더 본문에서 직접 호출한다.

## 4. 테스트 전략

- **`computeExecutionRoadmap.test.ts`**:
  - `recommendation`이 있고 `recommendedPlan`이 채워진 경우, 4개 이벤트가 정확한 나이/제목으로 생성되는지
  - `recommendation === undefined`(아직 계산 전/실패)일 때 `getIdentityPlan(params)` 기반으로 폴백되는지
  - `recommendation.recommendedPlan === null`(추천은 있지만 개선안 없음, `improved: false`)일 때도 동일하게 `getIdentityPlan(params)`로 폴백되는지
  - 같은 나이에 이벤트가 겹칠 때 하나의 `RoadmapEvent`로 병합되고 `items`에 여러 줄이 담기는지
  - 국민연금 조기(65세 미만)/정상(65세)/연기(65세 초과) 3가지 케이스의 제목 분기
  - `events`가 `age` 오름차순으로 정렬되는지
  - `expectancy`가 `params.userProfile.expectancy` 그대로 반환되는지

- **`ExecutionRoadmap.test.tsx`**:
  - 이벤트 노드들이 채워진 마커(`●`)로, 기대수명이 속이 빈 마커(`○`)로 렌더되는지(예: `data-testid`/`data-marker` 속성으로 구분)
  - 병합된 노드(여러 `items`)가 여러 줄로 렌더되는지
  - 각 이벤트의 나이/제목/설명 텍스트가 정확히 표시되는지

## Critical Files

- `src/core/usecases/dashboard/computeExecutionRoadmap.ts` (신규)
- `src/web/features/Dashboard/roadmap/ExecutionRoadmap.tsx` (신규)
- `src/web/features/Dashboard/DashboardSection.tsx` (수정 — `RecommendationChecklist` 다음에 배치)
- `src/core/usecases/strategy/StrategyCandidateGenerator.ts` (참고 — `getIdentityPlan` 재사용, 수정 없음)
- `src/core/usecases/pension/nationalPensionRules.ts` (참고 — `NATIONAL_PENSION_NORMAL_START_AGE` 재사용, 수정 없음)

## 범위 밖

- `depletionAge`(자산 고갈), `fireAge`(FIRE 달성) 등 계획 필드가 아닌 이벤트는 포함하지 않는다.
- ISA 만기 이벤트는 포함하지 않는다 — `IsaAccount.maturityYears`가 나이가 아니라 "연수"이고, 계좌가 여러 개면 계좌별로 만기 시점이 달라 단일 타임라인 이벤트로 단순화하기 어렵다(향후 별도 검토).
- "IRP 납입 확대"류, 계획 필드로 모델링되지 않은 일반적인 재무 조언은 포함하지 않는다 — 실제 계산된 데이터로 뒷받침되는 이벤트만 다룬다.
- Before/After 토글에 따라 로드맵이 바뀌는 기능은 범위 밖(위 "확정 사항" 참고).
