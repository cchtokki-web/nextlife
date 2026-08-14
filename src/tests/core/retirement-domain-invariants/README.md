# Retirement domain invariants

은퇴 엔진의 금액은 모두 `SimulationParams.displayCurrency`와 엔진이 선택한 명목/실질 기준을
그대로 사용한다. 이 suite는 표시 단위 변환을 다시 구현하지 않는다.

## 현금흐름 정의

- `targetSpending`은 기본 생활비와 의료비를 포함한 해당 연도의 총 목표 지출이다.
- `actualSpending`은 세후 가용소득과 세후 인출액으로 실제 충당한 금액이며 목표액을 넘지 않는다.
- 목표를 넘는 세후 소득은 소비로 간주하지 않고 `cashAssets`에 남는다.
- 세금은 가용소득 또는 인출액이 순액이 되기 전에 차감되므로 소비식에서 다시 차감하지 않는다.
- 사적연금 인출은 기존 총자산 안의 계좌에서 소비 현금으로 옮기는 내부 이동이다.

따라서 소비 검증식은 다음과 같다.

```text
actualSpending = min(targetSpending, afterTaxIncome + netWithdrawal)
shortfall      = targetSpending - actualSpending
```

연간 자산 보존식은 다음과 같다. 외부 세전소득에서 사적연금 총인출을 제외하면 내부 이동을
이중 계산하지 않는다.

```text
closingAssets
= openingAssets
 + investmentReturn
 + newContributions
 + externalPreTaxIncome
 - actualSpending
 - taxes
```

로컬 및 CI 실행 명령은 `npm run test:retirement-domain-invariants`이다.
