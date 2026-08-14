# 7단계: SimulationEngine 단일 전략 평가 경계

## 계약

```ts
simulate(profile: RetirementProfile, strategy: RetirementStrategy): StrategySimulationResult
```

`StrategySimulationResult`는 미래 경로인 `yearlyResults`와 경로 자체에서 확정되는
`depletionAge`, `endingAssets`만 포함한다. 은퇴 점수·등급, FIRE 판정, 고정소득 커버율,
효용과 추천은 포함하지 않는다. 기존 화면이 사용하는 이 평가값들은 레거시 `run` 호환
경로가 projection 이후에 별도로 조립한다.

`RetirementStrategy`는 시뮬레이션에 실제 적용할 은퇴 나이, 목표 월 생활비, 종료 나이와
명시적인 기준연도를 포함한다. 사용자 목표 우선순위는 평가 계층에서 사용하며, 시뮬레이션
실행 인자가 아니다.

`simulate`와 `runSingle`은 전달받은 전략을 한 번만 계산한다. 다음 작업은 수행하지 않는다.

- 전략 후보 생성 또는 최적 전략 선택
- 지속가능 생활비 탐색
- 효용 계산
- 추천 문구나 UI 문구 생성
- Monte Carlo 경로 생성 또는 실행

기존 화면과 저장 데이터가 사용하는 `run`, `runForUtility`, `SimulationParams` 경로는 호환
계층으로 유지한다. 이 경로의 최적화 및 효용 계산은 새 `SimulationEngine` 계약에 포함되지 않는다.

## 연도별 결과

기존 결과 필드를 유지하면서 아래 필드를 항상 채운다.

| 구분 | 필드 |
| --- | --- |
| 시점 | `year`, `age` |
| 소득 | `employmentIncome`, `nationalPensionIncome`, `privatePensionIncome`, `dividendIncome`, `otherIncome`, `totalIncome` |
| 생활비 | `targetSpending`, `actualSpending`, `shortfall` |
| 인출 | `generalAssetWithdrawal`, `isaWithdrawal`, `privatePensionWithdrawal`, `withdrawal` |
| 세금 | `taxes` 및 기존 세목별 필드 |
| 자산 흐름 | `openingAssets`, `investmentReturn`, `withdrawal`, `closingAssets` |

현재 도메인에는 근로소득 데이터가 없으므로 `employmentIncome`은 0이다. 근거 없는 소득
가정을 추가하지 않았으며, 향후 프로필에 근로소득 사실 데이터가 추가될 때 연결해야 한다.

`simulationStartYear`를 전략에 명시해 같은 `profile`과 `strategy` 객체는 실행 날짜와 무관하게
같은 연도와 같은 결과를 만든다. Monte Carlo 전용 `returnPath`는 `simulate`가 전달하지 않는다.
확률 경로의 연초자산은 충격 적용 전에 확정하며, 충격이 반영된 월 성장액 전체를 해당 연도
`investmentReturn`에 합산한다.
