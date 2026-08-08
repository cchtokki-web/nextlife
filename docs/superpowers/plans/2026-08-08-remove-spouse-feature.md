# 배우자 기능 전체 제거 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배우자(부부 기준 계산) 개념과 그로부터 파생된 모든 입력·규칙·결과 필드를 코드베이스에서 제거하고, 시뮬레이션을 본인 1인 기준으로 단일화한다.

**Architecture:** 바깥에서 안으로 4단계로 벗긴다 — (1) 입력 UI, (2) 엔진 규칙, (3) 결과 파생 필드(`spouseAlive`/`spendingFactor`), (4) 결과 종료 나이(`householdEndAge`). 각 단계가 끝날 때 타입 체크와 전체 테스트가 통과하는 상태를 유지한다. 배우자를 제거하면 루프 종료 나이가 항상 `userProfile.expectancy`이므로 본인은 전 구간 생존이고, 1인 생존 계수·유족연금 승계 분기는 도달 불가 코드가 되어 함께 사라진다.

**Tech Stack:** TypeScript(strict), Next.js, React, Vitest + @testing-library/react

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-08-08-remove-spouse-feature-design.md`
- 브랜치: `feat/remove-spouse` (이미 생성됨, base는 `develop`)
- 테스트: `npm test` = `vitest run`. 단일 파일은 `npx vitest run <경로>`
- 타입 체크: `npx tsc --noEmit`
- 주석·커밋 메시지는 한국어. `any` 금지
- 기존 저장 시나리오의 잔여 `spouse` 키는 읽는 코드가 없으므로 마이그레이션하지 않는다
- 배우자와 무관한 리팩터링은 하지 않는다

---

### Task 1: 입력 UI에서 배우자 제거

`SimulationParams.spouse` 타입은 이 태스크에서 건드리지 않는다(Task 2). UI가 더 이상 값을 만들지 않게 하는 것까지가 범위다.

**Files:**
- Modify: `src/web/features/StrategySettings/sections/BasicInfoSection.tsx`
- Modify: `src/web/features/StrategySettings/strategyOptions.tsx:36-58`
- Modify: `src/web/features/StrategySettings/fieldVisibility.ts:15-17,85-87`
- Modify: `src/web/features/StrategySettings/diffDefaults.ts:21-22`
- Test: `src/tests/web/features/StrategySettings/sections/BasicInfoSection.test.tsx`
- Test: `src/tests/web/features/StrategySettings/sectionFieldCoverage.test.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: `BasicInfoSection`은 본인 3필드(`현재 나이`/`목표 은퇴 나이`/`기대수명`)만 렌더한다. `createDefaultSpouse`와 `SPOUSE_EXPECTANCY_BONUS`는 더 이상 존재하지 않는다.

- [ ] **Step 1: 배우자 테스트를 삭제해 실패 상태를 만든다**

`src/tests/web/features/StrategySettings/sections/BasicInfoSection.test.tsx`에서 다음을 삭제한다:
- `createDefaultSpouse` import와 `DEFAULT_SPOUSE` 상수
- `'배우자 스위치가 꺼져 있으면 배우자 입력이 보이지 않는다'`
- `'배우자 스위치를 켜면 기본 배우자 프로필이 저장된다'`
- `describe('배우자 기본값은 본인 값에서 유도한다', …)` 블록 전체
- `'배우자가 켜져 있으면 나이·기대수명만 보이고 연금 입력은 없다'`
- `'배우자 기대수명이 현재 나이보다 작으면 경고를 표시한다'` 및 그 이후의 배우자 관련 테스트 전부

남는 테스트는 본인 3필드 표시/변경 케이스다. 그 대신 아래 테스트를 추가한다:

```tsx
  test('배우자 관련 입력을 렌더하지 않는다', () => {
    renderSection();

    expect(screen.queryByRole('switch', { name: /배우자/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('배우자 나이')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('배우자 기대수명')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/sections/BasicInfoSection.test.tsx`
Expected: FAIL — `createDefaultSpouse` import를 지웠으므로 컴파일은 통과하지만, 새 테스트가 배우자 스위치를 찾아내며 실패한다.

- [ ] **Step 3: BasicInfoSection에서 배우자 UI를 제거한다**

`BasicInfoSection.tsx`를 아래 형태로 만든다. `SpouseProfile`/`SimulationParams`/`createDefaultSpouse` import, `spouse`/`spouseEnabled`/`spouseDefaults`/`setSpouse`/`spouseAgeInvalid`, 배우자 `SwitchField` 블록, 배우자 입력 그리드, 경고 문단이 모두 사라진다.

```tsx
'use client';

import InputField from '../../../components/InputField';
import { FieldRow } from '../../../components/form';
import { AGE_MAX, AGE_MIN, EXPECTANCY_MAX, parseAge } from '../ageInput';
import { isFieldVisible } from '../fieldVisibility';
import { SectionProps } from '../strategyOptions';

export function BasicInfoSection({ params, onChangeParams, mode, changed }: SectionProps) {
  const { userProfile } = params;

  const setProfile = (key: 'currentAge' | 'retirementAge' | 'expectancy', value: number) => {
    onChangeParams({ ...params, userProfile: { ...userProfile, [key]: value } });
  };

  return (
    <div className="grid grid-cols-2 items-end gap-3.5 sm:gap-4">
      {/* 기존 세 개의 FieldRow(현재 나이 / 목표 은퇴 나이 / 기대수명)를 그대로 유지한다 */}
    </div>
  );
}
```

주의: 기존 세 `FieldRow` 블록(39-85행)은 내용을 그대로 옮긴다. 바깥 프래그먼트(`<>…</>`)가 없어지므로 그리드 `div`가 최상위가 된다.

- [ ] **Step 4: strategyOptions에서 배우자 기본값을 제거한다**

`src/web/features/StrategySettings/strategyOptions.tsx`에서 `SPOUSE_EXPECTANCY_BONUS` 상수와 그 주석, `createDefaultSpouse` 함수와 그 주석 블록(36-58행)을 삭제한다. `SpouseProfile` import도 함께 지운다(8행의 타입 import 목록에서 제거). `EXPECTANCY_MAX` import가 다른 곳에서 쓰이지 않게 되면 그것도 지운다.

- [ ] **Step 5: fieldVisibility에서 spouse 경로를 제거한다**

`SECTION_FIELDS.basic`(15-17행)과 `SIMPLE_FIELDS`(85-87행)에서 `'spouse.enabled'`, `'spouse.currentAge'`, `'spouse.expectancy'` 세 줄씩을 삭제한다. `SIMPLE_FIELDS` 위 주석의 "나이 3개"는 그대로 맞다.

- [ ] **Step 6: diffDefaults 주석을 정리한다**

`diffDefaults.ts:21-22`의 주석을 배우자 언급 없이 고친다:

```ts
// healthcare는 initialParams에 없으므로 undefined가 기준이 되고,
// 사용자가 켜는 순간 "변경됨"으로 잡힌다 — 의도한 동작이다.
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/`
Expected: PASS (전 파일). `sectionFieldCoverage.test.tsx`가 spouse 경로를 참조하면 그 참조도 삭제한다.

- [ ] **Step 8: 커밋**

```bash
git add src/web/features/StrategySettings src/tests/web/features/StrategySettings
git commit -m "refactor: 설정 UI에서 배우자 입력 제거"
```

---

### Task 2: 엔진에서 배우자 규칙 제거

**Files:**
- Delete: `src/core/usecases/spouse/spouseRules.ts` (디렉터리째)
- Delete: `src/tests/core/usecases/spouse/spouseRules.test.ts`
- Delete: `src/tests/core/usecases/SimulationEngine.spouse.test.ts`
- Modify: `src/core/entities/types.ts` (`SpouseProfile`, `SimulationParams.spouse`)
- Modify: `src/core/usecases/SimulationEngine.ts:37-38,604-605,635-639,699-716`
- Modify: `src/core/usecases/montecarlo/horizon.ts`
- Test: `src/tests/core/usecases/montecarlo/horizon.test.ts`
- Test: `src/tests/core/usecases/montecarlo/MonteCarloEngine.test.ts`
- Test: `src/tests/core/usecases/SimulationEngine.healthcare.test.ts`
- Test: `src/tests/core/usecases/SimulationEngine.retirementScoreWiring.test.ts`
- Test: `src/tests/core/usecases/SimulationEngine.targetAssets.test.ts`
- Test: `src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts`
- Test: `src/tests/core/usecases/strategy/RecommendationEngine.test.ts`
- Test: `src/tests/core/usecases/MonthlySpendingComposition.test.ts` (spouse params만)

**Interfaces:**
- Consumes: Task 1의 결과(UI가 `spouse`를 만들지 않음)
- Produces: `SimulationParams`에 `spouse` 없음. `simulationYearCount(params)` 시그니처 유지, 내부만 변경. 이 태스크 종료 시점에도 `SimulationYearlyResult.spouseAlive`(항상 `false`)와 `.spendingFactor`(항상 `1`)는 아직 존재한다 — Task 3에서 제거한다.

- [ ] **Step 1: 배우자 전용 테스트를 삭제한다**

```bash
git rm -r src/tests/core/usecases/spouse src/tests/core/usecases/SimulationEngine.spouse.test.ts
```

- [ ] **Step 2: horizon 테스트를 1인 기준으로 고친다**

`src/tests/core/usecases/montecarlo/horizon.test.ts`에서 `spouse`를 넣는 케이스를 삭제하고, 아래 테스트가 남거나 추가되게 한다:

```ts
  test('연수는 본인 기대수명까지의 햇수다', () => {
    const params = { ...baseParams, userProfile: { ...baseParams.userProfile, currentAge: 50, expectancy: 85 } };

    expect(simulationYearCount(params)).toBe(36);
  });
```

(`baseParams`는 그 파일에 이미 있는 픽스처 이름을 쓴다.)

- [ ] **Step 3: 나머지 테스트에서 spouse 픽스처를 걷어낸다**

`MonteCarloEngine.test.ts`, `SimulationEngine.healthcare.test.ts`, `SimulationEngine.targetAssets.test.ts`, `dashboard/computeExecutionRoadmap.test.ts`, `strategy/RecommendationEngine.test.ts`, `MonthlySpendingComposition.test.ts`에서 `spouse: { … }`를 넘기는 부분과 그것을 설명하는 주석을 삭제한다. 배우자 유무로 기대값이 달라지던 단언은 1인 기준 값으로 고친다.

`SimulationEngine.retirementScoreWiring.test.ts`는 배우자 사망 시나리오(70행 부근)로 `computeRetirementTargetAssets` 배선을 검증한다. 이를 **의료비 시나리오로 대체**한다 — 같은 함수의 세 번째 인자(은퇴 시점 반복 의료비)가 목표 자산 분모에 실제로 들어가는지 본다:

```ts
  test('은퇴 시점 반복 의료비가 목표 자산 분모에 반영된다', () => {
    const withoutHealthcare = new SimulationEngine().run(baseParams);
    const withHealthcare = new SimulationEngine().run({
      ...baseParams,
      healthcare: {
        enabled: true, costGrowthRate: 5, baseMonthlyCost: 1000000,
        longTermCareEnabled: false, longTermCareStartAge: 80, longTermCareMonthlyCost: 0,
        shockEnabled: false, shockAge: 0, shockAmount: 0,
      },
    });

    // 목표 자산 분모가 커지므로 자산 점수가, 따라서 총점이 낮아진다.
    expect(withHealthcare.retirementScore).toBeLessThan(withoutHealthcare.retirementScore);
  });
```

`HealthcareAssumptions`(`src/core/entities/types.ts:601-611`)의 9개 필드는 전부 필수다. 일회성 쇼크(`shockEnabled`)는 끈다 — 반복 의료비만 4% 룰 분모에 들어가는 것이 이 테스트가 보려는 배선이다.

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/`
Expected: FAIL — 아직 엔진이 배우자를 계산하므로 기대값 불일치, 또는 삭제한 픽스처로 인한 타입 에러.

- [ ] **Step 5: types.ts에서 배우자 타입을 제거한다**

- `SimulationParams.spouse?: SpouseProfile;`(246행) 삭제
- `export interface SpouseProfile { … }`(595행 부근) 블록 전체 삭제

- [ ] **Step 6: SimulationEngine에서 배우자 계산을 제거한다**

37-38행의 `spouseRules` import를 삭제한다. 604-605행을 다음으로 바꾼다:

```ts
    const endAge = userProfile.expectancy;
```

635-639행(생존 판정 블록)을 다음으로 바꾼다:

```ts
      // 배우자 개념이 없으므로 루프는 본인 기대수명까지만 돈다 — 전 구간 생존이다.
      const spouseAlive = false;
      const spendingFactor = 1;
```

699-716행에서 배우자를 설명하는 주석 4줄과 유족연금 승계 분기를 삭제해 다음만 남긴다:

```ts
      if (currentAge >= nationalPensionStartAge) {
        const nationalPensionAdjustmentFactor = getNationalPensionAdjustmentFactor(nationalPensionStartAge);
        const natAmountRaw = (inflationMode === 'nominal'
          ? nationalPension.expectedMonthlyAmount * Math.pow(1 + infRateAnnual, y)
          : nationalPension.expectedMonthlyAmount) * nationalPensionAdjustmentFactor;
```

(`natAmountRaw`가 재대입되지 않으므로 `let` → `const`. `selfNationalPensionStarted` 지역 변수는 인라인한다.)

`selfAlive`가 이 변경 후 어디에서도 쓰이지 않으면 함께 삭제한다.

- [ ] **Step 7: horizon.ts를 단순화한다**

```ts
import { SimulationParams } from '../../entities/types';

// 시뮬레이션이 실제로 도는 연수.
//
// 수익률 경로의 길이가 이 값과 정확히 같아야 한다. 짧으면 뒷부분이 조용히 충격 0이 되어
// 그 구간만 결정론이 되고(엔진은 던지지 않는다), 길면 남는 원소가 버려진다.
// runSingle의 totalYears(endAge − startAge + 1, endAge = 본인 기대수명)와 같은 식이다.
export function simulationYearCount(params: SimulationParams): number {
  return params.userProfile.expectancy - params.userProfile.currentAge + 1;
}
```

- [ ] **Step 8: spouseRules를 삭제한다**

```bash
git rm -r src/core/usecases/spouse
```

- [ ] **Step 9: 타입 체크와 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. 실패하면 남은 `params.spouse` 참조를 지운다.

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "refactor: 시뮬레이션 엔진에서 배우자 규칙 제거"
```

---

### Task 3: 결과의 spouseAlive·spendingFactor 필드 제거

Task 2 이후 두 필드는 상수(`false`/`1`)다. 필드와 그것을 곱하던 계산을 함께 지운다.

**Files:**
- Modify: `src/core/entities/types.ts:307-313,324-348`
- Modify: `src/core/usecases/SimulationEngine.ts:114-132,199-212,455-470,636-639,664-690,1241,1256-1260,1270-1280`
- Modify: `src/core/usecases/healthcare/healthcareCosts.ts:13-16,39-45,51,105-110`
- Modify: `src/core/usecases/utility/UtilityEngine.ts:37-53`
- Modify: `src/core/usecases/utility/explainUtilityComponents.ts:42-49`
- Modify: `src/core/usecases/MonthlySpendingComposition.ts:48-62`
- Test: `src/tests/fixtures/yearlyResult.ts`
- Test: `src/tests/core/usecases/MonthlySpendingComposition.test.ts`
- Test: `src/tests/core/usecases/SimulationEngine.unmetSpending.test.ts` (주석만)

**Interfaces:**
- Consumes: Task 2의 결과
- Produces:
  - `SimulationYearlyResult`에 `spouseAlive`/`spendingFactor` 없음, `SpendingFactor` 타입 없음
  - `computeRetirementTargetAssets(targetMonthlyAtRetirement: number, annualHealthcareAtRetirement: number): number` (2인자)
  - `HealthcareCostInput`에 `spendingFactor` 없음

- [ ] **Step 1: 픽스처와 테스트에서 두 필드를 제거한다**

`src/tests/fixtures/yearlyResult.ts`에서 `spouseAlive`/`spendingFactor` 기본값을 삭제한다.

`src/tests/core/usecases/MonthlySpendingComposition.test.ts`에서 `spendingFactor` 오버라이드 타입(82행), 기본값 대입(98행), `describe('가구 규모 계수(spendingFactor)', …)` 블록(313행 이하) 전체를 삭제한다.

`SimulationEngine.unmetSpending.test.ts:16`의 주석에서 "spendingFactor를 1로 고정하기 위해 배우자를 두지 않고" 부분을 지운다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/tests/core/usecases/MonthlySpendingComposition.test.ts`
Expected: FAIL — 타입 에러(필수 필드 `spendingFactor` 누락).

- [ ] **Step 3: types.ts에서 필드와 타입을 제거한다**

- `spouseAlive: boolean;`과 그 주석(324-327행) 삭제
- `spendingFactor: SpendingFactor;`와 그 주석(328-335행) 삭제
- `export type SpendingFactor = 0 | 0.7 | 1;`과 그 주석(338-348행) 삭제
- `healthcareSpending` 주석(307-313행)에서 `spendingFactor` 언급 문장 삭제

- [ ] **Step 4: SimulationEngine에서 계수 곱셈을 제거한다**

- `computeRetirementTargetAssets`(124-132행): 두 번째 파라미터 `spendingFactorAtRetirement` 삭제, 본문을 `targetMonthlyAtRetirement * 12 + annualHealthcareAtRetirement`로. 주석의 `spendingFactor` 항목(118-120행) 삭제
- 호출부(465행 부근): `retirementStartResult.spendingFactor` 인자 삭제
- `meetsSustainabilityGoal`(208행): `* year.spendingFactor` 삭제
- 636-639행: `spouseAlive`/`spendingFactor` 지역 변수 삭제
- 664-674행: `computeAnnualHealthcareCostBreakdown` 호출에서 `spendingFactor` 인자와 주석 삭제
- 685행: `monthlyTargetSpending = baseMonthly;`
- 1241행: `hasTaxWarning,`만 남긴다
- 1256-1260행: `* spendingFactor` 삭제, 위 주석에서 가구 규모 계수 설명 삭제
- 1276행: `* r.spendingFactor` 삭제, 1273-1275행 주석 삭제

- [ ] **Step 5: healthcareCosts에서 계수를 제거한다**

`HealthcareCostInput.spendingFactor` 필드와 주석(13-16행), 구조분해(51행), 곱셈 3곳(107-109행)을 삭제해 다음이 되게 한다:

```ts
  return {
    recurring,
    oneTime,
    total: recurring + oneTime,
  };
```

39-45행의 `spendingFactor` 설명 주석 문단도 삭제한다.

- [ ] **Step 6: 효용·구성 계산에서 계수를 제거한다**

- `UtilityEngine.targetAnnualSpendingForYear`(49행): `const base = userProfile.targetMonthlySpending * 12;`. 37-39행의 가구 규모 계수 주석 삭제
- `explainUtilityComponents`(46행): `sum + params.userProfile.targetMonthlySpending + r.healthcareSpending / 12`. 42-43행 주석 삭제
- `MonthlySpendingComposition`(53행): `targetMonthly *= r.spendingFactor;` 삭제. 48-52행 주석과 59-60행의 "가구 규모 계수도 이미 곱해져 있으므로 …" 문장 삭제

- [ ] **Step 7: 타입 체크와 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "refactor: 결과 타입에서 가구 규모 계수 제거"
```

---

### Task 4: householdEndAge 제거

**Files:**
- Modify: `src/core/entities/types.ts:354-368` (`endingAssets` 주석, `householdEndAge` 필드)
- Modify: `src/core/usecases/SimulationEngine.ts:440-442,497,545,612,1305-1316`
- Modify: `src/core/usecases/dashboard/resolvePlanAssetStatus.ts`
- Modify: `src/core/usecases/dashboard/describeDepletionAge.ts`
- Modify: `src/core/usecases/dashboard/describeFireAge.ts`
- Modify: `src/core/usecases/dashboard/generateChartCaptions.ts`
- Modify: `src/core/usecases/dashboard/computeRiskAlerts.ts:163-175`
- Modify: `src/core/usecases/dashboard/computeSensitivityAnalysis.ts:88-125`
- Modify: `src/core/usecases/dashboard/computeExecutionRoadmap.ts:77,178`
- Modify: `src/core/usecases/strategy/RecommendationEngine.ts:476-480`
- Modify: `src/core/usecases/utility/UtilityEngine.ts:88-95`
- Modify: `src/core/usecases/utility/explainUtilityComponents.ts:62-71`
- Modify: `src/core/usecases/montecarlo/MonteCarloEngine.ts:68`
- Modify: `src/core/entities/montecarlo.ts:29` (주석)
- Modify: `src/web/features/Dashboard/hero/heroHeadline.ts`, `hero/AiSummaryHero.tsx`, `DashboardSection.tsx:192`
- Modify: `src/app/simulator/page.tsx:220,440,445,448`
- Modify: `src/app/api/ai-advisor/route.ts:122` (`describeFireAge` 호출)
- Test: `householdEndAge`를 참조하는 모든 테스트

**Interfaces:**
- Consumes: Task 3의 결과
- Produces:
  - `SimulationResult`에 `householdEndAge` 없음
  - `resolvePlanAssetStatus(result: SimulationResult, expectancy: number): PlanAssetStatus`
  - `describeDepletionAge(depletionAge: number | null | undefined, expectancy: number, status: PlanAssetStatus): string` (3인자)
  - `describeFireAge(fireAge: number | null | undefined, retirementAge: number): string` (2인자 — 기대수명 분기가 사라지면 `expectancy`가 미사용 파라미터가 된다)

- [ ] **Step 1: 소비처를 찾는다**

Run: `grep -rn "householdEndAge" src`
결과 목록을 이 태스크의 작업 목록으로 삼는다.

- [ ] **Step 2: 문구 테스트를 1인 기준으로 고친다**

`describeDepletionAge`/`describeFireAge`/`generateChartCaptions`/`heroHeadline`/`resolvePlanAssetStatus`의 테스트에서 "배우자 기대수명 시점" 문구를 기대하는 케이스를 삭제하고, 호출을 새 시그니처로 바꾼다. 예:

```ts
  test('고갈되지 않으면 기대수명까지 유지된다고 말한다', () => {
    expect(describeDepletionAge(null, 85, 'sustained')).toBe('기대수명(85세)까지 고갈 없음');
  });
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/tests/core/usecases/dashboard/`
Expected: FAIL — 인자 개수 불일치로 타입 에러.

- [ ] **Step 4: types.ts에서 필드를 제거한다**

`SimulationResult.householdEndAge`(368행)와 그 주석을 삭제한다. `endingAssets` 주석(354-355행)에서 배우자 문장을 지워 `endingAssets: number; // 시뮬레이션 종료(기대수명) 시점 잔여 자산`으로 만든다.

- [ ] **Step 5: SimulationEngine에서 필드를 제거한다**

- `calculateRetirementScore`의 `householdEndAge: number` 파라미터(440-442행)를 삭제하고, 497행의 `householdEndAge - userProfile.retirementAge`를 `userProfile.expectancy - userProfile.retirementAge`로 바꾼다. 호출부(1313-1315행)에서 `endAge` 인자를 뺀다
- 조기 반환(545, 612행)과 최종 반환(1316행)의 `householdEndAge` 항목 삭제
- 1305-1310행의 FIRE 게이트 주석을 배우자 언급 없이 고친다 (게이트 조건 `fireAge >= endAge`는 그대로 둔다 — `endAge`는 이제 본인 기대수명이다)

- [ ] **Step 6: 대시보드 소비처를 expectancy로 바꾼다**

`params`를 이미 받는 함수는 `params.userProfile.expectancy`를 쓴다:
- `computeRiskAlerts.ts:174`: `const endAge = params.userProfile.expectancy;` (163-165행 주석도 정리). 175행의 `endAge > expectancy` 분기는 항상 거짓이 되므로 분기 자체를 없애고 단일 문구로 만든다
- `computeSensitivityAnalysis.ts`: `householdEndAge` 파라미터를 `expectancy`로 이름만 바꾸고, 112행에서 `params.userProfile.expectancy`를 넘긴다(그 함수가 `params`를 받지 않으면 호출부에서 값을 전달한다)
- `computeExecutionRoadmap.ts:77,178`: `resolveSpouse` 호출은 Task 2에서 이미 사라졌다. 178행을 `params.userProfile.expectancy`로 바꾼다
- `RecommendationEngine.ts:480`: `baselineResult.householdEndAge` → `params.userProfile.expectancy`(그 함수가 받는 params 이름을 확인해 쓴다). 476-478행 주석 정리
- `UtilityEngine.computeDepletionSafetyRaw`(95행): `const span = params.userProfile.expectancy - retirementAge;`. 88-94행 주석을 "본인 기대수명 기준"으로 다시 쓴다
- `explainUtilityComponents.explainDepletionSafety`(62-71행): `const { depletionAge } = result;`로 바꾸고 `params.userProfile.expectancy`를 쓴다
- `MonteCarloEngine.ts:68`: `const successAge = planned.userProfile.expectancy;` (그 스코프에서 접근 가능한 params 변수명을 확인해 쓴다). `entities/montecarlo.ts:29` 주석도 함께 정리
- `resolvePlanAssetStatus`: 두 번째 인자 `expectancy: number`를 추가하고 `depletionAge < expectancy`로 비교. 모든 호출부에 `params.userProfile.expectancy`를 넘긴다

- [ ] **Step 7: 문구 함수에서 배우자 분기를 없앤다**

`describeDepletionAge.ts`:

```ts
import { PlanAssetStatus } from './resolvePlanAssetStatus';

// 자산 고갈 예상 나이(SimulationResult.depletionAge)를 사람이 읽는 문구로 만든다.
//
// status가 'no_investable_asset'이면 나이를 쓰지 않는다. 투자자산이 하나도 없는 계획은
// 엔진이 첫 해에 depletionAge를 잡으므로(자산 0 <= 0), 여기서 그 값을 그대로 쓰면 PDF 요약이
// "자산 고갈 예상 나이: 51세"라고 보고한다 — 고갈시킬 자산이 애초에 없는 사람에게.
export function describeDepletionAge(
  depletionAge: number | null | undefined,
  expectancy: number,
  status: PlanAssetStatus
): string {
  if (status === 'no_investable_asset') return '투자자산 미보유';
  if (depletionAge !== null && depletionAge !== undefined) return `${depletionAge}세`;
  return `기대수명(${expectancy}세)까지 고갈 없음`;
}
```

`describeFireAge.ts`: `fireAge > expectancy` 분기를 삭제하고 `expectancy` 파라미터 자체를 없앤다(2인자). FIRE 게이트가 `fireAge >= endAge = expectancy`이므로 기대수명을 넘는 `fireAge`는 이제 발생하지 않는다. 주석에서 배우자 문단을 지우고 `retirementAge` 비교 설명은 남긴다. 호출부 두 곳(`src/app/simulator/page.tsx:440`, `src/app/api/ai-advisor/route.ts:122`)과 `src/tests/core/usecases/dashboard/describeFireAge.test.ts`를 함께 고친다 — 테스트의 "기대수명 이후" 케이스(33행, 43행)는 삭제한다.

`generateChartCaptions.ts`: `householdEndAge` 파라미터를 없애고 `expectancy`만 쓴다. 59-61행의 배우자 분기를 삭제해 `기대수명(${expectancy}세)까지 자산이 고갈되지 않고 유지됩니다.` 하나만 남긴다. 18행 주석의 배우자 설명도 지운다.

`heroHeadline.ts`: 세 번째 인자를 `expectancy`로 바꾸고 14-15행 주석의 배우자 설명을 지운다.

- [ ] **Step 8: web/app 계층 호출부를 고친다**

- `hero/AiSummaryHero.tsx`: `householdEndAge` prop을 `expectancy`로 바꾸고 주석 정리
- `DashboardSection.tsx:192`: `expectancy={params.userProfile.expectancy}` (해당 스코프의 params 변수명 확인). 281-283행의 배우자 언급 주석 정리
- `app/simulator/page.tsx`: 220행 구조분해에서 `householdEndAge` 제거, 445행 `describeDepletionAge(depletionAge, userProfile.expectancy, planAssetStatus)`, 448행을 `사망 시(기대수명 ${userProfile.expectancy}세) 잔여 자산`으로 단순화

- [ ] **Step 9: 타입 체크와 전체 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "refactor: 결과에서 가구 종료 나이 제거하고 본인 기대수명으로 단일화"
```

---

### Task 5: 잔여 배우자 언급 정리와 최종 검증

**Files:**
- Modify: `src/web/features/Dashboard/roadmap/ExecutionRoadmap.tsx:47`
- Modify: 아래 grep에서 걸리는 모든 파일

- [ ] **Step 1: 잔여 참조를 찾는다**

Run: `grep -rni "spouse\|배우자\|부부" src`

- [ ] **Step 2: 주석을 현재 사실에 맞게 고친다**

각 히트는 이제 존재하지 않는 기능을 설명하는 주석이다. 예: `ExecutionRoadmap.tsx:47`의 "항목(배우자 국민연금 등)과 섞여"는 배우자 국민연금이 없으므로 다른 예시로 바꾸거나 그 절을 지운다. 과거 맥락을 남기는 것이 유용한 곳은 없다 — 배우자 기능 자체가 사라졌으므로 전부 제거한다.

- [ ] **Step 3: grep이 비었는지 확인**

Run: `grep -rni "spouse\|배우자\|부부" src; echo "exit=$?"`
Expected: 출력 없음, `exit=1`

- [ ] **Step 4: 전체 검증**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 모두 통과

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "docs: 배우자 기능 제거 후 잔여 주석 정리"
```

---

## 완료 기준

- `grep -rni "spouse\|배우자\|부부" src`가 비어 있다
- `npx tsc --noEmit` 통과
- `npm test` 전체 통과
- `npm run lint` 통과
