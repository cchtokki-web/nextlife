# Monte Carlo 판정의 단일 출처 — SimulationVerdict와 HARD 목표 성공률

## 배경

Monte Carlo 판정값이 소비처마다 다른 경로로 도달한다. PDF는 네 단계 폴백을 탄다
(`src/web/features/Pdf/pdfReportSections.ts:170`).

```ts
const simulationSuccessRate = monteCarlo?.simulationSuccessRate
  ?? monteCarlo?.goalSuccessProbability
  ?? confidence.rates?.goalSuccessProbability
  ?? confidence.rates?.spendingSuccessRate
  ?? 0;
```

화면은 같은 체인을 짧게 다시 쓴다(`DashboardSection.tsx:236`). 두 가지가 잘못돼 있다.

**세 번째 폴백은 다른 질문의 답이다.** `spendingSuccessRate`는 자산 고갈을 묻지 않는 지표다.
`DashboardSection.tsx:232`가 "`spendingSuccessRate`로 대체하지 않는다. 그것은 「고갈 여부를 묻지
않는」 다른 지표"라고 못박고 있는데, PDF는 정확히 그 대체를 한다.

**`?? 0`은 「판정 못 함」과 「전멸」을 같은 화면으로 만든다.** 사용자가 구분해야 하는 두 상태다.

여기에 더해, HARD 목표를 몇 번의 시행에서 지켰는지를 묻는 지표가 없다.
`GoalSuccessConditions`는 생활비·자산생존·기말자산을 판정하지만 목표의 강도를 보지 않는다.

## 목표

- Monte Carlo 판정을 읽는 모든 경로가 하나의 파생 셀렉터를 거친다. PDF의 어느 영역도
  다른 출처에서 success/failure 수를 얻지 않는다.
- HARD 목표 성공률·생활비 충족률·자산 유지율을 서로 대체하지 않는 별개 KPI로 노출한다.
- 판정 불가 상태를 숫자 0이 아니라 부재로 표현한다.

## 비목표

- `MonteCarloResult`의 기존 필드를 삭제하거나 이름을 바꾸지 않는다. 소비처가 14개이고
  Worker 프로토콜과 API를 가로지른다.
- `/api/ai-advisor`의 요청 필드(`monteCarloSuccessRate`, `monteCarloSpendingSuccessRate`)를
  바꾸지 않는다. HARD 성공률을 LLM 프롬프트에 추가하지 않는다 — 요구에 없고, 넣으면 이 변경의
  영향이 서버 응답까지 번진다.
- Monte Carlo 시행 횟수, 민감도 경고, 수익률 provenance는 이 spec의 범위가 아니다.
  각각 별도 spec으로 다룬다.
- 판정 불가능한 목표를 판정 가능하게 만들지 않는다. `MEASURABLE_GOALS`를 넓히지 않는다.

## 선결 조사 결과

**`MonteCarloResult`는 저장되지 않는다.** 저장 계층(`src/infrastructure/storage`)과 Prisma
스키마 어디에도 없고, `useMonteCarlo`가 React state로만 들고 있다. 매번 계산된다.
따라서 데이터 마이그레이션이 필요 없다.

**판정 가능한 목표는 여섯 개뿐이다.** `isQuantitativelyJudgedGoal()`이
`MEASURABLE_GOALS`(LIVING_EXPENSE_STABILITY, COMFORTABLE_SPENDING, ASSET_SURVIVAL,
INHERITANCE, ASSET_GROWTH)와 `PLAN_EMBEDDED_GOALS`(EARLY_RETIREMENT)로 한정한다. 주거 안정·
연금 최대 활용·세금 최소화·투자 위험 최소화는 HARD로 골라도 미달을 만들지 않고
`GoalEvaluationEngine`의 `unsupportedHardGoals`로 드러난 채 남는다.

이것이 이 설계의 가장 중요한 제약이다. known-issues 1번(「주거 안정」이 기본 HARD인데 정량
효과가 없다)이 정확히 이 상황이었고, 그때 확인된 결론은 **계산은 옳았고 화면이 「못박은 조건을
계산이 지킨다」고 믿게 만든 것이 결함**이었다는 것이다. 판정된 HARD 목표만으로 비율을 내고 그
사실을 밝히지 않으면 같은 결함을 지표 하나 더 만들어 되풀이한다.

## 설계

### 1. HARD 강도를 판정 조건에 싣는다

`resolveGoalSuccessConditions()`는 오늘 「어떤 조건을 판정할지」를 정하는 유일한 자리다
(`MonteCarloEngine.ts:163` 주석이 "그 결정은 resolveGoalSuccessConditions 한 곳에만 둔다"고
명시한다). 강도 판정도 같은 자리에 둔다.

```ts
export interface GoalSuccessConditions {
  // 기존
  basis; requireSpendingTarget; requireAssetSurvival; terminalAssetGoal; unmeasuredGoals;

  // 신규 — 위 세 조건 중 어느 것이 HARD 목표에서 왔는가
  hardRequirements: {
    spendingTarget: boolean;
    assetSurvival: boolean;
    terminalAsset: boolean;
  };
}
```

### 2. 엔진은 같은 술어를 재사용한다

`MonteCarloEngine`은 이미 세 술어(`failsSpending`/`failsSurvival`/`failsTerminal`)로 시행을
거른다. HARD 비율도 **그 술어를 그대로** 쓴다.

```ts
const hardSucceeded = trials.filter((t) =>
  (!hard.spendingTarget || !failsSpending(t)) &&
  (!hard.assetSurvival  || !failsSurvival(t)) &&
  (!hard.terminalAsset  || !failsTerminal(t)));
```

술어를 새로 쓰지 않는 이유는 같은 파일 185행 주석에 있다 — "조건을 여기서 다시 쓰면 판정하지
않은 조건이 사유로만 보고되어 확률과 화면이 어긋난다."

`MonteCarloResult`에 `hardGoalSuccessProbability?: number` 하나가 늘어난다. 시행별 판정은
엔진만 할 수 있어 파생 셀렉터로 만들 수 없다. optional이므로 없으면 판정 부재로 떨어진다.

### 3. SimulationVerdict — 파생 셀렉터

`src/core/usecases/montecarlo/resolveSimulationVerdict.ts` 신규.

```ts
export interface SimulationVerdict {
  /** 판정 불가. 소비처는 숫자를 짜내지 말고 「판정 없음」을 표시한다. */
  available: boolean;
  trials: number;
  seed: number;

  goalSuccess: { rate: number; succeeded: number; failed: number };
  spendingFulfillment: { fullRate: number; averageRate: number | null };
  assetSurvival: { rate: number; throughAge: number };

  hardGoalSuccess: {
    rate: number;
    succeeded: number;
    failed: number;
    /** 이 비율이 실제로 판정한 HARD 목표 */
    judged: RetirementGoalType[];
    /** HARD로 골랐으나 이 비율이 판정하지 않은 목표 */
    unjudged: RetirementGoalType[];
  } | null;
}
```

**세 지표 사이에 폴백을 두지 않는다.** 요구가 「서로 다른 KPI로 분리」인데 하나가 없을 때 다른
값을 끼우면 분리한 의미가 사라진다.

**비율과 함께 개수를 싣는다.** 요구가 「PDF 모든 영역이 동일한 success/failure count를 참조」
이므로 비율만으로는 부족하다. `trials`가 함께 있어야 개수가 검증된다.

**HARD 목표가 없으면 `null`이다.** 세 플래그가 전부 거짓이면 모든 시행이 통과해 100%가 되는데,
그 숫자는 참이지만 오해를 부른다. 숫자가 아니라 부재로 표현한다.

**`unjudged`는 셀렉터가 계산한다.** 사용자가 HARD로 고른 목표 집합과
`isQuantitativelyJudgedGoal()`의 교집합/차집합이므로 엔진 변경 없이 구할 수 있다. 엔진에
필드를 더 만들지 않는 편이 변경 범위가 작다.

### 4. 소비처는 셀렉터만 본다

PDF와 화면의 폴백 체인을 제거하고 `resolveSimulationVerdict()` 호출로 바꾼다. 이는 새 관례가
아니라 기존 관례의 확장이다 — `describeSuccessRates`가 이미 "화면과 PDF가 같은 문장을 인쇄해야
하고 그 판정 규칙은 전부 core의 것"이라는 이유로 같은 자리에 있다.

**`unjudged`가 비어 있지 않으면 비율을 단독 표시하지 않는다.** 「HARD 목표 5개 중 2개 기준」
같은 단서를 함께 낸다. 이 관례도 이미 존재한다 — `unmeasuredGoals`가 같은 목적으로 있고
`DashboardSection.tsx:676`과 `pdfReportSections.ts:243`이 소비한다.

## 도달 가능성 5단계

1. **UI에서 생성 가능한가** — 목표 카드가 `RETIREMENT_GOAL_CONSTRAINT_LABELS`
   (`반드시 지키기`/`가능하면 달성`)로 강도를 노출한다.
2. **저장 가능한가** — `RetirementGoal.constraintType`이 시나리오에 저장된다.
3. **migration 후에도 유지되는가** — `migrateRetirementGoals`가 목표를 정규화하며 강도를
   보존한다.
4. **추천/자동생성 경로에서 만들어지는가** — `compileStrategy`가 `params.retirementGoals`를
   읽어 `createGoalUtilityConfig`로 넘긴다(`compileStrategy.ts:322`).
5. **production call graph에서 도달하는가** — `MonteCarloEngine`은
   `monteCarlo.worker.ts`·`strategyOptimization.worker.ts`·`StrategyOptimizer`·
   `RecommendationEngine`에서 호출된다.

다섯 단계가 모두 이어진다. HARD 목표는 production 기능이며 이 변경은 사용자가 보는 결과를
바꾼다 — 정확히는 **새 지표를 추가**하며, 기존 지표의 값은 바꾸지 않는다(§테스트 참조).

## 호환성 처리

| 경계 | 처리 |
| --- | --- |
| 저장 데이터 | 영향 없음. `MonteCarloResult`는 저장되지 않는다 |
| Worker 프로토콜 | `hardGoalSuccessProbability?: number` optional 추가. 앱과 같은 번들이라 버전 불일치 없음 |
| `/api/ai-advisor` | 무변경. 호출부만 셀렉터에서 값을 꺼내 넘기도록 바꾼다 |
| `MonteCarloResult` 기존 필드 | 전부 유지. `simulationSuccessRate` 별칭도 그대로 둔다 |

## 테스트

**신규**
- `resolveSimulationVerdict` — 세 지표가 서로 폴백하지 않는다. `available: false`가 `0`과
  구분된다. HARD 목표가 없으면 `hardGoalSuccess`가 `null`이다.
- `unjudged` 계산 — 판정 불가 목표(주거 안정 등)를 HARD로 고른 시나리오에서 그 목표가
  `unjudged`에 들어가고 `judged`에는 없다.
- `MonteCarloEngine` — HARD 목표가 있는 픽스처에서 `hardGoalSuccessProbability`가 전체
  `goalSuccessProbability`와 **달라지는** 경우를 고정한다. 두 값이 같은 픽스처만으로는
  판별력이 없다.

**회귀**
- PDF 골든(`reportCapture.json`)이 `성공률 82%`·`92%`를 담고 있다. 폴백 제거 후에도 정상
  경로에서 이 숫자가 바뀌지 않아야 한다. 바뀌면 폴백이 실제로 다른 값을 주고 있었다는 뜻이며
  그 자체가 발견이다.
- MC 결과가 없는 상태에서 「0%」가 아니라 「판정 없음」이 나온다.

## 위키 갱신

`AGENTS.md` 문서 현행화 원칙에 따라 같은 커밋에서 갱신한다.

- `docs/wiki/concepts/HARD와 SOFT 목표.md` — HARD 목표가 이제 Monte Carlo 성공률에도 반영된다는
  사실과, 판정 불가 목표는 그 비율에서 제외되고 `unjudged`로 드러난다는 계약을 추가한다.

## 위험

- **`unjudged` 단서를 소비처가 빠뜨리면 known-issues 1번이 재발한다.** 셀렉터가 데이터를 주는
  것만으로는 부족하고, 화면·PDF가 실제로 표시해야 한다. 테스트로 고정한다.
- **폴백 제거가 값을 바꿀 수 있다.** 지금 폴백이 실제로 다른 값을 주고 있었다면 골든이 깨진다.
  그때는 어느 값이 옳은지 판단해야 하며, 조용히 골든을 재캡처하지 않는다.
- **HARD 성공률이 전체 성공률보다 높게 나온다.** HARD 조건이 전체 조건의 부분집합이므로
  수학적으로 당연하지만, 화면에 나란히 놓이면 사용자가 모순으로 읽을 수 있다. 두 지표의
  관계를 설명하는 문구가 필요하다 — `describeSuccessRates`의 `compositeNote`가 이미 같은
  목적의 자리다.

## 완료 기준

- `resolveSimulationVerdict`가 존재하고, PDF와 화면의 폴백 체인이 제거되어 두 경로가 이 셀렉터
  하나만 호출한다.
- `hardGoalSuccess`가 판정된 목표와 판정하지 않은 목표를 함께 싣고, `unjudged`가 비어 있지
  않으면 화면·PDF가 단서를 표시한다.
- MC 결과가 없을 때 「판정 없음」이 표시되고 「0%」가 표시되지 않는다.
- PDF 골든이 정상 경로에서 변하지 않는다.
- `npm test` 통과. HARD 성공률이 전체 성공률과 달라지는 픽스처가 테스트에 있다.
- `docs/wiki/concepts/HARD와 SOFT 목표.md`가 같은 커밋에서 갱신된다.
