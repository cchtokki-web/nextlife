# 배당 재투자 탐색 (Dividend Reinvestment Optimization) 설계

## Context

"Lifetime Utility Score 전환 프로젝트"(2026-07-19 시작, 결과 화면 UX/IA 재구조화 Phase 1/2와는 별개의 이전 트랙)의 마지막 미착수 항목. 이미 완료된 것: Lifetime Utility Score 엔진, AI 추천 전략(사적연금 개시시기·인출액/국민연금 개시시기/ISA 만기 자금 처리/자산 매도 순서/일반자산 인출 시점 6차원 그리드 탐색), Tax Engine 분리, 현재 전략 강점/약점 분석, PDF 리포트 반영, 자연어 AI 어드바이저 연동, 은퇴준비도 UI 개편.

`InvestmentAsset.reinvestDividend: boolean` 필드는 이미 존재해 사용자가 자산별로 수동으로 켜고 끌 수 있지만, AI 추천 엔진(`RecommendationEngine.recommendStrategy()`)은 이 값에 대해 "어느 자산을 재투자로 바꾸는 게 최적인가"를 탐색하지 않는다. `WithdrawalPlan`(은퇴 이후 인출 국면 전용 6차원 그리드) 구조로는 이 파라미터를 표현할 수 없어(자산 배열 내부 값이고, 은퇴 "전" 축적기 파라미터라는 점에서 층위가 다름) 여러 번 의도적으로 미뤄졌다.

## 조사 결과 요약

- `reinvestDividend` 필드는 `InvestmentAsset`에만 존재한다. `PrivatePension`/`IsaAccount`는 이 개념 자체가 시뮬레이션 루프에 없다(ISA는 항상 재투자로 하드코딩, PrivatePension은 배당이라는 개념 자체가 루프에 없음).
- `SimulationEngine.ts`에서 `reinvestDividend`는 **은퇴 전(`!isRetired`)에만** 참조된다. 은퇴 후에는 배당이 항상 현금 인출로 처리된다.
- `reinvestDividend=false`일 때 배당이 사라지는 게 아니라 `activeAssets[0]`(자산 배열의 첫 번째)에 자동 합산된다 — 자산 간 자본 재배분 효과다.
- 자산 N개에 대해 재투자 on/off 전체 조합(2^N)을 그리드 탐색하면 기존 6차원 그리드(최악 864개)와 곱해져 감당 불가능하다. 자산 개수 상한도 UI에 없다.
- Lifetime Utility Score 중 `consumption`/`depletionSafety`/`bequestAdequacy`(가중치 합 최대 65점)가 은퇴 시점 자산 규모를 통해 이 값에 민감하게 반응할 수 있음을 확인 — 탐색할 가치가 있다는 근거.
- `reasons`(문장 리스트)는 Phase 1에서 화면 체크리스트가 `itemizedContributions`로 대체된 뒤에도 여전히 AI 어드바이저 프롬프트(`src/app/api/ai-advisor/route.ts:72`)와 체크리스트의 폴백 경로(`itemizedContributions` 없을 때)에 쓰이고 있다.

## 확정 사항 (브레인스토밍 결과)

- **범위**: `InvestmentAsset`만. `PrivatePension`/`IsaAccount`로의 재투자 개념 확장(SimulationEngine 자체의 신규 시뮬레이션 능력 추가)은 범위 밖 — 이번 작업은 이미 존재하는 사용자 조작 가능한 스위치에 대한 "AI 추천 확장"이다.
- **탐색 방식**: 자산별 독립 평가 O(N) — `computeItemizedContributions`와 동일한 패턴. 자산 N개에 N번의 시뮬레이션만 필요하다.
- **통합 수준**: 참고용 팁이 아니라 기존 `recommendedResult`/`recommendedPlan`/`itemizedContributions`/`reasons`에 실제로 통합한다. Before/After 토글, PDF, AI 어드바이저가 모두 자동으로 새 추천을 반영한다.

## 1. 알고리즘: Phase 3 (자산별 독립 평가 + 통합 검증)

기존 `recommendStrategy()`는 Phase 1(6차원 그리드 최적 계획 탐색) → Phase 2(생활비 배수 후보 추가 평가)로 최적 결과를 찾는다. 여기에 **Phase 3**을 추가한다:

1. Phase 1+2까지의 최적 결과(`bestPlan`/`bestResult`/`bestUtility`, `bestPlan`이 `null`이면 baseline인 `identityPlan` 사용)를 기준으로, `params.assets`의 각 자산에 대해 **그 자산 하나만** `reinvestDividend`를 현재값의 반대로 뒤집은 params로 재시뮬레이션한다(`engine.runForUtility`, 자산 N개 → N번 시뮬레이션).
2. 각 자산의 뒤집힌 결과 Utility가 `bestUtility`보다 개선되면 "이 자산은 뒤집는 게 유리하다"로 표시한다(유리한 자산 집합).
3. 유리하다고 표시된 자산들을 **한꺼번에** 적용한 최종 조합 params로 한 번 더 시뮬레이션한다(통합 검증, 자산 간 비가산적 상호작용에 대한 안전장치). 조합 결과의 Utility가 `bestUtility`보다 **실제로** 더 높으면 채택하고, 그렇지 않으면(상호작용으로 인한 역효과 등) Phase 1+2 결과를 그대로 유지한다(자산 재투자 변경 없음, `recommendedAssetReinvestment: null`).
4. `params.assets`가 빈 배열이면 Phase 3 전체를 스킵한다(0회 추가 시뮬레이션).

비용: 자산 개수 + 1회 추가 시뮬레이션(`runForUtility`, 이진탐색 없는 경량 버전). 기존 866개 후보 평가 대비 무시 가능한 비용이다(자산 개수가 일반적으로 두 자릿수를 넘지 않음).

## 2. 타입 확장

`src/core/entities/types.ts`의 `StrategyRecommendation`에 필드 추가:

```ts
recommendedAssetReinvestment: Record<string, boolean> | null; // assetId -> 권장 reinvestDividend 값. 변경 권장 없으면(자산 없음/개선 없음/통합 검증 실패) null.
```

`recommendedPlan`(`CompleteWithdrawalPlan | null`, 인출 계획)은 변경하지 않는다 — 자산 재투자는 은퇴 "전" 축적기 파라미터로 구조적으로 다른 층위이며, 두 필드가 독립적으로 "이 축에서 baseline 대비 변경을 권장하는가"를 각각 표현한다.

## 3. 기존 UI에 자동 반영 (신규 UI 코드 없음)

Phase 3의 결과를 다음 두 곳에 병합한다:

- **`itemizedContributions` 배열에 새 항목 추가**: 유리하다고 최종 채택된(통합 검증을 통과한) 자산마다 `{ label, utilityDelta, deltas }` 형태의 항목을 추가한다. `utilityDelta`는 Step 2의 개별(marginal) 평가값을 그대로 쓴다 — Phase 1의 `computeItemizedContributions`와 동일하게 "개별 항목의 utilityDelta 합산이 전체 개선분과 정확히 일치하지 않을 수 있음"이 동일하게 적용됨을 JSDoc으로 명시한다.
- **`reasons` 배열에 대응 문장 추가**: `buildReasons()`가 만드는 기존 문장들과 나란히, 자산 재투자 변경에 대한 문장을 추가한다.

`RecommendationChecklist.tsx`(화면), `renderItemizedChecklistSection`(PDF), `route.ts`(AI 어드바이저 프롬프트)는 이미 `itemizedContributions`/`reasons`를 그대로 순회해서 렌더링하므로 **이 세 소비처의 코드는 한 줄도 수정하지 않는다.** `recommendedResult`도 Phase 3 통합 검증을 반영한 최종 결과로 갱신되므로, `recommendedResult`를 그대로 소비하는 Before/After 토글(`DashboardSection.tsx`)도 코드 변경 없이 정확히 동작한다.

문구 예시:
- 재투자로 전환: `"{자산명}"의 배당을 재투자로 전환합니다.`
- 재투자 중단: `"{자산명}"의 배당 재투자를 중단하고 현금으로 인출합니다.`

## 4. 파일 구조

새 로직을 `RecommendationEngine.ts`(이미 크고, 문자열이 characterization 테스트로 고정되어 있어 신중하게 다뤄야 하는 파일)에 직접 넣지 않고, 별도 파일로 분리한다.

파일: `src/core/usecases/strategy/DividendReinvestmentOptimizer.ts` (신규)

```ts
export function optimizeDividendReinvestment(
  params: SimulationParams,
  bestPlan: CompleteWithdrawalPlan | null,
  bestResult: SimulationResult,
  bestUtility: UtilityBreakdown,
  engine: SimulationEngine,
  cfg: UtilityConfig
): {
  recommendedAssetReinvestment: Record<string, boolean> | null;
  additionalItemizedContributions: ItemizedContribution[];
  additionalReasons: string[];
  finalResult: SimulationResult;
  finalUtility: UtilityBreakdown;
}
```

- `bestPlan`이 `null`이면 내부적으로 `getIdentityPlan(params)`를 사용해 params를 구성한다(`StrategyCandidateGenerator.ts`의 기존 함수 재사용).
- 개선이 전혀 없으면(자산 없음, 또는 모든 개별 평가가 비개선, 또는 통합 검증 실패) `recommendedAssetReinvestment: null`, `additionalItemizedContributions: []`, `additionalReasons: []`, `finalResult: bestResult`, `finalUtility: bestUtility`를 그대로 반환한다(no-op으로 안전하게 축소).

`recommendStrategy()`(`RecommendationEngine.ts`)는 Phase 1+2 이후 이 함수를 호출해 반환값을 기존 `recommendedResult`/`itemizedContributions`/`reasons`/`improved`(재계산: `finalUtility.score > currentUtility.score`)에 병합하는 수 줄만 추가한다.

## 5. 테스트 전략

- `DividendReinvestmentOptimizer.test.ts`(신규): 자산 0개(스킵), 단일 자산 개선/비개선, 다중 자산 중 일부만 개선, 통합 검증이 개별 개선의 합보다 못한 경우(안전장치 발동, 변경 없음으로 폴백), `bestPlan: null`일 때 identity plan 기반 동작.
- 기존 `RecommendationEngine.test.ts`/`RecommendationEngine.performance.test.ts`의 자산 fixture 중 일부가 우연히 재투자 전환으로 이득을 보게 되면, 기존에 "개선 없음"으로 고정되어 있던 characterization 값(`improved`, `reasons`, 특정 utility 점수 등)이 바뀔 수 있다. 플랜 작성/구현 단계에서 전체 테스트를 실행해 영향을 확인하고, 실제 동작 변화를 반영해 해당 테스트를 업데이트한다(테스트가 깨지는 것 자체가 이 기능이 실제로 동작한다는 증거일 수 있음 — 버그가 아니라 의도된 동작 변화인지 케이스별로 판단).
- 성능 회귀 테스트(`RecommendationEngine.performance.test.ts`)에 Phase 3의 추가 비용(자산 개수 + 1회)이 기존 5초 예산 안에 드는지 확인하는 케이스를 추가한다.

## Critical Files

- `src/core/usecases/strategy/DividendReinvestmentOptimizer.ts` (신규)
- `src/core/usecases/strategy/RecommendationEngine.ts` (수정 — Phase 3 호출 및 병합 로직 몇 줄 추가)
- `src/core/entities/types.ts` (수정 — `StrategyRecommendation.recommendedAssetReinvestment` 필드 추가)
- `src/core/usecases/strategy/StrategyCandidateGenerator.ts` (참고 — `getIdentityPlan` 재사용, 수정 없음)
- `src/web/features/Dashboard/recommendation/RecommendationChecklist.tsx`, `src/web/features/Pdf/pdfReportSections.ts`, `src/app/api/ai-advisor/route.ts` (참고 — `itemizedContributions`/`reasons`를 그대로 소비, 수정 없음)

## 범위 밖

- `PrivatePension`/`IsaAccount`로의 재투자 개념 확장(SimulationEngine 자체의 신규 능력 추가)은 범위 밖이다.
- 자산 간 재투자 조합의 완전 탐색(2^N 그리드)은 범위 밖이다 — 자산별 독립 평가 + 1회 통합 검증으로 근사한다.
- 화면/PDF UI 컴포넌트 수정은 범위 밖이다(위 3절 참고 — 기존 소비처가 자동으로 새 데이터를 렌더링함).
