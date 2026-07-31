# 은퇴 전략 설정 화면 재설계 (Retirement Strategy Settings)

작성일: 2026-07-31

## 배경과 문제

계산 엔진은 고급인데 설정 화면이 그 수준을 따라가지 못한다.

현재 좌측 입력 패널은 다음과 같이 흩어져 있다.

```
QuickSettingsSummary        현재나이 / 은퇴나이 / 목표월생활비 / 수익률 프리셋
└ Collapse "설정 자세히 보기"
   ├ AssetFormSection       1655줄, 5탭(프로필/주식/연금/ISA/기타소득)
   ├ SimulationSettings     239줄, 통화·환율·물가·실질수익률·저율과세
   └ TaxSettingsSection     142줄, 세금 상세
```

사용자가 만나는 것은 "경제 변수 입력 폼"이지 "은퇴 전략"이 아니다.

한편 엔진에는 **UI가 전혀 없는 고급 파라미터**가 이미 존재한다.
`WithdrawalPlan`의 다섯 필드(`nationalPensionStartAge`, `privatePensionMonthlyTarget`,
`assetSellOrderStrategy`, `isaMaturityDestination`, `generalAssetWithdrawalStartAge`)는
AI 추천 엔진(`RecommendationEngine`)만이 생성하며 사용자는 손댈 수 없다.
`UtilityConfig`도 `recommendStrategy(params, cfg)` 시그니처로 주입 가능하지만
항상 `DEFAULT_UTILITY_CONFIG`만 쓰인다.

즉 이번 작업의 절반은 "새 기능 추가"가 아니라 **이미 있는 엔진 능력을 사용자에게 여는 것**이다.

## 목표

설정을 마친 사용자가 "내 은퇴 전략을 내가 설계했다"고 느끼게 한다.
항목 수는 늘어나지만 복잡해 보이면 안 된다.

## 비목표 (이번 범위에서 제외)

- 몬테카를로 시뮬레이션. 경제 시나리오는 결정론적 프리셋으로만 구현한다.
- 예정 세법(개정안) 데이터 탑재. 버전 분기 구조만 만들고 `'current'` 하나만 채운다.
- 배우자 계좌 분리. 자산·ISA·사적연금은 가구 합산 하나로 유지한다.
- `AssetFormSection`(1655줄) 내부 재작성. 자산 입력은 현 구조 그대로 둔다.

---

## 아키텍처: 전략 컴파일러

### 핵심 결정

새로 추가하는 전략 enum들을 `SimulationEngine`에 직접 넣지 **않는다**.
대신 사용자 언어(전략)를 엔진 언어(저수준 파라미터)로 번역하는 순수 함수를 둔다.

```
src/core/usecases/strategy/compileStrategy.ts

export interface CompiledStrategy {
  params: SimulationParams;      // 저수준 파라미터가 채워진 결과
  utilityConfig: UtilityConfig;  // 목적 함수
}

export function compileStrategy(params: SimulationParams): CompiledStrategy
```

`SimulationEngine`은 `RetirementStrategy` 타입의 존재조차 모른다.
따라서 아래 8개 항목은 **엔진 코드를 한 줄도 바꾸지 않고** 동작한다.

| 사용자 선택 | 컴파일 결과 |
| --- | --- |
| 목표 우선순위 | `UtilityConfig.weights` 프리셋 |
| 상속 전략 | `userProfile.targetBequest` |
| 국민연금 수령 전략 | `withdrawalPlan.nationalPensionStartAge` |
| 사적연금 전략 | `taxSettings.limitPrivatePensionToTaxLimit` + `withdrawalPlan.privatePensionMonthlyTarget` |
| ISA 우선 사용 | `withdrawalPlan.isaMaturityDestination` |
| ~~배당 재투자~~ | **컴파일 대상이 아님** — ③연금 전략의 스위치는 눌린 순간에만 `assets[].reinvestDividend`를 일괄 갱신하는 "버튼"이다. 매 컴파일마다 덮어쓰면 `AssetFormSection`의 자산별 토글이 조용히 뭉개진다(Task 7 리뷰에서 발견). |
| 리스크 성향 | `yieldPreset` (기존 `applyYieldPreset` 재사용) |
| 경제 시나리오 | `inflationRate` + 수익률 + `exchangeScenario` |

이 설계의 이점:

- 회귀 리스크 격리 — 엔진 변경 없이 전략 기능 대부분이 붙는다.
- 테스트 용이성 — 순수 함수라 입력/출력 단위 테스트로 전수 검증이 가능하다.
- 되돌리기 쉬움 — 전략 필드가 없으면(`params.strategy === undefined`) 컴파일러는 입력을 그대로 통과시킨다. 기존 저장 시나리오는 100% 그대로 동작한다.

### `'ai_*'` 값의 의미

`nationalPensionStrategy: 'ai_optimized'` 같은 값은 컴파일 시점에 **baseline(identity)
값으로 내려간다**. 실제 AI 값은 `recommendStrategy` 실행 후 사용자가 "적용"을 눌렀을 때
확정 enum(예: `'defer_max'`)으로 치환되어 저장된다.

이유: 컴파일러는 순수 함수여야 하는데 AI 추천은 시뮬레이션 N회 실행이 필요하다.
`'ai_*'`를 "아직 미정, 기본값으로 두되 AI 제안을 받겠다"는 표식으로 정의하면
컴파일러의 순수성이 유지된다.

### 엔진을 실제로 고쳐야 하는 3가지

컴파일러로 덮을 수 없는 것들:

1. **배우자 생존/연금** — 연도별 루프의 생존 판정과 생활비 계수 (5단계)
2. **의료비 지출 레이어** — 연도별 루프의 지출 계산 + 결과 필드 추가 (9단계)
3. **세법 버전** — `taxRates.ts`의 상수를 버전 프로필로 구조화 (10단계)

---

## 데이터 모델

`src/core/entities/types.ts`에 추가한다.

### 전략 enum

```ts
export type StrategyMode = 'simple' | 'standard' | 'expert';

export type ObjectivePriority =
  | 'lifetime_spending'      // 평생 생활비 확보
  | 'tax_minimization'       // 세금 최소화
  | 'wealth_maximization'    // 자산 최대화
  | 'bequest_maximization'   // 상속 최대화
  | 'ai_recommended';

export type BequestStrategy =
  | 'spend_all'      // 모두 사용
  | 'leave_some'     // 일부 남기기
  | 'maximize'       // 최대 상속
  | 'target_amount'; // 목표 금액 유지 (금액 직접 입력)

export type NationalPensionStrategy =
  | 'normal' | 'defer_1y' | 'defer_2y' | 'defer_max' | 'ai_optimized';

export type PrivatePensionStrategy =
  | 'tax_first'       // 절세 우선
  | 'spending_first'  // 생활비 우선
  | 'growth_first'    // 자산 성장 우선
  | 'minimum'         // 최소 인출
  | 'ai_optimized';

export type RiskProfile = 'conservative' | 'neutral' | 'aggressive' | 'ai_recommended';

export type EconomicScenario =
  | 'long_term_average' | 'recession' | 'high_inflation' | 'low_growth' | 'ai_recommended';

export type TaxLawVersion = 'current';

// 엔진의 SpendingStrategy 3종 + 'ai'. 'ai'는 엔진에 없는 값이므로 compileStrategy가
// 'target'으로 내리지만, 선택 상태 자체는 strategy.spendingChoice에 남는다 —
// params.spendingStrategy 하나에만 저장하면 'AI 추천'을 고른 사실이 사라진다.
export type SpendingStrategyChoice = SpendingStrategy | 'ai';

export interface RetirementStrategy {
  mode: StrategyMode;
  objective: ObjectivePriority;
  spendingChoice: SpendingStrategyChoice;
  bequestStrategy: BequestStrategy;
  nationalPensionStrategy: NationalPensionStrategy;
  privatePensionStrategy: PrivatePensionStrategy;
  preferIsaFirst: boolean;
  riskProfile: RiskProfile;
  economicScenario: EconomicScenario;
}
```

### 배우자

```ts
export interface SpouseProfile {
  enabled: boolean;
  currentAge: number;
  expectancy: number;
  nationalPensionMonthlyAmount: number;  // 65세 기준 금액 (본인과 동일 해석)
  nationalPensionStartAge: number;       // 60~70
}
```

### 의료비·장기요양

```ts
export interface HealthcareAssumptions {
  enabled: boolean;
  costGrowthRate: number;        // 의료비 증가율 %, 기본 5 (일반 물가보다 높게)
  baseMonthlyCost: number;       // 은퇴 시점 기준 월 의료비 (오늘 화폐가치)
  longTermCareEnabled: boolean;
  longTermCareStartAge: number;  // 기본 80
  longTermCareMonthlyCost: number;
  shockEnabled: boolean;
  shockAge: number;
  shockAmount: number;           // 일회성 목돈
}
```

### `SimulationParams` 확장

```ts
export interface SimulationParams {
  // ... 기존 필드 그대로 ...
  strategy?: RetirementStrategy;
  spouse?: SpouseProfile;
  healthcare?: HealthcareAssumptions;
  taxLawVersion?: TaxLawVersion;
}
```

전부 optional이다. 저장된 기존 시나리오는 마이그레이션 없이 그대로 로드된다.

### `SimulationYearlyResult` 확장

```ts
  healthcareSpending: number;  // 연간 의료비 지출 (spending에 포함된 금액 중 의료비분)
  spouseAlive: boolean;        // 해당 연도 배우자 생존 여부
```

`spending`은 기존 의미(생활비 총 인출)를 유지하고 의료비를 포함한다.
`healthcareSpending`은 그중 의료비가 얼마인지 분해해 보여주기 위한 정보성 필드다.

---

## 컴파일 매핑 상세

### 목표 우선순위 → `UtilityConfig.weights`

가중치 합은 반드시 100이어야 하며 `createUtilityConfig`가 이를 강제한다.

| 우선순위 | consumption | depletionSafety | pensionUtilization | taxEfficiency | taxationRisk | bequestAdequacy |
| --- | --- | --- | --- | --- | --- | --- |
| (기본값) | 35 | 20 | 15 | 10 | 10 | 10 |
| 평생 생활비 확보 | 45 | 25 | 15 | 5 | 5 | 5 |
| 세금 최소화 | 25 | 15 | 15 | 25 | 15 | 5 |
| 자산 최대화 | 25 | 30 | 15 | 10 | 5 | 15 |
| 상속 최대화 | 20 | 20 | 10 | 10 | 5 | 35 |
| AI 추천 | 기본값 사용 (AI가 별도 제안) | | | | | |

### 상속 전략 → `targetBequest`

| 전략 | `targetBequest` |
| --- | --- |
| 모두 사용 | `0` |
| 일부 남기기 | `targetMonthlySpending * 24` (`appropriateBequestMonths` 기본값과 일치) |
| 최대 상속 | `undefined` (미지정 → `UtilityEngine` 기존 공식 사용) + `objective`를 상속 가중치로 보강 |
| 목표 금액 유지 | 사용자 입력 금액 |

### 국민연금 전략 → `nationalPensionStartAge`

`NATIONAL_PENSION_NORMAL_START_AGE = 65`, `NATIONAL_PENSION_DEFERRED_MAX_AGE = 70` 기준.

| 전략 | 나이 | 연기 가산 (0.6%/월) |
| --- | --- | --- |
| 예상 수령 | 65 | +0% |
| 1년 연기 | 66 | +7.2% |
| 2년 연기 | 67 | +14.4% |
| 최대 연기 | 70 | +36% |
| AI 최적화 | 65 (baseline) | AI 제안 후 치환 |

### 사적연금 전략 → 파라미터

| 전략 | `limitPrivatePensionToTaxLimit` | `privatePensionMonthlyTarget` |
| --- | --- | --- |
| 절세 우선 | `true` | `privatePensionLimit / 12` |
| 생활비 우선 | `false` | `undefined` (엔진 기존 균등분할) |
| 자산 성장 우선 | `true` | `privatePensionLimit / 12 * 0.5` |
| 최소 인출 | `true` | 저율과세 한도의 25% |
| AI 최적화 | baseline(`false`, `undefined`) | AI 제안 후 치환 |

### 리스크 성향 → `yieldPreset`

기존 `applyYieldPreset`을 그대로 호출한다.
안정형 → `'conservative'`, 중립형 → `'base'`, 공격형 → `'aggressive'`.

### 경제 시나리오 → 경제 변수 묶음

| 시나리오 | inflationRate | 주식 수익률 | 연금 수익률 | exchangeScenario |
| --- | --- | --- | --- | --- |
| 장기 평균 | 2.5 | 7 | 4 | `base` |
| 장기 침체 | 1.5 | 3 | 2 | `usd_up` |
| 고물가 | 5.0 | 6 | 3 | `usd_up` |
| 저성장 | 2.0 | 4 | 2.5 | `base` |
| AI 추천 | 장기 평균 사용 | | | |

리스크 성향과 경제 시나리오가 둘 다 수익률을 건드린다. 충돌 규칙을 명시한다.

**적용 순서는 경제 시나리오 → 리스크 성향**이며, 리스크 성향이 최종 승자다
(사용자가 "공격형"을 골랐다면 침체 시나리오에서도 공격적 배분을 유지한다는 의미).
단 `riskProfile === 'ai_recommended'`이면 리스크 성향은 수익률을 덮어쓰지 않고
시나리오가 정한 수익률을 그대로 둔다 — `'ai_*'`는 "미정"이지 "중립형"이 아니기 때문이다.

물가·환율은 어느 경우에나 시나리오가 지배한다.
UI 설명문에 "시나리오는 물가·환율을, 리스크 성향은 수익률을 결정합니다"로 명시한다.

---

## 엔진 변경 상세

### 1. 배우자 (5단계)

`SimulationEngine`의 연도 루프(`endAge = userProfile.expectancy`, 약 325행)에 개입한다.

- **종료 나이**: `endAge = max(userProfile.expectancy, 배우자 사망 시 본인 나이)`.
  배우자 사망 시 본인 나이 = `userProfile.currentAge + (spouse.expectancy - spouse.currentAge)`.
- **생존 판정**: 각 연도에 `selfAlive` / `spouseAlive`를 계산한다.
- **생활비 계수**: 둘 다 생존이면 `1.0`, 한 명만 생존이면 `0.7`을 곱한다.
  (통계청 가계동향의 1인/2인 가구 소비지출 비를 단순화한 값. 상수로 추출해 근거를 주석에 남긴다.)
- **국민연금**: 각자의 개시 나이·조정 계수로 계산해 합산한다.
  본인 사망 후에는 배우자가 유족연금으로 본인 연금의 60%를 승계하되,
  중복조정으로 배우자 본인 연금과 합산하지 않고 **큰 쪽만** 수령한다(단순화).
- **회귀 보장**: `spouse === undefined || spouse.enabled === false`이면
  기존 코드 경로와 완전히 동일해야 한다. 이를 검증하는 테스트를 필수로 넣는다.

### 2. 의료비 지출 레이어 (9단계)

연도 루프의 지출 계산부(`annualSpending`, 약 348~676행)에 지출 라인을 추가한다.

```
연간 의료비 =
    baseMonthlyCost * 12 * (1 + costGrowthRate/100)^(경과연수)
  + (장기요양 발생 && age >= longTermCareStartAge ? longTermCareMonthlyCost * 12 * 동일 성장 : 0)
  + (shock && age === shockAge ? shockAmount : 0)
```

- `inflationMode === 'real'`이면 실질 기준으로 일관되게 처리한다.
  즉 실질 모드에서는 `costGrowthRate - inflationRate`를 초과 상승분으로 적용한다.
- 은퇴 전(`age < retirementAge`)에는 적용하지 않는다. 근로소득 가정이 없는 모델이라
  은퇴 전 의료비를 넣으면 자산이 부당하게 깎인다.
- `healthcare === undefined || enabled === false`이면 전부 0 — 기존 결과 불변.

### 3. 세법 버전 (10단계)

`taxRates.ts`의 개별 상수들을 하나의 프로필 객체로 묶는다.

```ts
export interface TaxLawProfile {
  financialIncomeThresholdKRW: number;
  isaAnnualLimitKRW: number;
  isaExemptionGeneralKRW: number;
  isaExemptionLowIncomeKRW: number;
  isaMaturityTaxRate: number;
  nationalPensionTaxRate: number;
  privatePensionBrackets: { minAge: number; maxAge: number; rate: number }[];
  privatePensionLimitKRW: number;
  privatePensionExcessTaxRate: number;
  comprehensiveIncomeBrackets: ProgressiveTaxBracket[];
}

export const TAX_LAW_PROFILES: Record<TaxLawVersion, TaxLawProfile> = {
  current: { /* 지금 값 그대로 */ },
};

export function resolveTaxLawProfile(version?: TaxLawVersion): TaxLawProfile
```

기존 개별 export 상수는 `TAX_LAW_PROFILES.current`를 참조하도록 바꿔 유지한다
(외부 import가 깨지지 않게 하고, 값의 단일 소스는 프로필 쪽으로 옮긴다).
셀렉터는 UI에 노출하되 선택지가 1개다. 허구의 개정안을 지어내지 않는다.

---

## UI 설계

### 정보 구조

좌측 패널을 두 덩어리로 나눈다.

```
┌ 좌측 패널 ───────────────────────────┐
│ [간편 ⭐] [표준] [전문가]   ← 전략 모드  │
│                                      │
│ ▣ 내 은퇴 전략                        │
│    ① 기본 정보          [2개 변경]     │
│    ② 은퇴 목표    ⭐    [AI 추천]      │
│    ③ 연금 전략          [AI 추천]      │
│    ④ 투자 전략          [AI 추천]      │
│    ⑤ 경제 가정                        │
│    ⑥ 고급 설정  (기본 접힘)            │
│                                      │
│ ▣ 내 자산  (기존 AssetFormSection)     │
│ ▣ 시나리오 관리                       │
└──────────────────────────────────────┘
```

`QuickSettingsSummary`는 ①기본 정보 + ④투자 전략에 흡수되어 제거된다.
`SimulationSettings`는 ⑤경제 가정으로, `TaxSettingsSection`은 ⑥고급 설정으로 이전 후 제거된다.

### 전략 모드별 노출

`fieldVisibility.ts`가 모드별 노출 필드를 선언하는 **단일 소스**다.
각 섹션이 개별적으로 `mode === 'expert'` 조건문을 흩뿌리지 않는다.

| 모드 | 노출 |
| --- | --- |
| 간편 | ①의 나이 3개, ②의 생활비 전략·목표 우선순위, ③의 국민연금·사적연금 전략. 나머지는 AI 기본값 |
| 표준 | 간편 + ④투자 전략 + ⑤경제 가정 주요 항목 |
| 전문가 | 전부 + ⑥고급 설정 자동 펼침 |

모드를 낮춰도 값은 보존한다(숨김일 뿐 초기화 아님).
숨겨진 필드 중 기본값과 다른 것이 있으면 섹션 헤더에 "숨겨진 사용자 설정 N개"를 표시해
"안 보이는 값이 결과에 영향을 준다"는 사실을 숨기지 않는다.

### 재사용 폼 컴포넌트

`src/web/components/form/` 에 신규 작성한다. 스타일은 **Tailwind v4**로 통일한다
(`QuickSettingsSummary`가 이미 Tailwind이고, `SimulationSettings`의 CSS Module +
인라인 스타일 혼용은 이번에 정리 대상이다).

| 컴포넌트 | 역할 |
| --- | --- |
| `SettingSection` | 아코디언 셸. 아이콘·제목·접힘 시 한 줄 요약·`[AI 추천]` 버튼·변경 개수 배지 |
| `RadioCardGroup` | 아이콘 + 라벨 + 2줄 이하 설명의 카드형 라디오. enum 기반 |
| `SwitchField` | 설명문을 포함하는 스위치 |
| `FieldRow` | 라벨 + `?` 툴팁 + 입력 + `사용자 설정` 배지 + AI 추천 힌트 |
| `HelpTip` | 기존 `ui/Tooltip` 래핑. `glossary` 키를 받으면 용어 설명을 자동 표시 |

`RadioCardGroup`의 옵션 메타(라벨/아이콘/설명/툴팁)는 `strategyOptions.ts` 한 곳에서
enum별로 정의한다. 컴포넌트에 문자열을 하드코딩하지 않는다.

### 기능 디렉터리

```
src/web/features/StrategySettings/
  StrategySettingsPanel.tsx      6섹션 컨테이너 + 모드 셀렉터
  StrategyModeSelector.tsx
  sections/
    BasicInfoSection.tsx           ①
    RetirementGoalSection.tsx      ②
    PensionStrategySection.tsx     ③
    InvestmentStrategySection.tsx  ④
    EconomicAssumptionSection.tsx  ⑤
    AdvancedSection.tsx            ⑥
  fieldVisibility.ts             모드별 노출 매트릭스
  strategyOptions.ts             enum → 라벨/아이콘/설명/툴팁 메타
  diffDefaults.ts                기본값 대비 변경 필드 집합
  useAiRecommendation.ts         AI 추천 1회 실행 + 캐시 + 섹션별 부분 적용
```

### 상태 관리

모든 섹션 컴포넌트는 `{ params, onChangeParams }` 인터페이스를 쓴다.
`SimulationSettings`가 쓰던 "`scenarioState` 통째 주입" 패턴은 폐기한다
(테스트가 어렵고 컴포넌트가 시나리오 저장 로직에 결합된다).

단일 소스는 기존 `activeParams` 그대로다. 즉시 반영은 현재 `useDeferredValue` 경로가
이미 처리하므로 추가 작업이 없다.

### 사용자 설정 배지 / 변경 하이라이트

`diffDefaults.ts`가 `initialParams`와 현재 `params`를 필드 경로(`'userProfile.currentAge'`)
단위로 비교해 변경된 경로의 `Set`을 만든다. `FieldRow`가 자기 경로가 그 집합에 있으면
`사용자 설정` 배지를 붙인다. 섹션 헤더의 개수 배지도 같은 집합에서 계산한다.

최근 변경 하이라이트는 `StrategySettingsPanel`의 로컬 state로 처리한다
(마지막 변경 경로를 기록하고 2초 후 해제).

### AI 추천 동작

`useAiRecommendation`이 `recommendStrategy(params, utilityConfig)`를 **1회** 실행하고
결과를 캐시한다. 각 섹션의 `[AI 추천]` 버튼은 그 결과 중 **자기 섹션 소관 필드만** 적용한다.

| 섹션 | 적용 필드 |
| --- | --- |
| ② 은퇴 목표 | `monthlySpendingMultiplier` → 생활비, 목표 우선순위 제안 |
| ③ 연금 전략 | `nationalPensionStartAge` → `nationalPensionStrategy`, `privatePensionMonthlyTarget` → `privatePensionStrategy`, `isaMaturityDestination` → `preferIsaFirst` |
| ④ 투자 전략 | `recommendedAssetReinvestment` → 자산별 `reinvestDividend` 직접 적용 |

적용 전에는 값 옆에 `AI 추천: 70세` 형태의 힌트만 보여준다.
사용자가 명시적으로 버튼을 눌러야 값이 바뀐다 — 조용한 덮어쓰기는 하지 않는다.

`recommendation.improved === false`면 "현재 전략이 이미 최적입니다"를 표시하고
버튼을 비활성화한다.

---

## 오류 처리

- **컴파일러**: 순수 함수이며 예외를 던지지 않는다. 알 수 없는 enum 값은
  해당 축의 baseline으로 폴백하고 다른 축은 정상 컴파일한다
  (저장된 옛 시나리오에 없어진 enum 값이 남아 있어도 화면이 죽지 않게).
- **`createUtilityConfig`**: 가중치 합 100 위반 시 던진다. 이는 개발 시점 버그이므로
  프리셋 테이블 전체를 검증하는 테스트로 잡는다.
- **AI 추천 실행 실패**: `recommendStrategy` 예외를 훅에서 잡아 섹션 버튼에
  "추천을 계산하지 못했습니다" 표시. 설정 화면 자체는 계속 동작한다.
- **배우자 나이 모순** (예: 배우자 기대수명 < 현재 나이): 입력 필드 레벨에서 경고를
  띄우고 시뮬레이션에는 `max(expectancy, currentAge)`로 클램프해 넘긴다.

## 테스트 전략

단계마다 테스트를 먼저 쓴다(Red → Green → Refactor).

- **`compileStrategy`**: 각 enum 값별로 기대 파라미터가 나오는지 전수 검증.
  `strategy === undefined`일 때 입력을 그대로 통과시키는지 검증.
- **엔진 회귀 (5·9·10단계 필수)**: `spouse.enabled === false` / `healthcare.enabled === false` /
  `taxLawVersion === 'current'`일 때 변경 전과 **동일한 `SimulationResult`**가 나오는지.
  기존 시나리오 픽스처로 검증한다.
- **배우자 로직**: 배우자가 먼저 사망 / 본인이 먼저 사망 / 동시 두 케이스의
  생활비 계수·국민연금 합산·종료 나이.
- **의료비 로직**: 명목/실질 모드 각각, 장기요양 시작 전후, 쇼크 연도.
- **폼 컴포넌트**: `RadioCardGroup` 선택 변경, `fieldVisibility` 모드별 노출,
  `diffDefaults` 배지 표시.

## 구현 단계

각 단계는 독립 커밋이며 그 시점에 `npm test`가 통과해야 한다.

| # | 내용 | 엔진 변경 |
| --- | --- | --- |
| 1 | 전략 타입 정의 + `compileStrategy` 순수 함수 (목적 함수·상속 전략 축) | 없음 |
| 2 | 공통 폼 컴포넌트 5종 (`SettingSection`/`RadioCardGroup`/`SwitchField`/`FieldRow`/`HelpTip`) | 없음 |
| 3 | 전략 모드 셀렉터 + 6섹션 셸 + `fieldVisibility` + `diffDefaults` 배지/하이라이트 | 없음 |
| 4 | ① 기본 정보 섹션 + `SpouseProfile` 타입 + 배우자 UI (값만 저장) | 없음 |
| 5 | **배우자 엔진 통합** — 생존 판정, 국민연금 합산·유족 전환, 생활비 계수, 종료 나이 | 있음 |
| 6 | ② 은퇴 목표 섹션 + `UtilityConfig` 주입 배선 + `useAiRecommendation` 기반 구축 | 없음 |
| 7 | ③ 연금 전략 섹션 — `WithdrawalPlan`이 처음 사용자에게 열림 | 없음 |
| 8 | ④ 투자 전략 + ⑤ 경제 가정 (리스크 성향, 시나리오 프리셋 테이블) | 없음 |
| 9 | **의료비·장기요양 지출 레이어** + UI + 대시보드 표시 | 있음 |
| 10 | ⑥ 고급 설정 + 세법 버전 프로필화 + 구 컴포넌트 3개 통합/제거 | 있음 |

단계 크기는 균일하지 않다. 5·9·10단계가 가장 무겁고,
2·3단계는 순수 UI 기반 작업이라 상대적으로 가볍다.
