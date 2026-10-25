# Retirement domain invariants

은퇴 엔진의 금액은 모두 `SimulationParams.displayCurrency`와 엔진이 선택한 명목/실질 기준을
그대로 사용한다. 이 suite는 표시 단위 변환을 다시 구현하지 않는다.

## 이 suite가 검증하지 않는 것

`fixtures.ts`는 `inflationRate: 0`, `inflationMode: 'real'`, `displayCurrency: 'KRW'`로 고정돼
있다. 물가가 0이면 명목과 실질이 수치상 같으므로, **명목/실질 혼용과 통화 변환은 여기서
검증되지 않는다.** 두 축은 다른 suite의 책임이고, 이 suite는 물가·환율을 상수로 묶은 상태의
현금흐름 항등식만 본다.

**파일 이름이 곧 커버리지는 아니다.** mutation 검사(해당 도메인의 계산을 고의로 망가뜨린 뒤
이 파일이 실패하는지 확인) 결과는 다음과 같다.

| 파일 | 상태 |
| --- | --- |
| `cashflow.test.ts` | 실질적. 세금을 2배로 만들면 실패한다 |
| `regression.test.ts` | 실질적 |
| `tax.test.ts` | 실질적. 세금 처리를 망가뜨리면 실패한다 |
| `optimizer.test.ts` | 실질적 |
| `monte-carlo.test.ts` | 실질적. 분위수 순서·확률 범위·교집합 부등식을 확인한다 |
| `pension.test.ts` | 실질적. 조기수령 감액을 없애면 실패한다 |
| `goal-evaluation.test.ts` | 실질적. HARD 생활비 판정을 없애면 실패한다 |
| `withdrawal.test.ts` | 실질적. 인출 상한 클램프를 없애면 실패한다 |

이 표는 실제 mutation 실행 결과다(추정이 아니다). 파일을 추가·수정할 때는 같은 방식으로
"그 도메인 계산을 망가뜨리면 이 파일이 실패하는가"를 확인하고 표를 갱신할 것.

**단일 지점 생존에 주의.** 일부 불변식은 엔진 안에서 두 곳이 각각 막는다(예: 보호 잔액).
그런 경우 한쪽만 무력화하면 테스트가 통과하므로, 생존만 보고 테스트가 약하다고 판단하면
틀린다. 해당 지점에는 테스트에 주석을 남겨 두었다.

## 현금흐름 정의

아래는 **엔진의 계약을 서술한 것**이고, 이 suite가 실행으로 검증하는 것은 자산 보존식,
shortfall 정의, 그리고 각 테스트 파일이 다루는 항목뿐이다. 서술과 검증 범위를 같은 것으로
읽지 않도록 주의한다.

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
