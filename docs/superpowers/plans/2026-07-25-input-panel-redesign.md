# 입력 패널 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 좌측 입력 패널 최상단에 항상 보이는 핵심 요약 카드(현재나이/은퇴나이/목표월생활비/
투자성향)를 추가하고, 나머지 상세 설정(AssetFormSection/SimulationSettings/TaxSettingsSection)을
하나의 Collapse(기본 닫힘)로 묶어 좌측 패널의 기본 길이를 크게 줄인다.

**Architecture:** 투자성향 프리셋 적용 로직을 `src/core/usecases/scenario/applyYieldPreset.ts`에
순수 함수로 추출해 기존 `SimulationSettings.tsx`와 신규 `QuickSettingsSummary.tsx`가 공유한다.
`AssetFormSection.tsx`(1637줄)의 내부는 전혀 건드리지 않는다.

**Tech Stack:** TypeScript, React 19, Tailwind v4(신규 컴포넌트), 기존 `InputField`/`GlassCard`
CSS-Module 컴포넌트 재사용, vitest + @testing-library/react.

## Global Constraints

- `any` 타입 사용 금지 (프로젝트 CLAUDE.md). 방어적 캐스팅이 꼭 필요한 테스트 코드에서는 `as any`
  대신 `as unknown as X`를 쓴다.
- TDD: 각 신규 함수/컴포넌트는 실패하는 테스트를 먼저 작성한 뒤 구현한다.
- 신규 컴포넌트(`QuickSettingsSummary`)는 Tailwind 유틸리티 클래스로 작성한다(Phase 1/2-1 관례).
  단, 그 안에서 재사용하는 `InputField`/`GlassCard`는 기존 CSS Module 스타일을 그대로 쓴다(둘 다
  이미 구축된 컴포넌트라 스타일을 다시 만들지 않는다).
- `AssetFormSection.tsx`는 이번 작업에서 전혀 수정하지 않는다.
- `SimulationSettings.tsx`는 `applyYieldPreset` 관련 계산 로직만 공유 함수로 위임하고, 그 외
  UI/스타일/다른 필드 로직은 손대지 않는다.
- 참고 스펙: `docs/superpowers/specs/2026-07-25-input-panel-redesign-design.md`

---

### Task 1: `applyYieldPreset` usecase 추출

**Files:**
- Create: `src/core/usecases/scenario/applyYieldPreset.ts`
- Test: `src/tests/core/usecases/scenario/applyYieldPreset.test.ts`

**Interfaces:**
- Consumes: `SimulationParams`, `InvestmentAsset`, `PrivatePension` (`src/core/entities/types.ts`).
- Produces: `export function applyYieldPreset(params: SimulationParams, preset: 'conservative' | 'base' | 'aggressive'): SimulationParams`.
  Task 2(신규 컴포넌트)와 Task 3(`SimulationSettings.tsx` 리팩터링)이 이 함수를 그대로 import해서
  쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/core/usecases/scenario/applyYieldPreset.test.ts` 파일을 새로 만든다:

```ts
import { describe, test, expect } from 'vitest';
import { applyYieldPreset } from '@/core/usecases/scenario/applyYieldPreset';
import { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1',
      type: 'stock',
      ticker: 'AAA',
      name: '자산1',
      quantity: 10,
      averagePrice: 1000,
      annualGrowthRate: 1,
      dividendYield: 2,
      monthlyContribution: 0,
      reinvestDividend: false,
      currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 10000000, monthlyContribution: 0, annualReturn: 1, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('applyYieldPreset', () => {
  test('conservative 프리셋은 자산 annualGrowthRate를 5, 연금 annualReturn을 3으로 설정한다', () => {
    const result = applyYieldPreset(baseParams, 'conservative');
    expect(result.assets[0].annualGrowthRate).toBe(5);
    expect(result.privatePensions[0].annualReturn).toBe(3);
    expect(result.yieldPreset).toBe('conservative');
  });

  test('base 프리셋은 자산 annualGrowthRate를 7, 연금 annualReturn을 4로 설정한다', () => {
    const result = applyYieldPreset(baseParams, 'base');
    expect(result.assets[0].annualGrowthRate).toBe(7);
    expect(result.privatePensions[0].annualReturn).toBe(4);
    expect(result.yieldPreset).toBe('base');
  });

  test('aggressive 프리셋은 자산 annualGrowthRate를 9, 연금 annualReturn을 6으로 설정한다', () => {
    const result = applyYieldPreset(baseParams, 'aggressive');
    expect(result.assets[0].annualGrowthRate).toBe(9);
    expect(result.privatePensions[0].annualReturn).toBe(6);
    expect(result.yieldPreset).toBe('aggressive');
  });

  test('자산/연금이 여러 개면 모두 동일한 값으로 매핑한다', () => {
    const params: SimulationParams = {
      ...baseParams,
      assets: [
        { ...baseParams.assets[0], id: 'a1' },
        { ...baseParams.assets[0], id: 'a2' },
      ],
      privatePensions: [
        { ...baseParams.privatePensions[0], id: 'p1' },
        { ...baseParams.privatePensions[0], id: 'p2' },
      ],
    };
    const result = applyYieldPreset(params, 'aggressive');
    expect(result.assets.map((a) => a.annualGrowthRate)).toEqual([9, 9]);
    expect(result.privatePensions.map((p) => p.annualReturn)).toEqual([6, 6]);
  });

  test('assets/privatePensions가 undefined여도 크래시 없이 빈 배열로 처리한다', () => {
    const params = { ...baseParams, assets: undefined, privatePensions: undefined } as unknown as SimulationParams;
    const result = applyYieldPreset(params, 'base');
    expect(result.assets).toEqual([]);
    expect(result.privatePensions).toEqual([]);
  });

  test('userProfile 등 자산/연금/yieldPreset 이외의 필드는 변경하지 않는다', () => {
    const result = applyYieldPreset(baseParams, 'conservative');
    expect(result.userProfile).toEqual(baseParams.userProfile);
    expect(result.displayCurrency).toBe(baseParams.displayCurrency);
    expect(result.inflationRate).toBe(baseParams.inflationRate);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/scenario/applyYieldPreset.test.ts`
Expected: FAIL — `Failed to resolve import "@/core/usecases/scenario/applyYieldPreset"`

- [ ] **Step 3: 최소 구현 작성**

`src/core/usecases/scenario/applyYieldPreset.ts` 파일을 새로 만든다:

```ts
import { SimulationParams } from '../../entities/types';

// SimulationSettings.tsx에 있던 "시장 수익률 프리셋 적용" 로직을 순수 함수로 추출한 것.
// QuickSettingsSummary.tsx도 동일한 프리셋 버튼을 제공해야 해서, 로직이 두 곳에 따로 복붙되어
// 나중에 어긋나지 않도록 이 함수를 공유한다.
//
// assets/privatePensions를 ?? []로 방어하는 이유: 이 함수를 호출하는 쪽(page.tsx가 넘기는
// activeParams)이 과거 시나리오 데이터라서 최신 필드를 다 갖추지 못했을 가능성이 있다 —
// AssetFormSection.tsx/DashboardSection.tsx가 이미 쓰고 있는 방어적 기본값 관례와 동일하다.
export function applyYieldPreset(
  params: SimulationParams,
  preset: 'conservative' | 'base' | 'aggressive'
): SimulationParams {
  let stockGrowth = 7;
  let pensionReturn = 4;
  if (preset === 'conservative') {
    stockGrowth = 5;
    pensionReturn = 3;
  } else if (preset === 'aggressive') {
    stockGrowth = 9;
    pensionReturn = 6;
  }

  return {
    ...params,
    assets: (params.assets ?? []).map((a) => ({ ...a, annualGrowthRate: stockGrowth })),
    privatePensions: (params.privatePensions ?? []).map((p) => ({ ...p, annualReturn: pensionReturn })),
    yieldPreset: preset,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/scenario/applyYieldPreset.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/usecases/scenario/applyYieldPreset.ts src/tests/core/usecases/scenario/applyYieldPreset.test.ts
git commit -m "feat: 투자성향 프리셋 적용 로직을 순수 함수(applyYieldPreset)로 추출"
```

---

### Task 2: `QuickSettingsSummary` 컴포넌트

**Files:**
- Create: `src/web/features/Scenario/QuickSettingsSummary.tsx`
- Test: `src/tests/web/features/Scenario/QuickSettingsSummary.test.tsx`

**Interfaces:**
- Consumes: `applyYieldPreset` (Task 1의 `src/core/usecases/scenario/applyYieldPreset.ts`),
  `SimulationParams` (`src/core/entities/types.ts`), `InputField`
  (`src/web/components/InputField.tsx`, default export), `GlassCard`
  (`src/web/components/GlassCard.tsx`, default export).
- Produces: `export function QuickSettingsSummary({ params, onChangeParams }: { params:
  SimulationParams; onChangeParams: (params: SimulationParams) => void }): JSX.Element`. Task 4가
  이 컴포넌트를 `page.tsx`에서 가져다 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/web/features/Scenario/QuickSettingsSummary.test.tsx` 파일을 새로 만든다:

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickSettingsSummary } from '@/web/features/Scenario/QuickSettingsSummary';
import { applyYieldPreset } from '@/core/usecases/scenario/applyYieldPreset';
import { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('QuickSettingsSummary', () => {
  test('현재나이/은퇴나이/목표월생활비 값을 표시하고, 프리셋 버튼 3개를 렌더링한다', () => {
    render(<QuickSettingsSummary params={baseParams} onChangeParams={vi.fn()} />);

    expect(screen.getByDisplayValue('55')).toBeInTheDocument();
    expect(screen.getByDisplayValue('60')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3,000,000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /보수적/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /기본값/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /공격적/ })).toBeInTheDocument();
  });

  test('현재나이를 변경하면 onChangeParams가 userProfile.currentAge만 바뀐 객체로 호출된다', () => {
    const onChangeParams = vi.fn();
    render(<QuickSettingsSummary params={baseParams} onChangeParams={onChangeParams} />);

    fireEvent.change(screen.getByDisplayValue('55'), { target: { value: '58' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, currentAge: 58 },
    });
  });

  test('목표 월 생활비를 콤마 포함 문자열로 입력해도 숫자로 파싱해 반영한다', () => {
    const onChangeParams = vi.fn();
    render(<QuickSettingsSummary params={baseParams} onChangeParams={onChangeParams} />);

    fireEvent.change(screen.getByDisplayValue('3,000,000'), { target: { value: '3,500,000' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, targetMonthlySpending: 3500000 },
    });
  });

  test('프리셋 버튼 클릭 시 onChangeParams가 applyYieldPreset 결과와 동일한 객체로 호출된다', () => {
    const onChangeParams = vi.fn();
    render(<QuickSettingsSummary params={baseParams} onChangeParams={onChangeParams} />);

    fireEvent.click(screen.getByRole('button', { name: /보수적/ }));

    expect(onChangeParams).toHaveBeenCalledWith(applyYieldPreset(baseParams, 'conservative'));
  });

  test('userProfile이 없으면 크래시 없이 기본값을 사용한다', () => {
    const paramsWithoutProfile = { ...baseParams, userProfile: undefined } as unknown as SimulationParams;
    render(<QuickSettingsSummary params={paramsWithoutProfile} onChangeParams={vi.fn()} />);

    expect(screen.getByDisplayValue('35')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/Scenario/QuickSettingsSummary.test.tsx`
Expected: FAIL — `Failed to resolve import "@/web/features/Scenario/QuickSettingsSummary"`

- [ ] **Step 3: 최소 구현 작성**

`src/web/features/Scenario/QuickSettingsSummary.tsx` 파일을 새로 만든다:

```tsx
'use client';

import GlassCard from '../../components/GlassCard';
import InputField from '../../components/InputField';
import { SimulationParams } from '../../../core/entities/types';
import { applyYieldPreset } from '../../../core/usecases/scenario/applyYieldPreset';

interface QuickSettingsSummaryProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
}

const DEFAULT_USER_PROFILE = { currentAge: 35, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 };

const PRESETS: Array<{ key: 'conservative' | 'base' | 'aggressive'; label: string }> = [
  { key: 'conservative', label: '보수적 (주식 5%, 연금 3%)' },
  { key: 'base', label: '기본값 ⭐ (주식 7%, 연금 4%)' },
  { key: 'aggressive', label: '공격적 (주식 9%, 연금 6%)' },
];

// 좌측 입력 패널 최상단에 항상 노출되는 핵심 요약 카드. 현재나이/은퇴나이/목표월생활비/투자성향
// 4개 필드만 직접 수정 가능하게 보여주고, 나머지 상세 설정은 그 아래 Collapse("설정 자세히
// 보기")에 남겨둔다. AssetFormSection.tsx의 profile 탭과 같은 값을 다루지만 별도 컴포넌트로
// 분리했다 — AssetFormSection(1637줄)의 내부 구조는 이번 재설계에서 건드리지 않기로 했기 때문이다.
export function QuickSettingsSummary({ params, onChangeParams }: QuickSettingsSummaryProps) {
  // AssetFormSection.tsx/DashboardSection.tsx와 동일한 방어적 기본값 처리.
  const userProfile = params.userProfile || DEFAULT_USER_PROFILE;

  const handleProfileChange = (key: keyof SimulationParams['userProfile'], value: number) => {
    onChangeParams({ ...params, userProfile: { ...userProfile, [key]: value } });
  };

  const handlePresetClick = (preset: 'conservative' | 'base' | 'aggressive') => {
    onChangeParams(applyYieldPreset(params, preset));
  };

  const activePreset = params.yieldPreset ?? null;

  return (
    <GlassCard>
      <div className="flex flex-col gap-4">
        <span className="text-sm font-semibold text-foreground-muted">핵심 설정</span>
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="현재 나이"
            type="number"
            value={userProfile.currentAge}
            onChange={(e) => handleProfileChange('currentAge', Number(e.target.value))}
            suffixText="세"
          />
          <InputField
            label="은퇴 나이"
            type="number"
            value={userProfile.retirementAge}
            onChange={(e) => handleProfileChange('retirementAge', Number(e.target.value))}
            suffixText="세"
          />
          <InputField
            label="목표 월 생활비"
            type="text"
            value={userProfile.targetMonthlySpending === 0 ? '0' : userProfile.targetMonthlySpending.toLocaleString()}
            onChange={(e) => {
              const rawValue = e.target.value.replace(/,/g, '');
              const numValue = rawValue === '' ? 0 : Number(rawValue);
              if (!isNaN(numValue)) {
                handleProfileChange('targetMonthlySpending', numValue);
              }
            }}
            suffixText={params.displayCurrency === 'KRW' ? '원' : params.displayCurrency}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs text-foreground-muted">투자성향</span>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => handlePresetClick(key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  activePreset === key ? 'border-primary bg-primary/10 text-primary' : 'border-card-border text-foreground-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/Scenario/QuickSettingsSummary.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/web/features/Scenario/QuickSettingsSummary.tsx src/tests/web/features/Scenario/QuickSettingsSummary.test.tsx
git commit -m "feat: QuickSettingsSummary 컴포넌트 추가"
```

---

### Task 3: `SimulationSettings.tsx`가 `applyYieldPreset`을 재사용하도록 리팩터링

**Files:**
- Modify: `src/web/features/Scenario/SimulationSettings.tsx`

**Interfaces:**
- Consumes: `applyYieldPreset` (Task 1).
- Produces: 변경 없음(내부 구현만 위임, export/props/UI 동일).

이 태스크는 동작 보존 리팩터링이며, `applyYieldPreset`의 정확성은 Task 1의 테스트가 이미
검증했으므로 신규 테스트는 추가하지 않는다(`SimulationSettings.tsx`에는 기존 테스트 파일 자체가
없다 — `find src/tests -iname "*SimulationSettings*"`로 확인 완료).

- [ ] **Step 1: import 추가**

`src/web/features/Scenario/SimulationSettings.tsx` 4번째 줄(`import compStyles from
'../../styles/components.module.css';`) 다음에 추가:

```tsx
import { applyYieldPreset } from '../../../core/usecases/scenario/applyYieldPreset';
```

- [ ] **Step 2: 로컬 함수를 공유 함수 호출로 위임**

아래 블록(67-81행)을:

```tsx
  const applyYieldPreset = (preset: 'conservative' | 'base' | 'aggressive') => {
    let stockGrowth = 7, pensionReturn = 4;
    if (preset === 'conservative') { stockGrowth = 5; pensionReturn = 3; }
    else if (preset === 'aggressive') { stockGrowth = 9; pensionReturn = 6; }

    const updatedAssets = activeParams.assets.map((a: any) => ({ ...a, annualGrowthRate: stockGrowth }));
    const updatedPensions = activeParams.privatePensions.map((p: any) => ({ ...p, annualReturn: pensionReturn }));

    handleUpdateActiveParams({
      ...activeParams,
      assets: updatedAssets,
      privatePensions: updatedPensions,
      yieldPreset: preset,
    });
  };
```

아래로 교체한다(함수 이름을 `applyYieldPresetToActiveScenario`로 바꿔 import한
`applyYieldPreset`과 이름이 겹치지 않도록 한다):

```tsx
  const applyYieldPresetToActiveScenario = (preset: 'conservative' | 'base' | 'aggressive') => {
    handleUpdateActiveParams(applyYieldPreset(activeParams, preset));
  };
```

- [ ] **Step 3: 버튼 3개의 onClick 호출부 이름 변경**

같은 파일에서 아래 3곳(현재 113-130행 부근)의 `applyYieldPreset(` 호출을 `applyYieldPresetToActiveScenario(`로
바꾼다(각 버튼의 `className`/텍스트/`activePreset === '...'` 비교 부분은 전혀 건드리지 않는다):

```tsx
                onClick={() => applyYieldPreset('conservative')}
```
→
```tsx
                onClick={() => applyYieldPresetToActiveScenario('conservative')}
```

```tsx
                onClick={() => applyYieldPreset('base')}
```
→
```tsx
                onClick={() => applyYieldPresetToActiveScenario('base')}
```

```tsx
                onClick={() => applyYieldPreset('aggressive')}
```
→
```tsx
                onClick={() => applyYieldPresetToActiveScenario('aggressive')}
```

- [ ] **Step 4: 타입체크 + 전체 테스트 통과 확인**

Run: `npx tsc --noEmit`
Expected: 출력 없음(에러 0건) — 특히 `activeParams: any`로 타입이 느슨했던 기존 코드가
`applyYieldPreset(params: SimulationParams, ...)`의 정확한 타입과 호환되는지 확인된다.

Run: `npm test`
Expected: 전체 테스트 PASS(이 리팩터링 자체를 검증하는 신규 테스트는 없지만, 기존 스위트가
회귀를 일으키지 않았는지 확인).

- [ ] **Step 5: 커밋**

```bash
git add src/web/features/Scenario/SimulationSettings.tsx
git commit -m "refactor: SimulationSettings가 applyYieldPreset 공유 함수를 사용하도록 위임"
```

---

### Task 4: `page.tsx`에 배치

**Files:**
- Modify: `src/app/simulator/page.tsx`

**Interfaces:**
- Consumes: `QuickSettingsSummary` (Task 2), `Collapse` (`src/web/components/ui`, Phase 1에서 이미
  존재).
- Produces: 변경 없음(페이지 컴포넌트 자체의 외부 인터페이스 없음).

`page.tsx`에는 기존 컴포넌트 테스트 파일이 없다(인증/훅 의존성이 커서 이번 작업 범위에서 신규
테스트 하네스를 만들지 않는다 — 스펙의 테스트 전략 참고). 이 태스크는 `npx tsc --noEmit`/`npm run
build`로 정적 검증하고, 개발 서버에서 육안 확인한다.

- [ ] **Step 1: import 추가**

`src/app/simulator/page.tsx`의 16번째 줄(`import { SimulationSettings } from
'../../web/features/Scenario/SimulationSettings';`) 다음에 추가:

```tsx
import { QuickSettingsSummary } from '../../web/features/Scenario/QuickSettingsSummary';
import { Collapse } from '../../web/components/ui';
```

- [ ] **Step 2: 좌측 컬럼 JSX 재배치**

`src/app/simulator/page.tsx`에서 아래 블록을 찾는다(현재 867-887행 부근, `{/* Scenario Manager
Section */}` 주석부터 `TaxSettingsSection`을 감싼 `{isPro && ( ... )}` 블록의 닫는 `)}`까지):

```tsx
            {/* Scenario Manager Section */}
            <GlassCard>
              <ScenarioManager scenarioState={scenarioState} />
            </GlassCard>

            {/* Inputs Section */}
            <GlassCard>
              <AssetFormSection params={activeParams} onChangeParams={handleUpdateActiveParams} />
            </GlassCard>

            {/* Simulation Settings Section */}
            <GlassCard>
              <SimulationSettings scenarioState={scenarioState} />
            </GlassCard>

            {/* Tax Settings Section */}
            {isPro && (
              <GlassCard>
                <TaxSettingsSection params={activeParams} onChangeParams={handleUpdateActiveParams} />
              </GlassCard>
            )}
```

아래로 교체한다:

```tsx
            {/* Quick Settings Summary */}
            <QuickSettingsSummary params={activeParams} onChangeParams={handleUpdateActiveParams} />

            {/* Scenario Manager Section */}
            <GlassCard>
              <ScenarioManager scenarioState={scenarioState} />
            </GlassCard>

            {/* Detailed Settings (기본 닫힘) */}
            <Collapse title={<span className="text-base font-semibold">설정 자세히 보기</span>}>
              <div className="flex flex-col gap-6 pt-2">
                {/* Inputs Section */}
                <GlassCard>
                  <AssetFormSection params={activeParams} onChangeParams={handleUpdateActiveParams} />
                </GlassCard>

                {/* Simulation Settings Section */}
                <GlassCard>
                  <SimulationSettings scenarioState={scenarioState} />
                </GlassCard>

                {/* Tax Settings Section */}
                {isPro && (
                  <GlassCard>
                    <TaxSettingsSection params={activeParams} onChangeParams={handleUpdateActiveParams} />
                  </GlassCard>
                )}
              </div>
            </Collapse>
```

- [ ] **Step 3: 정적 검증**

Run: `npx tsc --noEmit`
Expected: 출력 없음(에러 0건)

Run: `npm run build`
Expected: `✓ Compiled successfully`, `✓ Generating static pages` 포함 정상 종료.

- [ ] **Step 4: 개발 서버 육안 확인**

`npm run dev`로 로컬 서버를 띄우고(또는 이미 실행 중이면 재사용) `/simulator`에 로그인 상태로
접속해:
1. 좌측 패널 최상단에 핵심 설정 카드(현재나이/은퇴나이/목표월생활비/투자성향 버튼 3개)가 항상
   보이는지.
2. 카드에서 현재나이를 바꾸면 결과 화면이 실제로 갱신되는지.
3. "설정 자세히 보기"가 기본적으로 닫혀 있고, 클릭하면 기존 AssetFormSection/SimulationSettings가
   레이아웃 깨짐 없이 그대로 나오는지.
4. 핵심 설정 카드에서 프리셋 버튼을 누른 뒤 "설정 자세히 보기"를 펼쳤을 때, `SimulationSettings`
   안의 프리셋 버튼도 같은 프리셋이 활성 상태로 표시되는지(두 곳이 같은 `yieldPreset` 값을
   공유하므로 일치해야 한다).

문제가 있으면 다음 스텝(커밋)으로 진행하지 말고 원인을 조사해 고친다.

- [ ] **Step 5: 커밋**

```bash
git add src/app/simulator/page.tsx
git commit -m "feat: page.tsx 좌측 패널에 QuickSettingsSummary 배치 및 상세설정 Collapse로 묶기"
```

---

### Task 5: 최종 검증

**Files:** 없음(전체 확인만)

- [ ] **Step 1: 전체 테스트 스위트**

Run: `npm test`
Expected: 모든 테스트 파일 PASS. 이 시점의 총 테스트 수는 작업 시작 시점(323개) + Task 1에서
추가한 6개 + Task 2에서 추가한 5개 = 334개.

- [ ] **Step 2: 타입체크**

Run: `npx tsc --noEmit`
Expected: 출력 없음.

- [ ] **Step 3: 프로덕션 빌드**

Run: `npm run build`
Expected: `✓ Compiled successfully`, `✓ Generating static pages` 포함 정상 종료(에러 없음).

- [ ] **Step 4: ESLint**

Run: `npm run lint`
Expected: 이번 작업으로 새로 만들거나 수정한 4개 파일(`applyYieldPreset.ts`,
`QuickSettingsSummary.tsx`, `SimulationSettings.tsx`, `page.tsx`)에서 새 warning/error가 없어야
한다(기존에 있던 다른 파일의 pre-existing 경고는 무관).
