# 사적연금 조기수령 채널링(Phase 4) 설계

## Context

"Lifetime Utility Score 전환 프로젝트"는 Phase 1(6→5차원 그리드), Phase 2(생활비 배수), Phase 3(배당 재투자 최적화, `feature_dividend_reinvestment` → `develop` 병합 완료)까지 마쳤다. 이번 작업은 그 다음으로 요청된 새 개선 전략: "개인연금 운영 개선"이다.

사용자가 제시한 구체적 전략:
> 개인연금을 55세에 개시하고, 이때 받은 연금을 ISA에 재투자하며, 신규 개인연금을 만들어 (실제) 퇴직 전까지 월급으로 계속 납입한다 — 절세 및 (상속 대상이 없을 경우) 최대로 쓸 수 있는 생활비 개선이 목적.

## 조사 결과 요약

- `WithdrawalPlan.privatePensionStartAge` 필드는 최근 `7dbc016`("사적연금 수령 개시 나이 설정 기능 제거")에서 의도적으로 제거되어, 현재 사적연금 수령 개시 나이는 **항상 `retirementAge`(최소 55세로 하한, `clampPrivatePensionStartAge`)** 로 고정되어 있다.
- `SimulationEngine.ts`에서 사적연금 인출은 전적으로 `if (isRetired && pension.currentBalance > 0)` 블록 안에서만 일어난다. 즉 **은퇴 전에는 사적연금을 인출하는 경로 자체가 존재하지 않는다** — 이는 `7dbc016` 이전에도 마찬가지였다(그 커밋은 "개시 나이"만 제거했지, "은퇴 전 인출"을 막은 적은 없다 — 애초에 지원된 적이 없다).
- 은퇴 전(`!isRetired`)에는 자산/ISA/사적연금 모든 계좌의 `monthlyContribution`이 그대로 적용되고, 은퇴가 시작되면(`isRetired`) 일괄 0으로 중단된다(`SimulationEngine.ts:401,443,469` 인근). 즉 "은퇴 나이까지 새 연금 계좌에 납입"은 **이미 있는 매커니즘**이며 신규 로직이 필요 없다 — 신규 계좌를 후보 params에 추가하기만 하면 된다.
- `TaxSettings.privatePensionLimit`(기본 15,000,000원/년, "사적연금 저율과세 한도")과 그 한도까지만 인출하도록 캡을 거는 기존 로직(`monthlyPensionPreTaxLimitRemainingKRW`)이 이미 존재한다 — 이번 브릿지 구간 인출액 산정에 동일 개념을 재사용할 수 있다.
- `getPrivatePensionIncomeTaxRate(age)`는 나이 구간별로 독립적으로 세율을 정하며 은퇴 여부와 무관하다 — 55세부터 조기 인출해도 세율 계산 로직은 변경할 필요가 없다.
- 상속 목표(`userProfile.targetBequest`)를 0으로 명시하면 `UtilityEngine.computeBequestAdequacyRaw`가 "잔여자산 0 이하 = 만점"으로 이미 처리하고, `RecommendationEngine`의 `generateSpendingAdjustmentCandidates`(생활비 배수 1.1x/1.2x 탐색)가 이미 존재한다. 즉 "상속 대상 없을 시 최대 생활비"는 **기존 인프라가 이미 담당** — 이번 작업이 확보하는 여유 자금(절세분)을 자동으로 생활비 증액으로 연결해줄 것이므로 별도 구현이 필요 없다.

## 확정 사항 (브레인스토밍 결과)

- **개시 나이와 은퇴 나이의 분리**: 사적연금 수령은 `retirementAge`와 무관하게 55세부터 시작될 수 있어야 한다(재직 중 수령 포함). `privatePensionStartAge` 필드를 그대로 되살리는 것이 아니라, 이 전략 전용의 새로운 "브릿지 구간" 개념으로 구현한다(사용자가 직접 설정하는 범용 옵션이 아니라 이 전략이 켜졌을 때만 적용되는 동작).
- **제공 방식**: 사용자가 수동으로 켜는 입력 폼 옵션이 아니라, `RecommendationEngine`이 자동으로 탐색·추천하는 전략 후보(Phase 4)로 제공한다.
- **다중 계좌 처리**: 계좌별 조합 탐색(Phase 3처럼 2^N 근사)은 하지 않는다. 사용자가 사적연금을 여러 개 보유해도 **하나의 통합 on/off 전략**으로 취급한다 — 켜지면 보유한 모든 사적연금 계좌가 함께 55세 조기수령+ISA 재투자로 전환되고, 신규 연금 계좌 1개가 함께 추가된다.
- **통합 수준**: Phase 3와 동일하게, Phase 1+2+3의 최적 결과(`bestResult`/`bestUtility`) 대비 이 전략을 켠 결과가 더 유리하면 최종 추천(`recommendedResult`)에 자동으로 포함한다. 사용자가 별도로 선택하는 "대안 전략" UI는 만들지 않는다.
- **전제 조건**: 사적연금 계좌 ≥ 1개, ISA 계좌 ≥ 1개, `retirementAge > 55`. 셋 중 하나라도 성립하지 않으면 후보 자체를 생성하지 않는다(no-op).

## 1. 브릿지 구간 인출 규칙

"브릿지 구간"이란 `55세 ≤ currentAge < retirementAge`이면서 아직 `isRetired`가 아닌 기간을 말한다(즉 `retirementAge ≤ 55`인 사용자에게는 브릿지 구간이 존재하지 않는다).

- **인출 대상**: 이 전략이 켜졌을 때, `params.privatePensions`의 **기존 계좌 전부**(아래 2절에서 추가하는 신규 계좌는 제외).
- **월 인출액**: `min(계좌 잔액, privatePensionLimit ÷ 12)` — 저율과세 한도(기본 연 1500만원, KRW 기준)를 넘지 않는 선에서 최대한 인출한다. 여러 계좌가 있으면 기존 은퇴 후 로직(`remainingMonthlyPensionTargetKRW`와 동일한 "합산 후 순차 소진" 방식)을 그대로 재사용해 한도를 계좌 간에 공유한다. 계좌 통화가 KRW가 아니면 기존 `convertValue` 헬퍼로 환산해 비교한다(`monthlyPensionPreTaxLimitRemainingKRW` 계산부와 동일한 방식).
- **인출된 순액(세후)의 처리**: 생활비 재원으로 쓰지 않고, **기존 ISA 계좌(첫 번째 것) 의 `currentValue`에 그대로 더한다**(추가 납입처럼 취급). 재직 중이라 생활비는 이미 근로소득(이 시뮬레이터가 모델링하지 않는 영역)으로 충당된다고 가정한다.
- **세금**: 기존 `getPrivatePensionIncomeTaxRate(currentAge)`를 그대로 적용해 인출 시점에 과세한다. ISA에 들어가는 금액은 세후 순액이며, ISA 자체의 만기세는 기존 로직을 그대로 따른다(원금처럼 취급 — ISA 재투자 이후의 수익만 향후 ISA 만기세 대상).
- **`retirementAge` 도달 이후**: 이 전략의 영향은 사라지고, 기존 은퇴 후 인출 로직(생활비 재원 확보용)이 그대로 적용된다. 즉 `SimulationEngine.ts`에 추가하는 분기는 `!isRetired && currentAge >= 55` 조건에서만 동작하는, 기존 `isRetired` 블록과 **병렬인** 새 분기다 — 기존 은퇴 후 인출 코드 경로는 한 줄도 바뀌지 않는다.

## 2. 신규 사적연금 계좌 합성

이 전략이 켜지면 `params.privatePensions`에 다음 계좌를 하나 추가한 params로 재시뮬레이션한다:

```ts
{
  id: '<합성 ID, 예: "__phase4_new_pension__">',
  type: 'irp',
  investmentType: params.privatePensions[0].investmentType,
  annualReturn: params.privatePensions[0].annualReturn,
  dividendYield: params.privatePensions[0].dividendYield,
  balance: 0,
  monthlyContribution: 750_000, // 연 900만원 세액공제 한도
  currency: params.privatePensions[0].currency,
}
```

- 수익률/투자종류/통화는 사용자의 기존 사적연금 계좌(배열의 첫 번째)를 그대로 복사한다 — 별도 가정값을 새로 만들지 않는다.
- 납입은 기존 `isRetired` 게이팅에 의해 `retirementAge` 도달 시 자동으로 중단된다 — 신규 코드가 필요 없다.
- 이 계좌는 브릿지 구간 조기 인출 대상(1절)에서 **제외**한다 — 아직 납입 중인 계좌이므로 조기 인출 대상이 아니다.

## 3. 알고리즘: Phase 4 (단일 통합 on/off 평가)

Phase 3(`optimizeDividendReinvestment`) 직후에 실행한다.

1. 전제 조건(사적연금 ≥ 1, ISA ≥ 1, `retirementAge > 55`)을 확인한다. 하나라도 불충족이면 즉시 no-op으로 반환한다(추가 시뮬레이션 없음).
2. Phase 1~3까지의 최종 결과(`reinvestOpt.finalResult`/`finalUtility`, 및 그 결과를 만든 params — `bestPlan` 적용 + Phase 3의 `reinvestDividend` 오버라이드까지 반영된 params)를 기준으로, 1절+2절의 변경(기존 계좌 전체 브릿지 인출 on, 신규 계좌 추가)을 **한꺼번에** 적용한 단일 후보 params를 만들어 **1회** 재시뮬레이션한다(`engine.runForUtility`).
3. 후보의 Utility가 기준보다 개선되면 채택(`recommendedPrivatePensionChanneling: true`), 아니면 기각(`false` 아니라 `null` — Phase 3 패턴과 동일하게 "권장 없음"은 `null`로 표현).
4. 자산별 독립 평가(Phase 3처럼 N개 자산에 대해 각각 시뮬레이션)는 하지 않는다 — "확정 사항"에서 정한 대로 하나의 통합 전략이므로 추가 시뮬레이션 비용은 **최대 1회**다.

## 4. 타입 확장

`src/core/entities/types.ts`의 `StrategyRecommendation`에 필드 추가:

```ts
// 사적연금 조기수령 채널링(Phase 4) 권장 여부. 전제 조건 불충족/개선 없음이면 null.
recommendedPrivatePensionChanneling: boolean | null;
```

`recommendedPlan`/`recommendedAssetReinvestment`와 마찬가지로 별도 축으로 독립 관리한다 — 인출 계획(Phase 1/2)도, 배당 재투자(Phase 3)도 아닌 세 번째 축이다.

## 5. 기존 UI에 자동 반영 (신규 UI 코드 없음)

Phase 3와 동일한 통합 방식을 따른다:

- 채택되면 `itemizedContributions`에 항목 추가: `{ label: "사적연금을 55세부터 조기 수령해 ISA에 재투자하고, 신규 연금 계좌에 퇴직 전까지 납입합니다.", utilityDelta, deltas }`.
- `reasons` 배열에 대응 문장 추가.
- `recommendedResult`도 Phase 4까지 반영된 최종 결과로 갱신되므로, 이를 그대로 소비하는 Before/After 토글·PDF·AI 어드바이저 프롬프트는 **코드 변경 없이** 자동으로 새 추천을 반영한다.
- 화면/PDF에 이 전략을 별도로 강조하는 문구·아이콘 등 세부 UI는 이번 스펙 범위 밖이며, 구현 계획 단계에서 Phase 3의 기존 연동 패턴을 그대로 따른다.

## 6. 파일 구조

파일: `src/core/usecases/strategy/PrivatePensionChannelingOptimizer.ts` (신규, `DividendReinvestmentOptimizer.ts`와 동일한 패턴)

```ts
export function optimizePrivatePensionChanneling(
  params: SimulationParams,
  bestResult: SimulationResult,
  bestUtility: UtilityBreakdown,
  engine: SimulationEngine,
  cfg: UtilityConfig
): {
  recommendedPrivatePensionChanneling: boolean | null;
  itemizedContribution: ItemizedContribution | null;
  finalResult: SimulationResult;
  finalUtility: UtilityBreakdown;
}
```

- `bestPlan`을 인자로 받지 않는다 — 이 최적화는 `WithdrawalPlan` 축이 아니라 `params.privatePensions`/자산 배열을 직접 변형하는 축적기 파라미터 축이기 때문이다(Phase 3와 동일한 이유).
- `SimulationEngine.ts`에는 브릿지 구간 인출 분기를 추가한다: 이 분기가 활성화되는 조건은 params에 새로 추가하는 플래그(예: `params.privatePensionBridgeChannelingEnabled?: boolean`, 내부용 — `SimulationParams`에 옵션 필드로 추가하되 UI 입력 폼에는 노출하지 않는다)로 제어한다. `PrivatePensionChannelingOptimizer`가 후보 params를 만들 때 이 플래그를 `true`로 설정한다.
- `recommendStrategy()`(`RecommendationEngine.ts`)는 Phase 3 호출 직후 이 함수를 호출해 반환값을 `recommendedResult`/`itemizedContributions`/`reasons`/`improved`/`recommendedPrivatePensionChanneling`에 병합하는 수 줄만 추가한다.

## 7. 테스트 전략

- `PrivatePensionChannelingOptimizer.test.ts`(신규): 전제 조건 불충족 3가지(사적연금 없음/ISA 없음/`retirementAge<=55`) 각각 no-op, 브릿지 구간 인출액이 저율과세 한도로 캡되는 경우, 계좌가 여러 개일 때 한도가 계좌 간에 공유되는 경우, 개선이 없어 기각되는 경우.
- `SimulationEngine.test.ts`: 신규 브릿지 분기에 대한 단위 테스트 — 55세~retirementAge 구간에서 인출된 순액이 ISA `currentValue`에 정확히 합산되는지, `retirementAge` 이후에는 기존 로직으로 정확히 복귀하는지, `retirementAge<=55`이면 분기 자체가 발동하지 않는지.
- 기존 `RecommendationEngine.test.ts`의 characterization 값(사적연금+ISA를 함께 가진 fixture가 있다면)이 이번 변경으로 바뀔 수 있다 — 구현 단계에서 전체 테스트를 실행해 영향을 확인하고, 실제 동작 변화라면 해당 테스트를 업데이트한다(Phase 3 때와 동일한 주의사항).
- `RecommendationEngine.performance.test.ts`에 Phase 4의 추가 비용(최대 1회 시뮬레이션)이 기존 성능 예산 안에 드는지 확인하는 케이스를 추가한다.

## Critical Files

- `src/core/usecases/strategy/PrivatePensionChannelingOptimizer.ts` (신규)
- `src/core/usecases/SimulationEngine.ts` (수정 — 브릿지 구간 인출 분기 추가, 기존 `isRetired` 인출 블록은 변경 없음)
- `src/core/usecases/strategy/RecommendationEngine.ts` (수정 — Phase 4 호출 및 병합 로직 몇 줄 추가)
- `src/core/entities/types.ts` (수정 — `StrategyRecommendation.recommendedPrivatePensionChanneling` 필드, `SimulationParams`에 내부용 브릿지 플래그 필드 추가)
- `src/core/usecases/tax/TaxEngine.ts`, `src/core/usecases/pension/privatePensionRules.ts` (참고 — `privatePensionLimit`/`getPrivatePensionIncomeTaxRate`/`clampPrivatePensionStartAge` 재사용, 수정 없음)

## 범위 밖

- 사용자가 브릿지 채널링을 수동으로 켜고 끄는 입력 폼 UI는 범위 밖이다 — AI 추천 전용.
- 계좌별 독립 on/off 조합 탐색(Phase 3처럼 N개 계좌에 대한 개별 평가)은 범위 밖이다 — 하나의 통합 전략으로 근사한다.
- `privatePensionStartAge`를 사용자가 임의로 지정하는 범용 옵션 재도입은 범위 밖이다 — 이번 브릿지 로직은 이 전략 전용이며 `7dbc016`의 단순화 결정을 되돌리지 않는다.
- 신규 연금 계좌의 세액공제 한도 초과분 처리, 여러 신규 계좌 추가 등은 범위 밖이다 — 신규 계좌는 정확히 1개, 월 75만원 고정.
- "상속 대상 없을 시 최대 생활비" 자체를 위한 신규 유틸리티/탐색 로직은 범위 밖이다 — 기존 `targetBequest=0` 처리와 생활비 배수 탐색이 이미 담당한다.
