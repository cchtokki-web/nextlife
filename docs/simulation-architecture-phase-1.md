# 은퇴 시뮬레이션 구조 분석 및 1단계 엔진 분리

## 범위와 불변식

이 단계는 계산 결과를 변경하지 않고 경계만 만든다. 기존 계산기는 `LegacySimulationEngine`으로
보존하며 저장 데이터와 API의 `SimulationParams` 계약도 유지한다. 생활비, 인출 순서, 연금,
세율, Monte Carlo, 효용 점수 및 추천 후보 생성식은 변경하지 않는다.

핵심 회귀 불변식은 다음과 같다.

```text
LegacySimulationEngine.run(legacyConfig, utilityConfig)
===
LegacySimulationEngine.simulate(
  LegacySimulationAdapter.fromLegacy(legacyConfig, utilityConfig).profile,
  LegacySimulationAdapter.fromLegacy(legacyConfig, utilityConfig).goals,
  LegacySimulationAdapter.fromLegacy(legacyConfig, utilityConfig).strategy
)
```

## 기존 코드 조사 결과

| 조사 항목 | 현재 Single Source of Truth | 비고 |
| --- | --- | --- |
| 시뮬레이션 설정 모델 | `src/core/entities/types.ts`의 `SimulationParams` | 저장 시나리오와 UI가 함께 사용 |
| 자산 증가·자산 합계 | `src/core/usecases/SimulationEngine.ts` | 주식/ETF, 연금, ISA, 현금 버킷 포함 |
| 소득 계산 | `src/core/usecases/SimulationEngine.ts` | 배당, 국민연금, 사적연금, 기타소득을 연 단위 집계 |
| 생활비 계산 | `SimulationEngine.ts`, `spending/spendingCurve.ts`, `spending/spendingShortfall.ts` | 월 인출 후 연 결과로 집계 |
| 연금 계산 | `SimulationEngine.ts`, `pension/nationalPensionRules.ts`, `pension/privatePensionRules.ts` | 개시 나이와 세후 인출 반영 |
| 세금 계산 | `tax/TaxEngine.ts`, `tax/taxContext.ts`, `tax/taxLawProfiles.ts`, `tax/annualTaxTotals.ts` | 세율 원천은 tax law profile |
| 인출 계산 | `SimulationEngine.ts`, `strategy/assetOrdering.ts` | 현금, 일반자산, ISA, 사적연금 경로 포함 |
| Monte Carlo | `montecarlo/MonteCarloEngine.ts` 및 `src/web/workers/monteCarlo.worker.ts` | 코어 엔진은 React 비의존, 워커에서 실행 |
| 평생 효용 점수 | `utility/UtilityEngine.ts` | 기존 엔진 결과의 `utility`에 포함 |
| 추천 전략 | `strategy/RecommendationEngine.ts`와 후보/optimizer 모듈 | 기존 알고리즘을 legacy 추천 엔진이 위임 호출 |
| 결과 화면 변환·평가 | `dashboard/*`, `MonthlySpendingComposition.ts`, `pdfReportSections.ts` | 대시보드의 평가 조합을 Evaluation 경계로 이동 |

## 분리된 계층

```text
UI
 │
 ▼
Application: simulateLegacyConfig / strategy pipeline
 │
 ▼
Domain/Input: RetirementProfile + RetirementGoals + RetirementStrategy
 │              ▲
 │      LegacySimulationAdapter
 ▼
Simulation: SimulationEngine interface
 │              └─ LegacySimulationEngine
 ▼
SimulationResult
 │
 ▼
Evaluation: EvaluationEngine
 │              └─ LegacyEvaluationEngine
 ▼
Recommendation: RecommendationEngine
                └─ LegacyRecommendationEngine
```

- Domain/Input은 현재 상태(`RetirementProfile`), 원하는 결과(`RetirementGoals`), 계산 전략·가정
  (`RetirementStrategy`)을 분리한다.
- `LegacySimulationAdapter`는 기존 `SimulationParams`를 손실 없이 새 입력으로 변환하고 다시 복원한다.
- 새 `SimulationEngine`은 UI 프레임워크에 의존하지 않고
  `simulate(profile, goals, strategy)`만 계약한다.
- `LegacySimulationEngine`은 기존 `run`/`runSingle`을 유지하여 추천, 민감도, Monte Carlo와 기존
  호출자의 동작을 보존하면서 새 인터페이스도 구현한다.
- `LegacyEvaluationEngine`은 React가 직접 조합하던 위험 경고, 부족분, 자산 상태, 성공 판정,
  신뢰도, 연금 공백, 효용 설명을 순수 TypeScript 계층에서 계산한다.
- `LegacyRecommendationEngine`은 기존 추천 함수에 위임한다. 새 추천 알고리즘은 추가하지 않았다.

## 현재 남겨 둔 legacy 결합

기존 `SimulationResult`에는 은퇴 점수와 효용 점수가 이미 포함되어 있다. 이를 이번 단계에서
분리하면 결과 객체와 수치가 바뀔 위험이 있으므로 그대로 유지했다. Evaluation 계층은 이 값을
재계산하지 않고 불변 입력으로 받아 후속 평가를 만든다. 향후 새 엔진을 구현할 때 내부 결과와
평가 결과의 계약을 별도 버전으로 정의한 뒤 migration해야 한다.

`SimulationParams` 역시 저장소, API, 폼 전반의 공개 계약이므로 제거하지 않았다. 모든 기존 경로는
adapter를 통해 호환되며, 목표 기반 입력 모델이 확정되기 전까지 임의의 목표 필드를 추가하지 않는다.
