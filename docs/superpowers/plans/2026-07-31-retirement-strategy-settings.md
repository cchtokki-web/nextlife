# 은퇴 전략 설정 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경제 변수 입력 폼이던 설정 화면을 6개 섹션의 은퇴 전략 설계 화면으로 재구성하고, 지금까지 AI만 쓰던 엔진 파라미터를 사용자에게 연다.

**Architecture:** 사용자 언어(전략 enum)를 엔진 언어(저수준 파라미터)로 번역하는 순수 함수 `compileStrategy`를 두어 `SimulationEngine` 변경 없이 전략 기능 대부분을 붙인다. 엔진을 실제로 고치는 것은 배우자 생존 루프(Task 5), 의료비 지출 레이어(Task 9), 세법 버전 프로필화(Task 10) 세 곳뿐이다. UI는 재사용 폼 프리미티브 5종 위에 6개 섹션 컴포넌트를 얹는다.

**Tech Stack:** Next.js 16.2.7 (App Router), React 19.2.4, TypeScript strict, Tailwind CSS v4, vitest 4 + @testing-library/react, lucide-react, framer-motion

**설계 문서:** `docs/superpowers/specs/2026-07-31-retirement-strategy-settings-design.md`

## Global Constraints

- 언어: 모든 주석·커밋 메시지·UI 문구는 한국어. 변수/함수명은 영어.
- TypeScript `strict: true`. **`any` 사용 금지.** (기존 `SimulationSettings.tsx`가 `any`를 쓰지만 새 코드는 따르지 않는다.)
- TDD: 모든 Task는 실패하는 테스트 → 최소 구현 → 통과 → 커밋 순서.
- 테스트 실행: `npm test` (vitest run). 단일 파일: `npx vitest run <path>`.
- 테스트 import는 `@/` 별칭 사용 (예: `@/core/entities/types`). `vitest.config.ts`에 설정됨.
- 새 UI 컴포넌트 스타일은 **Tailwind v4 클래스만** 사용. CSS Module과 인라인 style 혼용 금지.
- 새 섹션 컴포넌트의 props 인터페이스는 `{ params: SimulationParams; onChangeParams: (p: SimulationParams) => void }`로 통일. `scenarioState` 통째 주입 금지.
- **모든 설정 필드는 예외 없이 `isFieldVisible(mode, path)`를 거쳐 렌더한다.** 부모 스위치가
  켜져 있어야만 보이는 하위 필드(배우자 상세, 의료비 상세 등)도 마찬가지로
  `parentEnabled && isFieldVisible(mode, path) && (...)` 형태여야 한다. 데이터 조건만으로
  게이트하면 `fieldVisibility.ts`가 노출 규칙의 단일 소스라는 보장이 깨진다.
- `InputField`에 `label=""`을 넘길 때(가시 라벨은 `FieldRow`가 그림) `InputField`가 빈
  `<label>` 요소를 렌더하지 않아야 한다. 빈 라벨은 입력마다 불필요한 세로 여백을 만든다.
- `SimulationParams`에 추가하는 모든 신규 필드는 **optional**. 저장된 기존 시나리오가 마이그레이션 없이 로드되어야 한다.
- 기능 off 상태(`spouse.enabled === false` 등)에서 시뮬레이션 결과가 변경 전과 **완전히 동일**해야 한다. Task 5·9·10은 이를 검증하는 회귀 테스트가 필수다.
- 커밋은 Task 단위. 각 커밋 시점에 `npm test` 전체가 통과해야 한다.

## File Structure

**신규 — 도메인/유즈케이스**

| 경로 | 책임 |
| --- | --- |
| `src/core/usecases/strategy/compileStrategy.ts` | 전략 enum → 저수준 파라미터 + `UtilityConfig` 번역 (순수) |
| `src/core/usecases/strategy/objectivePresets.ts` | 목표 우선순위별 `UtilityConfig.weights` 프리셋 테이블 |
| `src/core/usecases/scenario/economicScenarios.ts` | 경제 시나리오별 물가·수익률·환율 프리셋 테이블 |
| `src/core/usecases/spouse/spouseRules.ts` | 배우자 생존·생활비 계수·유족연금 규칙 (순수) |
| `src/core/usecases/healthcare/healthcareCosts.ts` | 연령별 의료비·장기요양·쇼크 계산 (순수) |
| `src/core/usecases/tax/taxLawProfiles.ts` | 세법 버전 프로필 테이블 |

**신규 — 재사용 폼 컴포넌트 (`src/web/components/form/`)**

| 파일 | 책임 |
| --- | --- |
| `SettingSection.tsx` | 아코디언 셸: 아이콘·제목·요약·AI 추천 버튼·변경 개수 배지 |
| `RadioCardGroup.tsx` | 아이콘 + 라벨 + 2줄 설명 카드형 라디오 (제네릭 enum) |
| `SwitchField.tsx` | 설명 포함 스위치 |
| `FieldRow.tsx` | 라벨 + `?` 툴팁 + 입력 + `사용자 설정` 배지 + AI 힌트 |
| `HelpTip.tsx` | `ui/Tooltip` 래핑, `glossary` 키 지원 |
| `index.ts` | 배럴 export |

**신규 — 기능 (`src/web/features/StrategySettings/`)**

| 파일 | 책임 |
| --- | --- |
| `StrategySettingsPanel.tsx` | 6섹션 컨테이너 + 모드 셀렉터 + 변경 하이라이트 state |
| `StrategyModeSelector.tsx` | 간편/표준/전문가 세그먼트 |
| `strategyOptions.ts` | enum → 라벨/아이콘/설명/툴팁 메타 (문자열 단일 소스) |
| `fieldVisibility.ts` | 모드별 노출 필드 매트릭스 |
| `diffDefaults.ts` | `initialParams` 대비 변경된 필드 경로 집합 |
| `useAiRecommendation.ts` | `recommendStrategy` 1회 실행 + 캐시 + 섹션별 부분 적용 |
| `sections/BasicInfoSection.tsx` | ① 기본 정보 (배우자 포함) |
| `sections/RetirementGoalSection.tsx` | ② 은퇴 목표 |
| `sections/PensionStrategySection.tsx` | ③ 연금 전략 |
| `sections/InvestmentStrategySection.tsx` | ④ 투자 전략 |
| `sections/EconomicAssumptionSection.tsx` | ⑤ 경제 가정 |
| `sections/AdvancedSection.tsx` | ⑥ 고급 설정 |

**수정**

| 경로 | 변경 |
| --- | --- |
| `src/core/entities/types.ts` | 전략 enum·`RetirementStrategy`·`SpouseProfile`·`HealthcareAssumptions` 추가, `SimulationParams`/`SimulationYearlyResult` 확장 |
| `src/core/usecases/SimulationEngine.ts` | 배우자(Task 5)·의료비(Task 9) 통합 |
| `src/core/usecases/tax/taxRates.ts` | 상수를 `taxLawProfiles`에서 재-export (Task 10) |
| `src/app/simulator/page.tsx` | 좌측 패널에 `StrategySettingsPanel` 마운트, `UtilityConfig` 배선, 구 컴포넌트 제거 |

**제거 (Task 10)**

`src/web/features/Scenario/QuickSettingsSummary.tsx`, `SimulationSettings.tsx`, `src/web/features/AssetForm/TaxSettingsSection.tsx` 및 각 테스트.

---

### Task 1: 전략 타입 + `compileStrategy` 골격

**Files:**
- Modify: `src/core/entities/types.ts`
- Create: `src/core/usecases/strategy/objectivePresets.ts`
- Create: `src/core/usecases/strategy/compileStrategy.ts`
- Test: `src/tests/core/usecases/strategy/objectivePresets.test.ts`
- Test: `src/tests/core/usecases/strategy/compileStrategy.test.ts`

**Interfaces:**
- Consumes: `UtilityConfig`, `SimulationParams`, `createUtilityConfig`, `DEFAULT_UTILITY_CONFIG` (기존)
- Produces:
  - `StrategyMode`, `ObjectivePriority`, `BequestStrategy`, `NationalPensionStrategy`, `PrivatePensionStrategy`, `RiskProfile`, `EconomicScenario`, `TaxLawVersion`, `RetirementStrategy`, `SpouseProfile`, `HealthcareAssumptions` 타입
  - `OBJECTIVE_WEIGHT_PRESETS: Record<ObjectivePriority, UtilityConfig['weights']>`
  - `DEFAULT_RETIREMENT_STRATEGY: RetirementStrategy`
  - `compileStrategy(params: SimulationParams): CompiledStrategy`
  - `interface CompiledStrategy { params: SimulationParams; utilityConfig: UtilityConfig }`

이 Task에서는 **목표 우선순위 축과 상속 전략 축만** 컴파일한다. 나머지 축(연금·투자·경제)은 Task 7·8에서 같은 함수에 추가한다.

- [ ] **Step 1: 타입을 `types.ts`에 추가**

`src/core/entities/types.ts` 끝부분, `ScenarioModel` 정의 앞에 추가한다.

```ts
// ── 은퇴 전략 설정 ────────────────────────────────────────────────────────
// 아래 enum들은 "사용자 언어"이며 SimulationEngine은 이 타입들을 알지 못한다.
// compileStrategy()가 저수준 파라미터(withdrawalPlan/taxSettings/yieldPreset 등)로
// 번역한 뒤에야 엔진에 들어간다.

export type StrategyMode = 'simple' | 'standard' | 'expert';

// 모든 계산의 목적 함수. UtilityConfig.weights 프리셋으로 번역된다.
export type ObjectivePriority =
  | 'lifetime_spending'
  | 'tax_minimization'
  | 'wealth_maximization'
  | 'bequest_maximization'
  | 'ai_recommended';

// 엔진의 SpendingStrategy 3종 + 'ai'. 'ai'는 엔진에 없는 값이라 compileStrategy가
// 'target'으로 내리고, AI가 제안한 생활비는 화면에 힌트로만 노출한다.
// 선택 상태 자체는 strategy.spendingChoice에 남으므로 화면에서 사라지지 않는다.
export type SpendingStrategyChoice = SpendingStrategy | 'ai';

export type BequestStrategy = 'spend_all' | 'leave_some' | 'maximize' | 'target_amount';

export type NationalPensionStrategy =
  | 'early' | 'normal' | 'defer_1y' | 'defer_2y' | 'defer_max' | 'ai_optimized';

export type PrivatePensionStrategy =
  | 'tax_first' | 'spending_first' | 'growth_first' | 'minimum' | 'ai_optimized';

export type RiskProfile = 'conservative' | 'neutral' | 'aggressive' | 'ai_recommended';

export type EconomicScenario =
  | 'long_term_average' | 'recession' | 'high_inflation' | 'low_growth' | 'ai_recommended';

// 현재는 'current' 하나뿐이다. 실제 개정안이 확정되면 프로필을 추가한다
// (허구의 개정안을 지어내지 않는다는 것이 설계 결정이다).
export type TaxLawVersion = 'current';

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

// 배우자. 자산/ISA/사적연금 계좌는 가구 합산 하나로 유지하고, 여기서는 생존 기간과
// 국민연금만 분리한다(설계 결정: 계좌 소유자 분리는 이번 범위 밖).
export interface SpouseProfile {
  enabled: boolean;
  currentAge: number;
  expectancy: number;
  nationalPensionMonthlyAmount: number; // 65세 기준 금액 (본인과 동일 해석)
  nationalPensionStartAge: number; // 60~70
}

export interface HealthcareAssumptions {
  enabled: boolean;
  costGrowthRate: number; // 의료비 증가율 %
  baseMonthlyCost: number; // 은퇴 시점 기준 월 의료비 (오늘 화폐가치)
  longTermCareEnabled: boolean;
  longTermCareStartAge: number;
  longTermCareMonthlyCost: number;
  shockEnabled: boolean;
  shockAge: number;
  shockAmount: number; // 일회성 목돈
}
```

`SimulationParams` 인터페이스에 4개 필드를 추가한다 (`withdrawalPlan?` 아래).

```ts
  strategy?: RetirementStrategy; // 은퇴 전략 설정 (미지정 시 compileStrategy가 입력을 그대로 통과)
  spouse?: SpouseProfile;
  healthcare?: HealthcareAssumptions;
  taxLawVersion?: TaxLawVersion;
```

- [ ] **Step 2: 목표 우선순위 프리셋 테스트를 작성**

`src/tests/core/usecases/strategy/objectivePresets.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { OBJECTIVE_WEIGHT_PRESETS } from '@/core/usecases/strategy/objectivePresets';
import { createUtilityConfig } from '@/core/usecases/utility/utilityWeights';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { ObjectivePriority } from '@/core/entities/types';

const ALL: ObjectivePriority[] = [
  'lifetime_spending', 'tax_minimization', 'wealth_maximization',
  'bequest_maximization', 'ai_recommended',
];

describe('OBJECTIVE_WEIGHT_PRESETS', () => {
  test('모든 우선순위에 대해 가중치 합이 100이다', () => {
    for (const key of ALL) {
      const sum = Object.values(OBJECTIVE_WEIGHT_PRESETS[key]).reduce((a, b) => a + b, 0);
      expect(sum, `${key} 가중치 합`).toBe(100);
    }
  });

  test('모든 프리셋이 createUtilityConfig 불변식을 통과하고 weights가 보존된다', () => {
    // createUtilityConfig는 `{ weights, ...rest }`를 반환하므로 rest에 weights가
    // 섞여 있으면 나중에 스프레드되어 프리셋을 덮어쓴다. rest는 반드시 weights를
    // 떼어낸 것이어야 한다 — 이 테스트가 그 회귀를 잡는다.
    const { weights: _unused, ...rest } = DEFAULT_UTILITY_CONFIG;

    for (const key of ALL) {
      const cfg = createUtilityConfig(OBJECTIVE_WEIGHT_PRESETS[key], rest);

      expect(cfg.weights, `${key} weights`).toEqual(OBJECTIVE_WEIGHT_PRESETS[key]);
      expect(cfg.appropriateBequestMonths).toBe(DEFAULT_UTILITY_CONFIG.appropriateBequestMonths);
    }
  });

  test('세금 최소화는 기본값보다 taxEfficiency 가중치가 높다', () => {
    expect(OBJECTIVE_WEIGHT_PRESETS.tax_minimization.taxEfficiency)
      .toBeGreaterThan(DEFAULT_UTILITY_CONFIG.weights.taxEfficiency);
  });

  test('상속 최대화는 기본값보다 bequestAdequacy 가중치가 높다', () => {
    expect(OBJECTIVE_WEIGHT_PRESETS.bequest_maximization.bequestAdequacy)
      .toBeGreaterThan(DEFAULT_UTILITY_CONFIG.weights.bequestAdequacy);
  });

  test('AI 추천은 기본 가중치와 동일하다 (AI가 별도로 제안하므로 중립 유지)', () => {
    expect(OBJECTIVE_WEIGHT_PRESETS.ai_recommended).toEqual(DEFAULT_UTILITY_CONFIG.weights);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/objectivePresets.test.ts`
Expected: FAIL — `Failed to resolve import "@/core/usecases/strategy/objectivePresets"`

- [ ] **Step 4: 프리셋 테이블 구현**

`src/core/usecases/strategy/objectivePresets.ts`

```ts
import { ObjectivePriority, UtilityConfig } from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from '../utility/utilityWeights';

// 목표 우선순위(목적 함수) → Lifetime Utility 가중치.
// 합이 반드시 100이어야 하며 createUtilityConfig가 런타임에 이를 강제한다
// (objectivePresets.test.ts가 테이블 전체를 전수 검증한다).
//
// 값은 기본값(35/20/15/10/10/10)에서 해당 목표의 축을 키우고 나머지를 줄인 것이다.
// 특정 축을 0으로 만들지 않는 이유: Utility는 6개 축의 균형 점수이며 한 축이 0이면
// 그 축이 파탄난 전략(예: 세금 최소화를 골랐더니 생활비가 고갈)이 만점을 받을 수 있다.
export const OBJECTIVE_WEIGHT_PRESETS: Record<ObjectivePriority, UtilityConfig['weights']> = {
  // 평생 생활비 확보: 소비 수준과 고갈 방지가 압도적으로 중요하다.
  lifetime_spending: {
    consumption: 45, depletionSafety: 25, pensionUtilization: 15,
    taxEfficiency: 5, taxationRisk: 5, bequestAdequacy: 5,
  },
  // 세금 최소화: 세금 효율과 과세 위험 관리를 끌어올린다.
  tax_minimization: {
    consumption: 25, depletionSafety: 15, pensionUtilization: 15,
    taxEfficiency: 25, taxationRisk: 15, bequestAdequacy: 5,
  },
  // 자산 최대화: 자산을 오래 남기는 방향 = 고갈 방지 + 잔여자산.
  wealth_maximization: {
    consumption: 25, depletionSafety: 30, pensionUtilization: 15,
    taxEfficiency: 10, taxationRisk: 5, bequestAdequacy: 15,
  },
  // 상속 최대화: 잔여자산 적정성이 최우선.
  bequest_maximization: {
    consumption: 20, depletionSafety: 20, pensionUtilization: 10,
    taxEfficiency: 10, taxationRisk: 5, bequestAdequacy: 35,
  },
  // AI 추천: 사용자가 목표를 정하지 않은 상태다. 특정 축으로 기울이지 않고
  // 기본 가중치를 그대로 쓰며, AI가 별도로 목표를 제안한다.
  ai_recommended: DEFAULT_UTILITY_CONFIG.weights,
};
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/objectivePresets.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: `compileStrategy` 테스트를 작성**

`src/tests/core/usecases/strategy/compileStrategy.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { OBJECTIVE_WEIGHT_PRESETS } from '@/core/usecases/strategy/objectivePresets';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { RetirementStrategy, SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const withStrategy = (patch: Partial<RetirementStrategy>): SimulationParams => ({
  ...baseParams,
  strategy: { ...DEFAULT_RETIREMENT_STRATEGY, ...patch },
});

describe('compileStrategy', () => {
  test('strategy가 없으면 params를 그대로 통과시키고 기본 UtilityConfig를 반환한다', () => {
    const result = compileStrategy(baseParams);

    expect(result.params).toEqual(baseParams);
    expect(result.utilityConfig).toEqual(DEFAULT_UTILITY_CONFIG);
  });

  test('목표 우선순위가 UtilityConfig.weights로 번역된다', () => {
    const result = compileStrategy(withStrategy({ objective: 'tax_minimization' }));

    expect(result.utilityConfig.weights).toEqual(OBJECTIVE_WEIGHT_PRESETS.tax_minimization);
    // weights 외 나머지 설정(appropriateBequestMonths 등)은 기본값을 유지한다.
    expect(result.utilityConfig.appropriateBequestMonths)
      .toBe(DEFAULT_UTILITY_CONFIG.appropriateBequestMonths);
  });

  test('상속 전략 "모두 사용"은 targetBequest를 0으로 만든다', () => {
    const result = compileStrategy(withStrategy({ bequestStrategy: 'spend_all' }));

    expect(result.params.userProfile.targetBequest).toBe(0);
  });

  test('상속 전략 "일부 남기기"는 월생활비 * 24를 targetBequest로 설정한다', () => {
    const result = compileStrategy(withStrategy({ bequestStrategy: 'leave_some' }));

    expect(result.params.userProfile.targetBequest).toBe(3000000 * 24);
  });

  test('상속 전략 "최대 상속"은 targetBequest를 미지정으로 남긴다', () => {
    const params = withStrategy({ bequestStrategy: 'maximize' });
    params.userProfile = { ...params.userProfile, targetBequest: 999 };

    const result = compileStrategy(params);

    expect(result.params.userProfile.targetBequest).toBeUndefined();
  });

  test('상속 전략 "목표 금액 유지"는 사용자가 입력한 targetBequest를 보존한다', () => {
    const params = withStrategy({ bequestStrategy: 'target_amount' });
    params.userProfile = { ...params.userProfile, targetBequest: 123456789 };

    const result = compileStrategy(params);

    expect(result.params.userProfile.targetBequest).toBe(123456789);
  });

  test('생활비 전략 "AI 추천"은 엔진 값 target으로 내려간다', () => {
    const result = compileStrategy(withStrategy({ spendingChoice: 'ai' }));

    expect(result.params.spendingStrategy).toBe('target');
    // 사용자가 무엇을 골랐는지는 strategy 쪽에 그대로 남아야 한다.
    expect(result.params.strategy?.spendingChoice).toBe('ai');
  });

  test('생활비 전략 "배당금만 소비"는 그대로 엔진 값이 된다', () => {
    const result = compileStrategy(withStrategy({ spendingChoice: 'dividend_only' }));

    expect(result.params.spendingStrategy).toBe('dividend_only');
  });

  test('알 수 없는 enum 값이 들어와도 던지지 않고 baseline으로 폴백한다', () => {
    // 저장된 옛 시나리오에 없어진 enum 값이 남아 있어도 화면이 죽으면 안 된다.
    const params = withStrategy({});
    (params.strategy as RetirementStrategy).objective = 'nonexistent' as never;

    expect(() => compileStrategy(params)).not.toThrow();
    expect(compileStrategy(params).utilityConfig.weights).toEqual(DEFAULT_UTILITY_CONFIG.weights);
  });

  test('입력 params 객체를 변형하지 않는다 (순수 함수)', () => {
    const params = withStrategy({ bequestStrategy: 'spend_all' });
    const snapshot = JSON.parse(JSON.stringify(params));

    compileStrategy(params);

    expect(params).toEqual(snapshot);
  });
});
```

- [ ] **Step 7: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/compileStrategy.test.ts`
Expected: FAIL — `Failed to resolve import "@/core/usecases/strategy/compileStrategy"`

- [ ] **Step 8: `compileStrategy` 구현**

`src/core/usecases/strategy/compileStrategy.ts`

```ts
import {
  BequestStrategy, RetirementStrategy, SimulationParams, UtilityConfig,
} from '../../entities/types';
import { createUtilityConfig, DEFAULT_UTILITY_CONFIG } from '../utility/utilityWeights';
import { OBJECTIVE_WEIGHT_PRESETS } from './objectivePresets';

// createUtilityConfig는 `{ weights, ...rest }`를 반환한다. rest에 DEFAULT_UTILITY_CONFIG를
// 통째로 넘기면 그 안의 weights가 나중에 스프레드되어 방금 고른 프리셋을 덮어쓴다.
// weights를 떼어낸 나머지만 재사용한다.
const { weights: _defaultWeights, ...UTILITY_CONFIG_REST } = DEFAULT_UTILITY_CONFIG;

export interface CompiledStrategy {
  params: SimulationParams; // 저수준 파라미터가 채워진 결과
  utilityConfig: UtilityConfig; // 목적 함수
}

// 새 시나리오의 기본 전략. 모든 축이 "기존 동작과 동일한 결과"를 내도록 골랐다 —
// 즉 이 기본값으로 compileStrategy를 돌려도 시뮬레이션 결과가 바뀌지 않는다.
export const DEFAULT_RETIREMENT_STRATEGY: RetirementStrategy = {
  mode: 'simple',
  objective: 'ai_recommended',
  spendingChoice: 'target', // 엔진 기본값(spendingStrategy 미지정)과 같은 동작
  bequestStrategy: 'maximize', // targetBequest 미지정 = UtilityEngine 기존 공식
  nationalPensionStrategy: 'ai_optimized',
  privatePensionStrategy: 'ai_optimized',
  preferIsaFirst: false,
  riskProfile: 'ai_recommended',
  economicScenario: 'ai_recommended',
};

// bequestStrategy → userProfile.targetBequest.
// 'maximize'는 undefined를 돌려주며, 이는 "미지정 → UtilityEngine이 월생활비 *
// appropriateBequestMonths로 적정 잔여자산을 추정" 이라는 기존 동작을 뜻한다.
function resolveTargetBequest(
  strategy: BequestStrategy,
  targetMonthlySpending: number,
  userEnteredBequest: number | undefined,
  appropriateBequestMonths: number
): number | undefined {
  switch (strategy) {
    case 'spend_all':
      return 0;
    case 'leave_some':
      return targetMonthlySpending * appropriateBequestMonths;
    case 'target_amount':
      return userEnteredBequest;
    case 'maximize':
    default:
      return undefined;
  }
}

// 전략(사용자 언어)을 저수준 파라미터(엔진 언어)로 번역한다.
//
// 순수 함수이며 절대 던지지 않는다. 알 수 없는 enum 값(저장된 옛 시나리오에 남은
// 값 등)이 들어오면 그 축만 baseline으로 폴백하고 나머지 축은 정상 컴파일한다.
//
// 'ai_*' 값은 "아직 미정, 기본값으로 두되 AI 제안을 받겠다"는 표식이며 baseline으로
// 내려간다. 실제 AI 값은 사용자가 추천을 명시적으로 "적용"할 때 확정 enum으로 치환된다.
export function compileStrategy(params: SimulationParams): CompiledStrategy {
  const strategy = params.strategy;
  if (!strategy) {
    return { params, utilityConfig: DEFAULT_UTILITY_CONFIG };
  }

  const weights = OBJECTIVE_WEIGHT_PRESETS[strategy.objective] ?? DEFAULT_UTILITY_CONFIG.weights;
  const utilityConfig = createUtilityConfig(weights, UTILITY_CONFIG_REST);

  const targetBequest = resolveTargetBequest(
    strategy.bequestStrategy,
    params.userProfile.targetMonthlySpending,
    params.userProfile.targetBequest,
    utilityConfig.appropriateBequestMonths
  );

  // targetBequest가 undefined일 때는 키 자체를 지운다. `targetBequest: undefined`를
  // 남겨두면 JSON 직렬화/구조 비교에서 "키가 없는 것"과 미묘하게 달라진다.
  const userProfile = { ...params.userProfile };
  if (targetBequest === undefined) {
    delete userProfile.targetBequest;
  } else {
    userProfile.targetBequest = targetBequest;
  }

  // 'ai'는 엔진 SpendingStrategy에 없는 값이므로 baseline인 'target'으로 내린다.
  // 사용자가 무엇을 골랐는지는 strategy.spendingChoice에 그대로 남는다.
  const spendingStrategy: SpendingStrategy =
    strategy.spendingChoice === 'ai' ? 'target' : (strategy.spendingChoice ?? 'target');

  return {
    params: { ...params, userProfile, spendingStrategy },
    utilityConfig,
  };
}
```

import 목록에 `SpendingStrategy`를 추가한다.

- [ ] **Step 9: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/`
Expected: PASS (13 tests)

- [ ] **Step 10: 전체 테스트가 깨지지 않았는지 확인**

Run: `npm test`
Expected: 기존 테스트 전부 PASS (신규 optional 필드만 추가했으므로 회귀 없음)

- [ ] **Step 11: 커밋**

```bash
git add src/core/entities/types.ts \
        src/core/usecases/strategy/objectivePresets.ts \
        src/core/usecases/strategy/compileStrategy.ts \
        src/tests/core/usecases/strategy/objectivePresets.test.ts \
        src/tests/core/usecases/strategy/compileStrategy.test.ts
git commit -m "feat: 은퇴 전략 타입과 compileStrategy 컴파일러 골격 추가

전략 enum(목표 우선순위/상속 전략 등)을 저수준 엔진 파라미터로 번역하는
순수 함수를 도입한다. 이번 단계에서는 목표 우선순위 축(UtilityConfig)과
상속 전략 축(targetBequest)만 컴파일하며, 연금/투자/경제 축은 이후 단계에서
같은 함수에 추가한다.

SimulationParams에 추가한 4개 필드는 모두 optional이라 저장된 기존
시나리오가 마이그레이션 없이 그대로 로드된다."
```

---

### Task 2: 재사용 폼 컴포넌트 5종

**Files:**
- Create: `src/web/components/form/HelpTip.tsx`
- Create: `src/web/components/form/ChangedBadge.tsx`
- Create: `src/web/components/form/FieldRow.tsx`
- Create: `src/web/components/form/SwitchField.tsx`
- Create: `src/web/components/form/RadioCardGroup.tsx`
- Create: `src/web/components/form/SettingSection.tsx`
- Create: `src/web/components/form/index.ts`
- Test: `src/tests/web/components/form/RadioCardGroup.test.tsx`
- Test: `src/tests/web/components/form/SettingSection.test.tsx`
- Test: `src/tests/web/components/form/FieldRow.test.tsx`

**Interfaces:**
- Consumes: `Tooltip`, `GLOSSARY`, `GlossaryTerm` from `@/web/components/ui`; `Collapse` (미사용 — `SettingSection`은 자체 아코디언을 쓴다)
- Produces:
  ```ts
  // HelpTip.tsx
  export function HelpTip(props: { term?: GlossaryTerm; text?: string }): JSX.Element | null

  // ChangedBadge.tsx — FieldRow와 SwitchField가 공유하는 '사용자 설정' 배지
  export function ChangedBadge(props: { changed?: boolean }): JSX.Element | null

  // FieldRow.tsx
  export function FieldRow(props: {
    label: string; tooltipTerm?: GlossaryTerm; tooltipText?: string;
    changed?: boolean; aiHint?: string; children: ReactNode;
  }): JSX.Element

  // SwitchField.tsx
  export function SwitchField(props: {
    label: string; description: string; checked: boolean;
    onChange: (checked: boolean) => void;
    tooltipTerm?: GlossaryTerm; tooltipText?: string; changed?: boolean;
  }): JSX.Element

  // RadioCardGroup.tsx
  export interface RadioCardOption<T extends string> {
    value: T; label: string; description: string; icon?: ReactNode; recommended?: boolean;
  }
  export function RadioCardGroup<T extends string>(props: {
    name: string; value: T; options: ReadonlyArray<RadioCardOption<T>>;
    onChange: (value: T) => void; columns?: 1 | 2; ariaLabel?: string;
  }): JSX.Element

  // SettingSection.tsx
  export function SettingSection(props: {
    icon: ReactNode; title: string; summary?: string; changedCount?: number;
    hiddenChangedCount?: number; defaultOpen?: boolean; highlighted?: boolean;
    onAiRecommend?: () => void; aiDisabled?: boolean; aiLabel?: string;
    children: ReactNode;
  }): JSX.Element
  ```

- [ ] **Step 1: `RadioCardGroup` 테스트를 작성**

`src/tests/web/components/form/RadioCardGroup.test.tsx`

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RadioCardGroup, RadioCardOption } from '@/web/components/form/RadioCardGroup';

type Fruit = 'apple' | 'banana';

const options: ReadonlyArray<RadioCardOption<Fruit>> = [
  { value: 'apple', label: '사과', description: '빨간 과일입니다.', recommended: true },
  { value: 'banana', label: '바나나', description: '노란 과일입니다.' },
];

describe('RadioCardGroup', () => {
  test('옵션의 라벨과 설명을 모두 렌더링한다', () => {
    render(<RadioCardGroup name="fruit" value="apple" options={options} onChange={vi.fn()} />);

    expect(screen.getByText('사과')).toBeInTheDocument();
    expect(screen.getByText('빨간 과일입니다.')).toBeInTheDocument();
    expect(screen.getByText('바나나')).toBeInTheDocument();
    expect(screen.getByText('노란 과일입니다.')).toBeInTheDocument();
  });

  test('현재 값에 해당하는 라디오만 checked이다', () => {
    render(<RadioCardGroup name="fruit" value="apple" options={options} onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /사과/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /바나나/ })).not.toBeChecked();
  });

  test('다른 옵션을 고르면 onChange가 그 값으로 호출된다', () => {
    const onChange = vi.fn();
    render(<RadioCardGroup name="fruit" value="apple" options={options} onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: /바나나/ }));

    expect(onChange).toHaveBeenCalledWith('banana');
  });

  test('ariaLabel을 주면 radiogroup의 접근성 이름이 된다', () => {
    render(
      <RadioCardGroup name="fruit" ariaLabel="과일 선택" value="apple" options={options} onChange={vi.fn()} />
    );

    expect(screen.getByRole('radiogroup', { name: '과일 선택' })).toBeInTheDocument();
  });

  test('recommended 옵션에는 추천 표식이 붙는다', () => {
    render(<RadioCardGroup name="fruit" value="banana" options={options} onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /사과/ })).toHaveAccessibleName(/추천/);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/components/form/RadioCardGroup.test.tsx`
Expected: FAIL — `Failed to resolve import "@/web/components/form/RadioCardGroup"`

- [ ] **Step 3: `HelpTip`과 `RadioCardGroup` 구현**

`src/web/components/form/HelpTip.tsx`

```tsx
'use client';

import { HelpCircle } from 'lucide-react';
import { GLOSSARY, GlossaryTerm, Tooltip } from '../ui';

interface HelpTipProps {
  // 용어집에 등재된 키. text보다 우선한다.
  term?: GlossaryTerm;
  // 용어집에 없는 임시 설명문. 2줄 이하로 쓴다.
  text?: string;
}

// 설정 항목 옆의 "?" 도움말. 세법 용어처럼 화면에 그대로 노출하면 안 되는 표현은
// 전부 이 컴포넌트 뒤로 보낸다.
export function HelpTip({ term, text }: HelpTipProps) {
  const label = term ? GLOSSARY[term] : text;
  if (!label) return null;

  return (
    <Tooltip label={<span className="block max-w-xs whitespace-normal">{label}</span>}>
      <HelpCircle size={14} className="text-foreground-muted" aria-label="도움말" />
    </Tooltip>
  );
}
```

`src/web/components/form/RadioCardGroup.tsx`

```tsx
'use client';

import { type ReactNode } from 'react';

export interface RadioCardOption<T extends string> {
  value: T;
  label: string;
  description: string; // 2줄 이하
  icon?: ReactNode;
  recommended?: boolean;
}

interface RadioCardGroupProps<T extends string> {
  name: string;
  value: T;
  options: ReadonlyArray<RadioCardOption<T>>;
  onChange: (value: T) => void;
  columns?: 1 | 2;
  // 그룹의 접근성 이름. 한 화면에 같은 라벨('AI 추천' 등)을 가진 그룹이 둘 이상
  // 있을 수 있으므로, 그룹 단위로 좁혀 찾을 수 있도록 반드시 지정한다.
  ariaLabel?: string;
}

// 아이콘 + 라벨 + 2줄 설명을 담은 카드형 라디오. 중요도가 높은 전략 선택은
// SelectField 대신 이 컴포넌트를 쓴다 — 선택지마다 "왜 이걸 고르는가"를
// 함께 보여줘야 사용자가 전략을 설계한다는 감각을 갖기 때문이다.
export function RadioCardGroup<T extends string>({
  name, value, options, onChange, columns = 1, ariaLabel,
}: RadioCardGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`grid gap-2 ${columns === 2 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
              selected
                ? 'border-primary bg-primary/10'
                : 'border-card-border hover:border-primary/50'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={selected}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            {opt.icon && (
              <span className={`mt-0.5 shrink-0 ${selected ? 'text-primary' : 'text-foreground-muted'}`} aria-hidden="true">
                {opt.icon}
              </span>
            )}
            <span className="flex flex-col gap-0.5">
              <span className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>
                {opt.label}
                {opt.recommended && <span className="ml-1 text-xs font-normal">⭐ 추천</span>}
              </span>
              <span className="text-xs leading-snug text-foreground-muted">{opt.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
```

`<input>`을 `sr-only`로 숨기고 `<label>`이 감싸므로, 접근성 이름은 라벨 + 추천 표식 + 설명을 합친 텍스트가 된다. 테스트의 `getByRole('radio', { name: /사과/ })`와 `toHaveAccessibleName(/추천/)`이 이 구조에 의존한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/components/form/RadioCardGroup.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: `FieldRow` 테스트를 작성**

`src/tests/web/components/form/FieldRow.test.tsx`

```tsx
import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldRow } from '@/web/components/form/FieldRow';

describe('FieldRow', () => {
  test('라벨과 자식 입력을 렌더링한다', () => {
    render(
      <FieldRow label="현재 나이">
        <input aria-label="현재 나이 입력" defaultValue="50" />
      </FieldRow>
    );

    expect(screen.getByText('현재 나이')).toBeInTheDocument();
    expect(screen.getByLabelText('현재 나이 입력')).toHaveValue('50');
  });

  test('changed가 true면 "사용자 설정" 배지를 표시한다', () => {
    render(<FieldRow label="현재 나이" changed><input /></FieldRow>);

    expect(screen.getByText('사용자 설정')).toBeInTheDocument();
  });

  test('changed가 false면 배지를 표시하지 않는다', () => {
    render(<FieldRow label="현재 나이"><input /></FieldRow>);

    expect(screen.queryByText('사용자 설정')).not.toBeInTheDocument();
  });

  test('aiHint가 있으면 AI 추천값을 표시한다', () => {
    render(<FieldRow label="수령 시작" aiHint="70세"><input /></FieldRow>);

    expect(screen.getByText('AI 추천: 70세')).toBeInTheDocument();
  });

  test('tooltipText가 있으면 도움말 버튼을 렌더링한다', () => {
    render(<FieldRow label="실질수익률" tooltipText="물가를 뺀 수익률입니다."><input /></FieldRow>);

    expect(screen.getByLabelText('도움말')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/components/form/FieldRow.test.tsx`
Expected: FAIL — `Failed to resolve import "@/web/components/form/FieldRow"`

- [ ] **Step 7: `FieldRow`와 `SwitchField` 구현**

`src/web/components/form/ChangedBadge.tsx`

```tsx
// 기본값과 다른 값임을 알리는 배지. FieldRow와 SwitchField가 같은 마크업을 쓰므로
// 한 곳으로 뽑아 두 컴포넌트가 서로 어긋나지 않게 한다.
export function ChangedBadge({ changed }: { changed?: boolean }) {
  if (!changed) return null;

  return (
    <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
      사용자 설정
    </span>
  );
}
```

`src/web/components/form/FieldRow.tsx`

```tsx
'use client';

import { type ReactNode } from 'react';
import { GlossaryTerm } from '../ui';
import { ChangedBadge } from './ChangedBadge';
import { HelpTip } from './HelpTip';

interface FieldRowProps {
  label: string;
  tooltipTerm?: GlossaryTerm;
  tooltipText?: string;
  // 기본값과 다른 값이면 true. diffDefaults가 계산한 결과를 받는다.
  changed?: boolean;
  // AI가 제안한 값의 표시 문자열(예: "70세"). 표시만 하며 자동 적용하지 않는다.
  aiHint?: string;
  children: ReactNode;
}

// 라벨 + 도움말 + 입력 + 상태 배지를 한 줄로 묶는 설정 항목 셸.
export function FieldRow({
  label, tooltipTerm, tooltipText, changed, aiHint, children,
}: FieldRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-foreground-muted">{label}</span>
        <HelpTip term={tooltipTerm} text={tooltipText} />
        <ChangedBadge changed={changed} />
        {aiHint && (
          <span className="text-[10px] text-foreground-muted">AI 추천: {aiHint}</span>
        )}
      </div>
      {children}
    </div>
  );
}
```

`src/web/components/form/SwitchField.tsx`

```tsx
'use client';

import { GlossaryTerm } from '../ui';
import { ChangedBadge } from './ChangedBadge';
import { HelpTip } from './HelpTip';

interface SwitchFieldProps {
  label: string;
  description: string; // 2줄 이하
  checked: boolean;
  onChange: (checked: boolean) => void;
  tooltipTerm?: GlossaryTerm;
  tooltipText?: string;
  changed?: boolean;
}

// 설명문을 반드시 포함하는 스위치. 설명 없는 on/off는 사용자가 무엇을 켰는지
// 알 수 없으므로 description을 optional로 두지 않는다.
export function SwitchField({
  label, description, checked, onChange, tooltipTerm, tooltipText, changed,
}: SwitchFieldProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-card-border p-3">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--color-primary,#6366f1)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {label}
          <HelpTip term={tooltipTerm} text={tooltipText} />
          <ChangedBadge changed={changed} />
        </span>
        <span className="text-xs leading-snug text-foreground-muted">{description}</span>
      </span>
    </label>
  );
}
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/components/form/FieldRow.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 9: `SettingSection` 테스트를 작성**

`src/tests/web/components/form/SettingSection.test.tsx`

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Target } from 'lucide-react';
import { SettingSection } from '@/web/components/form/SettingSection';

describe('SettingSection', () => {
  test('제목을 표시하고 defaultOpen이면 자식을 렌더링한다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="은퇴 목표" defaultOpen>
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.getByText('은퇴 목표')).toBeInTheDocument();
    expect(screen.getByText('본문')).toBeInTheDocument();
  });

  test('defaultOpen이 아니면 자식을 렌더링하지 않는다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="고급 설정">
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.queryByText('본문')).not.toBeInTheDocument();
  });

  test('헤더를 누르면 펼쳐진다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="고급 설정">
        <p>본문</p>
      </SettingSection>
    );

    fireEvent.click(screen.getByRole('button', { name: /고급 설정/ }));

    expect(screen.getByText('본문')).toBeInTheDocument();
  });

  test('changedCount가 0보다 크면 변경 개수 배지를 표시한다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="은퇴 목표" changedCount={3}>
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.getByText('3개 변경')).toBeInTheDocument();
  });

  test('hiddenChangedCount가 0보다 크면 숨겨진 설정을 알린다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="경제 가정" hiddenChangedCount={2}>
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.getByText('숨겨진 사용자 설정 2개')).toBeInTheDocument();
  });

  test('onAiRecommend가 있으면 AI 추천 버튼을 렌더링하고, 눌러도 섹션이 토글되지 않는다', () => {
    const onAiRecommend = vi.fn();
    render(
      <SettingSection icon={<Target size={16} />} title="연금 전략" onAiRecommend={onAiRecommend}>
        <p>본문</p>
      </SettingSection>
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 추천' }));

    expect(onAiRecommend).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('본문')).not.toBeInTheDocument();
  });

  test('highlighted면 강조 표식이 붙고, 아니면 붙지 않는다', () => {
    const { rerender, container } = render(
      <SettingSection icon={<Target size={16} />} title="은퇴 목표" highlighted>
        <p>본문</p>
      </SettingSection>
    );

    expect(container.querySelector('[data-highlighted]')).not.toBeNull();

    rerender(
      <SettingSection icon={<Target size={16} />} title="은퇴 목표">
        <p>본문</p>
      </SettingSection>
    );

    expect(container.querySelector('[data-highlighted]')).toBeNull();
  });

  test('aiDisabled면 AI 추천 버튼이 비활성화된다', () => {
    render(
      <SettingSection
        icon={<Target size={16} />} title="연금 전략"
        onAiRecommend={vi.fn()} aiDisabled aiLabel="이미 최적"
      >
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.getByRole('button', { name: '이미 최적' })).toBeDisabled();
  });
});
```

- [ ] **Step 10: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/components/form/SettingSection.test.tsx`
Expected: FAIL — `Failed to resolve import "@/web/components/form/SettingSection"`

- [ ] **Step 11: `SettingSection` 구현**

`src/web/components/form/SettingSection.tsx`

```tsx
'use client';

import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Sparkles } from 'lucide-react';

interface SettingSectionProps {
  icon: ReactNode;
  title: string;
  // 접혀 있을 때 헤더에 보여줄 한 줄 요약 (예: "60세 은퇴 · 기대수명 85세").
  summary?: string;
  changedCount?: number;
  // 현재 모드에서 숨겨져 있지만 기본값과 다른 필드 수. 안 보이는 값이 결과에
  // 영향을 준다는 사실을 숨기지 않기 위해 표시한다.
  hiddenChangedCount?: number;
  defaultOpen?: boolean;
  // 방금 값이 바뀐 섹션이면 true. 테두리를 잠깐 강조해 "무엇이 결과를 바꿨는지"를 알린다.
  highlighted?: boolean;
  onAiRecommend?: () => void;
  aiDisabled?: boolean;
  aiLabel?: string;
  children: ReactNode;
}

// 6개 전략 섹션이 공유하는 아코디언 셸.
// ui/Collapse를 쓰지 않는 이유: 헤더 안에 별도 클릭 대상(AI 추천 버튼)이 필요한데
// Collapse는 헤더 전체가 하나의 <button>이라 버튼 중첩이 된다.
export function SettingSection({
  icon, title, summary, changedCount = 0, hiddenChangedCount = 0,
  defaultOpen = false, highlighted = false,
  onAiRecommend, aiDisabled = false, aiLabel = 'AI 추천', children,
}: SettingSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div
      data-highlighted={highlighted || undefined}
      className={`rounded-2xl border transition-colors duration-300 ${
        highlighted ? 'border-primary bg-primary/5' : 'border-card-border'
      }`}
    >
      <div className="flex items-center gap-2 px-3">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          onClick={() => setIsOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 py-3 text-left"
        >
          <span className="shrink-0 text-primary" aria-hidden="true">{icon}</span>
          <span className="flex min-w-0 flex-col">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              {changedCount > 0 && (
                <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {changedCount}개 변경
                </span>
              )}
              {hiddenChangedCount > 0 && (
                <span className="rounded-full border border-card-border px-1.5 py-0.5 text-[10px] text-foreground-muted">
                  숨겨진 사용자 설정 {hiddenChangedCount}개
                </span>
              )}
            </span>
            {!isOpen && summary && (
              <span className="truncate text-xs text-foreground-muted">{summary}</span>
            )}
          </span>
        </button>

        {onAiRecommend && (
          <button
            type="button"
            onClick={onAiRecommend}
            disabled={aiDisabled}
            className="flex shrink-0 items-center gap-1 rounded-full border border-primary/40 px-2.5 py-1 text-xs font-semibold text-primary transition disabled:cursor-not-allowed disabled:border-card-border disabled:text-foreground-muted"
          >
            <Sparkles size={12} aria-hidden="true" />
            {aiLabel}
          </button>
        )}

        <motion.span
          className="shrink-0 text-foreground-muted"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          aria-hidden="true"
        >
          <ChevronDown size={16} />
        </motion.span>
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={contentId}
            role="region"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="flex flex-col gap-4 px-3 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 12: 배럴 파일 작성**

`src/web/components/form/index.ts`

```ts
export { HelpTip } from './HelpTip';
export { ChangedBadge } from './ChangedBadge';
export { FieldRow } from './FieldRow';
export { SwitchField } from './SwitchField';
export { RadioCardGroup } from './RadioCardGroup';
export type { RadioCardOption } from './RadioCardGroup';
export { SettingSection } from './SettingSection';
```

- [ ] **Step 13: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/components/form/`
Expected: PASS (16 tests)

- [ ] **Step 14: 전체 테스트 확인 후 커밋**

Run: `npm test` → 전부 PASS

```bash
git add src/web/components/form/ src/tests/web/components/form/
git commit -m "feat: 설정 화면용 재사용 폼 컴포넌트 5종 추가

SettingSection(아코디언 셸), RadioCardGroup(카드형 라디오), SwitchField,
FieldRow, HelpTip을 Tailwind로 작성한다.

RadioCardGroup은 선택지마다 2줄 설명을 강제해 사용자가 '왜 이걸 고르는가'를
알 수 있게 하고, SwitchField는 description을 optional로 두지 않는다.
SettingSection이 ui/Collapse를 재사용하지 않는 이유는 헤더 안에 별도
클릭 대상(AI 추천 버튼)이 필요해 버튼 중첩이 되기 때문이다."
```

---

### Task 3: 전략 모드 셀렉터 + 6섹션 셸 + 변경 배지

**Files:**
- Create: `src/web/features/StrategySettings/fieldVisibility.ts`
- Create: `src/web/features/StrategySettings/diffDefaults.ts`
- Create: `src/web/features/StrategySettings/StrategyModeSelector.tsx`
- Create: `src/web/features/StrategySettings/StrategySettingsPanel.tsx`
- Test: `src/tests/web/features/StrategySettings/fieldVisibility.test.ts`
- Test: `src/tests/web/features/StrategySettings/diffDefaults.test.ts`
- Test: `src/tests/web/features/StrategySettings/StrategySettingsPanel.test.tsx`

**Interfaces:**
- Consumes: `SettingSection` (Task 2), `RadioCardGroup` (Task 2), `DEFAULT_RETIREMENT_STRATEGY` (Task 1), `initialParams` from `@/infrastructure/storage/localStore`
- Produces:
  ```ts
  // fieldVisibility.ts
  export type FieldPath = string; // 'userProfile.currentAge' 같은 점 경로
  export const SECTION_FIELDS: Record<SectionId, ReadonlyArray<FieldPath>>;
  export type SectionId = 'basic' | 'goal' | 'pension' | 'investment' | 'economic' | 'advanced';
  export function isFieldVisible(mode: StrategyMode, path: FieldPath): boolean;

  // diffDefaults.ts
  export function collectChangedPaths(params: SimulationParams): ReadonlySet<FieldPath>;
  export function countSectionChanges(
    changed: ReadonlySet<FieldPath>, section: SectionId, mode: StrategyMode
  ): { visible: number; hidden: number };

  // StrategyModeSelector.tsx
  export function StrategyModeSelector(props: {
    mode: StrategyMode; onChange: (mode: StrategyMode) => void;
  }): JSX.Element;

  // StrategySettingsPanel.tsx
  export function StrategySettingsPanel(props: {
    params: SimulationParams; onChangeParams: (p: SimulationParams) => void;
  }): JSX.Element;
  ```

이 Task에서 6개 섹션은 **빈 셸**(제목 + 배지 + "준비 중" 없이 자식 없음)로만 만든다.
Task 4·6·7·8·10이 각각 자기 섹션의 내용을 채운다.

- [ ] **Step 1: `fieldVisibility` 테스트를 작성**

`src/tests/web/features/StrategySettings/fieldVisibility.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { SECTION_FIELDS, isFieldVisible, SectionId } from '@/web/features/StrategySettings/fieldVisibility';
import { StrategyMode } from '@/core/entities/types';

const ALL_SECTIONS: SectionId[] = ['basic', 'goal', 'pension', 'investment', 'economic', 'advanced'];
const ALL_MODES: StrategyMode[] = ['simple', 'standard', 'expert'];

describe('fieldVisibility', () => {
  test('모든 섹션에 필드 목록이 정의되어 있다', () => {
    for (const s of ALL_SECTIONS) {
      expect(SECTION_FIELDS[s].length, `${s} 섹션`).toBeGreaterThan(0);
    }
  });

  test('같은 필드 경로가 두 섹션에 중복 등록되지 않는다', () => {
    const all = ALL_SECTIONS.flatMap((s) => SECTION_FIELDS[s]);
    expect(new Set(all).size).toBe(all.length);
  });

  test('전문가 모드에서는 모든 필드가 보인다', () => {
    for (const s of ALL_SECTIONS) {
      for (const path of SECTION_FIELDS[s]) {
        expect(isFieldVisible('expert', path), `${path}`).toBe(true);
      }
    }
  });

  test('간편 모드에서는 고급 설정 필드가 보이지 않는다', () => {
    for (const path of SECTION_FIELDS.advanced) {
      expect(isFieldVisible('simple', path), `${path}`).toBe(false);
    }
  });

  test('간편 모드에서도 나이와 목표 우선순위는 보인다', () => {
    expect(isFieldVisible('simple', 'userProfile.currentAge')).toBe(true);
    expect(isFieldVisible('simple', 'userProfile.retirementAge')).toBe(true);
    expect(isFieldVisible('simple', 'strategy.objective')).toBe(true);
  });

  test('노출 범위는 간편 ⊆ 표준 ⊆ 전문가 순으로 넓어진다', () => {
    const visibleCount = (mode: StrategyMode) =>
      ALL_SECTIONS.flatMap((s) => SECTION_FIELDS[s]).filter((p) => isFieldVisible(mode, p)).length;

    expect(visibleCount('simple')).toBeLessThan(visibleCount('standard'));
    expect(visibleCount('standard')).toBeLessThan(visibleCount('expert'));
  });

  test('간편에서 보이는 필드는 표준/전문가에서도 전부 보인다', () => {
    const paths = ALL_SECTIONS.flatMap((s) => SECTION_FIELDS[s]);
    for (const path of paths.filter((p) => isFieldVisible('simple', p))) {
      for (const mode of ALL_MODES) {
        expect(isFieldVisible(mode, path), `${path} @ ${mode}`).toBe(true);
      }
    }
  });

  test('등록되지 않은 경로는 어떤 모드에서도 보이지 않는다', () => {
    expect(isFieldVisible('expert', 'nonexistent.path')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/fieldVisibility.test.ts`
Expected: FAIL — `Failed to resolve import ".../fieldVisibility"`

- [ ] **Step 3: `fieldVisibility` 구현**

`src/web/features/StrategySettings/fieldVisibility.ts`

```ts
import { StrategyMode } from '../../../core/entities/types';

// SimulationParams 안의 값을 가리키는 점 경로. diffDefaults가 같은 표기를 쓴다.
export type FieldPath = string;

export type SectionId = 'basic' | 'goal' | 'pension' | 'investment' | 'economic' | 'advanced';

// 섹션 → 그 섹션이 다루는 필드 경로. 한 경로는 정확히 한 섹션에만 속한다
// (중복되면 변경 개수 배지가 이중 계산된다 — 테스트가 이를 막는다).
export const SECTION_FIELDS: Record<SectionId, ReadonlyArray<FieldPath>> = {
  basic: [
    'userProfile.currentAge',
    'userProfile.retirementAge',
    'userProfile.expectancy',
    'spouse.enabled',
    'spouse.currentAge',
    'spouse.expectancy',
    'spouse.nationalPensionMonthlyAmount',
    'spouse.nationalPensionStartAge',
  ],
  goal: [
    'strategy.spendingChoice',
    'userProfile.targetMonthlySpending',
    'strategy.objective',
    'strategy.bequestStrategy',
    'userProfile.targetBequest',
  ],
  pension: [
    'strategy.nationalPensionStrategy',
    'strategy.privatePensionStrategy',
    'strategy.preferIsaFirst',
    // 자산 배열 내부 값을 가리키는 가상 경로. diffDefaults가 "자산 중 하나라도
    // 기본값과 다른가"로 해석한다 (배열 인덱스별 경로를 만들지 않기 위한 장치).
    'assets.reinvestDividend',
  ],
  investment: [
    'yieldPreset',
    'strategy.riskProfile',
    'strategy.economicScenario',
  ],
  economic: [
    'inflationRate',
    'inflationMode',
    'baseExchangeRate',
    'displayCurrency',
    'healthcare.enabled',
    'healthcare.baseMonthlyCost',
    'healthcare.costGrowthRate',
    'healthcare.longTermCareEnabled',
    'healthcare.longTermCareStartAge',
    'healthcare.longTermCareMonthlyCost',
    'healthcare.shockEnabled',
    'healthcare.shockAge',
    'healthcare.shockAmount',
  ],
  advanced: [
    'taxLawVersion',
    'taxSettings.limitPrivatePensionToTaxLimit',
    'taxSettings.enableComprehensiveTax',
    'taxSettings.enableHealthInsurance',
    'taxSettings.usDividendTaxRate',
    'taxSettings.domesticDividendTaxRate',
    'taxSettings.comprehensiveTaxRate',
    'taxSettings.healthInsuranceRate',
    'taxSettings.enablePrivatePensionTax',
    'taxSettings.privatePensionLimit',
    'taxSettings.privatePensionExcessTaxRate',
    'taxSettings.enablePensionComprehensiveComparison',
  ],
};

// 간편 모드에서 보이는 필드. "필수 입력만, 나머지는 AI가 추천" 원칙에 따라
// 나이 3개 + 생활비 전략 + 목표 우선순위 + 연금 전략 2개로 제한한다.
const SIMPLE_FIELDS: ReadonlySet<FieldPath> = new Set([
  'userProfile.currentAge',
  'userProfile.retirementAge',
  'userProfile.expectancy',
  'spouse.enabled',
  'spouse.currentAge',
  'spouse.expectancy',
  'spouse.nationalPensionMonthlyAmount',
  'spouse.nationalPensionStartAge',
  'strategy.spendingChoice',
  'userProfile.targetMonthlySpending',
  'strategy.objective',
  'strategy.nationalPensionStrategy',
  'strategy.privatePensionStrategy',
]);

// 표준 모드는 간편 + 상속 전략 + 투자 전략 + 경제 가정 주요 항목.
// 고급 설정(advanced)만 제외된다.
const STANDARD_EXCLUDED: ReadonlySet<FieldPath> = new Set(SECTION_FIELDS.advanced);

const ALL_FIELDS: ReadonlySet<FieldPath> = new Set(
  (Object.keys(SECTION_FIELDS) as SectionId[]).flatMap((s) => SECTION_FIELDS[s])
);

// 모드별 필드 노출 여부. 각 섹션이 개별적으로 mode === 'expert' 조건문을
// 흩뿌리지 않도록 이 함수가 단일 소스다.
export function isFieldVisible(mode: StrategyMode, path: FieldPath): boolean {
  if (!ALL_FIELDS.has(path)) return false;
  if (mode === 'expert') return true;
  if (mode === 'standard') return !STANDARD_EXCLUDED.has(path);
  return SIMPLE_FIELDS.has(path);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/fieldVisibility.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: `diffDefaults` 테스트를 작성**

`src/tests/web/features/StrategySettings/diffDefaults.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { collectChangedPaths, countSectionChanges } from '@/web/features/StrategySettings/diffDefaults';
import { initialParams } from '@/infrastructure/storage/localStore';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';

describe('collectChangedPaths', () => {
  test('기본값 그대로면 변경된 경로가 없다', () => {
    expect(collectChangedPaths(initialParams).size).toBe(0);
  });

  test('현재 나이를 바꾸면 그 경로만 변경으로 잡힌다', () => {
    const params = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 42 },
    };

    const changed = collectChangedPaths(params);

    expect(changed.has('userProfile.currentAge')).toBe(true);
    expect(changed.has('userProfile.retirementAge')).toBe(false);
  });

  test('전략이 기본 전략과 같으면 변경으로 잡지 않는다', () => {
    const params = { ...initialParams, strategy: { ...DEFAULT_RETIREMENT_STRATEGY } };

    expect(collectChangedPaths(params).size).toBe(0);
  });

  test('전략 하위 필드를 바꾸면 strategy.* 경로가 잡힌다', () => {
    const params = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, objective: 'tax_minimization' as const },
    };

    expect(collectChangedPaths(params).has('strategy.objective')).toBe(true);
  });

  test('taxSettings를 기본값과 다르게 주면 해당 경로가 잡힌다', () => {
    const params = { ...initialParams, taxSettings: { ...initialParams.taxSettings, usDividendTaxRate: 20 } as never };

    expect(collectChangedPaths(params).has('taxSettings.usDividendTaxRate')).toBe(true);
  });
});

describe('countSectionChanges', () => {
  test('보이는 변경과 숨겨진 변경을 모드 기준으로 나눈다', () => {
    const changed = new Set(['userProfile.currentAge', 'taxSettings.usDividendTaxRate']);

    // 간편 모드: currentAge는 basic 섹션에서 보이고, 세율은 advanced라 숨겨진다.
    expect(countSectionChanges(changed, 'basic', 'simple')).toEqual({ visible: 1, hidden: 0 });
    expect(countSectionChanges(changed, 'advanced', 'simple')).toEqual({ visible: 0, hidden: 1 });

    // 전문가 모드: 둘 다 보인다.
    expect(countSectionChanges(changed, 'advanced', 'expert')).toEqual({ visible: 1, hidden: 0 });
  });

  test('변경이 없으면 0을 반환한다', () => {
    expect(countSectionChanges(new Set(), 'goal', 'standard')).toEqual({ visible: 0, hidden: 0 });
  });
});
```

- [ ] **Step 6: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/diffDefaults.test.ts`
Expected: FAIL — `Failed to resolve import ".../diffDefaults"`

- [ ] **Step 7: `diffDefaults` 구현**

`src/web/features/StrategySettings/diffDefaults.ts`

```ts
import { SimulationParams, StrategyMode } from '../../../core/entities/types';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../core/usecases/strategy/compileStrategy';
import { resolveTaxSettings } from '../../../core/usecases/tax/taxRates';
import { initialParams } from '../../../infrastructure/storage/localStore';
import { FieldPath, SECTION_FIELDS, SectionId, isFieldVisible } from './fieldVisibility';

// 'a.b' 경로로 중첩 값을 읽는다. 중간이 없으면 undefined.
function readPath(source: unknown, path: FieldPath): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}

// 비교 기준값. 세 곳에서 온다:
//   - taxSettings.*  : resolveTaxSettings()가 채우는 기본 세팅
//   - strategy.*     : DEFAULT_RETIREMENT_STRATEGY
//   - 그 외          : initialParams (앱이 새 시나리오에 넣는 값)
// spouse/healthcare는 initialParams에 없으므로 undefined가 기준이 되고,
// 사용자가 켜는 순간 "변경됨"으로 잡힌다 — 의도한 동작이다.
function readBaseline(path: FieldPath): unknown {
  if (path.startsWith('taxSettings.')) {
    return readPath({ taxSettings: resolveTaxSettings() }, path);
  }
  if (path.startsWith('strategy.')) {
    return readPath({ strategy: DEFAULT_RETIREMENT_STRATEGY }, path);
  }
  return readPath(initialParams, path);
}

// 자산 배열 내부 값을 가리키는 가상 경로. 배열 인덱스별 경로를 만들지 않기 위해
// "자산 중 하나라도 기본값과 다른가"로 축약해 판정한다.
const ASSET_REINVEST_PATH: FieldPath = 'assets.reinvestDividend';

function isAssetReinvestChanged(params: SimulationParams): boolean {
  const baseline = new Map(initialParams.assets.map((a) => [a.id, a.reinvestDividend]));
  return params.assets.some((a) => {
    const base = baseline.get(a.id);
    // initialParams에 없는 자산(사용자가 추가한 것)은 기준값이 없으므로 변경으로 보지 않는다.
    return base !== undefined && a.reinvestDividend !== base;
  });
}

// 현재 params가 기본값과 다른 필드 경로의 집합.
// FieldRow의 "사용자 설정" 배지와 SettingSection의 변경 개수 배지가 모두 이 결과를 쓴다.
export function collectChangedPaths(params: SimulationParams): ReadonlySet<FieldPath> {
  const changed = new Set<FieldPath>();

  for (const section of Object.keys(SECTION_FIELDS) as SectionId[]) {
    for (const path of SECTION_FIELDS[section]) {
      if (path === ASSET_REINVEST_PATH) {
        if (isAssetReinvestChanged(params)) changed.add(path);
        continue;
      }

      const current = readPath(params, path);
      // 값을 아직 지정하지 않은 필드(undefined)는 "기본값 그대로"로 본다.
      // undefined vs 기본값을 변경으로 잡으면 새 시나리오가 전부 '사용자 설정'이 된다.
      if (current === undefined) continue;
      if (current !== readBaseline(path)) changed.add(path);
    }
  }

  return changed;
}

// 섹션 헤더 배지용. 현재 모드에서 보이는 변경 수와 숨겨진 변경 수를 나눈다.
export function countSectionChanges(
  changed: ReadonlySet<FieldPath>,
  section: SectionId,
  mode: StrategyMode
): { visible: number; hidden: number } {
  let visible = 0;
  let hidden = 0;

  for (const path of SECTION_FIELDS[section]) {
    if (!changed.has(path)) continue;
    if (isFieldVisible(mode, path)) visible += 1;
    else hidden += 1;
  }

  return { visible, hidden };
}
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/diffDefaults.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 9: 패널 테스트를 작성**

`src/tests/web/features/StrategySettings/StrategySettingsPanel.test.tsx`

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StrategySettingsPanel } from '@/web/features/StrategySettings/StrategySettingsPanel';
import { initialParams } from '@/infrastructure/storage/localStore';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';

describe('StrategySettingsPanel', () => {
  test('전략 모드 3개와 6개 섹션 제목을 렌더링한다', () => {
    render(<StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /간편/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /표준/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /전문가/ })).toBeInTheDocument();

    for (const title of ['기본 정보', '은퇴 목표', '연금 전략', '투자 전략', '경제 가정', '고급 설정']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  test('strategy가 없으면 간편 모드가 선택된다', () => {
    render(<StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /간편/ })).toBeChecked();
  });

  test('모드를 바꾸면 strategy.mode가 반영된 params로 onChangeParams가 호출된다', () => {
    const onChangeParams = vi.fn();
    render(<StrategySettingsPanel params={initialParams} onChangeParams={onChangeParams} />);

    fireEvent.click(screen.getByRole('radio', { name: /전문가/ }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, mode: 'expert' },
    });
  });

  test('기본값과 다른 값이 있으면 해당 섹션에 변경 개수 배지가 표시된다', () => {
    const params = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 42 },
    };

    render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} />);

    expect(screen.getByText('1개 변경')).toBeInTheDocument();
  });

  test('간편 모드에서 고급 설정 변경이 있으면 숨겨진 설정 개수를 알린다', () => {
    const params = {
      ...initialParams,
      taxSettings: { ...initialParams.taxSettings, usDividendTaxRate: 20 } as never,
    };

    render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} />);

    expect(screen.getByText('숨겨진 사용자 설정 1개')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/StrategySettingsPanel.test.tsx`
Expected: FAIL — `Failed to resolve import ".../StrategySettingsPanel"`

- [ ] **Step 11: `StrategyModeSelector` 구현**

`src/web/features/StrategySettings/StrategyModeSelector.tsx`

```tsx
'use client';

import { Gauge, Settings2, Wand2 } from 'lucide-react';
import { StrategyMode } from '../../../core/entities/types';
import { RadioCardGroup, RadioCardOption } from '../../components/form';

const MODE_OPTIONS: ReadonlyArray<RadioCardOption<StrategyMode>> = [
  {
    value: 'simple',
    label: '간편 모드',
    description: '꼭 필요한 것만 고르면 나머지는 AI가 추천합니다.',
    icon: <Wand2 size={16} />,
    recommended: true,
  },
  {
    value: 'standard',
    label: '표준 모드',
    description: '투자 전략과 경제 가정까지 직접 조정합니다.',
    icon: <Gauge size={16} />,
  },
  {
    value: 'expert',
    label: '전문가 모드',
    description: '세율·한도 등 모든 변수를 직접 지정합니다.',
    icon: <Settings2 size={16} />,
  },
];

interface StrategyModeSelectorProps {
  mode: StrategyMode;
  onChange: (mode: StrategyMode) => void;
}

export function StrategyModeSelector({ mode, onChange }: StrategyModeSelectorProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-foreground-muted">은퇴 전략 모드</span>
      <RadioCardGroup name="strategy-mode" ariaLabel="은퇴 전략 모드" value={mode} options={MODE_OPTIONS} onChange={onChange} />
    </div>
  );
}
```

- [ ] **Step 12: `StrategySettingsPanel` 구현**

`src/web/features/StrategySettings/StrategySettingsPanel.tsx`

```tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, LineChart, Settings2, Target, TrendingUp, User } from 'lucide-react';
import { RetirementStrategy, SimulationParams, StrategyMode } from '../../../core/entities/types';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../core/usecases/strategy/compileStrategy';
import { SettingSection } from '../../components/form';
import { StrategyModeSelector } from './StrategyModeSelector';
import { collectChangedPaths, countSectionChanges } from './diffDefaults';
import { SectionId } from './fieldVisibility';

export interface StrategySettingsPanelProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
}

// 값을 바꾼 섹션을 강조하는 시간. 눈에 띄되 시선을 붙잡지 않을 정도로 짧게 둔다.
const HIGHLIGHT_DURATION_MS = 2000;

// 섹션 표시 메타. 순서가 화면 순서다.
const SECTIONS: ReadonlyArray<{ id: SectionId; title: string; icon: React.ReactNode }> = [
  { id: 'basic', title: '기본 정보', icon: <User size={16} /> },
  { id: 'goal', title: '은퇴 목표', icon: <Target size={16} /> },
  { id: 'pension', title: '연금 전략', icon: <Coins size={16} /> },
  { id: 'investment', title: '투자 전략', icon: <TrendingUp size={16} /> },
  { id: 'economic', title: '경제 가정', icon: <LineChart size={16} /> },
  { id: 'advanced', title: '고급 설정', icon: <Settings2 size={16} /> },
];

// 저장된 시나리오에 strategy가 없을 수 있으므로(구 데이터) 항상 기본값으로 채워 읽는다.
export function resolveStrategy(params: SimulationParams): RetirementStrategy {
  return { ...DEFAULT_RETIREMENT_STRATEGY, ...(params.strategy ?? {}) };
}

export function StrategySettingsPanel({ params, onChangeParams }: StrategySettingsPanelProps) {
  const strategy = resolveStrategy(params);
  const mode = strategy.mode;

  const changed = useMemo(() => collectChangedPaths(params), [params]);

  // 방금 바뀐 섹션을 잠깐 강조한다. 어떤 필드가 바뀌었는지는 changed 집합의 변화로
  // 알 수 있지만, "언제" 바뀌었는지는 상태가 없으면 알 수 없어 로컬 state로 둔다.
  const [recentSection, setRecentSection] = useState<SectionId | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const highlightSection = useCallback((id: SectionId) => {
    setRecentSection(id);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setRecentSection(null), HIGHLIGHT_DURATION_MS);
  }, []);

  // 언마운트 시 타이머를 정리하지 않으면 setState가 사라진 컴포넌트에 대해 호출된다.
  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  const handleModeChange = (nextMode: StrategyMode) => {
    // 모드를 낮춰도 값은 보존한다 — 숨김일 뿐 초기화가 아니다.
    onChangeParams({ ...params, strategy: { ...strategy, mode: nextMode } });
  };

  return (
    <div className="flex flex-col gap-4">
      <StrategyModeSelector mode={mode} onChange={handleModeChange} />

      <div className="flex flex-col gap-2">
        {SECTIONS.map(({ id, title, icon }) => {
          const counts = countSectionChanges(changed, id, mode);
          return (
            <SettingSection
              key={id}
              icon={icon}
              title={title}
              changedCount={counts.visible}
              hiddenChangedCount={counts.hidden}
              highlighted={recentSection === id}
              // 고급 설정은 전문가 모드에서만 기본으로 펼친다.
              defaultOpen={id === 'advanced' ? mode === 'expert' : false}
            >
              {/* 섹션 본문은 Task 4·6·7·8·10에서 채운다. */}
            </SettingSection>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 13: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/`
Expected: PASS (20 tests)

- [ ] **Step 14: 시뮬레이터 페이지에 마운트**

`src/app/simulator/page.tsx`의 897행 부근, `<QuickSettingsSummary ... />` **바로 아래**에 추가한다.
기존 컴포넌트는 이 시점에 그대로 둔다(Task 10에서 제거). 병존 기간에는 같은 값이 두 곳에
보이지만, 단일 소스가 `activeParams` 하나이므로 값이 어긋나지 않는다.

```tsx
import { StrategySettingsPanel } from '../../web/features/StrategySettings/StrategySettingsPanel';
```

```tsx
            <QuickSettingsSummary params={activeParams} onChangeParams={handleUpdateActiveParams} />
            <GlassCard>
              <StrategySettingsPanel params={activeParams} onChangeParams={handleUpdateActiveParams} />
            </GlassCard>
```

- [ ] **Step 15: 전체 테스트 확인 후 커밋**

Run: `npm test` → 전부 PASS
Run: `npm run lint` → 에러 없음

```bash
git add src/web/features/StrategySettings/ \
        src/tests/web/features/StrategySettings/ \
        src/app/simulator/page.tsx
git commit -m "feat: 전략 모드 셀렉터와 6섹션 셸, 변경 배지 기반 추가

fieldVisibility가 모드별 필드 노출의 단일 소스가 되어 각 섹션이 개별적으로
mode 조건문을 흩뿌리지 않게 한다. diffDefaults는 기본값과 다른 필드 경로를
모아 '사용자 설정' 배지와 섹션별 변경 개수를 계산한다.

모드를 낮춰도 값은 보존하며, 숨겨진 필드 중 기본값과 다른 것이 있으면
'숨겨진 사용자 설정 N개'를 표시해 안 보이는 값이 결과에 영향을 준다는
사실을 숨기지 않는다.

섹션 본문은 비어 있고 이후 단계에서 채운다. 기존 QuickSettingsSummary와
당분간 병존하며 Task 10에서 제거한다."
```

---

### Task 4: ① 기본 정보 섹션 (배우자 UI 포함)

**Files:**
- Create: `src/web/features/StrategySettings/strategyOptions.tsx`
- Create: `src/web/features/StrategySettings/sections/BasicInfoSection.tsx`
- Modify: `src/web/features/StrategySettings/StrategySettingsPanel.tsx`
- Test: `src/tests/web/features/StrategySettings/sections/BasicInfoSection.test.tsx`

**Interfaces:**
- Consumes: `FieldRow`, `SwitchField`, `RadioCardGroup` (Task 2), `isFieldVisible`, `collectChangedPaths` (Task 3), `SpouseProfile` (Task 1), `InputField` from `@/web/components/InputField`
- Produces:
  ```ts
  // strategyOptions.tsx — enum → 라벨/아이콘/설명 메타의 단일 소스.
  // Task 6·7·8이 여기에 각자 옵션 테이블을 추가한다.
  export const DEFAULT_SPOUSE: SpouseProfile;

  // sections/BasicInfoSection.tsx
  export interface SectionProps {
    params: SimulationParams;
    onChangeParams: (p: SimulationParams) => void;
    mode: StrategyMode;
    changed: ReadonlySet<FieldPath>;
  }
  export function BasicInfoSection(props: SectionProps): JSX.Element;
  ```

`SectionProps`는 6개 섹션이 모두 공유한다. `strategyOptions.tsx`에 정의하고 각 섹션이 import 한다.

이 Task에서 배우자 값은 **저장만** 되고 시뮬레이션에 영향을 주지 않는다. 엔진 연결은 Task 5다.

- [ ] **Step 1: 테스트를 작성**

`src/tests/web/features/StrategySettings/sections/BasicInfoSection.test.tsx`

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BasicInfoSection } from '@/web/features/StrategySettings/sections/BasicInfoSection';
import { DEFAULT_SPOUSE } from '@/web/features/StrategySettings/strategyOptions';
import { initialParams } from '@/infrastructure/storage/localStore';

const renderSection = (params = initialParams, onChangeParams = vi.fn()) => {
  render(
    <BasicInfoSection
      params={params}
      onChangeParams={onChangeParams}
      mode="standard"
      changed={new Set()}
    />
  );
  return onChangeParams;
};

describe('BasicInfoSection', () => {
  test('현재 나이·은퇴 나이·기대수명을 표시한다', () => {
    renderSection();

    expect(screen.getByLabelText('현재 나이')).toHaveValue(50);
    expect(screen.getByLabelText('목표 은퇴 나이')).toHaveValue(60);
    expect(screen.getByLabelText('기대수명')).toHaveValue(85);
  });

  test('현재 나이를 바꾸면 userProfile.currentAge만 바뀐 params로 호출된다', () => {
    const onChangeParams = renderSection();

    fireEvent.change(screen.getByLabelText('현재 나이'), { target: { value: '48' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 48 },
    });
  });

  test('배우자 스위치가 꺼져 있으면 배우자 입력이 보이지 않는다', () => {
    renderSection();

    expect(screen.queryByLabelText('배우자 나이')).not.toBeInTheDocument();
  });

  test('배우자 스위치를 켜면 기본 배우자 프로필이 저장된다', () => {
    const onChangeParams = renderSection();

    fireEvent.click(screen.getByRole('switch', { name: /배우자 포함/ }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      spouse: { ...DEFAULT_SPOUSE, enabled: true },
    });
  });

  test('배우자가 켜져 있으면 나이·기대수명·국민연금 입력이 보인다', () => {
    const params = { ...initialParams, spouse: { ...DEFAULT_SPOUSE, enabled: true, currentAge: 48 } };
    render(
      <BasicInfoSection params={params} onChangeParams={vi.fn()} mode="standard" changed={new Set()} />
    );

    expect(screen.getByLabelText('배우자 나이')).toHaveValue(48);
    expect(screen.getByLabelText('배우자 기대수명')).toBeInTheDocument();
    expect(screen.getByLabelText('배우자 국민연금 예상 월 수령액')).toBeInTheDocument();
  });

  test('배우자 기대수명이 현재 나이보다 작으면 경고를 표시한다', () => {
    const params = {
      ...initialParams,
      spouse: { ...DEFAULT_SPOUSE, enabled: true, currentAge: 60, expectancy: 55 },
    };
    render(
      <BasicInfoSection params={params} onChangeParams={vi.fn()} mode="standard" changed={new Set()} />
    );

    expect(screen.getByText(/기대수명이 현재 나이보다 작습니다/)).toBeInTheDocument();
  });

  test('changed에 포함된 경로는 "사용자 설정" 배지를 받는다', () => {
    render(
      <BasicInfoSection
        params={initialParams}
        onChangeParams={vi.fn()}
        mode="standard"
        changed={new Set(['userProfile.currentAge'])}
      />
    );

    expect(screen.getAllByText('사용자 설정')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/sections/BasicInfoSection.test.tsx`
Expected: FAIL — `Failed to resolve import ".../sections/BasicInfoSection"`

- [ ] **Step 3: `strategyOptions.tsx` 생성**

`src/web/features/StrategySettings/strategyOptions.tsx`

```tsx
import { SimulationParams, SpouseProfile, StrategyMode } from '../../../core/entities/types';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../../../core/usecases/pension/nationalPensionRules';
import { FieldPath } from './fieldVisibility';

// 6개 섹션이 공유하는 props. 섹션은 자기 값 읽기/쓰기와 노출 판정에 필요한 것만 받는다.
export interface SectionProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
  mode: StrategyMode;
  changed: ReadonlySet<FieldPath>;
}

// 배우자 스위치를 처음 켤 때 채워 넣는 값.
// currentAge/expectancy는 BasicInfoSection이 본인 값을 기준으로 덮어쓴다.
export const DEFAULT_SPOUSE: SpouseProfile = {
  enabled: false,
  currentAge: 50,
  expectancy: 90, // 여성 기대수명이 더 길다는 통계를 반영해 본인 기본값(85)보다 높게 둔다.
  nationalPensionMonthlyAmount: 0,
  nationalPensionStartAge: NATIONAL_PENSION_NORMAL_START_AGE,
};
```

- [ ] **Step 4: `BasicInfoSection` 구현**

`src/web/features/StrategySettings/sections/BasicInfoSection.tsx`

```tsx
'use client';

import { SimulationParams, SpouseProfile } from '../../../../core/entities/types';
import {
  NATIONAL_PENSION_DEFERRED_MAX_AGE, NATIONAL_PENSION_EARLY_MIN_AGE,
} from '../../../../core/usecases/pension/nationalPensionRules';
import InputField from '../../../components/InputField';
import { FieldRow, SwitchField } from '../../../components/form';
import { isFieldVisible } from '../fieldVisibility';
import { DEFAULT_SPOUSE, SectionProps } from '../strategyOptions';

export function BasicInfoSection({ params, onChangeParams, mode, changed }: SectionProps) {
  const { userProfile } = params;
  const spouse = params.spouse;
  const spouseEnabled = spouse?.enabled ?? false;

  const setProfile = (key: 'currentAge' | 'retirementAge' | 'expectancy', value: number) => {
    onChangeParams({ ...params, userProfile: { ...userProfile, [key]: value } });
  };

  const setSpouse = (patch: Partial<SpouseProfile>) => {
    const next: SimulationParams = {
      ...params,
      spouse: { ...DEFAULT_SPOUSE, ...(spouse ?? {}), ...patch },
    };
    onChangeParams(next);
  };

  // 배우자 나이가 모순이면 경고만 띄우고 값은 그대로 둔다.
  // 시뮬레이션 쪽은 spouseRules가 클램프해 처리하므로 여기서 입력을 되돌리지 않는다.
  const spouseAgeInvalid =
    spouseEnabled && spouse !== undefined && spouse.expectancy < spouse.currentAge;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {isFieldVisible(mode, 'userProfile.currentAge') && (
          <FieldRow label="현재 나이" changed={changed.has('userProfile.currentAge')}>
            <InputField
              label="" aria-label="현재 나이" type="number" suffixText="세"
              value={userProfile.currentAge}
              onChange={(e) => setProfile('currentAge', Number(e.target.value))}
            />
          </FieldRow>
        )}
        {isFieldVisible(mode, 'userProfile.retirementAge') && (
          <FieldRow
            label="목표 은퇴 나이"
            tooltipText="근로소득이 끝나고 자산 인출을 시작하는 나이입니다."
            changed={changed.has('userProfile.retirementAge')}
          >
            <InputField
              label="" aria-label="목표 은퇴 나이" type="number" suffixText="세"
              value={userProfile.retirementAge}
              onChange={(e) => setProfile('retirementAge', Number(e.target.value))}
            />
          </FieldRow>
        )}
        {isFieldVisible(mode, 'userProfile.expectancy') && (
          <FieldRow
            label="기대수명"
            tooltipText="이 나이까지 자금이 버티는지를 기준으로 계산합니다."
            changed={changed.has('userProfile.expectancy')}
          >
            <InputField
              label="" aria-label="기대수명" type="number" suffixText="세"
              value={userProfile.expectancy}
              onChange={(e) => setProfile('expectancy', Number(e.target.value))}
            />
          </FieldRow>
        )}
      </div>

      {isFieldVisible(mode, 'spouse.enabled') && (
        <SwitchField
          label="배우자 포함 (부부 기준 계산)"
          description="두 사람의 국민연금을 합산하고, 한 명만 남으면 생활비가 줄어드는 것까지 반영합니다."
          checked={spouseEnabled}
          onChange={(checked) => setSpouse({ enabled: checked })}
          changed={changed.has('spouse.enabled')}
        />
      )}

      {spouseEnabled && (
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="배우자 나이" changed={changed.has('spouse.currentAge')}>
            <InputField
              label="" aria-label="배우자 나이" type="number" suffixText="세"
              value={spouse?.currentAge ?? DEFAULT_SPOUSE.currentAge}
              onChange={(e) => setSpouse({ currentAge: Number(e.target.value) })}
            />
          </FieldRow>
          <FieldRow label="배우자 기대수명" changed={changed.has('spouse.expectancy')}>
            <InputField
              label="" aria-label="배우자 기대수명" type="number" suffixText="세"
              value={spouse?.expectancy ?? DEFAULT_SPOUSE.expectancy}
              onChange={(e) => setSpouse({ expectancy: Number(e.target.value) })}
            />
          </FieldRow>
          <FieldRow
            label="배우자 국민연금 예상 월 수령액"
            tooltipText="65세에 받기 시작할 때의 금액입니다. 연기하면 자동으로 가산됩니다."
            changed={changed.has('spouse.nationalPensionMonthlyAmount')}
          >
            <InputField
              label="" aria-label="배우자 국민연금 예상 월 수령액" type="text" suffixText="원"
              value={(spouse?.nationalPensionMonthlyAmount ?? 0).toLocaleString()}
              onChange={(e) => {
                const raw = e.target.value.replace(/,/g, '');
                if (raw === '' || !isNaN(Number(raw))) {
                  setSpouse({ nationalPensionMonthlyAmount: raw === '' ? 0 : Number(raw) });
                }
              }}
            />
          </FieldRow>
          <FieldRow
            label="배우자 수령 개시 나이"
            changed={changed.has('spouse.nationalPensionStartAge')}
          >
            <InputField
              label="" aria-label="배우자 수령 개시 나이" type="number" suffixText="세"
              min={NATIONAL_PENSION_EARLY_MIN_AGE} max={NATIONAL_PENSION_DEFERRED_MAX_AGE}
              value={spouse?.nationalPensionStartAge ?? DEFAULT_SPOUSE.nationalPensionStartAge}
              onChange={(e) => setSpouse({ nationalPensionStartAge: Number(e.target.value) })}
            />
          </FieldRow>
        </div>
      )}

      {spouseAgeInvalid && (
        <p className="text-xs text-amber-500">
          배우자 기대수명이 현재 나이보다 작습니다. 계산에는 현재 나이를 사용합니다.
        </p>
      )}
    </>
  );
}
```

- [ ] **Step 5: 패널에 섹션을 연결**

`StrategySettingsPanel.tsx`에서 `SECTIONS` 배열의 `basic` 항목 본문을 렌더링하도록 바꾼다.
섹션 본문 렌더링은 `renderSectionBody` 함수로 분리해 이후 Task가 케이스만 추가하게 한다.

```tsx
import { BasicInfoSection } from './sections/BasicInfoSection';
import { SectionProps } from './strategyOptions';
```

```tsx
  // 섹션 본문 렌더링. Task 6·7·8·10이 여기에 자기 케이스를 추가한다.
  const renderSectionBody = (id: SectionId, sectionProps: SectionProps) => {
    switch (id) {
      case 'basic':
        return <BasicInfoSection {...sectionProps} />;
      default:
        return null;
    }
  };

  // 섹션이 값을 바꾸면 그 섹션을 잠깐 강조한다. 각 섹션이 highlightSection을
  // 직접 호출하게 하면 여섯 곳에서 잊어버릴 수 있으므로 여기서 한 번만 감싼다.
  const sectionPropsFor = (id: SectionId): SectionProps => ({
    params,
    onChangeParams: (next) => {
      highlightSection(id);
      onChangeParams(next);
    },
    mode,
    changed,
  });
```

`SECTIONS.map` 안에서:

```tsx
              {renderSectionBody(id, sectionPropsFor(id))}
```

- [ ] **Step 6: 하이라이트 배선 테스트를 추가**

`src/tests/web/features/StrategySettings/StrategySettingsPanel.test.tsx` 끝에 추가한다.

```tsx
  test('섹션에서 값을 바꾸면 그 섹션이 잠깐 강조되고 시간이 지나면 해제된다', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} />
      );

      fireEvent.click(screen.getByRole('button', { name: /기본 정보/ }));
      fireEvent.change(screen.getByLabelText('현재 나이'), { target: { value: '48' } });

      expect(container.querySelectorAll('[data-highlighted]')).toHaveLength(1);

      act(() => { vi.advanceTimersByTime(2000); });

      expect(container.querySelectorAll('[data-highlighted]')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
```

파일 상단 import에 `act`를 추가한다.

```tsx
import { act, render, screen, fireEvent } from '@testing-library/react';
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/`
Expected: PASS (28 tests)

- [ ] **Step 8: 전체 테스트 확인 후 커밋**

Run: `npm test` → 전부 PASS

```bash
git add src/web/features/StrategySettings/ src/tests/web/features/StrategySettings/
git commit -m "feat: 기본 정보 섹션과 배우자 프로필 UI 추가

나이 3개와 배우자 스위치·나이·기대수명·국민연금을 입력받는다.
이 단계에서 배우자 값은 저장만 되고 시뮬레이션에는 아직 반영되지 않는다
(엔진 통합은 다음 단계).

배우자 나이가 모순이면(기대수명 < 현재 나이) 경고만 띄우고 입력을
되돌리지 않는다 — 타이핑 중간 상태에서 값이 튀는 것을 막기 위해서이며,
계산 쪽은 spouseRules가 클램프해 처리한다."
```

---

### Task 5: 배우자 엔진 통합

**Files:**
- Create: `src/core/usecases/spouse/spouseRules.ts`
- Modify: `src/core/entities/types.ts` (`SimulationYearlyResult.spouseAlive` 추가)
- Modify: `src/core/usecases/SimulationEngine.ts`
- Test: `src/tests/core/usecases/spouse/spouseRules.test.ts`
- Test: `src/tests/core/usecases/SimulationEngine.spouse.test.ts`

**Interfaces:**
- Consumes: `SpouseProfile`, `UserProfile` (Task 1), `getNationalPensionAdjustmentFactor`, `NATIONAL_PENSION_*` 상수 (기존)
- Produces:
  ```ts
  export const SINGLE_SURVIVOR_SPENDING_FACTOR = 0.7;
  export const SURVIVOR_PENSION_INHERIT_RATE = 0.6;

  export interface ResolvedSpouse {
    currentAge: number;
    expectancy: number;
    nationalPensionMonthlyAmount: number;
    nationalPensionStartAge: number;
    // 배우자가 사망하는 시점의 "본인 나이"
    deathAtSelfAge: number;
  }

  export function resolveSpouse(
    spouse: SpouseProfile | undefined, userProfile: UserProfile
  ): ResolvedSpouse | null;

  export function computeHouseholdEndAge(
    userProfile: UserProfile, resolved: ResolvedSpouse | null
  ): number;

  export function computeSpendingFactor(selfAlive: boolean, spouseAlive: boolean): number;

  export function computeSpouseNationalPensionMonthly(
    resolved: ResolvedSpouse, selfAge: number
  ): number;

  export function computeSurvivorPensionMonthly(
    ownMonthly: number, deceasedMonthly: number
  ): number;
  ```

- [ ] **Step 1: `spouseRules` 테스트를 작성**

`src/tests/core/usecases/spouse/spouseRules.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import {
  SINGLE_SURVIVOR_SPENDING_FACTOR, SURVIVOR_PENSION_INHERIT_RATE,
  computeHouseholdEndAge, computeSpendingFactor, computeSpouseNationalPensionMonthly,
  computeSurvivorPensionMonthly, resolveSpouse,
} from '@/core/usecases/spouse/spouseRules';
import { SpouseProfile, UserProfile } from '@/core/entities/types';

const userProfile: UserProfile = {
  currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000,
};

const spouse: SpouseProfile = {
  enabled: true, currentAge: 48, expectancy: 90,
  nationalPensionMonthlyAmount: 800000, nationalPensionStartAge: 65,
};

describe('resolveSpouse', () => {
  test('undefined면 null을 반환한다', () => {
    expect(resolveSpouse(undefined, userProfile)).toBeNull();
  });

  test('enabled가 false면 null을 반환한다', () => {
    expect(resolveSpouse({ ...spouse, enabled: false }, userProfile)).toBeNull();
  });

  test('배우자 사망 시점을 본인 나이로 환산한다', () => {
    // 배우자는 48세, 90세까지 → 42년 후. 그때 본인은 50 + 42 = 92세.
    expect(resolveSpouse(spouse, userProfile)?.deathAtSelfAge).toBe(92);
  });

  test('기대수명이 현재 나이보다 작으면 현재 나이로 클램프한다', () => {
    const invalid = { ...spouse, currentAge: 60, expectancy: 55 };

    const resolved = resolveSpouse(invalid, userProfile);

    expect(resolved?.expectancy).toBe(60);
    expect(resolved?.deathAtSelfAge).toBe(50); // 0년 후 = 지금
  });

  test('수령 개시 나이를 60~70으로 클램프한다', () => {
    expect(resolveSpouse({ ...spouse, nationalPensionStartAge: 55 }, userProfile)?.nationalPensionStartAge).toBe(60);
    expect(resolveSpouse({ ...spouse, nationalPensionStartAge: 99 }, userProfile)?.nationalPensionStartAge).toBe(70);
  });
});

describe('computeHouseholdEndAge', () => {
  test('배우자가 없으면 본인 기대수명이다', () => {
    expect(computeHouseholdEndAge(userProfile, null)).toBe(85);
  });

  test('배우자가 더 오래 살면 그 시점까지 연장한다', () => {
    expect(computeHouseholdEndAge(userProfile, resolveSpouse(spouse, userProfile))).toBe(92);
  });

  test('배우자가 먼저 죽으면 본인 기대수명을 유지한다', () => {
    const shortLived = { ...spouse, currentAge: 48, expectancy: 70 }; // 22년 후 = 본인 72세

    expect(computeHouseholdEndAge(userProfile, resolveSpouse(shortLived, userProfile))).toBe(85);
  });
});

describe('computeSpendingFactor', () => {
  test('둘 다 생존이면 1.0이다', () => {
    expect(computeSpendingFactor(true, true)).toBe(1);
  });

  test('한 명만 생존이면 축소 계수를 적용한다', () => {
    expect(computeSpendingFactor(true, false)).toBe(SINGLE_SURVIVOR_SPENDING_FACTOR);
    expect(computeSpendingFactor(false, true)).toBe(SINGLE_SURVIVOR_SPENDING_FACTOR);
  });

  test('둘 다 사망이면 0이다', () => {
    expect(computeSpendingFactor(false, false)).toBe(0);
  });
});

describe('computeSpouseNationalPensionMonthly', () => {
  test('개시 나이 전에는 0이다', () => {
    const resolved = resolveSpouse(spouse, userProfile)!;
    // 배우자 65세 = 본인 67세. 그 전인 본인 66세에는 0.
    expect(computeSpouseNationalPensionMonthly(resolved, 66)).toBe(0);
  });

  test('개시 나이부터 정상 금액을 받는다 (65세 개시 = 조정계수 1)', () => {
    const resolved = resolveSpouse(spouse, userProfile)!;

    expect(computeSpouseNationalPensionMonthly(resolved, 67)).toBe(800000);
  });

  test('연기 수령이면 가산된 금액을 받는다 (70세 = +36%)', () => {
    const deferred = resolveSpouse({ ...spouse, nationalPensionStartAge: 70 }, userProfile)!;
    // 배우자 70세 = 본인 72세.
    expect(computeSpouseNationalPensionMonthly(deferred, 72)).toBeCloseTo(800000 * 1.36, 5);
  });
});

describe('computeSurvivorPensionMonthly', () => {
  test('본인 연금과 유족연금 중 큰 쪽만 받는다', () => {
    // 사망자 연금 100만 * 0.6 = 60만 < 본인 80만 → 본인 것 유지.
    expect(computeSurvivorPensionMonthly(800000, 1000000)).toBe(800000);
  });

  test('유족연금이 더 크면 유족연금을 받는다', () => {
    // 사망자 200만 * 0.6 = 120만 > 본인 80만.
    expect(computeSurvivorPensionMonthly(800000, 2000000)).toBe(2000000 * SURVIVOR_PENSION_INHERIT_RATE);
  });

  test('본인 연금이 0이어도 유족연금은 받는다', () => {
    expect(computeSurvivorPensionMonthly(0, 1000000)).toBe(600000);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/spouse/spouseRules.test.ts`
Expected: FAIL — `Failed to resolve import "@/core/usecases/spouse/spouseRules"`

- [ ] **Step 3: `spouseRules` 구현**

`src/core/usecases/spouse/spouseRules.ts`

```ts
import { SpouseProfile, UserProfile } from '../../entities/types';
import {
  NATIONAL_PENSION_DEFERRED_MAX_AGE, NATIONAL_PENSION_EARLY_MIN_AGE,
  getNationalPensionAdjustmentFactor,
} from '../pension/nationalPensionRules';

// 2인 가구 → 1인 가구로 줄었을 때의 소비지출 비율.
// 통계청 가계동향조사의 1인 가구 대비 2인 가구 소비지출 비(대략 1.4~1.5배)를 역수로
// 단순화한 값이다. 주거·공과금처럼 인원이 줄어도 그대로인 고정비가 있어 0.5가 아니다.
export const SINGLE_SURVIVOR_SPENDING_FACTOR = 0.7;

// 유족연금 지급률. 실제 국민연금 유족연금은 가입기간에 따라 40~60%로 나뉘지만
// 이 앱은 가입기간 정보를 받지 않으므로 최대치인 60%로 단순화한다.
export const SURVIVOR_PENSION_INHERIT_RATE = 0.6;

export interface ResolvedSpouse {
  currentAge: number;
  expectancy: number;
  nationalPensionMonthlyAmount: number;
  nationalPensionStartAge: number;
  // 배우자가 사망하는 시점을 "본인 나이"로 환산한 값. 엔진 루프는 본인 나이로
  // 돌기 때문에, 매 연도 배우자 나이를 다시 계산하지 않아도 되도록 미리 넣어 둔다.
  deathAtSelfAge: number;
}

// 입력값을 정규화한다. 잘못된 값(기대수명 < 현재 나이, 범위 밖 개시 나이)은
// 던지지 않고 클램프한다 — UI가 이미 경고를 표시하고 있고, 여기서 던지면
// 타이핑 중간 상태에서 화면 전체가 죽는다.
export function resolveSpouse(
  spouse: SpouseProfile | undefined,
  userProfile: UserProfile
): ResolvedSpouse | null {
  if (!spouse || !spouse.enabled) return null;

  const currentAge = Math.max(0, spouse.currentAge);
  const expectancy = Math.max(currentAge, spouse.expectancy);
  const nationalPensionStartAge = Math.min(
    NATIONAL_PENSION_DEFERRED_MAX_AGE,
    Math.max(NATIONAL_PENSION_EARLY_MIN_AGE, spouse.nationalPensionStartAge)
  );

  return {
    currentAge,
    expectancy,
    nationalPensionMonthlyAmount: Math.max(0, spouse.nationalPensionMonthlyAmount),
    nationalPensionStartAge,
    deathAtSelfAge: userProfile.currentAge + (expectancy - currentAge),
  };
}

// 시뮬레이션 종료 나이(본인 나이 기준). 둘 중 늦게 사망하는 쪽까지 돌린다.
export function computeHouseholdEndAge(
  userProfile: UserProfile,
  resolved: ResolvedSpouse | null
): number {
  if (!resolved) return userProfile.expectancy;
  return Math.max(userProfile.expectancy, resolved.deathAtSelfAge);
}

// 생존 인원에 따른 생활비 계수.
export function computeSpendingFactor(selfAlive: boolean, spouseAlive: boolean): number {
  if (selfAlive && spouseAlive) return 1;
  if (!selfAlive && !spouseAlive) return 0;
  return SINGLE_SURVIVOR_SPENDING_FACTOR;
}

// 배우자 본인 명의 국민연금 월 수령액(명목, 조정계수 반영). 개시 전이면 0.
// selfAge는 본인 나이이며, 배우자 나이로 환산해 판정한다.
export function computeSpouseNationalPensionMonthly(
  resolved: ResolvedSpouse,
  selfAge: number
): number {
  const spouseAge = resolved.currentAge + (selfAge - (resolved.deathAtSelfAge - (resolved.expectancy - resolved.currentAge)));
  if (spouseAge < resolved.nationalPensionStartAge) return 0;
  return resolved.nationalPensionMonthlyAmount
    * getNationalPensionAdjustmentFactor(resolved.nationalPensionStartAge);
}

// 배우자 사망 후 생존자가 받는 국민연금. 중복조정으로 본인 연금과 합산하지 않고
// "본인 연금" vs "사망자 연금 * 지급률" 중 큰 쪽만 받는다(실제 제도의 단순화).
export function computeSurvivorPensionMonthly(
  ownMonthly: number,
  deceasedMonthly: number
): number {
  return Math.max(ownMonthly, deceasedMonthly * SURVIVOR_PENSION_INHERIT_RATE);
}
```

`computeSpouseNationalPensionMonthly`의 배우자 나이 환산식이 장황하다. 아래로 단순화한다 —
`deathAtSelfAge - (expectancy - currentAge)`는 항상 `userProfile.currentAge`이므로, `ResolvedSpouse`에
그 값을 직접 담는 것이 명확하다. `ResolvedSpouse`에 필드를 하나 추가한다.

```ts
export interface ResolvedSpouse {
  // ... 위와 동일 ...
  // 시뮬레이션 시작 시점의 본인 나이. 본인 나이 → 배우자 나이 환산에 쓴다.
  selfStartAge: number;
}
```

`resolveSpouse`의 반환에 `selfStartAge: userProfile.currentAge`를 추가하고,
환산식을 다음으로 바꾼다.

```ts
  const spouseAge = resolved.currentAge + (selfAge - resolved.selfStartAge);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/spouse/spouseRules.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: 엔진 회귀 테스트를 먼저 작성**

`src/tests/core/usecases/SimulationEngine.spouse.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SINGLE_SURVIVOR_SPENDING_FACTOR } from '@/core/usecases/spouse/spouseRules';
import { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 60, retirementAge: 60, expectancy: 80, targetMonthlySpending: 2000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 500000000, monthlyContribution: 0, annualReturn: 0, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('SimulationEngine 배우자 통합', () => {
  test('spouse가 없으면 결과가 기존과 완전히 동일하다', () => {
    const engine = new SimulationEngine();

    const withoutField = engine.run(baseParams);
    const withUndefined = engine.run({ ...baseParams, spouse: undefined });

    expect(withUndefined).toEqual(withoutField);
  });

  test('spouse.enabled가 false면 결과가 기존과 완전히 동일하다', () => {
    const engine = new SimulationEngine();

    const baseline = engine.run(baseParams);
    const disabled = engine.run({
      ...baseParams,
      spouse: {
        enabled: false, currentAge: 58, expectancy: 95,
        nationalPensionMonthlyAmount: 900000, nationalPensionStartAge: 65,
      },
    });

    expect(disabled).toEqual(baseline);
  });

  test('배우자가 더 오래 살면 시뮬레이션이 그 시점까지 연장된다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 60, expectancy: 90, // 30년 후 = 본인 90세
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });

    expect(result.yearlyResults[result.yearlyResults.length - 1].age).toBe(90);
  });

  test('배우자 국민연금이 본인 것과 합산된다', () => {
    const engine = new SimulationEngine();

    const solo = engine.run(baseParams);
    const couple = engine.run({
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 60, expectancy: 80,
        nationalPensionMonthlyAmount: 500000, nationalPensionStartAge: 65,
      },
    });

    const at70 = (r: typeof solo) => r.yearlyResults.find((y) => y.age === 70)!;
    expect(at70(couple).nationalPensionIncome).toBeGreaterThan(at70(solo).nationalPensionIncome);
  });

  test('배우자 사망 후 생활비가 축소 계수만큼 줄어든다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 80 },
      spouse: {
        enabled: true, currentAge: 60, expectancy: 70, // 10년 후 = 본인 70세 사망
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });

    const before = result.yearlyResults.find((y) => y.age === 69)!;
    const after = result.yearlyResults.find((y) => y.age === 75)!;

    expect(before.spouseAlive).toBe(true);
    expect(after.spouseAlive).toBe(false);
    expect(after.spending).toBeCloseTo(before.spending * SINGLE_SURVIVOR_SPENDING_FACTOR, 0);
  });

  test('본인 사망 후에도 배우자 생존 기간에는 생활비가 계속 발생한다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 70 },
      spouse: {
        enabled: true, currentAge: 60, expectancy: 85, // 25년 후 = 본인 85세
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });

    const afterSelfDeath = result.yearlyResults.find((y) => y.age === 80)!;

    expect(afterSelfDeath.spending).toBeGreaterThan(0);
    expect(afterSelfDeath.spouseAlive).toBe(true);
  });
});
```

- [ ] **Step 6: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.spouse.test.ts`
Expected: FAIL — `spouseAlive` 필드가 없고 종료 나이가 연장되지 않음

- [ ] **Step 7: `SimulationYearlyResult`에 `spouseAlive` 추가**

`src/core/entities/types.ts`의 `SimulationYearlyResult`에 추가한다.

```ts
  // 해당 연도 배우자 생존 여부. 배우자 미설정이면 항상 false다
  // (배우자가 없는 것과 사망한 것을 결과 타입에서 구분하지 않는다 —
  //  구분이 필요한 소비처는 params.spouse를 함께 본다).
  spouseAlive: boolean;
```

- [ ] **Step 8: `SimulationEngine`에 배우자 로직 통합**

`src/core/usecases/SimulationEngine.ts`의 `runSingle` 계열 메서드를 다음 순서로 수정한다.

1. 파일 상단에 import 추가:

```ts
import {
  computeHouseholdEndAge, computeSpendingFactor, computeSpouseNationalPensionMonthly,
  computeSurvivorPensionMonthly, resolveSpouse,
} from './spouse/spouseRules';
```

2. `const endAge = userProfile.expectancy;` (약 325행)를 다음으로 교체:

```ts
    const resolvedSpouse = resolveSpouse(params.spouse, userProfile);
    const endAge = computeHouseholdEndAge(userProfile, resolvedSpouse);
```

3. 연도 루프(`for (let y = 0; ...)`) 안, `const isRetired = ...` 바로 아래에 생존 판정을 추가:

```ts
      // 생존 판정. 기대수명 "까지"는 생존으로 본다(기존 endAge 포함 루프와 일관).
      const selfAlive = currentAge <= userProfile.expectancy;
      const spouseAlive = resolvedSpouse !== null && currentAge <= resolvedSpouse.deathAtSelfAge;
      // 배우자가 없으면 본인 생존 기간만 돌므로 계수는 항상 1이다.
      const spendingFactor = resolvedSpouse === null ? 1 : computeSpendingFactor(selfAlive, spouseAlive);
```

4. 목표 생활비 계산부(약 358~362행)에 계수를 곱한다:

```ts
      let monthlyTargetSpending = 0;
      if (isRetired && spendingStrategy !== 'dividend_only') {
        const baseMonthly = inflationMode === 'nominal'
          ? userProfile.targetMonthlySpending * Math.pow(1 + infRateAnnual, y)
          : userProfile.targetMonthlySpending;
        monthlyTargetSpending = baseMonthly * spendingFactor;
      }
```

5. 국민연금 계산부에서 본인 금액을 구한 뒤, 배우자 몫을 합산한다.
`if (currentAge >= nationalPensionStartAge) { ... }` 블록에서 `natAmountRaw`를 만든 직후
다음을 삽입한다.

```ts
        // 배우자 국민연금 합산. 사망자가 생기면 중복조정으로 큰 쪽만 남는다.
        if (resolvedSpouse !== null) {
          const spouseMonthlyBase = computeSpouseNationalPensionMonthly(resolvedSpouse, currentAge);
          const spouseMonthly = inflationMode === 'nominal'
            ? spouseMonthlyBase * Math.pow(1 + infRateAnnual, y)
            : spouseMonthlyBase;

          if (selfAlive && spouseAlive) {
            natAmountRaw += spouseMonthly;
          } else if (spouseAlive) {
            // 본인 사망 → 배우자가 생존자. 본인 연금을 유족연금으로 승계 판정.
            natAmountRaw = computeSurvivorPensionMonthly(spouseMonthly, natAmountRaw);
          } else {
            // 배우자 사망 → 본인이 생존자.
            natAmountRaw = computeSurvivorPensionMonthly(natAmountRaw, spouseMonthly);
          }
        }
```

주의: 본인이 사망한 연도(`selfAlive === false`)에도 `currentAge >= nationalPensionStartAge`
조건은 참이므로 이 블록이 실행된다. 위 분기가 그 경우를 명시적으로 처리한다.

6. `yearlyResults.push({...})` 객체에 `spouseAlive`를 추가한다:

```ts
        spouseAlive,
```

7. 조기 반환 경로(`totalYears <= 0`일 때 반환하는 객체)는 `yearlyResults: []`이므로
   변경이 필요 없다.

8. `SimulationYearlyResult`를 만드는 다른 위치가 있는지 확인한다.

Run: `grep -rn "hasTaxWarning:" src/core src/web src/app --include=*.ts --include=*.tsx`
각 결과 위치에 `spouseAlive`를 추가한다 (`SimpleSimulationAdapter.ts`, 테스트 픽스처 등).
TypeScript 컴파일 에러가 누락을 잡아준다.

- [ ] **Step 9: 타입 체크 및 테스트 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.spouse.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 10: 전체 회귀 확인**

Run: `npm test`
Expected: 전부 PASS. 스냅샷 테스트(`src/tests/core/usecases/__snapshots__`)가 깨지면
`spouseAlive: false` 추가 때문인지 확인한다. **그 필드 추가 외의 값 변화가 있으면
배우자 로직이 off 상태에서 결과를 바꾼 것이므로 되돌려 원인을 찾는다.**
필드 추가만이 원인이면 `npx vitest run -u`로 스냅샷을 갱신한다.

- [ ] **Step 11: 커밋**

```bash
git add src/core/usecases/spouse/ src/core/usecases/SimulationEngine.ts \
        src/core/entities/types.ts src/tests/core/usecases/spouse/ \
        src/tests/core/usecases/SimulationEngine.spouse.test.ts \
        src/tests/core/usecases/__snapshots__
git commit -m "feat: 배우자 생존 기간과 국민연금을 시뮬레이션에 반영

연도 루프에 생존 판정을 추가해 (1) 시뮬레이션 종료 나이를 둘 중 늦게
사망하는 쪽까지 연장하고, (2) 한 명만 남으면 생활비에 축소 계수 0.7을
적용하며, (3) 두 사람의 국민연금을 합산하되 한쪽이 사망하면 중복조정으로
'본인 연금'과 '사망자 연금의 60%' 중 큰 쪽만 남긴다.

자산·ISA·사적연금 계좌는 가구 합산 하나로 유지한다(소유자 분리는 범위 밖).

spouse 미설정 또는 enabled=false이면 결과가 변경 전과 완전히 동일함을
회귀 테스트로 검증한다."
```

---

### Task 6: ② 은퇴 목표 섹션 + `UtilityConfig` 배선 + AI 추천 기반

**Files:**
- Modify: `src/web/features/StrategySettings/strategyOptions.tsx` (은퇴 목표 옵션 테이블 추가)
- Create: `src/web/features/StrategySettings/useAiRecommendation.ts`
- Create: `src/web/features/StrategySettings/sections/RetirementGoalSection.tsx`
- Modify: `src/web/features/StrategySettings/StrategySettingsPanel.tsx`
- Modify: `src/app/simulator/page.tsx` (`compileStrategy` 결과를 엔진/추천에 배선)
- Test: `src/tests/web/features/StrategySettings/sections/RetirementGoalSection.test.tsx`
- Test: `src/tests/web/features/StrategySettings/useAiRecommendation.test.tsx`

**Interfaces:**
- Consumes: `compileStrategy` (Task 1), `SectionProps` (Task 4), `recommendStrategy`, `SimulationEngine` (기존)
- Produces:
  ```ts
  // strategyOptions.tsx 추가분
  export const SPENDING_STRATEGY_OPTIONS: ReadonlyArray<RadioCardOption<SpendingStrategyChoice>>;
  export const OBJECTIVE_OPTIONS: ReadonlyArray<RadioCardOption<ObjectivePriority>>;
  export const BEQUEST_OPTIONS: ReadonlyArray<RadioCardOption<BequestStrategy>>;

  // useAiRecommendation.ts
  export interface AiRecommendationState {
    recommendation: StrategyRecommendation | null;
    error: string | null;
    improved: boolean;
  }
  export function useAiRecommendation(params: SimulationParams): AiRecommendationState;

  // sections/RetirementGoalSection.tsx
  export function RetirementGoalSection(props: SectionProps & {
    ai: AiRecommendationState;
  }): JSX.Element;
  ```

`SectionProps`에 `ai` 필드를 추가하는 대신 교차 타입으로 확장한다 — 배우자 섹션처럼 AI가
관여하지 않는 섹션까지 `ai`를 받게 만들 필요가 없기 때문이다.

`SpendingStrategy`는 엔진 타입에 `'target' | 'dividend_only' | 'max_sustainable'` 3종만 있다.
요청받은 4번째 선택지 "AI 추천"은 `SpendingStrategyChoice`의 `'ai'`로 `strategy.spendingChoice`에
저장되고, `compileStrategy`가 엔진에 넘길 때만 `'target'`으로 내린다. 선택 상태는 전략 쪽에
남으므로 화면에서 사라지지 않으며, AI가 제안한 `monthlySpendingMultiplier`는 힌트로 노출한다.

- [ ] **Step 1: `useAiRecommendation` 테스트를 작성**

`src/tests/web/features/StrategySettings/useAiRecommendation.test.tsx`

```tsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAiRecommendation } from '@/web/features/StrategySettings/useAiRecommendation';
import { initialParams } from '@/infrastructure/storage/localStore';
import * as RecommendationEngine from '@/core/usecases/strategy/RecommendationEngine';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useAiRecommendation', () => {
  test('recommendStrategy 결과를 그대로 노출한다', () => {
    const fake = { improved: true, recommendedPlan: { nationalPensionStartAge: 70 } };
    vi.spyOn(RecommendationEngine, 'recommendStrategy').mockReturnValue(fake as never);

    const { result } = renderHook(() => useAiRecommendation(initialParams));

    expect(result.current.recommendation).toBe(fake);
    expect(result.current.improved).toBe(true);
    expect(result.current.error).toBeNull();
  });

  test('params가 같으면 recommendStrategy를 다시 호출하지 않는다', () => {
    const spy = vi.spyOn(RecommendationEngine, 'recommendStrategy')
      .mockReturnValue({ improved: false } as never);

    const { rerender } = renderHook(({ p }) => useAiRecommendation(p), {
      initialProps: { p: initialParams },
    });
    rerender({ p: initialParams });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('recommendStrategy가 던지면 error를 채우고 recommendation은 null이다', () => {
    vi.spyOn(RecommendationEngine, 'recommendStrategy').mockImplementation(() => {
      throw new Error('시뮬레이션 실패');
    });

    const { result } = renderHook(() => useAiRecommendation(initialParams));

    expect(result.current.recommendation).toBeNull();
    expect(result.current.error).toBe('추천을 계산하지 못했습니다.');
    expect(result.current.improved).toBe(false);
  });

  test('compileStrategy가 만든 UtilityConfig로 추천을 실행한다', () => {
    const spy = vi.spyOn(RecommendationEngine, 'recommendStrategy')
      .mockReturnValue({ improved: false } as never);

    const params = {
      ...initialParams,
      strategy: {
        mode: 'standard' as const, objective: 'tax_minimization' as const,
        bequestStrategy: 'maximize' as const, nationalPensionStrategy: 'normal' as const,
        privatePensionStrategy: 'tax_first' as const, preferIsaFirst: false,
        reinvestDividends: true, riskProfile: 'neutral' as const,
        economicScenario: 'long_term_average' as const,
      },
    };

    renderHook(() => useAiRecommendation(params));

    const cfg = spy.mock.calls[0][2];
    expect(cfg?.weights.taxEfficiency).toBe(25);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/useAiRecommendation.test.tsx`
Expected: FAIL — `Failed to resolve import ".../useAiRecommendation"`

- [ ] **Step 3: `useAiRecommendation` 구현**

`src/web/features/StrategySettings/useAiRecommendation.ts`

```ts
'use client';

import { useMemo } from 'react';
import { SimulationParams, StrategyRecommendation } from '../../../core/entities/types';
import { SimulationEngine } from '../../../core/usecases/SimulationEngine';
import { compileStrategy } from '../../../core/usecases/strategy/compileStrategy';
import { recommendStrategy } from '../../../core/usecases/strategy/RecommendationEngine';

export interface AiRecommendationState {
  recommendation: StrategyRecommendation | null;
  error: string | null;
  // recommendation?.improved의 안전한 별칭. 섹션들이 매번 옵셔널 체이닝하지 않도록 미리 편다.
  improved: boolean;
}

// AI 추천을 params당 1회만 실행하고 결과를 캐시한다.
// 각 섹션의 [AI 추천] 버튼은 이 결과 중 자기 소관 필드만 적용한다 — 섹션마다 별도
// 최적화기를 두면 시뮬레이션 호출이 섹션 수만큼 늘어나기 때문이다.
export function useAiRecommendation(params: SimulationParams): AiRecommendationState {
  return useMemo(() => {
    try {
      const compiled = compileStrategy(params);
      const engine = new SimulationEngine();
      const recommendation = recommendStrategy(compiled.params, engine, compiled.utilityConfig);
      return { recommendation, error: null, improved: recommendation.improved };
    } catch {
      // 추천 실패는 설정 화면 전체를 죽일 이유가 아니다. 버튼만 비활성화된다.
      return { recommendation: null, error: '추천을 계산하지 못했습니다.', improved: false };
    }
  }, [params]);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/useAiRecommendation.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: 섹션 테스트를 작성**

`src/tests/web/features/StrategySettings/sections/RetirementGoalSection.test.tsx`

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RetirementGoalSection } from '@/web/features/StrategySettings/sections/RetirementGoalSection';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';
import { SimulationParams } from '@/core/entities/types';

const noAi = { recommendation: null, error: null, improved: false };

const renderSection = (params: SimulationParams = initialParams, onChangeParams = vi.fn(), ai = noAi) => {
  render(
    <RetirementGoalSection
      params={params} onChangeParams={onChangeParams}
      mode="standard" changed={new Set()} ai={ai}
    />
  );
  return onChangeParams;
};

// '생활비 전략'과 '목표 우선순위'는 둘 다 'AI 추천' 옵션을 갖는다. 그룹으로 좁히지
// 않으면 getByRole이 두 개를 찾아 던지므로, 라디오는 항상 그룹 안에서 찾는다.
const group = (name: string) => within(screen.getByRole('radiogroup', { name }));

describe('RetirementGoalSection', () => {
  test('생활비 전략 4개 선택지를 렌더링한다', () => {
    renderSection();

    const spending = group('생활비 전략');
    for (const label of [/원하는 생활비 직접 입력/, /배당금만 소비/, /최대 생활비 자동 계산/, /AI 추천/]) {
      expect(spending.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  test('목표 우선순위 5개 선택지를 렌더링한다', () => {
    renderSection();

    const objective = group('목표 우선순위');
    for (const label of [/평생 생활비 확보/, /세금 최소화/, /자산 최대화/, /상속 최대화/, /AI 추천/]) {
      expect(objective.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  test('목표 우선순위를 고르면 strategy.objective가 반영된다', () => {
    const onChangeParams = renderSection();

    fireEvent.click(group('목표 우선순위').getByRole('radio', { name: /세금 최소화/ }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, objective: 'tax_minimization' },
    });
  });

  test('생활비 전략이 target일 때만 목표 월 생활비 입력이 보인다', () => {
    renderSection();

    expect(screen.getByLabelText('목표 월 생활비')).toBeInTheDocument();
  });

  test('배당금만 소비를 고르면 목표 월 생활비 입력이 사라진다', () => {
    render(
      <RetirementGoalSection
        params={{
          ...initialParams,
          strategy: { ...DEFAULT_RETIREMENT_STRATEGY, spendingChoice: 'dividend_only' },
        }}
        onChangeParams={vi.fn()} mode="standard" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.queryByLabelText('목표 월 생활비')).not.toBeInTheDocument();
  });

  test('AI 추천을 고르면 그 선택 상태가 유지된다', () => {
    const onChangeParams = renderSection();

    fireEvent.click(group('생활비 전략').getByRole('radio', { name: /AI 추천/ }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, spendingChoice: 'ai' },
    });
  });

  test('상속 전략이 "목표 금액 유지"일 때만 금액 입력이 보인다', () => {
    renderSection();
    expect(screen.queryByLabelText('목표 상속자산')).not.toBeInTheDocument();

    render(
      <RetirementGoalSection
        params={{
          ...initialParams,
          strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'target_amount' },
        }}
        onChangeParams={vi.fn()} mode="standard" changed={new Set()} ai={noAi}
      />
    );
    expect(screen.getByLabelText('목표 상속자산')).toBeInTheDocument();
  });

  test('AI 추천이 개선안을 찾으면 생활비 배수 힌트를 표시한다', () => {
    const ai = {
      recommendation: {
        improved: true,
        recommendedPlan: { monthlySpendingMultiplier: 1.1 },
      } as never,
      error: null,
      improved: true,
    };

    renderSection(initialParams, vi.fn(), ai);

    expect(screen.getByText(/AI 추천: 385만원/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/sections/RetirementGoalSection.test.tsx`
Expected: FAIL — `Failed to resolve import ".../RetirementGoalSection"`

- [ ] **Step 7: 옵션 테이블을 `strategyOptions.tsx`에 추가**

```tsx
import { Banknote, Coins, Gift, HandCoins, PiggyBank, Receipt, Sparkles, TrendingUp, Wallet } from 'lucide-react';
import {
  BequestStrategy, ObjectivePriority, SpendingStrategyChoice,
} from '../../../core/entities/types';
import { RadioCardOption } from '../../components/form';

// SpendingStrategyChoice는 core(entities/types.ts)에 정의되어 있다 —
// strategy.spendingChoice 필드의 타입이라 도메인 쪽이 소유해야 한다.
export const SPENDING_STRATEGY_OPTIONS: ReadonlyArray<RadioCardOption<SpendingStrategyChoice>> = [
  {
    value: 'target', label: '원하는 생활비 직접 입력',
    description: '매달 쓰고 싶은 금액을 정하고, 그 돈이 언제까지 버티는지 봅니다.',
    icon: <Wallet size={16} />, recommended: true,
  },
  {
    value: 'dividend_only', label: '배당금만 소비',
    description: '원금은 건드리지 않고 배당·이자만 씁니다. 자산을 그대로 남깁니다.',
    icon: <Coins size={16} />,
  },
  {
    value: 'max_sustainable', label: '최대 생활비 자동 계산',
    description: '기대수명까지 정확히 다 쓰는 금액을 역산해 알려줍니다.',
    icon: <TrendingUp size={16} />,
  },
  {
    value: 'ai', label: 'AI 추천',
    description: '지금 자산과 목표를 보고 무리 없는 생활비를 제안받습니다.',
    icon: <Sparkles size={16} />,
  },
];

export const OBJECTIVE_OPTIONS: ReadonlyArray<RadioCardOption<ObjectivePriority>> = [
  {
    value: 'lifetime_spending', label: '평생 생활비 확보',
    description: '돈이 떨어지지 않는 것을 가장 중요하게 봅니다.',
    icon: <Wallet size={16} />,
  },
  {
    value: 'tax_minimization', label: '세금 최소화',
    description: '평생 내는 세금과 건강보험료를 줄이는 쪽을 택합니다.',
    icon: <Receipt size={16} />,
  },
  {
    value: 'wealth_maximization', label: '자산 최대화',
    description: '쓰는 속도를 늦춰 자산을 오래 크게 유지합니다.',
    icon: <PiggyBank size={16} />,
  },
  {
    value: 'bequest_maximization', label: '상속 최대화',
    description: '남기는 자산을 최우선으로 두고 계획을 세웁니다.',
    icon: <Gift size={16} />,
  },
  {
    value: 'ai_recommended', label: 'AI 추천',
    description: '목표를 정하지 않고 균형 잡힌 기본 기준으로 계산합니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

export const BEQUEST_OPTIONS: ReadonlyArray<RadioCardOption<BequestStrategy>> = [
  {
    value: 'spend_all', label: '모두 사용',
    description: '남기지 않고 다 쓰는 것을 목표로 합니다.',
    icon: <HandCoins size={16} />,
  },
  {
    value: 'leave_some', label: '일부 남기기',
    description: '2년치 생활비 정도를 남기는 것을 목표로 합니다.',
    icon: <Banknote size={16} />,
  },
  {
    value: 'maximize', label: '최대 상속',
    description: '가능한 한 많이 남기는 방향으로 평가합니다.',
    icon: <Gift size={16} />, recommended: true,
  },
  {
    value: 'target_amount', label: '목표 금액 유지',
    description: '남기고 싶은 금액을 직접 정합니다.',
    icon: <PiggyBank size={16} />,
  },
];
```

`strategyOptions.tsx`는 JSX를 포함하므로 확장자가 `.tsx`여야 한다 (Task 4에서 이미 `.tsx`로 만들었다).

- [ ] **Step 8: `RetirementGoalSection` 구현**

`src/web/features/StrategySettings/sections/RetirementGoalSection.tsx`

```tsx
'use client';

import InputField from '../../../components/InputField';
import { FieldRow, RadioCardGroup } from '../../../components/form';
import { isFieldVisible } from '../fieldVisibility';
import {
  BEQUEST_OPTIONS, OBJECTIVE_OPTIONS, SPENDING_STRATEGY_OPTIONS, SectionProps,
} from '../strategyOptions';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../../core/usecases/strategy/compileStrategy';
import { AiRecommendationState } from '../useAiRecommendation';

type Props = SectionProps & { ai: AiRecommendationState };

function formatManwon(krw: number): string {
  return `${Math.round(krw / 10000).toLocaleString()}만원`;
}

export function RetirementGoalSection({ params, onChangeParams, mode, changed, ai }: Props) {
  const strategy = { ...DEFAULT_RETIREMENT_STRATEGY, ...(params.strategy ?? {}) };
  const spendingChoice = strategy.spendingChoice;

  const setStrategy = (patch: Partial<typeof strategy>) => {
    onChangeParams({ ...params, strategy: { ...strategy, ...patch } });
  };

  const multiplier = ai.improved
    ? ai.recommendation?.recommendedPlan?.monthlySpendingMultiplier
    : undefined;
  const spendingHint = multiplier !== undefined && multiplier !== 1
    ? formatManwon(params.userProfile.targetMonthlySpending * multiplier)
    : undefined;

  return (
    <>
      {isFieldVisible(mode, 'strategy.spendingChoice') && (
        <FieldRow label="생활비 전략" changed={changed.has('strategy.spendingChoice')}>
          <RadioCardGroup
            name="spending-strategy" ariaLabel="생활비 전략" value={spendingChoice}
            options={SPENDING_STRATEGY_OPTIONS}
            onChange={(v) => setStrategy({ spendingChoice: v })}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'userProfile.targetMonthlySpending') && spendingChoice === 'target' && (
        <FieldRow
          label="목표 월 생활비"
          changed={changed.has('userProfile.targetMonthlySpending')}
          aiHint={spendingHint}
        >
          <InputField
            label="" aria-label="목표 월 생활비" type="text"
            suffixText={params.displayCurrency === 'KRW' ? '원' : params.displayCurrency}
            value={params.userProfile.targetMonthlySpending.toLocaleString()}
            onChange={(e) => {
              const raw = e.target.value.replace(/,/g, '');
              if (raw === '' || !isNaN(Number(raw))) {
                onChangeParams({
                  ...params,
                  userProfile: {
                    ...params.userProfile,
                    targetMonthlySpending: raw === '' ? 0 : Number(raw),
                  },
                });
              }
            }}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.objective') && (
        <FieldRow
          label="목표 우선순위"
          tooltipText="이 선택이 모든 추천의 기준이 됩니다. 무엇을 가장 중요하게 볼지 정하세요."
          changed={changed.has('strategy.objective')}
        >
          <RadioCardGroup
            name="objective" ariaLabel="목표 우선순위" value={strategy.objective}
            options={OBJECTIVE_OPTIONS} onChange={(v) => setStrategy({ objective: v })}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.bequestStrategy') && (
        <FieldRow label="상속 전략" changed={changed.has('strategy.bequestStrategy')}>
          <RadioCardGroup
            name="bequest-strategy" ariaLabel="상속 전략" value={strategy.bequestStrategy}
            options={BEQUEST_OPTIONS} onChange={(v) => setStrategy({ bequestStrategy: v })}
            columns={2}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'userProfile.targetBequest') && strategy.bequestStrategy === 'target_amount' && (
        <FieldRow label="목표 상속자산" changed={changed.has('userProfile.targetBequest')}>
          <InputField
            label="" aria-label="목표 상속자산" type="text" suffixText="원"
            value={(params.userProfile.targetBequest ?? 0).toLocaleString()}
            onChange={(e) => {
              const raw = e.target.value.replace(/,/g, '');
              if (raw === '' || !isNaN(Number(raw))) {
                onChangeParams({
                  ...params,
                  userProfile: {
                    ...params.userProfile,
                    targetBequest: raw === '' ? 0 : Number(raw),
                  },
                });
              }
            }}
          />
        </FieldRow>
      )}
    </>
  );
}
```

- [ ] **Step 9: 패널에 섹션과 AI 훅을 연결**

`StrategySettingsPanel.tsx`:

```tsx
import { RetirementGoalSection } from './sections/RetirementGoalSection';
import { useAiRecommendation } from './useAiRecommendation';
```

컴포넌트 본문 상단:

```tsx
  const ai = useAiRecommendation(params);
```

`renderSectionBody`에 케이스 추가:

```tsx
      case 'goal':
        return <RetirementGoalSection {...sectionProps} ai={ai} />;
```

`SettingSection`에 AI 버튼을 붙인다 — `goal`/`pension`/`investment` 세 섹션만 대상이다.

```tsx
const AI_SECTIONS: ReadonlySet<SectionId> = new Set(['goal', 'pension', 'investment']);
```

`SECTIONS.map` 안:

```tsx
              onAiRecommend={AI_SECTIONS.has(id) ? () => applyAiToSection(id) : undefined}
              aiDisabled={!ai.improved}
              aiLabel={ai.error ?? (ai.improved ? 'AI 추천' : '이미 최적')}
```

`applyAiToSection`은 Task 7에서 연금 섹션 적용 로직과 함께 구현한다. 이 Task에서는 목표 섹션이
적용할 필드가 `monthlySpendingMultiplier` 하나뿐이므로 다음만 둔다.

```tsx
  // 섹션별 AI 적용. Task 7·8이 자기 케이스를 추가한다.
  const applyAiToSection = (id: SectionId) => {
    const plan = ai.recommendation?.recommendedPlan;
    if (!plan) return;

    if (id === 'goal' && plan.monthlySpendingMultiplier !== 1) {
      onChangeParams({
        ...params,
        userProfile: {
          ...params.userProfile,
          targetMonthlySpending: Math.round(
            params.userProfile.targetMonthlySpending * plan.monthlySpendingMultiplier
          ),
        },
      });
    }
  };
```

- [ ] **Step 10: `simulator/page.tsx`에 `compileStrategy` 배선**

지금까지 전략은 UI에만 저장되고 계산에 반영되지 않았다. 이 Step에서 연결한다.

`src/app/simulator/page.tsx`에서 `deferredParams`로 시뮬레이션을 실행하는 부분을 찾아
(`engine.run(deferredParams)` 또는 `useMemo` 안) 다음 형태로 바꾼다.

```tsx
import { compileStrategy } from '../../core/usecases/strategy/compileStrategy';
```

```tsx
  // 전략(사용자 언어)을 저수준 파라미터로 컴파일한 뒤 엔진에 넘긴다.
  // strategy가 없는 기존 시나리오는 compileStrategy가 입력을 그대로 통과시킨다.
  const compiled = useMemo(() => compileStrategy(deferredParams), [deferredParams]);
```

그 아래 `engine.run(deferredParams)`를 `engine.run(compiled.params)`로,
`recommendStrategy(deferredParams, engine)` 호출이 있다면
`recommendStrategy(compiled.params, engine, compiled.utilityConfig)`로 바꾼다.

`computeLifetimeUtility`/`analyzeCurrentStrategy`/`computeRiskAlerts` 등 `UtilityConfig`를
받는 호출도 `compiled.utilityConfig`를 넘기도록 수정한다.

Run: `grep -n "deferredParams" src/app/simulator/page.tsx` 로 모든 사용처를 확인하고,
**시뮬레이션 입력으로 쓰이는 곳만** 교체한다. 폼에 되돌려주는 값(`activeParams`)은 바꾸지 않는다.

- [ ] **Step 11: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 12: 전체 테스트 확인 후 커밋**

Run: `npm test` → 전부 PASS

```bash
git add src/web/features/StrategySettings/ src/tests/web/features/StrategySettings/ \
        src/app/simulator/page.tsx
git commit -m "feat: 은퇴 목표 섹션과 목적 함수 배선, AI 추천 기반 추가

생활비 전략·상속 전략·목표 우선순위를 카드형 라디오로 고르게 하고,
목표 우선순위가 compileStrategy를 거쳐 UtilityConfig.weights로 실제
계산에 반영되도록 simulator 페이지를 배선한다.

useAiRecommendation은 recommendStrategy를 params당 1회만 실행하고
결과를 캐시한다. 각 섹션은 이 결과 중 자기 소관 필드만 적용한다.
추천 실행이 실패해도 설정 화면은 계속 동작하며 버튼만 비활성화된다.

생활비 전략의 'AI 추천'은 엔진 SpendingStrategy에 없는 UI 전용 값이라
'target'으로 컴파일하고 추천 배수는 힌트로만 노출한다."
```

---

### Task 7: ③ 연금 전략 섹션

**Files:**
- Modify: `src/core/usecases/strategy/compileStrategy.ts` (연금 축 추가)
- Modify: `src/web/features/StrategySettings/strategyOptions.tsx` (연금 옵션 테이블)
- Create: `src/web/features/StrategySettings/sections/PensionStrategySection.tsx`
- Modify: `src/web/features/StrategySettings/StrategySettingsPanel.tsx`
- Test: `src/tests/core/usecases/strategy/compileStrategy.pension.test.ts`
- Test: `src/tests/web/features/StrategySettings/sections/PensionStrategySection.test.tsx`

**Interfaces:**
- Consumes: `compileStrategy` (Task 1), `resolveTaxSettings`, `NATIONAL_PENSION_*` (기존)
- Produces:
  ```ts
  // strategyOptions.tsx 추가분
  export const NATIONAL_PENSION_OPTIONS: ReadonlyArray<RadioCardOption<NationalPensionStrategy>>;
  export const PRIVATE_PENSION_OPTIONS: ReadonlyArray<RadioCardOption<PrivatePensionStrategy>>;
  export const NATIONAL_PENSION_STRATEGY_AGES: Record<NationalPensionStrategy, number>;

  // sections/PensionStrategySection.tsx
  export function PensionStrategySection(props: SectionProps & { ai: AiRecommendationState }): JSX.Element;
  ```

여기서 지금까지 UI가 없던 `WithdrawalPlan` 필드가 처음 사용자에게 열린다.

- [ ] **Step 1: 컴파일러 연금 축 테스트를 작성**

`src/tests/core/usecases/strategy/compileStrategy.pension.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { DEFAULT_PRIVATE_PENSION_LIMIT_KRW } from '@/core/usecases/tax/taxRates';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '@/core/usecases/pension/nationalPensionRules';
import { RetirementStrategy, SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 1,
      annualGrowthRate: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const withStrategy = (patch: Partial<RetirementStrategy>): SimulationParams => ({
  ...baseParams,
  strategy: { ...DEFAULT_RETIREMENT_STRATEGY, ...patch },
});

describe('compileStrategy 연금 축', () => {
  test('국민연금 "예상 수령"은 정상 개시 나이로 컴파일된다', () => {
    const r = compileStrategy(withStrategy({ nationalPensionStrategy: 'normal' }));

    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(NATIONAL_PENSION_NORMAL_START_AGE);
  });

  test('국민연금 "1년 연기"는 66세다', () => {
    const r = compileStrategy(withStrategy({ nationalPensionStrategy: 'defer_1y' }));

    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(66);
  });

  test('국민연금 "최대 연기"는 70세다', () => {
    const r = compileStrategy(withStrategy({ nationalPensionStrategy: 'defer_max' }));

    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
  });

  test('국민연금 "AI 최적화"는 baseline(정상 개시)으로 내려간다', () => {
    const r = compileStrategy(withStrategy({ nationalPensionStrategy: 'ai_optimized' }));

    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(NATIONAL_PENSION_NORMAL_START_AGE);
  });

  test('사적연금 "절세 우선"은 한도 내 인출을 켜고 월 목표를 한도/12로 잡는다', () => {
    const r = compileStrategy(withStrategy({ privatePensionStrategy: 'tax_first' }));

    expect(r.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(true);
    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget)
      .toBe(DEFAULT_PRIVATE_PENSION_LIMIT_KRW / 12);
  });

  test('사적연금 "생활비 우선"은 한도 제한을 끄고 월 목표를 미지정으로 둔다', () => {
    const r = compileStrategy(withStrategy({ privatePensionStrategy: 'spending_first' }));

    expect(r.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(false);
    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget).toBeUndefined();
  });

  test('사적연금 "자산 성장 우선"은 한도의 절반만 인출한다', () => {
    const r = compileStrategy(withStrategy({ privatePensionStrategy: 'growth_first' }));

    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget)
      .toBe(DEFAULT_PRIVATE_PENSION_LIMIT_KRW / 12 * 0.5);
  });

  test('사적연금 "최소 인출"은 한도의 25%만 인출한다', () => {
    const r = compileStrategy(withStrategy({ privatePensionStrategy: 'minimum' }));

    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget)
      .toBe(DEFAULT_PRIVATE_PENSION_LIMIT_KRW / 12 * 0.25);
  });

  test('사적연금 "AI 최적화"는 고급 설정에서 켠 한도 내 인출을 덮어쓰지 않는다', () => {
    // 'ai_*'는 "미정"이지 "끄기"가 아니다. 저장해 둔 설정이 조용히 뒤집히면 안 된다.
    const params = withStrategy({ privatePensionStrategy: 'ai_optimized' });
    params.taxSettings = { ...params.taxSettings, limitPrivatePensionToTaxLimit: true } as never;

    const r = compileStrategy(params);

    expect(r.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(true);
  });

  test('명시적 전략은 고급 설정의 한도 내 인출 값을 덮어쓴다', () => {
    const params = withStrategy({ privatePensionStrategy: 'spending_first' });
    params.taxSettings = { ...params.taxSettings, limitPrivatePensionToTaxLimit: true } as never;

    const r = compileStrategy(params);

    expect(r.params.taxSettings?.limitPrivatePensionToTaxLimit).toBe(false);
  });

  test('사용자가 지정한 privatePensionLimit이 있으면 그 값을 기준으로 계산한다', () => {
    const params = withStrategy({ privatePensionStrategy: 'tax_first' });
    params.taxSettings = { ...params.taxSettings, privatePensionLimit: 12000000 } as never;

    const r = compileStrategy(params);

    expect(r.params.withdrawalPlan?.privatePensionMonthlyTarget).toBe(1000000);
  });

  test('ISA 우선 사용을 켜면 만기 자금이 일반 자산으로 간다', () => {
    const r = compileStrategy(withStrategy({ preferIsaFirst: true }));

    expect(r.params.withdrawalPlan?.isaMaturityDestination).toBe('asset');
  });

  test('ISA 우선 사용이 꺼져 있으면 만기 자금이 연금으로 간다 (기존 동작)', () => {
    const r = compileStrategy(withStrategy({ preferIsaFirst: false }));

    expect(r.params.withdrawalPlan?.isaMaturityDestination).toBe('pension');
  });

  test('compileStrategy는 자산별 reinvestDividend를 건드리지 않는다', () => {
    // 배당 재투자 스위치는 "일괄 적용 버튼"이라 눌린 순간에만 assets를 갱신한다.
    // 컴파일 때마다 덮어쓰면 AssetFormSection의 자산별 토글이 뭉개진다.
    const params = withStrategy({});
    params.assets = [
      { ...params.assets[0], id: 'a1', reinvestDividend: true },
      { ...params.assets[0], id: 'a2', reinvestDividend: false },
    ];

    const r = compileStrategy(params);

    expect(r.params.assets.map((a) => a.reinvestDividend)).toEqual([true, false]);
  });

  test('사용자가 이미 넣어둔 withdrawalPlan 필드는 덮어쓰지 않는다', () => {
    const params = withStrategy({ nationalPensionStrategy: 'defer_max' });
    params.withdrawalPlan = { generalAssetWithdrawalStartAge: 62 };

    const r = compileStrategy(params);

    expect(r.params.withdrawalPlan?.generalAssetWithdrawalStartAge).toBe(62);
    expect(r.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/compileStrategy.pension.test.ts`
Expected: FAIL — `withdrawalPlan`이 undefined

- [ ] **Step 3: `compileStrategy`에 연금 축을 추가**

`src/core/usecases/strategy/compileStrategy.ts`에 import와 상수, 매핑 함수를 추가한다.

```ts
import {
  NationalPensionStrategy, PrivatePensionStrategy, WithdrawalPlan,
} from '../../entities/types';
import {
  NATIONAL_PENSION_EARLY_MIN_AGE, NATIONAL_PENSION_NORMAL_START_AGE,
} from '../pension/nationalPensionRules';
import { resolveTaxSettings } from '../tax/taxRates';

// 국민연금 수령 전략 → 청구 나이.
// getNationalPensionAdjustmentFactor가 연기 1개월당 0.6%를 가산하므로
// 70세는 +36%가 된다. 'ai_optimized'는 baseline(정상 개시)으로 내린다.
export const NATIONAL_PENSION_STRATEGY_AGES: Record<NationalPensionStrategy, number> = {
  // 조기수령. StrategyCandidateGenerator의 나이 격자가 [60, 65, 70]이므로 60을 표현할
  // enum이 없으면 AI가 조기수령을 추천해도 적용 시 가장 가까운 'normal'(65)로 뒤집힌다.
  early: NATIONAL_PENSION_EARLY_MIN_AGE,
  normal: NATIONAL_PENSION_NORMAL_START_AGE,
  defer_1y: NATIONAL_PENSION_NORMAL_START_AGE + 1,
  defer_2y: NATIONAL_PENSION_NORMAL_START_AGE + 2,
  defer_max: 70,
  ai_optimized: NATIONAL_PENSION_NORMAL_START_AGE,
};

// 사적연금 전략 → (저율과세 한도 대비 인출 비율, 한도 내 인출 강제 여부).
// null 비율은 "월 목표를 지정하지 않음" = 엔진의 기존 균등분할 인출을 뜻한다.
// limitToTaxLimit이 null이면 "전략이 이 값을 정하지 않음" = 사용자가 ⑥고급 설정에서
// 직접 켠 값을 그대로 존중한다는 뜻이다. 'ai_optimized'는 "미정"이지 "끄기"가 아니므로
// false를 강제하면 안 된다 — 저장해 둔 설정이 조용히 뒤집힌다.
const PRIVATE_PENSION_RULES: Record<
  PrivatePensionStrategy,
  { limitToTaxLimit: boolean | null; withdrawalRatio: number | null }
> = {
  tax_first: { limitToTaxLimit: true, withdrawalRatio: 1 },
  spending_first: { limitToTaxLimit: false, withdrawalRatio: null },
  growth_first: { limitToTaxLimit: true, withdrawalRatio: 0.5 },
  minimum: { limitToTaxLimit: true, withdrawalRatio: 0.25 },
  ai_optimized: { limitToTaxLimit: null, withdrawalRatio: null },
};
```

`compileStrategy` 본문의 `return` 직전에 다음을 추가한다.

```ts
  const taxSettings = resolveTaxSettings(params.taxSettings);
  const pensionRule = PRIVATE_PENSION_RULES[strategy.privatePensionStrategy]
    ?? PRIVATE_PENSION_RULES.ai_optimized;

  const monthlyPensionLimit = taxSettings.privatePensionLimit / 12;
  const privatePensionMonthlyTarget = pensionRule.withdrawalRatio === null
    ? undefined
    : monthlyPensionLimit * pensionRule.withdrawalRatio;

  // 사용자가 직접 넣어둔 withdrawalPlan 필드(일반자산 인출 개시 나이 등)는 보존하고,
  // 전략이 지배하는 3개 필드만 덮어쓴다.
  const withdrawalPlan: WithdrawalPlan = {
    ...(params.withdrawalPlan ?? {}),
    nationalPensionStartAge:
      NATIONAL_PENSION_STRATEGY_AGES[strategy.nationalPensionStrategy]
      ?? NATIONAL_PENSION_NORMAL_START_AGE,
    isaMaturityDestination: strategy.preferIsaFirst ? 'asset' : 'pension',
  };
  if (privatePensionMonthlyTarget === undefined) {
    delete withdrawalPlan.privatePensionMonthlyTarget;
  } else {
    withdrawalPlan.privatePensionMonthlyTarget = privatePensionMonthlyTarget;
  }

  // 배당 재투자는 compileStrategy가 건드리지 않는다 (위 주석과 동일한 이유).
  const assets = params.assets;
```

`return` 문을 다음으로 교체한다.

```ts
  return {
    params: {
      ...params,
      userProfile,
      spendingStrategy,
      assets,
      withdrawalPlan,
      taxSettings: {
        ...taxSettings,
        // null이면 사용자가 고급 설정에서 정한 값을 유지한다.
        limitPrivatePensionToTaxLimit:
          pensionRule.limitToTaxLimit ?? taxSettings.limitPrivatePensionToTaxLimit,
      },
    },
    utilityConfig,
  };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/`
Expected: PASS (26 tests)

기존 `compileStrategy.test.ts`의 "입력 params 객체를 변형하지 않는다" 테스트가 여전히
통과해야 한다 — 위 코드는 전부 새 객체를 만들므로 통과한다.

- [ ] **Step 5: 섹션 테스트를 작성**

`src/tests/web/features/StrategySettings/sections/PensionStrategySection.test.tsx`

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PensionStrategySection } from '@/web/features/StrategySettings/sections/PensionStrategySection';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';

const noAi = { recommendation: null, error: null, improved: false };

describe('PensionStrategySection', () => {
  test('국민연금 전략 5개와 사적연금 전략 5개를 렌더링한다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    // 두 그룹 모두 'AI 최적화' 옵션을 가지므로 그룹으로 좁혀 찾는다.
    const national = within(screen.getByRole('radiogroup', { name: '국민연금 수령 시작' }));
    for (const label of [/예상 수령/, /1년 연기/, /2년 연기/, /최대 연기/, /AI 최적화/]) {
      expect(national.getByRole('radio', { name: label })).toBeInTheDocument();
    }

    const priv = within(screen.getByRole('radiogroup', { name: '사적연금 인출 전략' }));
    for (const label of [/절세 우선/, /생활비 우선/, /자산 성장 우선/, /최소 인출/, /AI 최적화/]) {
      expect(priv.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  test('국민연금 전략을 고르면 strategy에 반영된다', () => {
    const onChangeParams = vi.fn();
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '국민연금 수령 시작' }))
        .getByRole('radio', { name: /최대 연기/ })
    );

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'defer_max' },
    });
  });

  test('ISA 우선 사용과 배당 재투자 스위치를 렌더링한다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.getByRole('switch', { name: /ISA 먼저 사용/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /배당금 재투자/ })).toBeInTheDocument();
  });

  test('배당금 재투자를 끄면 모든 자산의 reinvestDividend가 false가 된다', () => {
    const onChangeParams = vi.fn();
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: /배당금 재투자/ }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      assets: initialParams.assets.map((a) => ({ ...a, reinvestDividend: false })),
    });
  });

  test('자산마다 설정이 다르면 스위치가 꺼진 상태로 보이고 혼합 안내를 표시한다', () => {
    const mixed = {
      ...initialParams,
      assets: [
        { ...initialParams.assets[0], reinvestDividend: true },
        { ...initialParams.assets[1], reinvestDividend: false },
      ],
    };

    render(
      <PensionStrategySection
        params={mixed} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.getByRole('switch', { name: /배당금 재투자/ })).not.toBeChecked();
    expect(screen.getByText(/자산마다 다르게 설정되어 있습니다/)).toBeInTheDocument();
  });

  test('AI가 연기 수령을 추천하면 힌트를 표시한다', () => {
    const ai = {
      recommendation: { improved: true, recommendedPlan: { nationalPensionStartAge: 70 } } as never,
      error: null, improved: true,
    };

    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={ai}
      />
    );

    expect(screen.getByText('AI 추천: 70세부터 수령')).toBeInTheDocument();
  });

  test('간편 모드에서도 국민연금/사적연금 전략은 보인다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="simple" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.getByRole('radio', { name: /최대 연기/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /절세 우선/ })).toBeInTheDocument();
  });

  test('간편 모드에서는 ISA/배당 재투자 스위치가 숨겨진다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="simple" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.queryByRole('switch', { name: /ISA 먼저 사용/ })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/sections/PensionStrategySection.test.tsx`
Expected: FAIL — `Failed to resolve import ".../PensionStrategySection"`

- [ ] **Step 7: 연금 옵션 테이블 추가**

`strategyOptions.tsx`에 추가한다.

```tsx
import { CalendarClock, CalendarMinus, CalendarPlus, Leaf, Rocket, Shield, Sparkles, Wallet } from 'lucide-react';
import { NationalPensionStrategy, PrivatePensionStrategy } from '../../../core/entities/types';

export const NATIONAL_PENSION_OPTIONS: ReadonlyArray<RadioCardOption<NationalPensionStrategy>> = [
  {
    value: 'early', label: '조기 수령 (60세)',
    description: '5년 일찍 받는 대신 매달 받는 금액이 30% 줄어듭니다.',
    icon: <CalendarMinus size={16} />,
  },
  {
    value: 'normal', label: '예상 수령 (65세)',
    description: '원래 받기로 된 나이에 그대로 받습니다.',
    icon: <CalendarClock size={16} />,
  },
  {
    value: 'defer_1y', label: '1년 연기 (66세)',
    description: '1년 늦추면 매달 받는 금액이 7.2% 늘어납니다.',
    icon: <CalendarPlus size={16} />,
  },
  {
    value: 'defer_2y', label: '2년 연기 (67세)',
    description: '2년 늦추면 매달 받는 금액이 14.4% 늘어납니다.',
    icon: <CalendarPlus size={16} />,
  },
  {
    value: 'defer_max', label: '최대 연기 (70세)',
    description: '5년 늦추면 매달 받는 금액이 36% 늘어납니다.',
    icon: <CalendarPlus size={16} />,
  },
  {
    value: 'ai_optimized', label: 'AI 최적화',
    description: '연기 가산과 평생 수령액을 따져 가장 유리한 시점을 찾습니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

export const PRIVATE_PENSION_OPTIONS: ReadonlyArray<RadioCardOption<PrivatePensionStrategy>> = [
  {
    value: 'tax_first', label: '절세 우선',
    description: '세금이 적게 붙는 한도까지만 꺼내 씁니다.',
    icon: <Shield size={16} />,
  },
  {
    value: 'spending_first', label: '생활비 우선',
    description: '세금보다 생활비를 먼저 채웁니다. 필요한 만큼 꺼냅니다.',
    icon: <Wallet size={16} />,
  },
  {
    value: 'growth_first', label: '자산 성장 우선',
    description: '절반만 꺼내고 나머지는 계좌 안에서 계속 굴립니다.',
    icon: <Rocket size={16} />,
  },
  {
    value: 'minimum', label: '최소 인출',
    description: '꼭 필요한 만큼만 꺼내 연금 잔액을 최대한 지킵니다.',
    icon: <Leaf size={16} />,
  },
  {
    value: 'ai_optimized', label: 'AI 최적화',
    description: '세금과 생활비를 함께 따져 가장 유리한 인출량을 찾습니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];
```

- [ ] **Step 8: `PensionStrategySection` 구현**

`src/web/features/StrategySettings/sections/PensionStrategySection.tsx`

```tsx
'use client';

import { FieldRow, RadioCardGroup, SwitchField } from '../../../components/form';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../../core/usecases/strategy/compileStrategy';
import { isFieldVisible } from '../fieldVisibility';
import {
  NATIONAL_PENSION_OPTIONS, PRIVATE_PENSION_OPTIONS, SectionProps,
} from '../strategyOptions';
import { AiRecommendationState } from '../useAiRecommendation';

type Props = SectionProps & { ai: AiRecommendationState };

export function PensionStrategySection({ params, onChangeParams, mode, changed, ai }: Props) {
  const strategy = { ...DEFAULT_RETIREMENT_STRATEGY, ...(params.strategy ?? {}) };

  const setStrategy = (patch: Partial<typeof strategy>) => {
    onChangeParams({ ...params, strategy: { ...strategy, ...patch } });
  };

  // 배당 재투자 스위치는 "설정"이 아니라 "일괄 적용 버튼"이다. 표시 상태는 자산들에서
  // 파생하고(모두 켜짐 / 모두 꺼짐 / 혼합), 누르면 그 순간 모든 자산을 갱신한다.
  // compileStrategy는 이 값을 건드리지 않으므로 이후 자산별로 고친 값이 그대로 살아남는다.
  const reinvestState: 'all' | 'none' | 'mixed' =
    params.assets.every((a) => a.reinvestDividend) ? 'all'
      : params.assets.every((a) => !a.reinvestDividend) ? 'none'
        : 'mixed';

  const applyReinvestToAllAssets = (next: boolean) => {
    onChangeParams({
      ...params,
      assets: params.assets.map((a) => ({ ...a, reinvestDividend: next })),
    });
  };

  const plan = ai.improved ? ai.recommendation?.recommendedPlan : undefined;
  const nationalHint = plan?.nationalPensionStartAge !== undefined
    ? `${plan.nationalPensionStartAge}세부터 수령`
    : undefined;
  const privateHint = plan?.privatePensionMonthlyTarget !== undefined
    ? `월 ${Math.round(plan.privatePensionMonthlyTarget / 10000).toLocaleString()}만원 인출`
    : undefined;

  return (
    <>
      {isFieldVisible(mode, 'strategy.nationalPensionStrategy') && (
        <FieldRow
          label="국민연금 수령 시작"
          tooltipText="늦게 받을수록 매달 받는 금액이 커집니다. 대신 받는 기간은 짧아집니다."
          changed={changed.has('strategy.nationalPensionStrategy')}
          aiHint={nationalHint}
        >
          <RadioCardGroup
            name="national-pension-strategy" ariaLabel="국민연금 수령 시작" value={strategy.nationalPensionStrategy}
            options={NATIONAL_PENSION_OPTIONS}
            onChange={(v) => setStrategy({ nationalPensionStrategy: v })}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.privatePensionStrategy') && (
        <FieldRow
          label="사적연금 인출 전략"
          tooltipTerm="irp"
          changed={changed.has('strategy.privatePensionStrategy')}
          aiHint={privateHint}
        >
          <RadioCardGroup
            name="private-pension-strategy" ariaLabel="사적연금 인출 전략" value={strategy.privatePensionStrategy}
            options={PRIVATE_PENSION_OPTIONS}
            onChange={(v) => setStrategy({ privatePensionStrategy: v })}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.preferIsaFirst') && (
        <SwitchField
          label="ISA 먼저 사용"
          description="ISA 만기 자금을 연금으로 옮기지 않고 생활비로 먼저 씁니다."
          tooltipTerm="isa"
          checked={strategy.preferIsaFirst}
          onChange={(v) => setStrategy({ preferIsaFirst: v })}
          changed={changed.has('strategy.preferIsaFirst')}
        />
      )}

      {isFieldVisible(mode, 'assets.reinvestDividend') && params.assets.length > 0 && (
        <SwitchField
          label="배당금 재투자"
          description={
            reinvestState === 'mixed'
              ? '자산마다 다르게 설정되어 있습니다. 여기서 켜거나 끄면 모든 자산에 한 번에 적용됩니다.'
              : '받은 배당을 쓰지 않고 다시 사들여 복리로 굴립니다. 모든 자산에 한 번에 적용됩니다.'
          }
          checked={reinvestState === 'all'}
          onChange={applyReinvestToAllAssets}
          changed={changed.has('assets.reinvestDividend')}
        />
      )}
    </>
  );
}
```

- [ ] **Step 9: 패널에 연결하고 AI 적용 케이스를 추가**

`StrategySettingsPanel.tsx`의 `renderSectionBody`에:

```tsx
      case 'pension':
        return <PensionStrategySection {...sectionProps} ai={ai} />;
```

`applyAiToSection`에 `pension` 케이스를 추가한다. 추천된 나이를 가장 가까운 전략 enum으로
역매핑한다.

```tsx
import { NationalPensionStrategy } from '../../../core/entities/types';
import { NATIONAL_PENSION_STRATEGY_AGES } from '../../../core/usecases/strategy/compileStrategy';
```

```tsx
    if (id === 'pension') {
      // 추천 나이를 enum으로 역매핑한다. 정확히 일치하는 전략이 없으면(예: 68세)
      // 가장 가까운 값을 고른다 — 후보 생성기의 나이 격자와 전략 4종이 완전히
      // 겹치지는 않기 때문이다.
      const strategy = resolveStrategy(params);
      const targetAge = plan.nationalPensionStartAge;
      const candidates = (Object.keys(NATIONAL_PENSION_STRATEGY_AGES) as NationalPensionStrategy[])
        .filter((k) => k !== 'ai_optimized');
      const nearest = candidates.reduce((best, k) =>
        Math.abs(NATIONAL_PENSION_STRATEGY_AGES[k] - targetAge)
          < Math.abs(NATIONAL_PENSION_STRATEGY_AGES[best] - targetAge) ? k : best
      );

      onChangeParams({
        ...params,
        strategy: {
          ...strategy,
          nationalPensionStrategy: nearest,
          preferIsaFirst: plan.isaMaturityDestination === 'asset',
        },
      });
      return;
    }
```

`applyAiToSection` 상단의 `if (id === 'goal' && ...)`도 `return`을 넣어 케이스가 배타적이게 한다.

- [ ] **Step 10: 테스트 통과 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/ src/tests/core/usecases/strategy/`
Expected: PASS

Run: `npx tsc --noEmit` → 에러 없음

- [ ] **Step 11: 전체 테스트 확인 후 커밋**

Run: `npm test` → 전부 PASS

```bash
git add src/core/usecases/strategy/compileStrategy.ts \
        src/web/features/StrategySettings/ \
        src/tests/core/usecases/strategy/compileStrategy.pension.test.ts \
        src/tests/web/features/StrategySettings/
git commit -m "feat: 연금 전략 섹션 추가 및 WithdrawalPlan을 사용자에게 개방

지금까지 AI 추천 엔진만 생성하던 WithdrawalPlan의 nationalPensionStartAge,
privatePensionMonthlyTarget, isaMaturityDestination을 사용자가 직접 고를 수
있게 한다.

국민연금은 '예상 수령/1년·2년·최대 연기/AI 최적화' 5종, 사적연금은
'절세·생활비·자산성장 우선/최소 인출/AI 최적화' 5종을 저율과세 한도 대비
인출 비율로 컴파일한다.

사용자가 직접 넣어둔 withdrawalPlan 필드(일반자산 인출 개시 나이 등)는
덮어쓰지 않고 전략이 지배하는 3개 필드만 교체한다."
```

---

### Task 8: ④ 투자 전략 + ⑤ 경제 가정 섹션

**Files:**
- Create: `src/core/usecases/scenario/economicScenarios.ts`
- Modify: `src/core/usecases/strategy/compileStrategy.ts` (투자/경제 축 추가)
- Modify: `src/web/features/StrategySettings/strategyOptions.tsx`
- Create: `src/web/features/StrategySettings/sections/InvestmentStrategySection.tsx`
- Create: `src/web/features/StrategySettings/sections/EconomicAssumptionSection.tsx`
- Modify: `src/web/features/StrategySettings/StrategySettingsPanel.tsx`
- Test: `src/tests/core/usecases/scenario/economicScenarios.test.ts`
- Test: `src/tests/core/usecases/strategy/compileStrategy.investment.test.ts`
- Test: `src/tests/web/features/StrategySettings/sections/InvestmentStrategySection.test.tsx`

**선행 작업**: `SettingSection`의 AI 추천 버튼에 섹션 이름을 붙인다.
현재 세 섹션(`goal`/`pension`/`investment`)이 모두 `aiLabel`("AI 추천")만으로 접근성
이름을 만들어, 스크린리더 사용자가 role+name으로 이동할 때 세 버튼을 구분할 수 없다.
`RadioCardGroup`에 `ariaLabel`을 추가한 것과 같은 이유다.

`SettingSection.tsx`의 AI 버튼에 `aria-label={\`${title} ${aiLabel}\`}`을 주고
(예: "연금 전략 AI 추천"), 화면에 보이는 텍스트는 `aiLabel` 그대로 둔다.
`SettingSection.test.tsx`에 "AI 버튼의 접근성 이름에 섹션 제목이 포함된다" 케이스를
추가하고, 기존 테스트 중 `getByRole('button', { name: 'AI 추천' })`으로 찾던 것을
`name: /AI 추천/`으로 완화한다. Task 7이 DOM 형제 관계로 버튼을 찾던 테스트도
이 접근성 이름으로 바꿔 정리한다.

**Interfaces:**
- Consumes: `applyYieldPreset` (기존), `compileStrategy` (Task 1·7)
- Produces:
  ```ts
  // economicScenarios.ts
  export interface EconomicScenarioProfile {
    inflationRate: number;
    stockGrowthRate: number;
    pensionReturnRate: number;
    exchangeScenario: SimulationParams['exchangeScenario'];
  }
  export const ECONOMIC_SCENARIO_PROFILES: Record<EconomicScenario, EconomicScenarioProfile>;
  export function applyEconomicScenario(
    params: SimulationParams, scenario: EconomicScenario
  ): SimulationParams;

  // strategyOptions.tsx 추가분
  export const RISK_PROFILE_OPTIONS: ReadonlyArray<RadioCardOption<RiskProfile>>;
  export const ECONOMIC_SCENARIO_OPTIONS: ReadonlyArray<RadioCardOption<EconomicScenario>>;

  export function InvestmentStrategySection(props: SectionProps & { ai: AiRecommendationState }): JSX.Element;
  export function EconomicAssumptionSection(props: SectionProps): JSX.Element;
  ```

의료비 UI는 ⑤ 경제 가정에 속하지만 엔진 레이어가 Task 9라, 이 Task에서는 통화·환율·물가·
실질수익률만 다룬다. 의료비 필드는 Task 9에서 같은 섹션에 추가한다.

- [ ] **Step 1: 경제 시나리오 테스트를 작성**

`src/tests/core/usecases/scenario/economicScenarios.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import {
  ECONOMIC_SCENARIO_PROFILES, applyEconomicScenario, isEconomicScenarioGoverning,
} from '@/core/usecases/scenario/economicScenarios';
import { EconomicScenario, SimulationParams } from '@/core/entities/types';

const ALL: EconomicScenario[] = [
  'long_term_average', 'recession', 'high_inflation', 'low_growth', 'ai_recommended',
];

const params: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 1,
      annualGrowthRate: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 1000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('ECONOMIC_SCENARIO_PROFILES', () => {
  test('AI 추천을 제외한 모든 시나리오에 프로필이 정의되어 있다', () => {
    for (const s of ALL.filter((x) => x !== 'ai_recommended')) {
      expect(ECONOMIC_SCENARIO_PROFILES[s], s).toBeDefined();
    }
  });

  test('고물가는 장기 평균보다 물가상승률이 높다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES.high_inflation.inflationRate)
      .toBeGreaterThan(ECONOMIC_SCENARIO_PROFILES.long_term_average.inflationRate);
  });

  test('장기 침체는 장기 평균보다 주식 수익률이 낮다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES.recession.stockGrowthRate)
      .toBeLessThan(ECONOMIC_SCENARIO_PROFILES.long_term_average.stockGrowthRate);
  });

  test('AI 추천(미정)에는 프로필이 없다', () => {
    // 프로필을 주면 사용자가 직접 입력한 물가상승률이 조용히 덮어써진다.
    expect(ECONOMIC_SCENARIO_PROFILES.ai_recommended).toBeUndefined();
    expect(isEconomicScenarioGoverning('ai_recommended')).toBe(false);
    expect(isEconomicScenarioGoverning('recession')).toBe(true);
  });
});

describe('applyEconomicScenario', () => {
  test('물가·환율 시나리오·수익률을 한꺼번에 교체한다', () => {
    const r = applyEconomicScenario(params, 'high_inflation');
    const profile = ECONOMIC_SCENARIO_PROFILES.high_inflation;

    expect(r.inflationRate).toBe(profile.inflationRate);
    expect(r.exchangeScenario).toBe(profile.exchangeScenario);
    expect(r.assets[0].annualGrowthRate).toBe(profile.stockGrowthRate);
    expect(r.privatePensions[0].annualReturn).toBe(profile.pensionReturnRate);
  });

  test('입력 객체를 변형하지 않는다', () => {
    const snapshot = JSON.parse(JSON.stringify(params));

    applyEconomicScenario(params, 'recession');

    expect(params).toEqual(snapshot);
  });

  test('알 수 없는 시나리오는 입력을 그대로 반환한다', () => {
    expect(applyEconomicScenario(params, 'nope' as never)).toEqual(params);
  });

  test('AI 추천(미정)은 사용자가 입력한 물가상승률을 보존한다', () => {
    const custom = { ...params, inflationRate: 3.7 };

    const r = applyEconomicScenario(custom, 'ai_recommended');

    expect(r.inflationRate).toBe(3.7);
    expect(r).toEqual(custom);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/scenario/economicScenarios.test.ts`
Expected: FAIL — `Failed to resolve import ".../economicScenarios"`

- [ ] **Step 3: `economicScenarios` 구현**

`src/core/usecases/scenario/economicScenarios.ts`

```ts
import { EconomicScenario, SimulationParams } from '../../entities/types';

export interface EconomicScenarioProfile {
  inflationRate: number; // %
  stockGrowthRate: number; // % — 모든 주식/ETF 자산에 일괄 적용
  pensionReturnRate: number; // % — 모든 사적연금 계좌에 일괄 적용
  exchangeScenario: SimulationParams['exchangeScenario'];
}

// 경제 시나리오 프리셋. 몬테카를로가 아니라 결정론적 단일 경로다 —
// 시나리오를 고르면 그 가정 하나로 계산하며, 확률 분포는 산출하지 않는다.
//
// 침체·고물가에서 exchangeScenario를 'usd_up'으로 두는 이유: 두 국면 모두 원화 약세
// 압력이 커진다는 경험적 관찰을 단순화한 것이다. 정밀한 환율 모형이 아니다.
// 'ai_recommended'는 이 테이블에 없다. "미정"이지 "장기 평균"이 아니기 때문이다 —
// 프로필을 주면 사용자가 ⑤경제 가정에서 직접 입력한 물가상승률이 매 컴파일마다
// 조용히 덮어써진다(Task 8 리뷰에서 발견, Task 7의 'ai_optimized'와 같은 버그).
export const ECONOMIC_SCENARIO_PROFILES: Partial<Record<EconomicScenario, EconomicScenarioProfile>> = {
  long_term_average: {
    inflationRate: 2.5, stockGrowthRate: 7, pensionReturnRate: 4, exchangeScenario: 'base',
  },
  recession: {
    inflationRate: 1.5, stockGrowthRate: 3, pensionReturnRate: 2, exchangeScenario: 'usd_up',
  },
  high_inflation: {
    inflationRate: 5, stockGrowthRate: 6, pensionReturnRate: 3, exchangeScenario: 'usd_up',
  },
  low_growth: {
    inflationRate: 2, stockGrowthRate: 4, pensionReturnRate: 2.5, exchangeScenario: 'base',
  },
};

// 특정 시나리오가 경제 변수를 지배하는지. false면 사용자가 직접 입력한
// 물가상승률/환율이 그대로 쓰이므로 UI는 그 입력 필드를 열어두어야 한다.
export function isEconomicScenarioGoverning(scenario: EconomicScenario): boolean {
  return ECONOMIC_SCENARIO_PROFILES[scenario] !== undefined;
}

// 시나리오 프로필을 params에 적용한다. 순수 함수이며, 'ai_recommended'(미정)이거나
// 알 수 없는 값이면 입력을 그대로 돌려준다 — 사용자가 직접 입력한 값을 보존하기 위해서다.
export function applyEconomicScenario(
  params: SimulationParams,
  scenario: EconomicScenario
): SimulationParams {
  const profile = ECONOMIC_SCENARIO_PROFILES[scenario];
  if (!profile) return params;

  return {
    ...params,
    inflationRate: profile.inflationRate,
    exchangeScenario: profile.exchangeScenario,
    assets: (params.assets ?? []).map((a) => ({ ...a, annualGrowthRate: profile.stockGrowthRate })),
    privatePensions: (params.privatePensions ?? []).map((p) => ({
      ...p, annualReturn: profile.pensionReturnRate,
    })),
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/scenario/economicScenarios.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 컴파일러 투자/경제 축 테스트를 작성**

`src/tests/core/usecases/strategy/compileStrategy.investment.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { ECONOMIC_SCENARIO_PROFILES } from '@/core/usecases/scenario/economicScenarios';
import { RetirementStrategy, SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 1,
      annualGrowthRate: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 1000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const withStrategy = (patch: Partial<RetirementStrategy>): SimulationParams => ({
  ...baseParams,
  strategy: { ...DEFAULT_RETIREMENT_STRATEGY, ...patch },
});

describe('compileStrategy 투자/경제 축', () => {
  test('경제 시나리오가 물가와 환율 시나리오를 지배한다', () => {
    const r = compileStrategy(withStrategy({ economicScenario: 'high_inflation' }));

    expect(r.params.inflationRate).toBe(ECONOMIC_SCENARIO_PROFILES.high_inflation.inflationRate);
    expect(r.params.exchangeScenario).toBe(ECONOMIC_SCENARIO_PROFILES.high_inflation.exchangeScenario);
  });

  test('리스크 성향이 시나리오보다 나중에 적용되어 수익률의 최종 승자가 된다', () => {
    const r = compileStrategy(withStrategy({
      economicScenario: 'recession', // 주식 3%
      riskProfile: 'aggressive', // 주식 9%
    }));

    expect(r.params.assets[0].annualGrowthRate).toBe(9);
    // 물가는 여전히 시나리오가 지배한다.
    expect(r.params.inflationRate).toBe(ECONOMIC_SCENARIO_PROFILES.recession.inflationRate);
  });

  test('리스크 성향이 ai_recommended면 시나리오 수익률을 덮어쓰지 않는다', () => {
    const r = compileStrategy(withStrategy({
      economicScenario: 'recession',
      riskProfile: 'ai_recommended',
    }));

    expect(r.params.assets[0].annualGrowthRate)
      .toBe(ECONOMIC_SCENARIO_PROFILES.recession.stockGrowthRate);
  });

  test('안정형/중립형/공격형이 각각 yieldPreset으로 번역된다', () => {
    expect(compileStrategy(withStrategy({ riskProfile: 'conservative' })).params.yieldPreset)
      .toBe('conservative');
    expect(compileStrategy(withStrategy({ riskProfile: 'neutral' })).params.yieldPreset)
      .toBe('base');
    expect(compileStrategy(withStrategy({ riskProfile: 'aggressive' })).params.yieldPreset)
      .toBe('aggressive');
  });

  test('리스크 성향 프리셋을 적용해도 자산별 reinvestDividend가 보존된다', () => {
    // applyYieldPreset이 자산 배열을 새로 만들지만 reinvestDividend는 스프레드로 유지된다.
    const params = withStrategy({ riskProfile: 'aggressive' });
    params.assets = [{ ...params.assets[0], reinvestDividend: false }];

    const r = compileStrategy(params);

    expect(r.params.assets[0].reinvestDividend).toBe(false);
    expect(r.params.assets[0].annualGrowthRate).toBe(9);
  });
});
```

- [ ] **Step 6: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/compileStrategy.investment.test.ts`
Expected: FAIL — 경제 시나리오가 반영되지 않음

- [ ] **Step 7: `compileStrategy`에 투자/경제 축을 추가**

import 추가:

```ts
import { RiskProfile } from '../../entities/types';
import { applyYieldPreset } from '../scenario/applyYieldPreset';
import { applyEconomicScenario } from '../scenario/economicScenarios';
```

리스크 성향 매핑 상수를 추가한다.

```ts
// 리스크 성향 → 기존 수익률 프리셋. 'ai_recommended'는 매핑이 없으며,
// 이 경우 경제 시나리오가 정한 수익률을 그대로 둔다("미정"이지 "중립형"이 아니다).
const RISK_PROFILE_PRESETS: Partial<Record<RiskProfile, 'conservative' | 'base' | 'aggressive'>> = {
  conservative: 'conservative',
  neutral: 'base',
  aggressive: 'aggressive',
};
```

`compileStrategy` 본문에서 **`assets` 매핑보다 앞에** 경제/리스크 축을 적용한다.
`const taxSettings = ...` 줄 바로 위에 삽입한다.

```ts
  // 경제 시나리오 → 리스크 성향 순으로 적용한다. 둘 다 수익률을 건드리므로
  // 순서가 결과를 결정한다: 시나리오는 물가·환율을, 리스크 성향은 수익률을 지배한다.
  let economyApplied = applyEconomicScenario(params, strategy.economicScenario);
  const riskPreset = RISK_PROFILE_PRESETS[strategy.riskProfile];
  if (riskPreset) {
    economyApplied = applyYieldPreset(economyApplied, riskPreset);
  }
```

그리고 뒤이은 코드에서 `params` 대신 `economyApplied`를 읽도록 바꾼다.

```ts
  const taxSettings = resolveTaxSettings(economyApplied.taxSettings);
```

```ts
  const withdrawalPlan: WithdrawalPlan = {
    ...(economyApplied.withdrawalPlan ?? {}),
```

```ts
  // 배당 재투자는 compileStrategy가 건드리지 않는다. ③연금 전략의 스위치는 "설정"이 아니라
  // "일괄 적용 버튼"이며, 눌린 그 순간에만 params.assets를 직접 갱신한다. 여기서 매번
  // 덮어쓰면 AssetFormSection의 자산별 토글이 조용히 뭉개진다.
  const assets = economyApplied.assets;
```

`return` 문의 스프레드 대상도 바꾼다.

```ts
  return {
    params: {
      ...economyApplied,
      userProfile,
      spendingStrategy,
      assets,
      withdrawalPlan,
      taxSettings: {
        ...taxSettings,
        // null이면 사용자가 고급 설정에서 정한 값을 유지한다.
        limitPrivatePensionToTaxLimit:
          pensionRule.limitToTaxLimit ?? taxSettings.limitPrivatePensionToTaxLimit,
      },
    },
    utilityConfig,
  };
```

주의: `userProfile`은 `params.userProfile`에서 파생되었고 `applyEconomicScenario`/
`applyYieldPreset`는 `userProfile`을 건드리지 않으므로 그대로 써도 안전하다.

- [ ] **Step 8: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/`
Expected: PASS (전체 31 tests). 기존 Task 1·7 테스트가 모두 통과해야 한다.

- [ ] **Step 9: 섹션 테스트를 작성**

`src/tests/web/features/StrategySettings/sections/InvestmentStrategySection.test.tsx`

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { InvestmentStrategySection } from '@/web/features/StrategySettings/sections/InvestmentStrategySection';
import { EconomicAssumptionSection } from '@/web/features/StrategySettings/sections/EconomicAssumptionSection';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';

const noAi = { recommendation: null, error: null, improved: false };

describe('InvestmentStrategySection', () => {
  test('리스크 성향과 경제 시나리오 선택지를 렌더링한다', () => {
    render(
      <InvestmentStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    // 두 그룹 모두 'AI 추천' 옵션을 가지므로 그룹으로 좁혀 찾는다.
    const risk = within(screen.getByRole('radiogroup', { name: '리스크 성향' }));
    for (const label of [/안정형/, /중립형/, /공격형/, /AI 추천/]) {
      expect(risk.getByRole('radio', { name: label })).toBeInTheDocument();
    }

    const scenario = within(screen.getByRole('radiogroup', { name: '경제 시나리오' }));
    for (const label of [/장기 평균/, /장기 침체/, /고물가/, /저성장/, /AI 추천/]) {
      expect(scenario.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  test('리스크 성향을 고르면 strategy.riskProfile이 반영된다', () => {
    const onChangeParams = vi.fn();
    render(
      <InvestmentStrategySection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '리스크 성향' }))
        .getByRole('radio', { name: /공격형/ })
    );

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, riskProfile: 'aggressive' },
    });
  });

  test('시나리오와 리스크 성향의 역할 구분을 설명문으로 알린다', () => {
    render(
      <InvestmentStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.getByText(/시나리오는 물가·환율을, 리스크 성향은 수익률을 결정합니다/))
      .toBeInTheDocument();
  });
});

describe('EconomicAssumptionSection', () => {
  test('물가상승률·환율·기준 통화를 표시한다', () => {
    render(
      <EconomicAssumptionSection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()}
      />
    );

    expect(screen.getByLabelText('물가상승률')).toHaveValue(2.5);
    expect(screen.getByLabelText('적용 환율')).toBeInTheDocument();
    expect(screen.getByLabelText('대시보드 기준 통화')).toBeInTheDocument();
  });

  test('실질 수익률 스위치를 끄면 inflationMode가 nominal이 된다', () => {
    const onChangeParams = vi.fn();
    render(
      <EconomicAssumptionSection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()}
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: /실질 수익률로 계산/ }));

    expect(onChangeParams).toHaveBeenCalledWith({ ...initialParams, inflationMode: 'nominal' });
  });
});
```

- [ ] **Step 10: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/sections/InvestmentStrategySection.test.tsx`
Expected: FAIL — import 실패

- [ ] **Step 11: 옵션 테이블과 두 섹션을 구현**

`strategyOptions.tsx`에 추가:

```tsx
import { Activity, CloudRain, Flame, ShieldCheck, Snowflake, TrendingDown } from 'lucide-react';
import { EconomicScenario, RiskProfile } from '../../../core/entities/types';

export const RISK_PROFILE_OPTIONS: ReadonlyArray<RadioCardOption<RiskProfile>> = [
  {
    value: 'conservative', label: '안정형',
    description: '수익은 낮아도 흔들림이 적은 쪽으로 계산합니다. (주식 5%)',
    icon: <ShieldCheck size={16} />,
  },
  {
    value: 'neutral', label: '중립형',
    description: '장기 평균 수준의 수익을 가정합니다. (주식 7%)',
    icon: <Activity size={16} />,
  },
  {
    value: 'aggressive', label: '공격형',
    description: '높은 수익을 가정하되 그만큼 변동도 크다고 봅니다. (주식 9%)',
    icon: <Flame size={16} />,
  },
  {
    value: 'ai_recommended', label: 'AI 추천',
    description: '나이와 은퇴까지 남은 기간을 보고 알아서 정합니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];

export const ECONOMIC_SCENARIO_OPTIONS: ReadonlyArray<RadioCardOption<EconomicScenario>> = [
  {
    value: 'long_term_average', label: '장기 평균',
    description: '지난 수십 년의 평균적인 물가와 성장을 가정합니다.',
    icon: <Activity size={16} />,
  },
  {
    value: 'recession', label: '장기 침체',
    description: '성장이 오래 정체되고 원화가 약해지는 국면입니다.',
    icon: <CloudRain size={16} />,
  },
  {
    value: 'high_inflation', label: '고물가',
    description: '물가가 연 5% 오르는 국면입니다. 실질 구매력이 빠르게 줄어듭니다.',
    icon: <Flame size={16} />,
  },
  {
    value: 'low_growth', label: '저성장',
    description: '물가는 안정적이지만 자산이 잘 늘지 않는 국면입니다.',
    icon: <TrendingDown size={16} />,
  },
  {
    value: 'ai_recommended', label: 'AI 추천',
    description: '특정 국면을 가정하지 않고 장기 평균으로 계산합니다.',
    icon: <Sparkles size={16} />, recommended: true,
  },
];
```

`src/web/features/StrategySettings/sections/InvestmentStrategySection.tsx`

```tsx
'use client';

import { FieldRow, RadioCardGroup } from '../../../components/form';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../../core/usecases/strategy/compileStrategy';
import { isFieldVisible } from '../fieldVisibility';
import { ECONOMIC_SCENARIO_OPTIONS, RISK_PROFILE_OPTIONS, SectionProps } from '../strategyOptions';
import { AiRecommendationState } from '../useAiRecommendation';

type Props = SectionProps & { ai: AiRecommendationState };

export function InvestmentStrategySection({ params, onChangeParams, mode, changed, ai }: Props) {
  const strategy = { ...DEFAULT_RETIREMENT_STRATEGY, ...(params.strategy ?? {}) };

  const setStrategy = (patch: Partial<typeof strategy>) => {
    onChangeParams({ ...params, strategy: { ...strategy, ...patch } });
  };

  // AI가 배당 재투자 변경을 권하면 그 사실만 알린다(적용은 섹션 버튼으로).
  const reinvestHint = ai.improved && ai.recommendation?.recommendedAssetReinvestment
    ? '배당 재투자 설정 변경 권장'
    : undefined;

  return (
    <>
      {isFieldVisible(mode, 'strategy.riskProfile') && (
        <FieldRow
          label="리스크 성향"
          changed={changed.has('strategy.riskProfile')}
          aiHint={reinvestHint}
        >
          <RadioCardGroup
            name="risk-profile" ariaLabel="리스크 성향" value={strategy.riskProfile}
            options={RISK_PROFILE_OPTIONS} onChange={(v) => setStrategy({ riskProfile: v })}
            columns={2}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'strategy.economicScenario') && (
        <FieldRow label="경제 시나리오" changed={changed.has('strategy.economicScenario')}>
          <RadioCardGroup
            name="economic-scenario" ariaLabel="경제 시나리오" value={strategy.economicScenario}
            options={ECONOMIC_SCENARIO_OPTIONS}
            onChange={(v) => setStrategy({ economicScenario: v })}
            columns={2}
          />
        </FieldRow>
      )}

      {(isFieldVisible(mode, 'strategy.riskProfile')
        || isFieldVisible(mode, 'strategy.economicScenario')) && (
        <p className="text-xs text-foreground-muted">
          두 설정이 겹칠 때는 시나리오는 물가·환율을, 리스크 성향은 수익률을 결정합니다.
        </p>
      )}
    </>
  );
}
```

`src/web/features/StrategySettings/sections/EconomicAssumptionSection.tsx`

```tsx
'use client';

import { AssetCurrency } from '../../../../core/entities/types';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../../core/usecases/strategy/compileStrategy';
import { isEconomicScenarioGoverning } from '../../../../core/usecases/scenario/economicScenarios';
import InputField from '../../../components/InputField';
import SelectField from '../../../components/SelectField';
import { FieldRow, SwitchField } from '../../../components/form';
import { isFieldVisible } from '../fieldVisibility';
import { SectionProps } from '../strategyOptions';

export function EconomicAssumptionSection({ params, onChangeParams, mode, changed }: SectionProps) {
  // 경제 시나리오를 명시적으로 고르면 그 프로필이 물가·환율을 지배한다. 그 상태에서
  // 입력을 열어두면 "고쳤는데 결과가 안 바뀐다"가 되므로 비활성화하고 이유를 적는다.
  const scenario =
    params.strategy?.economicScenario ?? DEFAULT_RETIREMENT_STRATEGY.economicScenario;
  const scenarioGoverns = isEconomicScenarioGoverning(scenario);

  return (
    <>
      {scenarioGoverns && (
        <p className="text-xs text-amber-500">
          ④투자 전략에서 고른 경제 시나리오가 아래 물가상승률과 환율을 결정합니다.
          직접 정하려면 시나리오를 &ldquo;AI 추천&rdquo;으로 두세요.
        </p>
      )}
      {isFieldVisible(mode, 'inflationMode') && (
        <SwitchField
          label="실질 수익률로 계산"
          description="물가상승분을 뺀 오늘 화폐가치로 표시합니다. 표의 생활비가 매년 같은 것은 이 설정 때문입니다."
          checked={params.inflationMode === 'real'}
          onChange={(checked) =>
            onChangeParams({ ...params, inflationMode: checked ? 'real' : 'nominal' })
          }
          changed={changed.has('inflationMode')}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        {isFieldVisible(mode, 'inflationRate') && (
          <FieldRow label="물가상승률" changed={changed.has('inflationRate')}>
            <InputField
              label="" aria-label="물가상승률" type="number" step="0.1" suffixText="%"
              value={params.inflationRate}
              disabled={scenarioGoverns}
              onChange={(e) => onChangeParams({ ...params, inflationRate: Number(e.target.value) })}
            />
          </FieldRow>
        )}

        {isFieldVisible(mode, 'baseExchangeRate') && (
          <FieldRow
            label="적용 환율"
            tooltipText="1달러를 원화로 환산할 때 쓰는 값입니다."
            changed={changed.has('baseExchangeRate')}
          >
            <InputField
              label="" aria-label="적용 환율" type="text" suffixText="원"
              value={params.baseExchangeRate.toLocaleString()}
              onChange={(e) => {
                const raw = e.target.value.replace(/,/g, '');
                if (raw === '' || !isNaN(Number(raw))) {
                  onChangeParams({
                    ...params,
                    baseExchangeRate: raw === '' ? 0 : Number(raw),
                  });
                }
              }}
            />
          </FieldRow>
        )}

        {isFieldVisible(mode, 'displayCurrency') && (
          <FieldRow label="대시보드 기준 통화" changed={changed.has('displayCurrency')}>
            <SelectField
              label="" aria-label="대시보드 기준 통화"
              value={params.displayCurrency}
              onChange={(e) =>
                onChangeParams({ ...params, displayCurrency: e.target.value as AssetCurrency })
              }
              options={[
                { value: 'KRW', label: 'KRW (대한민국 원)' },
                { value: 'USD', label: 'USD (미국 달러)' },
              ]}
            />
          </FieldRow>
        )}
      </div>
    </>
  );
}
```

기존 `SimulationSettings`의 "최신 환율 자동 조회" 기능은 Task 10에서 이 섹션으로 옮긴다.

- [ ] **Step 12: 패널에 두 섹션을 연결**

`renderSectionBody`에:

```tsx
      case 'investment':
        return <InvestmentStrategySection {...sectionProps} ai={ai} />;
      case 'economic':
        return <EconomicAssumptionSection {...sectionProps} />;
```

`applyAiToSection`에 `investment` 케이스를 추가한다.

```tsx
    if (id === 'investment') {
      const recommended = ai.recommendation?.recommendedAssetReinvestment;
      if (!recommended) return;

      // 자산별 권장값을 그대로 적용한다. 전역 스위치는 표시 상태를 자산에서 파생하므로
      // 별도로 갱신할 필요가 없다.
      onChangeParams({
        ...params,
        assets: params.assets.map((a) =>
          a.id in recommended ? { ...a, reinvestDividend: recommended[a.id] } : a
        ),
      });
      return;
    }
```

- [ ] **Step 13: 테스트 통과 후 커밋**

Run: `npm test` → 전부 PASS
Run: `npx tsc --noEmit` → 에러 없음

```bash
git add src/core/usecases/scenario/economicScenarios.ts \
        src/core/usecases/strategy/compileStrategy.ts \
        src/web/features/StrategySettings/ \
        src/tests/core/usecases/scenario/economicScenarios.test.ts \
        src/tests/core/usecases/strategy/compileStrategy.investment.test.ts \
        src/tests/web/features/StrategySettings/
git commit -m "feat: 투자 전략과 경제 가정 섹션 추가

리스크 성향 4종과 경제 시나리오 4종을 카드형 라디오로 고르게 하고,
compileStrategy가 '경제 시나리오 → 리스크 성향' 순으로 적용하도록 한다.
둘 다 수익률을 건드리므로 시나리오는 물가·환율을, 리스크 성향은 수익률을
지배한다는 규칙을 코드와 화면 설명문 양쪽에 명시한다.

리스크 성향이 ai_recommended이면 시나리오 수익률을 덮어쓰지 않는다 —
'ai_*'는 '미정'이지 '중립형'이 아니기 때문이다.

경제 시나리오는 결정론적 단일 경로이며 확률 분포(몬테카를로)는 산출하지 않는다."
```

---

### Task 9: 의료비·장기요양 지출 레이어

**Files:**
- Create: `src/core/usecases/healthcare/healthcareCosts.ts`
- Modify: `src/core/entities/types.ts` (`SimulationYearlyResult.healthcareSpending`)
- Modify: `src/core/usecases/SimulationEngine.ts`
- Modify: `src/web/features/StrategySettings/sections/EconomicAssumptionSection.tsx`
- Modify: `src/web/features/StrategySettings/strategyOptions.tsx` (`DEFAULT_HEALTHCARE`)
- Test: `src/tests/core/usecases/healthcare/healthcareCosts.test.ts`
- Test: `src/tests/core/usecases/SimulationEngine.healthcare.test.ts`

**Interfaces:**
- Consumes: `HealthcareAssumptions` (Task 1), `SectionProps` (Task 4)
- Produces:
  ```ts
  export function computeAnnualHealthcareCost(input: {
    healthcare: HealthcareAssumptions | undefined;
    currentAge: number;
    retirementAge: number;
    yearsSinceRetirement: number;
    inflationMode: 'nominal' | 'real';
    inflationRate: number;
  }): number;

  export const DEFAULT_HEALTHCARE: HealthcareAssumptions; // strategyOptions.tsx
  ```

- [ ] **Step 1: `healthcareCosts` 테스트를 작성**

`src/tests/core/usecases/healthcare/healthcareCosts.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { computeAnnualHealthcareCost } from '@/core/usecases/healthcare/healthcareCosts';
import { HealthcareAssumptions } from '@/core/entities/types';

const healthcare: HealthcareAssumptions = {
  enabled: true,
  costGrowthRate: 5,
  baseMonthlyCost: 300000,
  longTermCareEnabled: false,
  longTermCareStartAge: 80,
  longTermCareMonthlyCost: 1500000,
  shockEnabled: false,
  shockAge: 75,
  shockAmount: 30000000,
};

const call = (patch: Partial<Parameters<typeof computeAnnualHealthcareCost>[0]> = {}) =>
  computeAnnualHealthcareCost({
    healthcare, currentAge: 65, retirementAge: 60, yearsSinceRetirement: 5,
    inflationMode: 'nominal', inflationRate: 2.5, ...patch,
  });

describe('computeAnnualHealthcareCost', () => {
  test('healthcare가 없으면 0이다', () => {
    expect(call({ healthcare: undefined })).toBe(0);
  });

  test('enabled가 false면 0이다', () => {
    expect(call({ healthcare: { ...healthcare, enabled: false } })).toBe(0);
  });

  test('은퇴 전에는 0이다', () => {
    expect(call({ currentAge: 55, yearsSinceRetirement: -5 })).toBe(0);
  });

  test('은퇴 시점에는 기본 월 의료비의 12배다', () => {
    expect(call({ currentAge: 60, yearsSinceRetirement: 0 })).toBe(300000 * 12);
  });

  test('명목 모드에서는 의료비 증가율 전체가 복리로 적용된다', () => {
    // 5년 경과, 연 5% → 300000 * 12 * 1.05^5
    expect(call()).toBeCloseTo(300000 * 12 * Math.pow(1.05, 5), 0);
  });

  test('실질 모드에서는 물가 초과분만 적용된다', () => {
    // 의료비 5% - 물가 2.5% = 초과 2.5%
    const result = call({ inflationMode: 'real' });

    expect(result).toBeCloseTo(300000 * 12 * Math.pow(1.025, 5), 0);
  });

  test('실질 모드에서 의료비 증가율이 물가보다 낮으면 감소한다', () => {
    const result = call({
      inflationMode: 'real',
      healthcare: { ...healthcare, costGrowthRate: 1 }, // 1% - 2.5% = -1.5%
    });

    expect(result).toBeLessThan(300000 * 12);
  });

  test('장기요양 시작 나이 전에는 장기요양비가 붙지 않는다', () => {
    const withLtc = { ...healthcare, longTermCareEnabled: true, longTermCareStartAge: 80 };

    expect(call({ healthcare: withLtc, currentAge: 79, yearsSinceRetirement: 19 }))
      .toBeCloseTo(300000 * 12 * Math.pow(1.05, 19), 0);
  });

  test('장기요양 시작 나이부터 장기요양비가 더해진다', () => {
    const withLtc = { ...healthcare, longTermCareEnabled: true, longTermCareStartAge: 80 };
    const base = 300000 * 12 * Math.pow(1.05, 20);
    const ltc = 1500000 * 12 * Math.pow(1.05, 20);

    expect(call({ healthcare: withLtc, currentAge: 80, yearsSinceRetirement: 20 }))
      .toBeCloseTo(base + ltc, 0);
  });

  test('쇼크는 지정한 나이 한 해에만 발생한다', () => {
    const withShock = { ...healthcare, shockEnabled: true, shockAge: 70 };
    const baseAt10 = 300000 * 12 * Math.pow(1.05, 10);

    expect(call({ healthcare: withShock, currentAge: 70, yearsSinceRetirement: 10 }))
      .toBeCloseTo(baseAt10 + 30000000, 0);
    expect(call({ healthcare: withShock, currentAge: 71, yearsSinceRetirement: 11 }))
      .toBeCloseTo(300000 * 12 * Math.pow(1.05, 11), 0);
  });

  test('쇼크 금액에는 증가율을 적용하지 않는다 (오늘 화폐가치 목돈)', () => {
    const withShock = {
      ...healthcare, shockEnabled: true, shockAge: 70,
      baseMonthlyCost: 0, longTermCareEnabled: false,
    };

    expect(call({ healthcare: withShock, currentAge: 70, yearsSinceRetirement: 10 }))
      .toBe(30000000);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/healthcare/healthcareCosts.test.ts`
Expected: FAIL — import 실패

- [ ] **Step 3: `healthcareCosts` 구현**

`src/core/usecases/healthcare/healthcareCosts.ts`

```ts
import { HealthcareAssumptions } from '../../entities/types';

interface HealthcareCostInput {
  healthcare: HealthcareAssumptions | undefined;
  currentAge: number;
  retirementAge: number;
  // 은퇴 후 경과 연수. 은퇴 전이면 음수다.
  yearsSinceRetirement: number;
  inflationMode: 'nominal' | 'real';
  inflationRate: number; // %
}

// 해당 연도의 추가 의료비 지출(생활비와 별개 라인).
//
// 은퇴 전에는 0이다 — 이 앱은 근로소득을 모델링하지 않으므로 은퇴 전 의료비를
// 넣으면 자산이 부당하게 깎인다(실제로는 급여에서 나가는 돈이다).
//
// 실질 모드에서는 물가 초과분만 적용한다. 시뮬레이션 전체가 오늘 화폐가치로
// 표시되므로, 여기서도 "물가보다 얼마나 더 빨리 오르는가"만 반영해야 일관된다.
export function computeAnnualHealthcareCost({
  healthcare, currentAge, retirementAge, yearsSinceRetirement, inflationMode, inflationRate,
}: HealthcareCostInput): number {
  if (!healthcare || !healthcare.enabled) return 0;
  if (currentAge < retirementAge) return 0;

  const effectiveGrowthRate = inflationMode === 'real'
    ? healthcare.costGrowthRate - inflationRate
    : healthcare.costGrowthRate;
  const growthFactor = Math.pow(1 + effectiveGrowthRate / 100, Math.max(0, yearsSinceRetirement));

  let annual = healthcare.baseMonthlyCost * 12 * growthFactor;

  if (healthcare.longTermCareEnabled && currentAge >= healthcare.longTermCareStartAge) {
    annual += healthcare.longTermCareMonthlyCost * 12 * growthFactor;
  }

  // 쇼크는 "오늘 화폐가치의 일회성 목돈"으로 정의한다. 증가율을 곱하지 않는 이유는
  // 사용자가 입력하는 값이 "그 나이에 실제로 나갈 금액"이기 때문이다.
  if (healthcare.shockEnabled && currentAge === healthcare.shockAge) {
    annual += healthcare.shockAmount;
  }

  return annual;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/healthcare/healthcareCosts.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 엔진 통합 테스트를 작성**

`src/tests/core/usecases/SimulationEngine.healthcare.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { HealthcareAssumptions, SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 60, retirementAge: 60, expectancy: 80, targetMonthlySpending: 2000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 1000000000, monthlyContribution: 0, annualReturn: 0, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const healthcare: HealthcareAssumptions = {
  enabled: true, costGrowthRate: 0, baseMonthlyCost: 500000,
  longTermCareEnabled: false, longTermCareStartAge: 80, longTermCareMonthlyCost: 0,
  shockEnabled: false, shockAge: 75, shockAmount: 0,
};

describe('SimulationEngine 의료비 통합', () => {
  test('healthcare가 없으면 결과가 기존과 완전히 동일하다', () => {
    const engine = new SimulationEngine();

    expect(engine.run({ ...baseParams, healthcare: undefined })).toEqual(engine.run(baseParams));
  });

  test('healthcare.enabled가 false면 결과가 기존과 완전히 동일하다', () => {
    const engine = new SimulationEngine();

    const disabled = engine.run({ ...baseParams, healthcare: { ...healthcare, enabled: false } });

    expect(disabled).toEqual(engine.run(baseParams));
  });

  test('의료비를 켜면 해당 금액이 healthcareSpending에 기록된다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({ ...baseParams, healthcare });
    const at65 = result.yearlyResults.find((y) => y.age === 65)!;

    expect(at65.healthcareSpending).toBe(500000 * 12);
  });

  test('의료비가 총 생활비 인출(spending)에 포함된다', () => {
    const engine = new SimulationEngine();

    const without = engine.run(baseParams);
    const withHc = engine.run({ ...baseParams, healthcare });

    const at65 = (r: typeof without) => r.yearlyResults.find((y) => y.age === 65)!;

    expect(at65(withHc).spending).toBeCloseTo(at65(without).spending + 500000 * 12, 0);
  });

  test('은퇴 전 연도에는 의료비가 0이다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, currentAge: 55, retirementAge: 60 },
      healthcare,
    });
    const at57 = result.yearlyResults.find((y) => y.age === 57)!;

    expect(at57.healthcareSpending).toBe(0);
  });

  test('의료비를 켜면 자산이 더 빨리 줄어든다', () => {
    const engine = new SimulationEngine();

    const without = engine.run(baseParams);
    const withHc = engine.run({ ...baseParams, healthcare });

    expect(withHc.endingAssets).toBeLessThan(without.endingAssets);
  });
});
```

- [ ] **Step 6: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.healthcare.test.ts`
Expected: FAIL — `healthcareSpending` 필드 없음

- [ ] **Step 7: `SimulationYearlyResult`에 필드 추가**

`src/core/entities/types.ts`의 `SimulationYearlyResult`에 추가한다.

```ts
  // 연간 의료비 지출. spending에 이미 포함된 금액 중 의료비분을 분해해 보여주기
  // 위한 정보성 필드다 (spending에서 빼면 안 된다).
  healthcareSpending: number;
```

- [ ] **Step 8: `SimulationEngine`에 의료비 레이어 통합**

1. import 추가:

```ts
import { computeAnnualHealthcareCost } from './healthcare/healthcareCosts';
```

2. 연도 루프 안, `monthlyTargetSpending` 계산 직후에 의료비를 구한다.

```ts
      // 생활비와 별개의 지출 라인. 은퇴 후에만 발생하며 spending에 합산된다.
      const annualHealthcareCost = computeAnnualHealthcareCost({
        healthcare: params.healthcare,
        currentAge,
        retirementAge: userProfile.retirementAge,
        yearsSinceRetirement: currentAge - userProfile.retirementAge,
        inflationMode,
        inflationRate: infRateAnnual * 100,
      });
```

`infRateAnnual`이 이미 소수(0.025)인지 퍼센트(2.5)인지 확인한다.
Run: `grep -n "infRateAnnual" src/core/usecases/SimulationEngine.ts`
소수라면 위처럼 `* 100`, 퍼센트라면 그대로 넘긴다.

3. 목표 생활비에 의료비를 더해 인출 대상 금액을 키운다.
`monthlyTargetSpending` 대입 직후:

```ts
      // 의료비는 목표 생활비와 같은 재원(자산 인출)에서 나가므로 월 단위로 환산해 더한다.
      // dividend_only 전략에서도 의료비는 발생하므로 조건 밖에서 더한다.
      monthlyTargetSpending += annualHealthcareCost / 12;
```

`monthlyTargetSpending`이 `let`인지 확인하고, `const`라면 `let`으로 바꾼다.

4. `yearlyResults.push({...})`에 추가:

```ts
        healthcareSpending: annualHealthcareCost,
```

5. `SimulationYearlyResult`를 만드는 다른 위치를 모두 갱신한다.

Run: `npx tsc --noEmit` → 누락된 곳이 컴파일 에러로 드러난다.

- [ ] **Step 9: 테스트 확인**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.healthcare.test.ts`
Expected: PASS (6 tests)

Run: `npm test`
Expected: 전부 PASS. 스냅샷이 깨지면 `healthcareSpending: 0` 추가만이 원인인지 확인하고
`npx vitest run -u`로 갱신한다. **다른 값이 바뀌었다면 의료비 off 상태에서 결과가 변한
것이므로 되돌려 원인을 찾는다.**

- [ ] **Step 10: 의료비 UI를 ⑤ 경제 가정 섹션에 추가**

`strategyOptions.tsx`에 기본값을 추가한다.

```tsx
import { HealthcareAssumptions } from '../../../core/entities/types';

// 의료비 스위치를 처음 켤 때 채워 넣는 값.
// 월 30만원은 통계청 가계동향의 60대 이상 보건 지출 수준을 참고한 것이고,
// 증가율 5%는 건강보험 진료비 증가율이 일반 물가를 상회해 온 추세를 반영한다.
export const DEFAULT_HEALTHCARE: HealthcareAssumptions = {
  enabled: false,
  costGrowthRate: 5,
  baseMonthlyCost: 300000,
  longTermCareEnabled: false,
  longTermCareStartAge: 80,
  longTermCareMonthlyCost: 1500000,
  shockEnabled: false,
  shockAge: 75,
  shockAmount: 30000000,
};
```

`EconomicAssumptionSection.tsx`에 의료비 블록을 추가한다 (기존 grid 아래).

```tsx
import { HealthcareAssumptions } from '../../../../core/entities/types';
import { DEFAULT_HEALTHCARE } from '../strategyOptions';
```

```tsx
  const healthcare = params.healthcare;
  const healthcareEnabled = healthcare?.enabled ?? false;

  const setHealthcare = (patch: Partial<HealthcareAssumptions>) => {
    onChangeParams({
      ...params,
      healthcare: { ...DEFAULT_HEALTHCARE, ...(healthcare ?? {}), ...patch },
    });
  };
```

```tsx
      {isFieldVisible(mode, 'healthcare.enabled') && (
        <SwitchField
          label="의료비를 따로 계산"
          description="나이가 들수록 늘어나는 의료비를 생활비와 별도로 반영합니다."
          checked={healthcareEnabled}
          onChange={(checked) => setHealthcare({ enabled: checked })}
          changed={changed.has('healthcare.enabled')}
        />
      )}

      {healthcareEnabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {isFieldVisible(mode, 'healthcare.baseMonthlyCost') && (
            <FieldRow label="은퇴 시점 월 의료비" changed={changed.has('healthcare.baseMonthlyCost')}>
              <InputField
                label="" aria-label="은퇴 시점 월 의료비" type="text" suffixText="원"
                value={(healthcare?.baseMonthlyCost ?? 0).toLocaleString()}
                onChange={(e) => {
                  const raw = e.target.value.replace(/,/g, '');
                  if (raw === '' || !isNaN(Number(raw))) {
                    setHealthcare({ baseMonthlyCost: raw === '' ? 0 : Number(raw) });
                  }
                }}
              />
            </FieldRow>
            )}
            {isFieldVisible(mode, 'healthcare.costGrowthRate') && (
            <FieldRow
              label="의료비 증가율"
              tooltipText="의료비는 보통 일반 물가보다 빠르게 오릅니다."
              changed={changed.has('healthcare.costGrowthRate')}
            >
              <InputField
                label="" aria-label="의료비 증가율" type="number" step="0.1" suffixText="%"
                value={healthcare?.costGrowthRate ?? DEFAULT_HEALTHCARE.costGrowthRate}
                onChange={(e) => setHealthcare({ costGrowthRate: Number(e.target.value) })}
              />
            </FieldRow>
            )}
          </div>

          {isFieldVisible(mode, 'healthcare.longTermCareEnabled') && (
          <SwitchField
            label="장기요양 발생 가정"
            description="특정 나이부터 요양 비용이 매달 추가로 나간다고 봅니다."
            checked={healthcare?.longTermCareEnabled ?? false}
            onChange={(v) => setHealthcare({ longTermCareEnabled: v })}
            changed={changed.has('healthcare.longTermCareEnabled')}
          />
          )}

          {healthcare?.longTermCareEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="장기요양 시작 나이" changed={changed.has('healthcare.longTermCareStartAge')}>
                <InputField
                  label="" aria-label="장기요양 시작 나이" type="number" suffixText="세"
                  value={healthcare.longTermCareStartAge}
                  onChange={(e) => setHealthcare({ longTermCareStartAge: Number(e.target.value) })}
                />
              </FieldRow>
              <FieldRow label="월 장기요양비" changed={changed.has('healthcare.longTermCareMonthlyCost')}>
                <InputField
                  label="" aria-label="월 장기요양비" type="text" suffixText="원"
                  value={healthcare.longTermCareMonthlyCost.toLocaleString()}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, '');
                    if (raw === '' || !isNaN(Number(raw))) {
                      setHealthcare({ longTermCareMonthlyCost: raw === '' ? 0 : Number(raw) });
                    }
                  }}
                />
              </FieldRow>
            </div>
          )}

          {isFieldVisible(mode, 'healthcare.shockEnabled') && (
          <SwitchField
            label="의료비 급증 시나리오"
            description="특정 나이에 큰 목돈이 한 번 나가는 상황을 가정합니다."
            checked={healthcare?.shockEnabled ?? false}
            onChange={(v) => setHealthcare({ shockEnabled: v })}
            changed={changed.has('healthcare.shockEnabled')}
          />
          )}

          {healthcare?.shockEnabled && (
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="급증 발생 나이" changed={changed.has('healthcare.shockAge')}>
                <InputField
                  label="" aria-label="급증 발생 나이" type="number" suffixText="세"
                  value={healthcare.shockAge}
                  onChange={(e) => setHealthcare({ shockAge: Number(e.target.value) })}
                />
              </FieldRow>
              <FieldRow label="급증 금액" changed={changed.has('healthcare.shockAmount')}>
                <InputField
                  label="" aria-label="급증 금액" type="text" suffixText="원"
                  value={healthcare.shockAmount.toLocaleString()}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, '');
                    if (raw === '' || !isNaN(Number(raw))) {
                      setHealthcare({ shockAmount: raw === '' ? 0 : Number(raw) });
                    }
                  }}
                />
              </FieldRow>
            </div>
          )}
        </>
      )}
```

- [ ] **Step 11: 대시보드에 의료비 표시를 추가**

`src/web/features/Dashboard/YearlyChart.tsx`(또는 연도별 표를 그리는 컴포넌트)에서
`healthcareSpending`이 0보다 큰 시나리오일 때 지출 열에 의료비를 분리 표시한다.

Run: `grep -n "spending" src/web/features/Dashboard/YearlyChart.tsx`
`spending`을 표시하는 위치를 찾아 그 옆에 다음을 추가한다.

```tsx
                  {row.healthcareSpending > 0 && (
                    <span className="block text-xs text-foreground-muted">
                      의료비 {Math.round(row.healthcareSpending / 10000).toLocaleString()}만원 포함
                    </span>
                  )}
```

표시 위치가 이 파일이 아니면 `grep -rn "\.spending" src/web` 로 실제 소비처를 찾아 적용한다.

- [ ] **Step 12: 전체 테스트 확인 후 커밋**

Run: `npm test` → 전부 PASS
Run: `npx tsc --noEmit` → 에러 없음

```bash
git add src/core/usecases/healthcare/ src/core/usecases/SimulationEngine.ts \
        src/core/entities/types.ts src/web/features/StrategySettings/ \
        src/web/features/Dashboard/ src/tests/core/usecases/healthcare/ \
        src/tests/core/usecases/SimulationEngine.healthcare.test.ts \
        src/tests/core/usecases/__snapshots__
git commit -m "feat: 의료비·장기요양 지출 레이어를 시뮬레이션에 추가

생활비와 별개의 지출 라인을 연도 루프에 추가한다. 기본 의료비(연령별 복리
증가), 장기요양(특정 나이부터 월 추가), 급증 이벤트(일회성 목돈) 세 가지를
파라미터화했다.

은퇴 전에는 적용하지 않는다 — 이 앱은 근로소득을 모델링하지 않으므로
은퇴 전 의료비를 넣으면 자산이 부당하게 깎인다.

실질 모드에서는 물가 초과분(의료비 증가율 - 물가상승률)만 적용해
시뮬레이션 전체의 실질 기준과 일관되게 맞춘다.

healthcare 미설정 또는 enabled=false이면 결과가 변경 전과 완전히
동일함을 회귀 테스트로 검증한다."
```

---

### Task 10: ⑥ 고급 설정 + 세법 버전 + 구 컴포넌트 정리

**Files:**
- Create: `src/core/usecases/tax/taxLawProfiles.ts`
- Modify: `src/core/usecases/tax/taxRates.ts`
- Create: `src/web/features/StrategySettings/sections/AdvancedSection.tsx`
- Modify: `src/web/features/StrategySettings/StrategySettingsPanel.tsx`
- Modify: `src/web/features/StrategySettings/sections/EconomicAssumptionSection.tsx` (최신 환율 조회 이전)
- Modify: `src/app/simulator/page.tsx`
- Delete: `src/web/features/Scenario/QuickSettingsSummary.tsx`, `src/web/features/Scenario/SimulationSettings.tsx`, `src/web/features/AssetForm/TaxSettingsSection.tsx`
- Delete: 위 3개의 테스트 파일
- Test: `src/tests/core/usecases/tax/taxLawProfiles.test.ts`
- Test: `src/tests/web/features/StrategySettings/sections/AdvancedSection.test.tsx`

**Interfaces:**
- Produces:
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
  export const TAX_LAW_PROFILES: Record<TaxLawVersion, TaxLawProfile>;
  export function resolveTaxLawProfile(version?: TaxLawVersion): TaxLawProfile;

  export function AdvancedSection(props: SectionProps): JSX.Element;
  ```

- [ ] **Step 1: 세법 프로필 테스트를 작성**

`src/tests/core/usecases/tax/taxLawProfiles.test.ts`

```ts
import { describe, test, expect } from 'vitest';
import { TAX_LAW_PROFILES, resolveTaxLawProfile } from '@/core/usecases/tax/taxLawProfiles';
import {
  DEFAULT_PRIVATE_PENSION_LIMIT_KRW, FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW,
  ISA_ANNUAL_CONTRIBUTION_LIMIT_KRW, KOREA_COMPREHENSIVE_INCOME_TAX_BRACKETS_2024,
  PRIVATE_PENSION_TAX_BRACKETS,
} from '@/core/usecases/tax/taxRates';

describe('TAX_LAW_PROFILES', () => {
  test('current 프로필이 기존 상수와 정확히 일치한다', () => {
    const p = TAX_LAW_PROFILES.current;

    expect(p.financialIncomeThresholdKRW).toBe(FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW);
    expect(p.isaAnnualLimitKRW).toBe(ISA_ANNUAL_CONTRIBUTION_LIMIT_KRW);
    expect(p.privatePensionLimitKRW).toBe(DEFAULT_PRIVATE_PENSION_LIMIT_KRW);
    expect(p.privatePensionBrackets).toEqual(PRIVATE_PENSION_TAX_BRACKETS);
    expect(p.comprehensiveIncomeBrackets).toEqual(KOREA_COMPREHENSIVE_INCOME_TAX_BRACKETS_2024);
  });
});

describe('resolveTaxLawProfile', () => {
  test('버전 미지정이면 current를 반환한다', () => {
    expect(resolveTaxLawProfile()).toBe(TAX_LAW_PROFILES.current);
  });

  test('current를 명시해도 같은 프로필을 반환한다', () => {
    expect(resolveTaxLawProfile('current')).toBe(TAX_LAW_PROFILES.current);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/core/usecases/tax/taxLawProfiles.test.ts`
Expected: FAIL — import 실패

- [ ] **Step 3: `taxLawProfiles` 구현**

`src/core/usecases/tax/taxLawProfiles.ts`

```ts
import { TaxLawVersion } from '../../entities/types';

export interface ProgressiveTaxBracket {
  minKRW: number;
  rate: number;
  deductionKRW: number;
}

export interface PrivatePensionTaxBracket {
  minAge: number;
  maxAge: number;
  rate: number;
}

// 한 세법 버전이 정하는 세율·한도의 전체 집합.
// 개정안이 확정되면 이 인터페이스를 만족하는 프로필을 하나 더 추가하면 된다.
export interface TaxLawProfile {
  financialIncomeThresholdKRW: number;
  isaAnnualLimitKRW: number;
  isaExemptionGeneralKRW: number;
  isaExemptionLowIncomeKRW: number;
  isaMaturityTaxRate: number;
  nationalPensionTaxRate: number;
  privatePensionBrackets: PrivatePensionTaxBracket[];
  privatePensionLimitKRW: number;
  privatePensionExcessTaxRate: number;
  comprehensiveIncomeBrackets: ProgressiveTaxBracket[];
}

// 현행 세법(2024년 기준). taxRates.ts에 흩어져 있던 값을 그대로 옮긴 것이며
// 값 변경은 없다(taxLawProfiles.test.ts가 기존 상수와의 일치를 검증한다).
//
// 'planned'(예정 법령) 프로필은 의도적으로 비워 두었다. 실제로 확정된 개정안이
// 없는 상태에서 허구의 숫자를 넣으면 사용자가 그것을 사실로 받아들이기 때문이다.
const CURRENT_PROFILE: TaxLawProfile = {
  financialIncomeThresholdKRW: 20000000,
  isaAnnualLimitKRW: 20000000,
  isaExemptionGeneralKRW: 2000000,
  isaExemptionLowIncomeKRW: 4000000,
  isaMaturityTaxRate: 0.099,
  nationalPensionTaxRate: 0.02,
  privatePensionBrackets: [
    { minAge: 0, maxAge: 70, rate: 0.055 },
    { minAge: 70, maxAge: 80, rate: 0.044 },
    { minAge: 80, maxAge: Infinity, rate: 0.033 },
  ],
  privatePensionLimitKRW: 15000000,
  privatePensionExcessTaxRate: 16.5,
  comprehensiveIncomeBrackets: [
    { minKRW: 0, rate: 0.06, deductionKRW: 0 },
    { minKRW: 14000000, rate: 0.15, deductionKRW: 1260000 },
    { minKRW: 50000000, rate: 0.24, deductionKRW: 5760000 },
    { minKRW: 88000000, rate: 0.35, deductionKRW: 15440000 },
    { minKRW: 150000000, rate: 0.38, deductionKRW: 19940000 },
    { minKRW: 300000000, rate: 0.40, deductionKRW: 25940000 },
    { minKRW: 500000000, rate: 0.42, deductionKRW: 35940000 },
    { minKRW: 1000000000, rate: 0.45, deductionKRW: 65940000 },
  ],
};

export const TAX_LAW_PROFILES: Record<TaxLawVersion, TaxLawProfile> = {
  current: CURRENT_PROFILE,
};

export function resolveTaxLawProfile(version?: TaxLawVersion): TaxLawProfile {
  return TAX_LAW_PROFILES[version ?? 'current'] ?? CURRENT_PROFILE;
}
```

- [ ] **Step 4: `taxRates.ts`가 프로필을 참조하도록 변경**

기존 export 이름을 유지하되 값의 단일 소스를 프로필로 옮긴다. 외부 import가 깨지지 않는다.

```ts
import { TAX_LAW_PROFILES } from './taxLawProfiles';
export type { ProgressiveTaxBracket } from './taxLawProfiles';

const CURRENT = TAX_LAW_PROFILES.current;

export const FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW = CURRENT.financialIncomeThresholdKRW;
export const ISA_ANNUAL_CONTRIBUTION_LIMIT_KRW = CURRENT.isaAnnualLimitKRW;
export const ISA_EXEMPTION_LIMIT_GENERAL_KRW = CURRENT.isaExemptionGeneralKRW;
export const ISA_EXEMPTION_LIMIT_LOW_INCOME_KRW = CURRENT.isaExemptionLowIncomeKRW;
export const ISA_MATURITY_TAX_RATE = CURRENT.isaMaturityTaxRate;
export const NATIONAL_PENSION_TAX_RATE = CURRENT.nationalPensionTaxRate;
export const PRIVATE_PENSION_TAX_BRACKETS = CURRENT.privatePensionBrackets;
export const DEFAULT_PRIVATE_PENSION_LIMIT_KRW = CURRENT.privatePensionLimitKRW;
export const DEFAULT_PRIVATE_PENSION_EXCESS_TAX_RATE = CURRENT.privatePensionExcessTaxRate;
export const KOREA_COMPREHENSIVE_INCOME_TAX_BRACKETS_2024 = CURRENT.comprehensiveIncomeBrackets;
```

`DEFAULT_COMPREHENSIVE_TAX_RATE`, `DEFAULT_HEALTH_INSURANCE_RATE`, `DEFAULT_TAX_SETTINGS`,
`resolveTaxSettings`는 그대로 유지한다 (세법이 아니라 앱 기본 설정이다).
파일 상단 주석을 갱신해 "값의 단일 소스는 `taxLawProfiles.ts`"임을 명시한다.

- [ ] **Step 5: 테스트 확인**

Run: `npm test`
Expected: 전부 PASS. 값이 동일하므로 시뮬레이션 결과에 변화가 없어야 한다.
스냅샷이 깨지면 값이 바뀐 것이므로 프로필 숫자를 다시 대조한다.

- [ ] **Step 6: `AdvancedSection` 테스트를 작성**

`src/tests/web/features/StrategySettings/sections/AdvancedSection.test.tsx`

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdvancedSection } from '@/web/features/StrategySettings/sections/AdvancedSection';
import { initialParams } from '@/infrastructure/storage/localStore';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { resolveTaxSettings } from '@/core/usecases/tax/taxRates';

const renderSection = (onChangeParams = vi.fn()) => {
  render(
    <AdvancedSection
      params={initialParams} onChangeParams={onChangeParams}
      mode="expert" changed={new Set()}
    />
  );
  return onChangeParams;
};

describe('AdvancedSection', () => {
  test('세법 버전 셀렉터를 렌더링하고 현행만 선택지로 둔다', () => {
    renderSection();

    const select = screen.getByLabelText('세법 버전');
    expect(select).toBeInTheDocument();
    expect(select.querySelectorAll('option')).toHaveLength(1);
  });

  test('세율·한도 입력을 렌더링한다', () => {
    renderSection();

    expect(screen.getByLabelText('미국 배당세율')).toBeInTheDocument();
    expect(screen.getByLabelText('국내 배당세율')).toBeInTheDocument();
    expect(screen.getByLabelText('사적연금 저율과세 한도')).toBeInTheDocument();
    expect(screen.getByLabelText('사적연금 한도초과 세율')).toBeInTheDocument();
  });

  test('미국 배당세율을 바꾸면 taxSettings에 반영된다', () => {
    const onChangeParams = renderSection();

    fireEvent.change(screen.getByLabelText('미국 배당세율'), { target: { value: '20' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      taxSettings: { ...resolveTaxSettings(initialParams.taxSettings), usDividendTaxRate: 20 },
    });
  });

  test('연금 전략이 AI 최적화면 저율과세 한도 스위치를 직접 켤 수 있다', () => {
    const onChangeParams = renderSection();

    const sw = screen.getByRole('switch', { name: /저율과세 한도 내에서만 인출/ });
    expect(sw).not.toBeDisabled();

    fireEvent.click(sw);

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      taxSettings: {
        ...resolveTaxSettings(initialParams.taxSettings),
        limitPrivatePensionToTaxLimit: true,
      },
    });
  });

  test('연금 전략이 명시적이면 저율과세 한도 스위치가 비활성화되고 이유를 설명한다', () => {
    render(
      <AdvancedSection
        params={{
          ...initialParams,
          strategy: { ...DEFAULT_RETIREMENT_STRATEGY, privatePensionStrategy: 'tax_first' },
        }}
        onChangeParams={vi.fn()} mode="expert" changed={new Set()}
      />
    );

    expect(screen.getByRole('switch', { name: /저율과세 한도 내에서만 인출/ })).toBeDisabled();
    expect(screen.getByText(/③연금 전략의 선택이 이 값을 결정합니다/)).toBeInTheDocument();
  });

  test('금융소득종합과세 스위치를 렌더링한다', () => {
    renderSection();

    expect(screen.getByRole('switch', { name: /금융소득종합과세 반영/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /건강보험료 반영/ })).toBeInTheDocument();
  });

  test('간편 모드에서는 아무것도 렌더링하지 않는다', () => {
    render(
      <AdvancedSection
        params={initialParams} onChangeParams={vi.fn()}
        mode="simple" changed={new Set()}
      />
    );

    expect(screen.queryByLabelText('미국 배당세율')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7: 테스트가 실패하는지 확인**

Run: `npx vitest run src/tests/web/features/StrategySettings/sections/AdvancedSection.test.tsx`
Expected: FAIL — import 실패

- [ ] **Step 8: `AdvancedSection` 구현**

**선행 작업**: `SwitchField`에 `disabled?: boolean` prop을 추가한다
(`src/web/components/form/SwitchField.tsx`). `disabled`면 `<input>`에 `disabled`를 넘기고
라벨 전체를 `opacity-60 cursor-not-allowed`로 처리한다. `SwitchField.test.tsx`에
"disabled면 클릭해도 onChange가 호출되지 않는다" 케이스를 추가한다.

`src/web/features/StrategySettings/sections/AdvancedSection.tsx`

기존 `TaxSettingsSection.tsx`를 먼저 읽어 어떤 필드를 어떤 라벨로 다루는지 확인한다.

Run: `cat src/web/features/AssetForm/TaxSettingsSection.tsx`

그 필드들을 `FieldRow`/`SwitchField`로 옮겨 담는다.

```tsx
'use client';

import { TaxSettings } from '../../../../core/entities/types';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../../core/usecases/strategy/compileStrategy';
import { resolveTaxSettings } from '../../../../core/usecases/tax/taxRates';
import InputField from '../../../components/InputField';
import SelectField from '../../../components/SelectField';
import { FieldRow, SwitchField } from '../../../components/form';
import { isFieldVisible } from '../fieldVisibility';
import { SectionProps } from '../strategyOptions';

// 세법 버전 선택지. 현재는 현행 하나뿐이며, 확정된 개정안이 생기면 여기에 추가한다.
const TAX_LAW_OPTIONS = [{ value: 'current', label: '현행 세법 (2024년 기준)' }];

export function AdvancedSection({ params, onChangeParams, mode, changed }: SectionProps) {
  const tax = resolveTaxSettings(params.taxSettings);

  // ③연금 전략이 'ai_optimized'가 아니면 compileStrategy가 저율과세 한도 설정을
  // 덮어쓴다. 그 상태에서 스위치를 켤 수 있게 두면 "켰는데 결과가 안 바뀐다"가 되므로
  // 비활성화하고 이유를 설명문에 적는다.
  const pensionStrategy =
    params.strategy?.privatePensionStrategy ?? DEFAULT_RETIREMENT_STRATEGY.privatePensionStrategy;
  const pensionStrategyGovernsLimit = pensionStrategy !== 'ai_optimized';

  const setTax = (patch: Partial<TaxSettings>) => {
    onChangeParams({ ...params, taxSettings: { ...tax, ...patch } });
  };

  const numberField = (
    path: string, label: string, key: keyof TaxSettings, suffix: string, tooltip?: string
  ) =>
    isFieldVisible(mode, path) && (
      <FieldRow label={label} tooltipText={tooltip} changed={changed.has(path)}>
        <InputField
          label="" aria-label={label} type="number" step="0.1" suffixText={suffix}
          value={tax[key] as number}
          onChange={(e) => setTax({ [key]: Number(e.target.value) } as Partial<TaxSettings>)}
        />
      </FieldRow>
    );

  return (
    <>
      {isFieldVisible(mode, 'taxLawVersion') && (
        <FieldRow
          label="세법 버전"
          tooltipText="계산에 사용할 세율표입니다. 확정된 개정안이 생기면 선택지가 늘어납니다."
          changed={changed.has('taxLawVersion')}
        >
          <SelectField
            label="" aria-label="세법 버전"
            value={params.taxLawVersion ?? 'current'}
            onChange={(e) =>
              onChangeParams({ ...params, taxLawVersion: e.target.value as 'current' })
            }
            options={TAX_LAW_OPTIONS}
          />
        </FieldRow>
      )}

      <div className="grid grid-cols-2 gap-3">
        {numberField('taxSettings.usDividendTaxRate', '미국 배당세율', 'usDividendTaxRate', '%')}
        {numberField('taxSettings.domesticDividendTaxRate', '국내 배당세율', 'domesticDividendTaxRate', '%')}
        {numberField('taxSettings.comprehensiveTaxRate', '금융소득종합과세 세율', 'comprehensiveTaxRate', '%',
          '연 2천만원을 넘는 금융소득에 추가로 붙는 세율입니다.')}
        {numberField('taxSettings.healthInsuranceRate', '건강보험료율', 'healthInsuranceRate', '%')}
        {numberField('taxSettings.privatePensionLimit', '사적연금 저율과세 한도', 'privatePensionLimit', '원',
          '이 금액까지는 낮은 세율이 적용됩니다.')}
        {numberField('taxSettings.privatePensionExcessTaxRate', '사적연금 한도초과 세율', 'privatePensionExcessTaxRate', '%')}
      </div>

      {isFieldVisible(mode, 'taxSettings.limitPrivatePensionToTaxLimit') && (
        <SwitchField
          label="사적연금을 저율과세 한도 내에서만 인출"
          description={
            pensionStrategyGovernsLimit
              ? '지금은 ③연금 전략의 선택이 이 값을 결정합니다. 직접 정하려면 연금 전략을 "AI 최적화"로 두세요.'
              : '세금이 적게 붙는 한도까지만 꺼내 씁니다. 생활비가 모자라면 다른 자산에서 채웁니다.'
          }
          tooltipTerm="irp"
          checked={tax.limitPrivatePensionToTaxLimit}
          onChange={(v) => setTax({ limitPrivatePensionToTaxLimit: v })}
          disabled={pensionStrategyGovernsLimit}
          changed={changed.has('taxSettings.limitPrivatePensionToTaxLimit')}
        />
      )}

      {isFieldVisible(mode, 'taxSettings.enableComprehensiveTax') && (
        <SwitchField
          label="금융소득종합과세 반영"
          description="배당·이자가 연 2천만원을 넘을 때의 추가 세금을 계산에 넣습니다."
          tooltipTerm="comprehensiveTax"
          checked={tax.enableComprehensiveTax}
          onChange={(v) => setTax({ enableComprehensiveTax: v })}
          changed={changed.has('taxSettings.enableComprehensiveTax')}
        />
      )}

      {isFieldVisible(mode, 'taxSettings.enableHealthInsurance') && (
        <SwitchField
          label="건강보험료 반영"
          description="은퇴 후 소득에 따라 늘어나는 건강보험료를 계산에 넣습니다."
          tooltipTerm="healthInsurance"
          checked={tax.enableHealthInsurance}
          onChange={(v) => setTax({ enableHealthInsurance: v })}
          changed={changed.has('taxSettings.enableHealthInsurance')}
        />
      )}

      {isFieldVisible(mode, 'taxSettings.enablePrivatePensionTax') && (
        <SwitchField
          label="사적연금 한도초과세 반영"
          description="저율과세 한도를 넘겨 인출할 때의 추가 세금을 계산에 넣습니다."
          tooltipTerm="irp"
          checked={tax.enablePrivatePensionTax}
          onChange={(v) => setTax({ enablePrivatePensionTax: v })}
          changed={changed.has('taxSettings.enablePrivatePensionTax')}
        />
      )}

      {isFieldVisible(mode, 'taxSettings.enablePensionComprehensiveComparison') && (
        <SwitchField
          label="분리과세·종합과세 유리한 쪽 선택"
          description="한도를 넘긴 연금소득에 대해 둘 중 세금이 적은 쪽으로 계산합니다."
          checked={tax.enablePensionComprehensiveComparison}
          onChange={(v) => setTax({ enablePensionComprehensiveComparison: v })}
          changed={changed.has('taxSettings.enablePensionComprehensiveComparison')}
        />
      )}
    </>
  );
}
```

- [ ] **Step 9: 패널에 연결**

`renderSectionBody`에:

```tsx
      case 'advanced':
        return <AdvancedSection {...sectionProps} />;
```

- [ ] **Step 10: 최신 환율 자동 조회를 ⑤ 경제 가정으로 이전**

기존 `SimulationSettings.tsx`의 `fetchExchangeRate` 로직을 `EconomicAssumptionSection.tsx`로
옮긴다. 원본을 읽고 그대로 옮기되 다음을 지킨다.

- `any` 제거: `catch (err: unknown)` 후 `err instanceof Error ? err.message : '환율 정보를 가져오지 못했습니다.'`
- `useEffect` 의존성은 `params.useLatestExchangeRate` 그대로 유지
- 인라인 style 제거, Tailwind 클래스로 대체
- "최신 환율 적용" 체크박스는 `SwitchField`로 교체

`SimulationParams`에 `useLatestExchangeRate?: boolean`가 타입 정의에 없다면 추가한다
(현재 `SimulationSettings.tsx`가 `any` 캐스팅으로 우회하고 있다).

```ts
  useLatestExchangeRate?: boolean; // 실시간 환율 자동 조회 여부 (미지정 시 true = 기존 동작)
```

- [ ] **Step 11: 구 컴포넌트를 제거하고 페이지를 정리**

`src/app/simulator/page.tsx`의 좌측 패널을 다음 구조로 정리한다.

```tsx
            <GlassCard>
              <StrategySettingsPanel params={activeParams} onChangeParams={handleUpdateActiveParams} />
            </GlassCard>

            <div className={styles.sidebarSection}>
              <ScenarioManager scenarioState={scenarioState} />
            </div>

            <Collapse title={<span className="text-base font-semibold">내 자산</span>}>
              <div className={styles.sidebarSection}>
                <AssetFormSection params={activeParams} onChangeParams={handleUpdateActiveParams} />
              </div>
            </Collapse>
```

`QuickSettingsSummary` / `SimulationSettings` / `TaxSettingsSection` import와 사용처를 모두 제거한다.

파일과 테스트를 삭제한다.

```bash
git rm src/web/features/Scenario/QuickSettingsSummary.tsx \
       src/web/features/Scenario/SimulationSettings.tsx \
       src/web/features/AssetForm/TaxSettingsSection.tsx \
       src/tests/web/features/Scenario/QuickSettingsSummary.test.tsx \
       src/tests/web/features/Scenario/SimulationSettings.test.tsx
```

`TaxSettingsSection` 테스트가 있으면 함께 삭제한다.

Run: `grep -rn "QuickSettingsSummary\|SimulationSettings\|TaxSettingsSection" src/`
Expected: 결과 없음. 남아 있으면 그 참조도 제거한다.

`AssetFormSection`의 profile 탭에 남은 중복 필드(현재 나이/은퇴 나이/기대수명/목표 생활비/
생활비 전략/목표 상속자산)를 제거한다. 그 탭이 비면 탭 자체를 제거하고 기본 탭을
`'stocks'`로 바꾼다.

Run: `grep -n "activeTab === 'profile'" src/web/features/AssetForm/AssetFormSection.tsx`
해당 블록과 탭 버튼, `TabType`의 `'profile'`을 제거한다.

- [ ] **Step 12: 전체 검증**

Run: `npx tsc --noEmit` → 에러 없음
Run: `npm run lint` → 에러 없음
Run: `npm test` → 전부 PASS

앱을 띄워 수동으로 확인한다.

Run: `npm run dev`

확인 항목:
- 간편/표준/전문가 전환 시 필드 노출이 바뀌고, 되돌려도 값이 보존되는가
- 6개 섹션이 모두 펼쳐지고 값 변경이 우측 대시보드에 즉시 반영되는가
- 기본값과 다른 값에 "사용자 설정" 배지가 붙는가
- 섹션의 [AI 추천] 버튼이 동작하고, 개선안이 없으면 "이미 최적"으로 비활성화되는가
- 배우자를 켜면 결과가 바뀌고, 끄면 원래대로 돌아오는가
- 의료비를 켜면 자산 곡선이 더 빨리 내려가는가

- [ ] **Step 13: 커밋**

```bash
git add -A
git commit -m "feat: 고급 설정 섹션과 세법 버전 구조 추가, 구 설정 컴포넌트 제거

taxRates.ts에 흩어져 있던 세율·한도 상수를 TaxLawProfile로 묶어 세법 버전
분기 구조를 만든다. 값 변경은 없으며 기존 export 이름도 유지해 외부 import가
깨지지 않는다. 'planned'(예정 법령) 프로필은 의도적으로 비워 두었다 —
확정된 개정안이 없는 상태에서 허구의 숫자를 넣으면 사용자가 그것을 사실로
받아들이기 때문이다.

QuickSettingsSummary / SimulationSettings / TaxSettingsSection 세 컴포넌트를
6개 섹션으로 흡수하고 제거한다. AssetFormSection의 profile 탭에 중복으로
남아 있던 나이·생활비 필드도 정리했다.

좌측 패널이 [내 은퇴 전략 = 6섹션] / [시나리오] / [내 자산] 세 덩어리로
정리되어, 설정 화면이 경제 변수 입력 폼이 아니라 전략 설계 화면이 된다."
```

---

## 완료 기준

- `npm test` 전체 통과, `npx tsc --noEmit` 에러 없음
- `npm run lint`: **베이스라인 대비 증가 없음.** 이 저장소는 작업 시작 시점(커밋 59b558e)에
  이미 137 errors / 74 warnings를 갖고 있다(대부분 루트 스크립트의 `require()` 스타일 import).
  "lint 에러 0"은 달성 불가능한 기준이므로, 판정은 `npm run lint` 총계가 137 errors를
  넘지 않고 경고도 74건에서 늘지 않았는지로 한다. 새로 만든 파일에 대해서는
  `npx eslint <새 파일들>`이 완전히 깨끗해야 한다.
- `grep -rn "QuickSettingsSummary\|SimulationSettings\|TaxSettingsSection" src/` 결과 없음
- 새 코드에 `any` 없음: `grep -rn ": any\|as any" src/web/features/StrategySettings src/web/components/form src/core/usecases/strategy src/core/usecases/spouse src/core/usecases/healthcare` 결과 없음
- 전략 기능을 모두 끈 상태(`strategy`/`spouse`/`healthcare` 미설정)에서 시뮬레이션 결과가 작업 시작 전과 동일
