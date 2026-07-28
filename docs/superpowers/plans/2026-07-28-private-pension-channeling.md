# 사적연금 조기수령 채널링(Phase 4) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사적연금을 55세부터 조기 수령해 저율과세 한도 내에서 ISA로 재투자하고, 신규 연금계좌를 개설해 퇴직 전까지 세액공제 한도만큼 납입하는 전략을 `RecommendationEngine`이 Phase 4로 자동 탐색·추천하게 만든다.

**Architecture:** `SimulationEngine`에 "55세~retirementAge 브릿지 구간" 전용 인출 분기를 하나 추가하고(기존 은퇴 후 인출 경로는 변경 없음), Phase 3(`DividendReinvestmentOptimizer`)와 동일한 패턴의 신규 파일 `PrivatePensionChannelingOptimizer.ts`가 이 분기를 켠 candidate params로 1회 재시뮬레이션해 유불리를 판단한다. `RecommendationEngine.recommendStrategy()`는 Phase 3 직후 이 옵티마이저를 호출해 결과를 기존 필드에 병합한다.

**Tech Stack:** TypeScript(strict), Vitest, 기존 Clean Architecture 계층 구조(`src/core/entities`, `src/core/usecases`) 그대로 사용.

## Global Constraints

- 설계 문서: `docs/superpowers/specs/2026-07-28-private-pension-channeling-design.md` (사용자 승인 완료)
- `any` 사용 금지, `strict: true` 유지
- 브릿지 인출 월 한도 = `(currentTaxSettings.privatePensionLimit ?? 15000000) / 12` (KRW 기준, 계좌 통화가 다르면 `convertValue`로 환산)
- 신규 연금 계좌 월 납입액은 고정 750,000원(연 900만원)
- 신규 연금 계좌의 `annualReturn`/`investmentType`/`dividendYield`/`currency`는 `params.privatePensions[0]`을 그대로 복사
- 전제 조건(사적연금 ≥ 1, ISA ≥ 1, `retirementAge > 55`) 불충족 시 candidate 생성 자체를 생략(추가 시뮬레이션 0회)
- 계좌별 조합 탐색은 하지 않는다 — 단일 통합 on/off 전략 1회 시뮬레이션만 추가한다
- 커밋은 각 Task 완료 시마다 별도로 생성한다(한국어 커밋 메시지)

## 설계 문서와 다른 구현 세부사항 (투명성을 위한 기록)

설계 문서는 "SimulationParams에 옵션 필드로 추가"라고 서술했지만, 실제 구현에서는 **`PrivatePension.earlyChannelingEnabled?: boolean`** (계좌별 필드, `InvestmentAsset.reinvestDividend`와 동일한 패턴)로 구현한다. 이유: 신규로 합성되는 연금 계좌를 조기 인출 대상에서 자동으로 제외해야 하는데, 전역 플래그로는 "기존 계좌만" 대상으로 삼기 위해 별도의 ID 추적 메커니즘이 필요해진다. 계좌별 필드를 쓰면 옵티마이저가 신규 계좌에는 이 필드를 아예 설정하지 않는 것만으로 자연스럽게 제외된다. **동작(기존 계좌 전부 대상, 신규 계좌 제외)은 스펙과 동일하며, 표현 위치만 다르다.**

---

### Task 1: 사적연금 브릿지 조기인출 — SimulationEngine

**Files:**
- Modify: `src/core/entities/types.ts` (`PrivatePension` 인터페이스, 41~52번째 줄 부근)
- Modify: `src/core/usecases/SimulationEngine.ts` (Pensions Processing 블록, 459~516번째 줄 부근)
- Test: `src/tests/core/usecases/SimulationEngine.privatePensionBridgeChanneling.test.ts` (신규)

**Interfaces:**
- Produces: `PrivatePension.earlyChannelingEnabled?: boolean` — 이 계좌를 55세부터 브릿지 채널링 대상으로 삼을지 여부(신규 필드). `SimulationEngine`이 소비하며, Task 2의 `PrivatePensionChannelingOptimizer`가 candidate params를 만들 때 이 필드를 설정한다.
- 동작 규약: `!isRetired && currentAge >= 55(PRIVATE_PENSION_MIN_START_AGE) && pension.earlyChannelingEnabled && pension.currentBalance > 0`이면, 그 달 `min(잔액, (privatePensionLimit ?? 15000000)/12를 계좌 간 공유하는 잔여한도)`만큼 인출해 세후 순액을 `activeIsas[0]`(있을 때만)의 `currentBalance`/`totalInvested`에 더한다. `retirementAge` 이후에는 이 분기가 아니라 기존 `isRetired` 분기가 그대로 적용된다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/core/usecases/SimulationEngine.privatePensionBridgeChanneling.test.ts` 파일을 새로 만든다:

```ts
import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

describe('SimulationEngine 사적연금 브릿지 조기인출(Phase 4)', () => {
  const baseParams: SimulationParams = {
    userProfile: {
      currentAge: 50,
      retirementAge: 60,
      expectancy: 55,
      targetMonthlySpending: 0,
    },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [
      {
        id: 'p1',
        type: 'irp',
        balance: 100000000,
        monthlyContribution: 0,
        annualReturn: 0,
        currency: 'KRW',
        earlyChannelingEnabled: true,
      },
    ],
    isaAccounts: [
      {
        id: 'isa1',
        type: 'general',
        balance: 0,
        monthlyContribution: 0,
        annualReturn: 0,
        dividendYield: 0,
        currency: 'KRW',
        maturityYears: 99, // 테스트 기간 내 만기가 발생하지 않도록 충분히 길게 설정
      },
    ],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };

  test('55세 미만에는 브릿지 조기인출이 발동하지 않아 사적연금 잔액이 그대로 유지된다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({ ...baseParams, userProfile: { ...baseParams.userProfile, expectancy: 54 } });

    const at54 = result.yearlyResults.find((r) => r.age === 54);
    expect(at54!.pensionAssets).toBeCloseTo(100000000, 2);
  });

  test('55세부터 저율과세 한도(연 1500만원)만큼 조기 인출되어 사적연금 잔액이 감소한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams); // expectancy: 55

    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55!.pensionAssets).toBeCloseTo(100000000 - 15000000, 2);
  });

  test('인출된 순액(세후)만큼만 총자산이 줄어든다(나머지는 ISA로 이동해 총자산에는 그대로 남음)', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams); // expectancy: 55

    const at54 = result.yearlyResults.find((r) => r.age === 54);
    const at55 = result.yearlyResults.find((r) => r.age === 55);
    const expectedTax = 15000000 * 0.055; // 55세 세율 5.5%(PRIVATE_PENSION_TAX_BRACKETS)
    expect(at54!.totalAssets - at55!.totalAssets).toBeCloseTo(expectedTax, 2);
  });

  test('브릿지 구간에서는 privatePensionIncome(생활비 소득)에 반영되지 않는다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams); // expectancy: 55

    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55!.privatePensionIncome).toBe(0);
  });

  test('retirementAge 이후에는 기존 인출 로직으로 복귀해 privatePensionIncome에 반영된다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({ ...baseParams, userProfile: { ...baseParams.userProfile, expectancy: 60 } });

    const at59 = result.yearlyResults.find((r) => r.age === 59);
    const at60 = result.yearlyResults.find((r) => r.age === 60);
    expect(at59!.privatePensionIncome).toBe(0); // 아직 브릿지 구간(재직 중)
    expect(at60!.privatePensionIncome).toBeGreaterThan(0); // retirementAge 도달, 기존 로직으로 복귀
  });

  test('earlyChannelingEnabled가 없으면(기본값) 55세가 지나도 조기인출이 발동하지 않는다', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [{ ...baseParams.privatePensions[0], earlyChannelingEnabled: undefined }],
    };
    const result = engine.run(params);

    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55!.pensionAssets).toBeCloseTo(100000000, 2);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.privatePensionBridgeChanneling.test.ts`
Expected: FAIL — `earlyChannelingEnabled` 타입 오류(아직 `PrivatePension`에 없음) 및 로직 미구현으로 잔액/총자산 관련 assertion 실패.

- [ ] **Step 3: `PrivatePension`에 `earlyChannelingEnabled` 필드 추가**

`src/core/entities/types.ts`에서 `PrivatePension` 인터페이스를 수정한다:

```ts
export interface PrivatePension {
  id: string;
  type: PrivatePensionType;
  investmentType?: AccountInvestmentType;
  ticker?: string;
  name?: string;
  balance: number;
  monthlyContribution: number;
  annualReturn: number; // % 단위 (ETF인 경우 연 성장률로 사용)
  dividendYield?: number; // % 단위 (ETF인 경우 연 배당률)
  currency: AssetCurrency;
  // 사적연금 조기수령 채널링(Phase 4) 전용 내부 필드. true면 55세(PRIVATE_PENSION_MIN_START_AGE)부터
  // retirementAge 이전(재직 중)에도 저율과세 한도 내에서 조기 인출해 ISA로 재투자한다. AI 추천
  // 엔진(PrivatePensionChannelingOptimizer)만 설정하며, 사용자가 직접 켜는 입력 폼 필드가 아니다.
  earlyChannelingEnabled?: boolean;
}
```

- [ ] **Step 4: SimulationEngine에 브릿지 인출 분기 추가**

`src/core/usecases/SimulationEngine.ts`의 Pensions Processing 블록(기존 459~516번째 줄)을 다음으로 교체한다:

```ts
        // Pensions Processing
        let monthlyPensionIncomeNetDisplay = 0;
        let monthlyPensionPreTaxLimitRemainingKRW = (currentTaxSettings.privatePensionLimit ?? 15000000) / 12;
        // privatePensionMonthlyTarget은 계좌 개별이 아닌 "전체 사적연금 계좌 합산" 목표액이다.
        // 계좌를 순서대로 처리하며 이 잔여 목표액만큼만 인출하도록 공유 상태로 관리한다.
        let remainingMonthlyPensionTargetKRW = withdrawalPlan?.privatePensionMonthlyTarget;
        // 사적연금 조기수령 채널링(Phase 4)의 월별 저율과세 한도. 여러 계좌가 earlyChannelingEnabled면
        // 위 monthlyPensionPreTaxLimitRemainingKRW와 별개로 이 잔여한도를 계좌 간에 공유한다 — 두
        // 한도는 서로 다른 인출 경로(은퇴 후 정상 인출 vs 브릿지 조기 인출)라 섞이면 안 된다.
        let remainingBridgeLimitKRW = (currentTaxSettings.privatePensionLimit ?? 15000000) / 12;

        activePensions.forEach((pension) => {
          if (pension.currentBalance < 0) pension.currentBalance = 0;
          const growth = pension.currentBalance * pension.returnRateMonthly;
          const contribution = isRetired ? 0 : pension.monthlyContribution;
          pension.currentBalance += growth + contribution;

          if (isRetired && pension.currentBalance > 0) {
            let drawAmountRaw = 0;
            // 사용자가 개별 조정할 수 있는 필드가 아니라 항상 이 식이다 — computeExecutionRoadmap.ts의
            // 로드맵 이벤트 나이 계산과 동일해야 한다.
            const planStartAge = clampPrivatePensionStartAge(userProfile.retirementAge);
            const pensionWithdrawalsStarted = currentAge >= planStartAge;

            if (pensionWithdrawalsStarted) {
              if (remainingMonthlyPensionTargetKRW !== undefined) {
                const targetInPensionCurrency = this.convertValue(
                  Math.max(0, remainingMonthlyPensionTargetKRW), 'KRW', pension.currency, exchangeRate
                );
                drawAmountRaw = Math.min(pension.currentBalance, targetInPensionCurrency);
                remainingMonthlyPensionTargetKRW -= this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
              } else if (spendingStrategy === 'dividend_only' || spendingStrategy === 'max_sustainable') {
                drawAmountRaw = Math.max(0, growth);
              } else {
                const remainingMonths = Math.max(1, (endAge - currentAge) * 12 + (12 - m));
                drawAmountRaw = pension.currentBalance / remainingMonths;
              }
            }

            if (currentTaxSettings.limitPrivatePensionToTaxLimit) {
              const remainingLimitInPensionCurrency = this.convertValue(monthlyPensionPreTaxLimitRemainingKRW, 'KRW', pension.currency, exchangeRate);
              drawAmountRaw = Math.min(drawAmountRaw, Math.max(0, remainingLimitInPensionCurrency));
              monthlyPensionPreTaxLimitRemainingKRW -= this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
            }

            pension.currentBalance -= drawAmountRaw;

            // pensionWithdrawalsStarted가 false면 drawAmountRaw는 항상 0이라 세율 값 자체는 결과에
            // 영향을 주지 않지만, getPrivatePensionIncomeTaxRate는 "55세 미만으로 호출되지 않는다"는
            // 불변식을 전제하므로(taxRates.ts 주석 참고) 그 불변식을 실제로 지키기 위해 게이트를 건다.
            const taxRate = pensionWithdrawalsStarted ? getPrivatePensionIncomeTaxRate(currentAge) : 0;

            const drawAmountTax = drawAmountRaw * taxRate;
            const drawAmountNet = drawAmountRaw - drawAmountTax;

            monthlyPensionIncomeNetDisplay += this.convertValue(drawAmountNet, pension.currency, displayCurrency, exchangeRate);
            annualPensionTaxPaid += this.convertValue(drawAmountTax, pension.currency, displayCurrency, exchangeRate);
            annualPreTaxTotalIncome += this.convertValue(drawAmountRaw, pension.currency, displayCurrency, exchangeRate);
            annualPrivatePensionPreTaxKRW += this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
          } else if (
            !isRetired &&
            currentAge >= PRIVATE_PENSION_MIN_START_AGE &&
            pension.earlyChannelingEnabled &&
            pension.currentBalance > 0
          ) {
            // 사적연금 조기수령 채널링(Phase 4): 은퇴 전(재직 중)이라도 55세부터 저율과세 한도
            // 내에서 조기 인출해 ISA로 재투자한다. 생활비 재원이 아니므로 monthlyPensionIncomeNetDisplay/
            // annualPrivatePensionIncome(소득 표시용 필드)에는 더하지 않는다 — 재직 중이라 생활비는
            // 이 시뮬레이터가 모델링하지 않는 근로소득으로 충당된다고 가정한다.
            const limitInPensionCurrency = this.convertValue(
              Math.max(0, remainingBridgeLimitKRW), 'KRW', pension.currency, exchangeRate
            );
            const drawAmountRaw = Math.min(pension.currentBalance, limitInPensionCurrency);
            remainingBridgeLimitKRW -= this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
            pension.currentBalance -= drawAmountRaw;

            const taxRate = getPrivatePensionIncomeTaxRate(currentAge);
            const drawAmountTax = drawAmountRaw * taxRate;
            const drawAmountNet = drawAmountRaw - drawAmountTax;

            if (activeIsas.length > 0) {
              const netInIsaCurrency = this.convertValue(drawAmountNet, pension.currency, activeIsas[0].currency, exchangeRate);
              activeIsas[0].currentBalance += netInIsaCurrency;
              activeIsas[0].totalInvested += netInIsaCurrency;
            }

            annualPensionTaxPaid += this.convertValue(drawAmountTax, pension.currency, displayCurrency, exchangeRate);
            annualPreTaxTotalIncome += this.convertValue(drawAmountRaw, pension.currency, displayCurrency, exchangeRate);
            annualPrivatePensionPreTaxKRW += this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
          }
        });
        annualPrivatePensionIncome += monthlyPensionIncomeNetDisplay;
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.privatePensionBridgeChanneling.test.ts`
Expected: PASS (6개 테스트 모두)

- [ ] **Step 6: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/core/entities/types.ts src/core/usecases/SimulationEngine.ts src/tests/core/usecases/SimulationEngine.privatePensionBridgeChanneling.test.ts
git commit -m "$(cat <<'EOF'
feat: 사적연금 55세 브릿지 조기인출(Phase 4) 엔진 로직 추가

PrivatePension.earlyChannelingEnabled가 켜진 계좌는 은퇴 전(재직 중)이라도
55세부터 저율과세 한도(연 1500만원) 내에서 조기 인출해 ISA로 재투자한다.
retirementAge 이후에는 기존 은퇴 후 인출 로직이 그대로 적용된다.
EOF
)"
```

---

### Task 2: PrivatePensionChannelingOptimizer 신규 모듈

**Files:**
- Create: `src/core/usecases/strategy/PrivatePensionChannelingOptimizer.ts`
- Test: `src/tests/core/usecases/strategy/PrivatePensionChannelingOptimizer.test.ts` (신규)

**Interfaces:**
- Consumes: Task 1의 `PrivatePension.earlyChannelingEnabled?: boolean`, 기존 `SimulationEngine.runForUtility(params): SimulationResult`, `computeLifetimeUtility(result, params, cfg): UtilityBreakdown`, `computeDeltas(baseline, recommended): StrategyRecommendation['deltas']` (`./deltas`에서 import).
- Produces:
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
    failed: boolean;
  }
  ```
  Task 3가 이 반환 타입의 필드명을 그대로 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/core/usecases/strategy/PrivatePensionChannelingOptimizer.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
import { optimizePrivatePensionChanneling } from '@/core/usecases/strategy/PrivatePensionChannelingOptimizer';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { DomainError } from '@/core/entities/errors';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { SimulationParams, SimulationResult, UtilityBreakdown } from '@/core/entities/types';

vi.mock('@/core/usecases/utility/UtilityEngine', () => ({
  computeLifetimeUtility: vi.fn((result: SimulationResult) => ({
    score: result.retirementScore,
    components: { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 },
  })),
}));

const zeroComponents = { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 };

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  isaAccounts: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

function makePension(overrides: Partial<SimulationParams['privatePensions'][number]> = {}) {
  return {
    id: 'p1',
    type: 'irp' as const,
    investmentType: 'deposit' as const,
    balance: 100000000,
    monthlyContribution: 0,
    annualReturn: 4,
    dividendYield: 0,
    currency: 'KRW' as const,
    ...overrides,
  };
}

function makeIsa(overrides: Partial<NonNullable<SimulationParams['isaAccounts']>[number]> = {}) {
  return {
    id: 'isa1',
    type: 'general' as const,
    balance: 0,
    monthlyContribution: 0,
    annualReturn: 5,
    dividendYield: 2,
    currency: 'KRW' as const,
    maturityYears: 3,
    ...overrides,
  };
}

function makeResult(retirementScore: number): SimulationResult {
  return {
    yearlyResults: [],
    fireAge: null,
    depletionAge: null,
    endingAssets: 0,
    retirementScore,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

const bestUtility: UtilityBreakdown = { score: 70, components: zeroComponents };
const bestResult = makeResult(70);

describe('optimizePrivatePensionChanneling', () => {
  test('사적연금이 없으면 no-op을 반환하고 시뮬레이션을 전혀 실행하지 않는다', () => {
    const runForUtility = vi.fn();
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = { ...baseParams, privatePensions: [], isaAccounts: [makeIsa()] };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.itemizedContribution).toBeNull();
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
    expect(runForUtility).not.toHaveBeenCalled();
  });

  test('ISA 계좌가 없으면 no-op을 반환한다', () => {
    const runForUtility = vi.fn();
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = { ...baseParams, privatePensions: [makePension()], isaAccounts: [] };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(runForUtility).not.toHaveBeenCalled();
  });

  test('retirementAge가 55 이하이면(브릿지 구간 없음) no-op을 반환한다', () => {
    const runForUtility = vi.fn();
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = {
      ...baseParams,
      userProfile: { ...baseParams.userProfile, retirementAge: 55 },
      privatePensions: [makePension()],
      isaAccounts: [makeIsa()],
    };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(runForUtility).not.toHaveBeenCalled();
  });

  test('전제 조건을 충족하고 개선되지 않으면 no-op을 반환하며 시뮬레이션은 1회만 실행한다', () => {
    const runForUtility = vi.fn(() => makeResult(65));
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = { ...baseParams, privatePensions: [makePension()], isaAccounts: [makeIsa()] };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.itemizedContribution).toBeNull();
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
    expect(runForUtility).toHaveBeenCalledTimes(1);
  });

  test('전제 조건을 충족하고 개선되면 채택하고, candidate params에 기존 계좌 채널링+신규 계좌가 반영된다', () => {
    const improvedResult = makeResult(80);
    const runForUtility = vi.fn(() => improvedResult);
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = {
      ...baseParams,
      privatePensions: [makePension({ id: 'existing-1', annualReturn: 3, investmentType: 'etf' as const, dividendYield: 1 })],
      isaAccounts: [makeIsa()],
    };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBe(true);
    expect(result.finalResult).toBe(improvedResult);
    expect(result.finalUtility.score).toBe(80);
    expect(result.itemizedContribution).not.toBeNull();
    expect(result.itemizedContribution!.utilityDelta).toBe(10);
    expect(runForUtility).toHaveBeenCalledTimes(1);

    const candidateParams = runForUtility.mock.calls[0][0] as SimulationParams;
    expect(candidateParams.privatePensions).toHaveLength(2);
    const existing = candidateParams.privatePensions.find((p) => p.id === 'existing-1');
    expect(existing?.earlyChannelingEnabled).toBe(true);
    const added = candidateParams.privatePensions.find((p) => p.id !== 'existing-1');
    expect(added?.monthlyContribution).toBe(750000);
    expect(added?.earlyChannelingEnabled).toBeFalsy();
    // 신규 계좌는 기존 첫 번째 계좌의 수익률/투자종류를 그대로 복사한다
    expect(added?.annualReturn).toBe(3);
    expect(added?.investmentType).toBe('etf');
    expect(added?.dividendYield).toBe(1);
  });

  test('시뮬레이션 중 DomainError가 발생하면 no-op을 반환하고 failed를 true로 표시한다', () => {
    const runForUtility = vi.fn(() => {
      throw new DomainError('평가 실패');
    });
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = { ...baseParams, privatePensions: [makePension()], isaAccounts: [makeIsa()] };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
    expect(result.failed).toBe(true);
  });

  test('DomainError가 아닌 예외는 그대로 다시 던진다', () => {
    const runForUtility = vi.fn(() => {
      throw new Error('예상치 못한 버그');
    });
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = { ...baseParams, privatePensions: [makePension()], isaAccounts: [makeIsa()] };

    expect(() =>
      optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG)
    ).toThrow('예상치 못한 버그');
  });
});
```

`DomainError`가 `src/core/entities/errors.ts`에 이미 존재하는지 먼저 확인한다:

Run: `grep -n "class DomainError" src/core/entities/errors.ts`
Expected: 클래스 정의가 출력됨(Phase 3의 `DividendReinvestmentOptimizer.ts`가 이미 이 클래스를 사용하므로 존재해야 한다).

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/PrivatePensionChannelingOptimizer.test.ts`
Expected: FAIL — 모듈이 존재하지 않아 import 에러.

- [ ] **Step 3: `PrivatePensionChannelingOptimizer.ts` 구현**

```ts
import {
  ItemizedContribution,
  PrivatePension,
  SimulationParams,
  SimulationResult,
  UtilityBreakdown,
  UtilityConfig,
} from '../../entities/types';
import { DomainError } from '../../entities/errors';
import { SimulationEngine } from '../SimulationEngine';
import { computeLifetimeUtility } from '../utility/UtilityEngine';
import { PRIVATE_PENSION_MIN_START_AGE } from '../pension/privatePensionRules';
import { computeDeltas } from './deltas';

const NEW_PENSION_MONTHLY_CONTRIBUTION = 750000; // 연 900만원 세액공제 한도
const NEW_PENSION_ID = 'phase4-new-private-pension';

export interface PrivatePensionChannelingResult {
  recommendedPrivatePensionChanneling: boolean | null;
  itemizedContribution: ItemizedContribution | null;
  finalResult: SimulationResult;
  finalUtility: UtilityBreakdown;
  failed: boolean;
}

function noOp(bestResult: SimulationResult, bestUtility: UtilityBreakdown, failed = false): PrivatePensionChannelingResult {
  return {
    recommendedPrivatePensionChanneling: null,
    itemizedContribution: null,
    finalResult: bestResult,
    finalUtility: bestUtility,
    failed,
  };
}

function buildNewPension(templatePension: PrivatePension): PrivatePension {
  return {
    id: NEW_PENSION_ID,
    type: 'irp',
    investmentType: templatePension.investmentType,
    annualReturn: templatePension.annualReturn,
    dividendYield: templatePension.dividendYield,
    balance: 0,
    monthlyContribution: NEW_PENSION_MONTHLY_CONTRIBUTION,
    currency: templatePension.currency,
  };
}

// Phase 1~3 최적 결과(bestResult/bestUtility) 대비, 사적연금을 55세부터 조기 수령해 ISA로
// 재투자하고 신규 연금 계좌를 하나 더 열어 retirementAge까지 납입하는 전략을 켰을 때 더 유리한지
// 단 1회 재시뮬레이션으로 판단한다. 계좌별 조합 탐색은 하지 않는다 — 기존 사적연금 계좌 전부를
// 한꺼번에 채널링 대상으로 켜는 단일 통합 on/off 전략이다.
export function optimizePrivatePensionChanneling(
  params: SimulationParams,
  bestResult: SimulationResult,
  bestUtility: UtilityBreakdown,
  engine: SimulationEngine,
  cfg: UtilityConfig
): PrivatePensionChannelingResult {
  const hasPension = params.privatePensions.length > 0;
  const hasIsa = (params.isaAccounts?.length ?? 0) > 0;
  const hasBridgeWindow = params.userProfile.retirementAge > PRIVATE_PENSION_MIN_START_AGE;

  if (!hasPension || !hasIsa || !hasBridgeWindow) return noOp(bestResult, bestUtility);

  const candidateParams: SimulationParams = {
    ...params,
    privatePensions: [
      ...params.privatePensions.map((p) => ({ ...p, earlyChannelingEnabled: true })),
      buildNewPension(params.privatePensions[0]),
    ],
  };

  try {
    const candidateResult = engine.runForUtility(candidateParams);
    const candidateUtility = computeLifetimeUtility(candidateResult, candidateParams, cfg);

    if (candidateUtility.score <= bestUtility.score) return noOp(bestResult, bestUtility);

    return {
      recommendedPrivatePensionChanneling: true,
      itemizedContribution: {
        label: '사적연금을 55세부터 조기 수령해 ISA에 재투자하고, 신규 연금 계좌를 개설해 퇴직 전까지 납입합니다.',
        utilityDelta: candidateUtility.score - bestUtility.score,
        deltas: computeDeltas(bestResult, candidateResult),
      },
      finalResult: candidateResult,
      finalUtility: candidateUtility,
      failed: false,
    };
  } catch (err) {
    if (err instanceof DomainError) {
      console.warn('Skipping private pension channeling candidate that failed to simulate', err);
      return noOp(bestResult, bestUtility, true);
    }
    throw err;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/PrivatePensionChannelingOptimizer.test.ts`
Expected: PASS (7개 테스트 모두)

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/core/usecases/strategy/PrivatePensionChannelingOptimizer.ts src/tests/core/usecases/strategy/PrivatePensionChannelingOptimizer.test.ts
git commit -m "$(cat <<'EOF'
feat: PrivatePensionChannelingOptimizer(Phase 4) 신규 모듈 추가

기존 사적연금 전체를 55세 조기수령+ISA재투자로 전환하고 신규 연금계좌를
추가하는 단일 통합 전략을 1회 시뮬레이션으로 평가한다. Phase 3
(DividendReinvestmentOptimizer)와 동일한 패턴을 따르되, 계좌별 조합
탐색 없이 하나의 on/off 후보로 단순화했다.
EOF
)"
```

---

### Task 3: RecommendationEngine 통합

**Files:**
- Modify: `src/core/entities/types.ts` (`StrategyRecommendation` 인터페이스, 228~267번째 줄 부근)
- Modify: `src/core/usecases/strategy/RecommendationEngine.ts` (import 및 `recommendStrategy` 함수 끝부분, 363~408번째 줄 부근)
- Test: `src/tests/core/usecases/strategy/RecommendationEngine.test.ts` (기존 파일에 새 `describe` 블록 추가)

**Interfaces:**
- Consumes: Task 2의 `optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, cfg): PrivatePensionChannelingResult` (필드: `recommendedPrivatePensionChanneling`, `itemizedContribution`, `finalResult`, `finalUtility`, `failed`).
- Produces: `StrategyRecommendation.recommendedPrivatePensionChanneling: boolean | null` — Dashboard/PDF 등 이후 소비처가 이 필드로 Phase 4 채택 여부를 읽는다(이번 계획 범위 밖의 UI 연동에서 사용).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/tests/core/usecases/strategy/RecommendationEngine.test.ts` 끝에 다음 `describe` 블록을 추가한다(파일 상단의 기존 `paramsWithLargePension`을 재사용):

```ts
describe('recommendStrategy - Phase 4 사적연금 채널링 통합', () => {
  test('ISA 계좌가 없으면 recommendedPrivatePensionChanneling은 null이다', () => {
    const engine = new SimulationEngine();
    const result = recommendStrategy(paramsWithLargePension, engine);
    expect(result.recommendedPrivatePensionChanneling).toBeNull();
  });

  test('사적연금+ISA가 있고 브릿지 구간이 존재하면 유리할 때 채택되고 itemizedContributions/reasons에 반영된다', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...paramsWithLargePension,
      userProfile: { ...paramsWithLargePension.userProfile, currentAge: 50, retirementAge: 60, expectancy: 90 },
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 600000000, monthlyContribution: 0, annualReturn: 2, currency: 'KRW' },
      ],
      isaAccounts: [
        { id: 'isa-1', type: 'general', balance: 10000000, monthlyContribution: 0, annualReturn: 6, dividendYield: 0, currency: 'KRW', maturityYears: 99 },
      ],
    };

    const result = recommendStrategy(params, engine);

    // ISA 수익률(6%)이 사적연금 수익률(2%)보다 높은 시나리오라 채널링이 유리해야 한다.
    // 만약 이 assertion이 실패하면(유리하지 않다고 나오면) annualReturn 격차를 더 벌려서
    // 결정론적으로 채택되는 시나리오를 다시 찾는다 — 실제 엔진 기반 통합 테스트이므로 근사치가
    // 아니라 실제 계산 결과에 의존한다.
    expect(result.recommendedPrivatePensionChanneling).toBe(true);
    expect(result.itemizedContributions.some((c) => c.label.includes('사적연금을 55세부터'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('사적연금을 55세부터'))).toBe(true);
    expect(result.recommendedUtility.score).toBeGreaterThan(result.currentUtility.score);
  });

  test('retirementAge가 55 이하이면 채널링 후보 자체가 생성되지 않는다', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...paramsWithLargePension,
      userProfile: { ...paramsWithLargePension.userProfile, currentAge: 50, retirementAge: 55, expectancy: 90 },
      isaAccounts: [
        { id: 'isa-1', type: 'general', balance: 10000000, monthlyContribution: 0, annualReturn: 6, dividendYield: 0, currency: 'KRW', maturityYears: 99 },
      ],
    };

    const result = recommendStrategy(params, engine);
    expect(result.recommendedPrivatePensionChanneling).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/RecommendationEngine.test.ts -t "Phase 4"`
Expected: FAIL — `recommendedPrivatePensionChanneling`가 `StrategyRecommendation`에 없어 타입 에러, 런타임에는 `undefined`.

- [ ] **Step 3: `StrategyRecommendation`에 필드 추가**

`src/core/entities/types.ts`의 `StrategyRecommendation` 인터페이스에서 `recommendedAssetReinvestment` 필드 바로 아래에 추가한다:

```ts
  recommendedAssetReinvestment: Record<string, boolean> | null;
  // 사적연금 조기수령 채널링(Phase 4) 권장 여부. 전제 조건(사적연금/ISA 존재, retirementAge>55)
  // 불충족이거나 개선이 없으면 null. recommendedPlan/recommendedAssetReinvestment와 마찬가지로
  // 독립된 축(축적기 파라미터 중에서도 은퇴 전 인출이라는 새로운 층위)이다.
  recommendedPrivatePensionChanneling: boolean | null;
```

- [ ] **Step 4: RecommendationEngine에 Phase 4 배선**

`src/core/usecases/strategy/RecommendationEngine.ts` 상단 import에 한 줄 추가:

```ts
import { optimizeDividendReinvestment } from './DividendReinvestmentOptimizer';
import { optimizePrivatePensionChanneling } from './PrivatePensionChannelingOptimizer';
```

`recommendStrategy` 함수의 기존 마지막 블록(363~408번째 줄, Phase 3 통합 부분)을 다음으로 교체한다:

```ts
  // Phase 3: 배당 재투자 최적화 (신규). Phase 1+2 결과 위에서 자산별 reinvestDividend를
  // 독립 평가(O(N)) + 통합 검증한다. WithdrawalPlan(bestPlan)과는 다른 축(축적기 파라미터)이라
  // bestPlan 자체는 바꾸지 않고, 최종 결과와 추가 itemized 항목/reasons만 병합한다.
  const reinvestOpt = optimizeDividendReinvestment(params, bestPlan, bestResult, bestUtility, engine, cfg);
  const additionalItemizedContributions: ItemizedContribution[] = reinvestOpt.perAssetResults.map((r) => ({
    label: r.flippedValue
      ? `"${r.assetName}"의 배당을 재투자로 전환합니다.`
      : `"${r.assetName}"의 배당 재투자를 중단하고 현금으로 인출합니다.`,
    utilityDelta: r.utilityDelta,
    deltas: r.deltas,
  }));

  // Phase 4: 사적연금 조기수령 채널링 (신규). Phase 1+2+3 최종 결과(reinvestOpt.finalResult/
  // finalUtility) 위에서 평가한다. paramsAfterPhase3는 Phase 3까지의 결정(인출계획 + 자산별
  // reinvestDividend)을 반영한 params로, PrivatePensionChannelingOptimizer가 이 위에 사적연금
  // 채널링+신규 계좌를 얹은 candidate를 만든다.
  const paramsAfterPhase3: SimulationParams = {
    ...params,
    withdrawalPlan: bestPlan ?? identityPlan,
    assets: reinvestOpt.recommendedAssetReinvestment
      ? params.assets.map((a) =>
          a.id in reinvestOpt.recommendedAssetReinvestment!
            ? { ...a, reinvestDividend: reinvestOpt.recommendedAssetReinvestment![a.id] }
            : a
        )
      : params.assets,
  };
  const channelingOpt = optimizePrivatePensionChanneling(
    paramsAfterPhase3,
    reinvestOpt.finalResult,
    reinvestOpt.finalUtility,
    engine,
    cfg
  );
  if (channelingOpt.itemizedContribution) {
    additionalItemizedContributions.push(channelingOpt.itemizedContribution);
  }
  const additionalReasons = additionalItemizedContributions.map((c) => c.label);

  // withdrawalPlanImproved면 기존 reasons 뒤에 자연스럽게 이어붙이고, WithdrawalPlan 차원에서는
  // 개선이 없었는데 Phase 3/4만 개선을 찾았다면 "개선 없음" 문구(baseReasons) 대신 그 문구만
  // 보여준다(둘 다 없으면 기존 baseReasons의 "개선 없음" 문구를 그대로 유지).
  const reasons = withdrawalPlanImproved
    ? [...baseReasons, ...additionalReasons]
    : additionalReasons.length > 0
      ? additionalReasons
      : baseReasons;
  const itemizedContributions = [...withdrawalItemizedContributions, ...additionalItemizedContributions];
  const improved = channelingOpt.finalUtility.score > currentUtility.score;
  const deltas = computeDeltas(baselineResult, channelingOpt.finalResult);

  // Phase 3/4의 시도량/실패량을 후보 통계에 합산해 AI advisor(계산 실패 감지)까지 흐르게 한다.
  // params.assets.length는 Phase 3가 시도한 작업량의 근사치이고, Phase 4는 최대 1회 시도이므로
  // +1을 더한다 — 둘 다 "얼마나 시도했나"라는 coarse 신호로만 쓰이므로 근사면 충분하다.
  const totalCandidateCount = candidateStats.total + params.assets.length + 1;
  const failedCandidateCount = candidateStats.failed + reinvestOpt.failedAssetCount + (channelingOpt.failed ? 1 : 0);

  return {
    currentUtility,
    recommendedUtility: channelingOpt.finalUtility,
    recommendedPlan: bestPlan,
    recommendedAssetReinvestment: reinvestOpt.recommendedAssetReinvestment,
    recommendedPrivatePensionChanneling: channelingOpt.recommendedPrivatePensionChanneling,
    improved,
    reasons,
    totalCandidateCount,
    failedCandidateCount,
    deltas,
    recommendedResult: channelingOpt.finalResult,
    itemizedContributions,
  };
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/RecommendationEngine.test.ts`
Expected: PASS — 신규 Phase 4 테스트 포함, 기존 테스트도 전부 그대로 통과. `paramsWithLargePension`/`paramsWithAssetsAndIsa`는 `currentAge === retirementAge`(브릿지 구간 없음)라 Phase 4가 항상 no-op이므로 기존 characterization 값에 영향이 없어야 한다.

만약 기존 테스트 중 일부가 예상과 다르게 깨지면(예: `totalCandidateCount` 관련 assertion), 그 테스트가 Phase 4의 +1 카운트를 반영하지 못한 것이므로 실제 새 동작에 맞춰 기댓값을 업데이트한다 — Phase 3 도입 때와 동일한 주의사항이다.

- [ ] **Step 6: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/core/entities/types.ts src/core/usecases/strategy/RecommendationEngine.ts src/tests/core/usecases/strategy/RecommendationEngine.test.ts
git commit -m "$(cat <<'EOF'
feat: RecommendationEngine에 사적연금 채널링 최적화(Phase 4) 통합

Phase 3 최종 결과 위에서 PrivatePensionChannelingOptimizer를 호출해
StrategyRecommendation.recommendedPrivatePensionChanneling으로 노출한다.
recommendedResult/itemizedContributions/reasons도 Phase 4까지 반영한
최종값으로 갱신되어 기존 UI/PDF/AI 어드바이저가 코드 변경 없이 새
추천을 반영한다.
EOF
)"
```

---

### Task 4: 전체 회귀 검증

**Files:** 없음(신규/수정 없음) — 검증 전용 Task.

**Interfaces:** 없음.

- [ ] **Step 1: 전체 테스트 스위트 실행**

Run: `npm test`
Expected: 모든 테스트 파일 PASS (기존 테스트 포함, Phase 4 관련 신규 테스트 포함). `RecommendationEngine.performance.test.ts`의 `worstCaseParams`는 `retirementAge: 61`, `currentAge: 55`, 사적연금+ISA를 모두 가지고 있어 Phase 4 전제 조건을 충족한다 — 즉 이 성능 테스트는 Phase 4의 추가 1회 시뮬레이션 비용을 이미 포함해서 통과해야 한다.

- [ ] **Step 2: 전체 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 성능 회귀 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/RecommendationEngine.performance.test.ts`
Expected: PASS, 5초 이내(기존 예산 그대로 — Phase 4는 216개 후보에 최대 1회만 추가하므로 예산에 미치는 영향은 무시 가능한 수준이어야 한다). 만약 5초를 초과하면 Task 2의 candidate 구성 로직에 불필요한 반복 연산이 없는지 점검한다(예: `buildNewPension`이 매 호출마다 새 객체를 만드는 것은 문제 없음 — 이 함수 자체가 O(1)이어야 한다).

- [ ] **Step 4: lint 확인**

Run: `npx eslint src/core/usecases/strategy/PrivatePensionChannelingOptimizer.ts src/core/usecases/SimulationEngine.ts src/core/usecases/strategy/RecommendationEngine.ts src/core/entities/types.ts`
Expected: 에러 없음

- [ ] **Step 5: 최종 확인 커밋(필요한 경우)**

Step 1~4에서 수정이 발생했다면(예: characterization 테스트 기댓값 업데이트) 그 변경만 별도로 커밋한다:

```bash
git add -A
git commit -m "$(cat <<'EOF'
test: Phase 4 통합에 따른 회귀 테스트 기댓값 정리
EOF
)"
```

Step 1~4에서 아무 수정도 필요 없었다면 이 Task는 커밋 없이 종료한다.

## 참고: 시뮬레이션 모델의 한계 (구현자가 알아야 할 것)

이 시뮬레이터는 은퇴 전(재직 중) 소득/지출이나 소득세(근로소득세) 자체를 모델링하지 않는다. 따라서 신규 연금 계좌의 "세액공제" 혜택(실제 절세 효과)은 이 엔진의 Utility 계산에 직접 반영되지 않는다 — 신규 계좌에 넣는 월 75만원은 "이미 있던 자산을 재배치"하는 것이 아니라 시뮬레이션 관점에서는 새로 투입되는 자금이며, 그 자체만으로도 대체로 Utility를 개선시키는 방향으로 작용한다. 반면 "기존 사적연금을 55세부터 조기 인출해 ISA로 옮기는" 부분은 이미 존재하는 자산의 재배치이므로, 세율/수익률 차이에 따라 유리할 수도 불리할 수도 있는 실제 최적화 대상이다. 두 요소가 하나의 통합 후보로 묶여 있어 개별 기여도를 분리해서 보여주지는 않는다(설계 문서의 "범위 밖" 항목과 일치).
