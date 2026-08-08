# 배우자 기능 전체 제거 설계

작성일: 2026-08-08

## 배경

`feat: 배우자 명의 국민연금 제거`(58bf979)로 배우자 명의 연금은 이미 사라졌다.
남은 배우자 기능은 세 가지 규칙뿐이다 — 가구 종료 나이 연장, 1인 생존 시 생활비 계수(0.7),
본인 사후 유족연금 승계(60%). 이 셋을 유지하려면 입력 필드 3개, 전용 유즈케이스 모듈,
결과 타입 필드 3개(`spouseAlive`, `spendingFactor`, `householdEndAge`)와 그것을 읽는
20여 개 소비처가 함께 남아야 한다.

배우자 개념을 제품에서 걷어내기로 했으므로, 그 개념에서만 파생된 코드도 함께 제거한다.
"항상 1인 계수"나 "항상 본인 기대수명인 종료 나이"를 남기면 아무도 바꿀 수 없는 죽은
분기가 되고, 그 분기를 전제로 한 주석이 다음 사람을 오독하게 만든다.

## 목표

- 시뮬레이션은 **본인 1인 기준**으로만 돈다. 종료 나이는 항상 `userProfile.expectancy`.
- 배우자에서 파생된 결과 필드와 계산 규칙을 모두 제거한다.
- 기존 저장 시나리오는 계속 열려야 한다.

## 비목표

- 배우자와 무관한 리팩터링
- `householdEndAge` 외의 결과 필드 정리
- 생활비/의료비 계산 규칙 자체의 변경 (계수 곱셈이 사라지는 것 외에)

## 변경 설계

### 1. 입력 계층

| 파일 | 변경 |
|---|---|
| `core/entities/types.ts` | `SpouseProfile` 인터페이스, `SimulationParams.spouse` 삭제 |
| `web/features/StrategySettings/sections/BasicInfoSection.tsx` | 배우자 스위치, 배우자 나이/기대수명 입력, 나이 모순 경고 삭제. 본인 3필드만 남는다 |
| `web/features/StrategySettings/strategyOptions.tsx` | `SPOUSE_EXPECTANCY_BONUS`, `createDefaultSpouse` 삭제 |
| `web/features/StrategySettings/fieldVisibility.ts` | `spouse.enabled/currentAge/expectancy` 경로 삭제 (전체 목록 + 간편 모드 목록) |
| `web/features/StrategySettings/diffDefaults.ts` | 주석의 spouse 언급 정리 |

**저장 데이터 호환**: `initialParams`에 `spouse`가 없고, 타입에서 제거된 뒤에는 저장 JSON에
남은 `spouse` 키를 읽는 코드가 존재하지 않는다. 별도 마이그레이션은 하지 않는다.

### 2. 엔진

- `core/usecases/spouse/spouseRules.ts` **삭제** (`SINGLE_SURVIVOR_SPENDING_FACTOR`,
  `SURVIVOR_PENSION_INHERIT_RATE`, `resolveSpouse`, `computeHouseholdEndAge`,
  `computeSpendingFactor`, `inheritSurvivorPension`). 디렉터리째 사라진다.
- `core/usecases/SimulationEngine.ts`
  - `resolvedSpouse` / `spouseAlive` / `spendingFactor` 지역 변수 제거
  - `endAge = userProfile.expectancy`
  - 본인 사후 유족연금 승계 분기 제거 (본인 사망 = 시뮬레이션 종료이므로 도달 불가)
  - `computeRetirementTargetAssets`의 `spendingFactorAtRetirement` 파라미터 제거
  - `meetsSustainabilityGoal`의 `year.spendingFactor` 곱셈 제거
- `core/usecases/healthcare/healthcareCosts.ts`: `HealthcareCostInput.spendingFactor`와
  `recurring`/`oneTime`/`total`의 곱셈 제거
- `core/usecases/montecarlo/horizon.ts`: `expectancy - currentAge + 1`로 직접 계산

### 3. 결과 타입과 소비처

**제거 대상**
- `SimulationYearlyResult.spouseAlive`
- `SimulationYearlyResult.spendingFactor` 및 `SpendingFactor` 타입
- `SimulationResult.householdEndAge`

**`spendingFactor` 곱셈이 사라지는 곳**: `utility/UtilityEngine.ts`,
`utility/explainUtilityComponents.ts`, `MonthlySpendingComposition.ts`,
`SimulationEngine.meetsSustainabilityGoal`

**`householdEndAge` → `userProfile.expectancy` 대체**: `dashboard/computeRiskAlerts.ts`,
`dashboard/computeSensitivityAnalysis.ts`, `dashboard/describeDepletionAge.ts`,
`dashboard/describeFireAge.ts`, `dashboard/generateChartCaptions.ts`,
`dashboard/resolvePlanAssetStatus.ts`, `dashboard/computeExecutionRoadmap.ts`,
`strategy/RecommendationEngine.ts`, `utility/UtilityEngine.ts`,
`utility/explainUtilityComponents.ts`, `montecarlo/MonteCarloEngine.ts`,
`entities/montecarlo.ts`(주석), `web/features/Dashboard/hero/heroHeadline.ts`,
`hero/AiSummaryHero.tsx`, `DashboardSection.tsx`, `app/simulator/page.tsx`

`params`를 이미 받는 함수는 `params.userProfile.expectancy`를 쓴다.
`resolvePlanAssetStatus(result)`처럼 `result`만 받던 함수는 `expectancy`를 인자로 추가하고
호출부를 함께 고친다.

**문구 정리**: `describeDepletionAge`, `describeFireAge`, `generateChartCaptions`,
`heroHeadline`, PDF(`app/simulator/page.tsx`)의 "배우자 기대수명 시점(본인 나이 N세)" 분기를
삭제하고 단일 문구(`기대수명(N세)까지 …`)로 만든다. `ExecutionRoadmap.tsx`,
`DashboardSection.tsx`의 배우자 언급 주석도 현재 사실에 맞게 고친다.

### 4. 테스트 (TDD)

테스트를 먼저 고쳐 Red를 만든 뒤 구현한다.

- **삭제**: `tests/core/usecases/SimulationEngine.spouse.test.ts`,
  `tests/core/usecases/spouse/spouseRules.test.ts`
- **수정**: `montecarlo/horizon.test.ts`, `montecarlo/MonteCarloEngine.test.ts`,
  `SimulationEngine.healthcare.test.ts`, `SimulationEngine.retirementScoreWiring.test.ts`,
  `SimulationEngine.targetAssets.test.ts`, `MonthlySpendingComposition.test.ts`,
  `dashboard/computeExecutionRoadmap.test.ts`, `strategy/RecommendationEngine.test.ts`,
  `tests/fixtures/yearlyResult.ts`,
  `web/features/StrategySettings/sections/BasicInfoSection.test.tsx`,
  `web/features/StrategySettings/sectionFieldCoverage.test.tsx`

`retirementScoreWiring.test.ts`는 "배우자가 은퇴 전 사망하면 계수가 0.7"이라는 시나리오로
`computeRetirementTargetAssets` 배선을 검증한다. 배우자가 없으면 이 시나리오는 성립하지
않으므로, **의료비를 켠 시나리오로 같은 배선(은퇴 시점 의료비가 목표 자산 분모에 들어가는지)을
검증하도록 바꾼다** — 삭제하지 않는다.

## 위험

- **점수·효용 수치 변화**: 배우자를 켜 둔 저장 시나리오는 종료 나이와 생활비 계수가 바뀌므로
  점수가 달라진다. 의도된 결과다.
- **함수 시그니처 변경 누락**: `householdEndAge` 제거는 타입 에러로 전부 드러난다.
  `npx tsc --noEmit`을 완료 기준에 포함한다.

## 완료 기준

- `grep -ri "spouse\|배우자" src`가 비어 있다
- `npx tsc --noEmit` 통과
- `npm test` 전체 통과
