# 2단계 사용자 입력값과 시스템 결정값 분리

## 분류 원칙

- **FACT**: 사용자의 현재 상태와 현재 보유·납입 현황이다.
- **GOAL**: 사용자가 원하는 결과다. 실행 방법을 포함하지 않는다.
- **STRATEGY**: 목표 달성을 위해 시스템이 선택할 실행 정책과 계산 가정이다.

레거시 `SimulationParams`는 한 객체나 하위 객체 안에 세 의미가 섞여 있다. 새 입력 경계는 이를
`RetirementProfile`, `RetirementGoals`, `RetirementStrategy`로 나눈다. 저장 형식과 기존 API는
바꾸지 않으며 `RetirementModelAdapter`가 양방향 변환한다.

## SimulationParams 필드 분류

| 레거시 필드 | 분류 | 새 위치 |
| --- | --- | --- |
| `userProfile.currentAge` | FACT | `profile.personal.currentAge` |
| `userProfile.retirementAge` | GOAL + STRATEGY | 희망값은 `goals.retirement_age`, 실제 실행값은 `strategy.retirementAge` |
| `userProfile.expectancy` | GOAL | `goals.plan_horizon` |
| `userProfile.targetMonthlySpending` | GOAL | `goals.monthly_spending` |
| `userProfile.targetBequest` | GOAL | `goals.bequest` |
| `assets`의 계좌·수량·가격·현재 납입 | FACT | `profile.assets`, `profile.contributions` |
| `assets`의 수익률·배당률·재투자 | STRATEGY | `strategy.assetAllocation.accountProjections` |
| `nationalPension.expectedMonthlyAmount` | FACT | `profile.pensions` |
| `privatePensions`의 계좌·잔액·현재 납입 | FACT | `profile.pensions`, `profile.contributions` |
| `privatePensions`의 수익률·조기 채널링 | STRATEGY | `strategy.assetAllocation`, `strategy.contributionPolicy` |
| `isaAccounts`의 계좌·잔액·현재 납입 | FACT | `profile.assets`, `profile.contributions` |
| `isaAccounts`의 수익률·배당률 | STRATEGY | `strategy.assetAllocation` |
| `otherIncomes` | FACT | `profile.income` |
| `inflationRate`, `inflationMode` | STRATEGY | `strategy.legacySettings` 계산 가정 |
| `baseExchangeRate`, `exchangeScenario`, `useLatestExchangeRate` | STRATEGY | `strategy.legacySettings` 환율 가정 |
| `displayCurrency` | STRATEGY | `strategy.legacySettings` 결과 표시 정책 |
| `yieldPreset`, `customYieldSnapshot` | STRATEGY | `strategy.legacySettings` 수익률 정책 |
| `spendingStrategy`, `spendingCurve` | STRATEGY | `strategy.spendingPolicy` |
| `assetFloor` | STRATEGY | `strategy.withdrawalPolicy.assetFloor` |
| `cashYieldRate` | STRATEGY | `strategy.legacySettings` 현금 운용 가정 |
| `taxSettings`, `taxLawVersion` | STRATEGY | `strategy.legacySettings` 세금 정책 |
| `withdrawalPlan` | STRATEGY | `strategy.withdrawalPolicy`, `strategy.nationalPensionStartAge` |
| `strategy` | STRATEGY | `strategy.legacySettings.strategy` (기존 고수준 전략 계약) |
| `healthcare` | STRATEGY | `strategy.legacySettings` 의료비 가정 |

계좌의 적립 관련 필드는 계좌 객체에 중복 보관하지 않는다. `profile.contributions`가
`monthlyContribution`, `contributionPeriod`, `contributionAmount`의 유일한 원천이며,
역변환 시 계좌 종류와 ID로 연결한다. 연결되는 적립 계획이 없으면 이전 값을 추측하지 않고 오류를 낸다.

`SimulationParams.userProfile.retirementAge`는 레거시에서 목표와 실행 시점을 동시에 뜻했다. 새
모델에서는 둘을 분리한다. 어댑터로 처음 변환할 때는 두 값을 같게 만들고, 역변환할 때는 실제
시뮬레이션 실행값인 `strategy.retirementAge`를 사용한다.

## 호환성 불변식

```text
legacyConfig
  === RetirementModelAdapter.toLegacy(
        RetirementModelAdapter.fromLegacy(legacyConfig).profile,
        RetirementModelAdapter.fromLegacy(legacyConfig).goals,
        RetirementModelAdapter.fromLegacy(legacyConfig).strategy
      )
```

새 `SimulationEngine` 경계도 세 객체를 직접 받는다.

```ts
engine.simulate(profile, goals, strategy)
```

기존 생활비, 연금, 세금, 인출, Monte Carlo, 효용 및 추천 계산식은 변경하지 않는다.
