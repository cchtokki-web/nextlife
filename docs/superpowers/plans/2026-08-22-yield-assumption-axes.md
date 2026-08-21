# 수익률 가정 축 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「리스크 성향」과 「경제 시나리오」가 사용자가 입력한 종목별 수익률을 덮어쓰는 동작을 없애고, 프리셋을 입력 도우미와 민감도·강건성 렌즈로만 남긴다.

**Architecture:** 프리셋 적용 함수(`applyYieldPreset`)는 그대로 두고 **호출부만** 옮긴다 — `compileStrategy`에서 빼고, 입력 도우미·강건성·민감도 셋에서만 부른다. 경제 시나리오는 프로필 타입에서 수익률 필드를 지워 물가·환율만 지배하게 한다. `RiskProfile` 유니온에서 지배하는 세 값을 지우면 기존 저장 데이터는 `asOneOf`의 `undefined` 폴백을 타고 자동으로 `'ai_recommended'`가 된다.

**Tech Stack:** TypeScript, Next.js 16, Vitest 4, React 19

**Spec:** `docs/superpowers/specs/2026-08-22-yield-assumption-axes-design.md`

## Global Constraints

- 수익률 프리셋 값을 바꾸지 않는다: `conservative 5/3`, `base 7/4`, `aggressive 9/6` (`applyYieldPreset.ts:19-23`). 근거가 기록된 적 없는 값이므로 임의 변경 금지.
- 경제 국면의 물가·환율 값을 바꾸지 않는다 (`economicScenarios.ts:33-47`).
- 금액 단위는 원. 수익률 단위는 % (7% → `7`, `0.07` 아님).
- 새 금융 가정·세율·수익률을 만들지 않는다 (AGENTS.md).
- 테스트 실행: `npx vitest run <경로>`. 전체: `npm test`.
- 커밋 메시지는 한국어, 「무엇을 왜」를 적는다. 기존 이력의 관례를 따른다.
- 이 계획은 `develop-2` 브랜치에서 진행한다. HEAD는 `477547d`(스펙 커밋).

---

### Task 0: 진단 도구를 커밋한다

감사 과정에서 만든 하니스와 재현 픽스처를 먼저 커밋한다. Task 8의 검증이 이 하니스를 쓴다.

**Files:**
- Commit: `scripts/harness/ledger.harness.ts` (작업 트리에 이미 있음)
- Commit: `src/tests/fixtures/auditReportCase.json` (작업 트리에 이미 있음)

**Interfaces:**
- Produces: `LEDGER_INPUT` / `HARNESS_OUT` 환경변수로 임의 시나리오 JSON의 연도별 원장·MC·민감도를 뽑는 하니스.

- [ ] **Step 1: 하니스가 도는지 확인**

```bash
LEDGER_INPUT=src/tests/fixtures/auditReportCase.json \
HARNESS_OUT=/tmp/ledger-before \
  npx vitest run --config vitest.harness.config.ts scripts/harness/ledger.harness.ts
```

Expected: PASS. `/tmp/ledger-before/summary.json`이 생긴다.

- [ ] **Step 2: 커밋**

```bash
git add scripts/harness/ledger.harness.ts src/tests/fixtures/auditReportCase.json
git commit -m "test: 시나리오 하나의 연도별 원장을 뽑는 진단 하니스를 추가한다

리포트 숫자가 어느 식에서 나왔는지 대조할 자리가 없었다. 화면의 LedgerDebugPanel은
개발 모드에서 한 해씩만 보여주고, 페르소나 하니스는 54인 집계라 개별 시나리오를
추적할 수 없다.

LEDGER_INPUT으로 임의의 시나리오 JSON을 받아 화면과 같은 파이프라인
(normalize → migrateRetirementGoals → compileStrategy → recommend → applyAiSentinels)을
태운 뒤 연도별 원장·몬테카를로·민감도를 파일로 남긴다. 회귀 테스트가 아니라 분석
도구이므로 vitest.harness.config.ts 아래에 둔다."
```

**주의:** `src/tests/core/usecases/SimulationEngine.auditFindings.test.ts`는 **커밋하지 않는다.** 그 파일은 이 스펙과 무관한 결함 셋(ISA 인출 미등록, 사적연금 저율과세 한도, MC 주변확률 위반)을 고정한 실패 테스트이고, 별도 작업에서 다룬다. 작업 트리에 그대로 둔다.

---

### Task 1: 경제 시나리오에서 수익률 덮어쓰기를 제거한다

**Files:**
- Modify: `src/core/usecases/scenario/economicScenarios.ts:3-12` (타입), `:33-47` (프로필), `:85-105` (적용)
- Test: `src/tests/core/usecases/scenario/economicScenarios.test.ts`

**Interfaces:**
- Produces: `EconomicScenarioProfile { inflationRate: number; exchangeScenario: SimulationParams['exchangeScenario'] }` — `stockGrowthRate`·`pensionReturnRate` 없음.
- Produces: `applyEconomicScenario(params, scenario)` — `assets`·`privatePensions`·`isaAccounts`를 건드리지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/tests/core/usecases/scenario/economicScenarios.test.ts` 끝에 추가:

```ts
describe('경제 시나리오는 수익률을 지배하지 않는다', () => {
  // 물가·환율은 거시 환경이라 서비스가 제시하지만, 수익률은 「내 포트폴리오의 가정」이라
  // 사용자 입력이 유일한 출처다. 예전에는 국면을 고르면 주식·연금·ISA 수익률이 함께
  // 갈렸고, 리스크 성향과 겹쳐 실제로는 아무 효과도 없는 필드였다.
  const params = {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    assets: [{
      id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 100_000_000,
      totalReturn: 9.5, dividendYield: 0.4, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW', assetMarket: 'US_ETF',
    }],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP', balance: 50_000_000,
      monthlyContribution: 0, totalReturn: 6.4, dividendYield: 2.9, currency: 'KRW',
    }],
    isaAccounts: [{
      id: 'i', type: 'general', investmentType: 'etf', name: 'ISA', balance: 10_000_000,
      monthlyContribution: 0, totalReturn: 7, dividendYield: 3, currency: 'KRW', maturityYears: 3,
    }],
    otherIncomes: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 2.5, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
  } as unknown as SimulationParams;

  for (const scenario of ['long_term_average', 'recession', 'high_inflation', 'low_growth'] as const) {
    test(`${scenario}: 총수익률이 입력값 그대로다`, () => {
      const applied = applyEconomicScenario(params, scenario);

      expect(applied.assets.map((a) => a.totalReturn)).toEqual([9.5]);
      expect(applied.privatePensions.map((p) => p.totalReturn)).toEqual([6.4]);
      expect(applied.isaAccounts!.map((i) => i.totalReturn)).toEqual([7]);
    });
  }

  test('물가와 환율은 여전히 지배한다', () => {
    const applied = applyEconomicScenario(params, 'high_inflation');

    expect(applied.inflationRate).toBe(5);
    expect(applied.exchangeScenario).toBe('usd_up');
  });
});
```

파일 상단 import에 `SimulationParams` 타입이 없으면 추가한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/tests/core/usecases/scenario/economicScenarios.test.ts`
Expected: FAIL — `expected [ 7 ] to deeply equal [ 9.5 ]` 형태 (국면이 수익률을 덮고 있다).

- [ ] **Step 3: 타입에서 수익률 필드를 지운다**

`src/core/usecases/scenario/economicScenarios.ts`의 `EconomicScenarioProfile`을 다음으로 교체한다. 기존 `stockGrowthRate`/`pensionReturnRate` 필드와 그 위의 주석 블록을 함께 지운다.

```ts
export interface EconomicScenarioProfile {
  inflationRate: number; // %
  exchangeScenario: SimulationParams['exchangeScenario'];
}
```

- [ ] **Step 4: 프로필 테이블에서 두 값을 지운다**

`ECONOMIC_SCENARIO_PROFILES`를 다음으로 교체한다. **물가·환율 값은 그대로다.**

```ts
export const ECONOMIC_SCENARIO_PROFILES: Record<GoverningEconomicScenario, EconomicScenarioProfile> = {
  long_term_average: { inflationRate: 2.5, exchangeScenario: 'base' },
  recession: { inflationRate: 1.5, exchangeScenario: 'usd_up' },
  high_inflation: { inflationRate: 5, exchangeScenario: 'usd_up' },
  low_growth: { inflationRate: 2, exchangeScenario: 'base' },
};
```

- [ ] **Step 5: 적용 함수에서 계좌 매핑을 지운다**

`applyEconomicScenario`의 본문을 다음으로 교체한다.

```ts
export function applyEconomicScenario(
  params: SimulationParams,
  scenario: EconomicScenario
): SimulationParams {
  const profile = resolveEconomicScenarioProfile(scenario);
  if (!profile) return params;

  // **수익률은 건드리지 않는다.** 물가·환율은 사용자가 알 도리가 없는 거시 환경이라
  // 국면이 정하는 것이 맞지만, 수익률은 「내 포트폴리오의 가정」이라 사용자 입력이
  // 유일한 출처다. 예전에는 여기서 주식·연금·ISA를 함께 덮었고, compileStrategy가
  // 리스크 성향을 나중에 적용해 그 값을 다시 덮었으므로 실제로는 효과도 없었다.
  return {
    ...params,
    inflationRate: profile.inflationRate,
    exchangeScenario: profile.exchangeScenario,
  };
}
```

- [ ] **Step 6: 컴파일 오류를 따라간다**

Run: `npx tsc --noEmit`
Expected: `stockGrowthRate` / `pensionReturnRate`를 읽던 곳이 오류로 드러난다. 각 지점을 지운다. 테스트 픽스처가 그 필드를 들고 있으면 함께 지운다.

- [ ] **Step 7: 테스트 통과를 확인한다**

Run: `npx vitest run src/tests/core/usecases/scenario/economicScenarios.test.ts`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "fix: 경제 시나리오가 종목별 수익률을 덮어쓰지 않는다

물가·환율은 사용자가 알 도리가 없는 거시 환경이라 국면이 정하는 것이 맞지만,
수익률은 「내 포트폴리오의 가정」이라 사용자 입력이 유일한 출처여야 한다.

게다가 이 필드는 애초에 효과가 없었다. compileStrategy가 경제 시나리오를 먼저,
리스크 성향을 나중에 적용하므로 두 축이 모두 지배할 때 수익률은 언제나 리스크
성향이 이겼다. 두 축이 같은 값을 두고 다투던 것을 하나로 정리한다.

타입에서 필드를 지워 누락이 컴파일 오류로 드러나게 했다."
```

---

### Task 2: 리스크 성향에서 지배하는 세 값을 없앤다

**Files:**
- Modify: `src/core/entities/types.ts:780` (`RiskProfile`)
- Modify: `src/core/usecases/strategy/compileStrategy.ts` (`RISK_PROFILE_PRESETS`, `GoverningRiskProfile`, `isGoverningRiskProfile`, `resolveRiskProfileYieldPreset`, `RISK_PROFILE_LABELS`, 445-449행)
- Modify: `src/infrastructure/storage/normalizeSimulationParams.ts:244-246` (`RISK_PROFILES`)
- Test: `src/tests/infrastructure/storage/normalizeSimulationParams.test.ts`
- Test: `src/tests/core/usecases/scenario/applyYieldPreset.test.ts`

**Interfaces:**
- Consumes: Task 1의 `applyEconomicScenario`.
- Produces: `type RiskProfile = 'custom' | 'ai_recommended'`.
- Produces: `compileStrategy(params)` — `applyYieldPreset`을 부르지 않는다. 자산별 `totalReturn`이 입력 그대로 통과한다.
- **삭제:** `resolveRiskProfileYieldPreset` (호출부 없음이 되어야 한다).

- [ ] **Step 1: 실패하는 회귀 테스트를 쓴다**

`src/tests/core/usecases/scenario/applyYieldPreset.test.ts` 끝에 추가:

```ts
describe('저장된 프리셋이 계획을 지배하지 않는다', () => {
  // 2026-08-22 실측: 저장된 riskProfile 'conservative' 하나가 8개 계좌의 총수익률을
  // 5%/3%로 갈아치우고 있었다. QQQ 9.5%도 SCHD 7%도 무시되어, 종목을 무엇으로 담아도
  // 결과가 같았다. 이 테스트가 그 상태로 되돌아가는 것을 막는다.
  test('conservative가 저장돼 있어도 자산별 입력값으로 계산한다', () => {
    const raw = {
      userProfile: { currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
      assets: [
        { id: 'q', type: 'etf', ticker: 'QQQ', name: 'QQQ', quantity: 1, averagePrice: 10_000_000,
          totalReturn: 9.5, dividendYield: 0.4, monthlyContribution: 0,
          reinvestDividend: true, currency: 'KRW', assetMarket: 'US_ETF' },
      ],
      privatePensions: [
        { id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP', balance: 30_000_000,
          monthlyContribution: 0, totalReturn: 6.4, dividendYield: 2.9, currency: 'KRW' },
      ],
      isaAccounts: [
        { id: 'i', type: 'general', investmentType: 'etf', name: 'ISA', balance: 5_000_000,
          monthlyContribution: 0, totalReturn: 7, dividendYield: 3, currency: 'KRW', maturityYears: 3 },
      ],
      otherIncomes: [],
      nationalPension: { expectedMonthlyAmount: 2_000_000 },
      inflationRate: 2.5, inflationMode: 'real', baseExchangeRate: 1400,
      exchangeScenario: 'base', displayCurrency: 'KRW',
      strategy: { riskProfile: 'conservative', economicScenario: 'ai_recommended' },
    };

    const compiled = compileStrategy(normalizeSimulationParams(raw));

    expect(compiled.params.assets[0].totalReturn).toBe(9.5);
    expect(compiled.params.privatePensions[0].totalReturn).toBe(6.4);
    expect(compiled.params.isaAccounts![0].totalReturn).toBe(7);
  });
});
```

파일 상단에 다음 import를 추가한다.

```ts
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/tests/core/usecases/scenario/applyYieldPreset.test.ts`
Expected: FAIL — `expected 5 to be 9.5`

- [ ] **Step 3: 마이그레이션 테스트를 쓴다**

`src/tests/infrastructure/storage/normalizeSimulationParams.test.ts` 끝에 추가:

```ts
describe('지배하는 리스크 성향은 「입력 수익률 유지」로 떨어진다', () => {
  // asOneOf가 목록에 없는 문자열에 undefined를 돌려주고 pickValid가 그 키를 떨어뜨리므로,
  // resolveStrategy가 기본값으로 메운다. 값 변환이 없어 멱등이다.
  for (const legacy of ['conservative', 'neutral', 'aggressive']) {
    test(`${legacy}는 저장 키에서 사라진다`, () => {
      const normalized = normalizeSimulationParams({
        userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
        assets: [], privatePensions: [], isaAccounts: [], otherIncomes: [],
        nationalPension: { expectedMonthlyAmount: 0 },
        inflationRate: 2.5, inflationMode: 'real', baseExchangeRate: 1400,
        exchangeScenario: 'base', displayCurrency: 'KRW',
        strategy: { riskProfile: legacy },
      });

      expect(normalized.strategy?.riskProfile).toBeUndefined();
    });
  }

  test('두 번 적용해도 같다 (멱등)', () => {
    const once = normalizeSimulationParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
      assets: [], privatePensions: [], isaAccounts: [], otherIncomes: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      inflationRate: 2.5, inflationMode: 'real', baseExchangeRate: 1400,
      exchangeScenario: 'base', displayCurrency: 'KRW',
      strategy: { riskProfile: 'conservative' },
    });

    expect(normalizeSimulationParams(once)).toEqual(once);
  });
});
```

- [ ] **Step 4: 타입 유니온을 줄인다**

`src/core/entities/types.ts:780`을 다음으로 교체한다.

```ts
// 수익률을 «지배하는» 값(conservative/neutral/aggressive)은 2026-08-22에 제거됐다.
// 수익률의 유일한 출처는 사용자 입력이고, 프리셋은 자산 폼의 「일괄 채우기」 도우미와
// 민감도·강건성 렌즈로만 남는다. 남는 두 값의 차이는 강건성 검증 on/off 하나다.
export type RiskProfile = 'custom' | 'ai_recommended';
```

- [ ] **Step 5: compileStrategy에서 프리셋 경로를 지운다**

다음 네 가지를 지운다.

1. `GoverningRiskProfile` 타입 별칭과 그 위 주석 블록
2. `RISK_PROFILE_PRESETS` 상수
3. `isGoverningRiskProfile` 함수
4. `resolveRiskProfileYieldPreset` 함수 (export되어 있으므로 호출부도 함께 정리한다)

`RISK_PROFILE_LABELS`를 다음으로 교체한다.

```ts
export const RISK_PROFILE_LABELS: Record<RiskProfile, string> = {
  custom: '사용자 직접입력',
  ai_recommended: '입력 수익률 유지',
};
```

445-449행을 다음으로 교체한다.

```ts
  // 경제 시나리오는 물가·환율만 지배한다. 수익률은 사용자 입력이 유일한 출처이므로
  // 어떤 축도 덮어쓰지 않는다(2026-08-22 수익률 가정 축 분리).
  const economyApplied = applyEconomicScenario(params, strategy.economicScenario);
```

`applyYieldPreset` import가 더 이상 쓰이지 않으면 지운다.

- [ ] **Step 6: 정규화 목록을 줄인다**

`src/infrastructure/storage/normalizeSimulationParams.ts:244-246`을 다음으로 교체한다.

```ts
const RISK_PROFILES = coversUnion<RiskProfile>()(['custom', 'ai_recommended']);
```

- [ ] **Step 7: 컴파일 오류를 따라간다**

Run: `npx tsc --noEmit`
Expected: `'conservative'`/`'neutral'`/`'aggressive'`를 `RiskProfile`로 쓰던 곳이 전부 오류로 드러난다. 프로덕션 코드는 위 단계에서 정리됐으므로 남는 것은 테스트 픽스처와 `strategyOptions.tsx`의 선택지다. 픽스처는 `'ai_recommended'`로 바꾼다. `strategyOptions.tsx`는 Task 7에서 다루므로 여기서는 세 항목만 지워 컴파일을 통과시킨다.

- [ ] **Step 8: 테스트 통과를 확인한다**

Run: `npx vitest run src/tests/core/usecases/scenario/applyYieldPreset.test.ts src/tests/infrastructure/storage/normalizeSimulationParams.test.ts`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "fix: 리스크 성향 프리셋이 입력한 수익률을 덮어쓰지 않는다

실측(2026-08-22): 저장된 riskProfile 'conservative' 하나가 8개 계좌의 총수익률을
5%/3%로 갈아치우고 있었다. QQQ 9.5%도 SCHD 7%도 SOL 9.5%도 전부 무시되어, 종목을
무엇으로 담아도 결과가 같았다. 서비스는 2단계에서 자산·투자 현황을 입력받는데 그
입력이 계산에 닿지 않는 상태였다.

robustness.ts가 이미 옳은 원칙을 적어 두었다 — 「사용자가 입력한 물가·수익률은 절대
덮어쓰지 않고, 바뀌는 것은 어느 인출 계획을 추천하는가뿐이다」. 그 원칙이 'ai_*'
경로에만 적용되고 사용자가 명시적으로 프리셋을 고르면 버려졌다. 모든 경로로 넓힌다.

RiskProfile에서 지배하는 세 값을 제거했다. 저장된 값은 asOneOf가 undefined를
돌려주고 pickValid가 키를 떨어뜨려 기본값 'ai_recommended'로 메워진다 — 값 변환이
없으므로 멱등이고 버전 마커가 필요 없다.

저장된 시나리오의 결과는 바뀐다. 파괴가 아니라 복원이다: applyYieldPreset은 계산용
params에만 적용되고 저장소를 건드리지 않았으므로, 사용자 입력값은 지금도 저장 파일에
그대로 살아 있다."
```

---

### Task 3: 몬테카를로 변동성을 언제나 유도한다

**Files:**
- Modify: `src/core/usecases/montecarlo/volatilityPresets.ts:85-105`
- Modify: `src/core/entities/types.ts` (`SimulationParams.yieldPreset` 주석)
- Test: `src/tests/core/usecases/montecarlo/volatilityPresets.test.ts`

**Interfaces:**
- Produces: `resolveMonteCarloConfig(params)` — `params.yieldPreset`을 읽지 않는다. `annualStdDev`는 언제나 `derivedVolatility(params)`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/tests/core/usecases/montecarlo/volatilityPresets.test.ts` 끝에 추가:

```ts
describe('변동성은 옛 프리셋이 아니라 실제 수익률에서 나온다', () => {
  // 화면이 리스크 성향만 바꾸고 params.yieldPreset은 그대로 두므로, 프리셋 분기를
  // 남겨 두면 수익률은 사용자 값인데 변동성만 안정형 10%p로 굳는다. 실측 시나리오가
  // 정확히 그 상태였다 — 가중평균 총수익률 7.6%에 σ 10%p.
  test('yieldPreset이 남아 있어도 가중평균 총수익률에서 유도한다', () => {
    const params = {
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
      assets: [{
        id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 100_000_000,
        totalReturn: 9, dividendYield: 0, monthlyContribution: 0,
        reinvestDividend: true, currency: 'KRW', assetMarket: 'US_ETF',
      }],
      privatePensions: [], isaAccounts: [], otherIncomes: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      inflationRate: 2.5, inflationMode: 'real', baseExchangeRate: 1400,
      exchangeScenario: 'base', displayCurrency: 'KRW',
      yieldPreset: 'conservative',
    } as unknown as SimulationParams;

    // 총수익률 9%는 volatilityForStockReturn의 상단 앵커라 20%p가 나와야 한다.
    // 프리셋을 읽으면 10%p가 된다.
    expect(resolveMonteCarloConfig(params).annualStdDev).toBe(20);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/tests/core/usecases/montecarlo/volatilityPresets.test.ts`
Expected: FAIL — `expected 10 to be 20`

- [ ] **Step 3: 프리셋 분기를 지운다**

`resolveMonteCarloConfig`를 다음으로 교체한다.

```ts
export function resolveMonteCarloConfig(params: SimulationParams): MonteCarloConfig {
  // **언제나 실제 수익률에서 유도한다.** 예전에는 params.yieldPreset을 먼저 읽었는데,
  // 프리셋이 수익률을 지배하던 시절에는 "유도해도 같은 값이 나온다"가 성립했다.
  // 그 지배가 사라진 뒤로 이 분기는 옛 프리셋 값에 변동성을 묶어 두는 일만 한다 —
  // 화면은 strategy.riskProfile만 바꾸고 yieldPreset은 그대로 두기 때문이다.
  return {
    trials: DEFAULT_MONTE_CARLO_TRIALS,
    seed: DEFAULT_MONTE_CARLO_SEED,
    annualStdDev: derivedVolatility(params),
  };
}
```

`VOLATILITY_BY_YIELD_PRESET`이 다른 곳에서 쓰이지 않으면 지운다. `npx tsc --noEmit`으로 확인한다.

- [ ] **Step 4: 타입 주석을 고친다**

`src/core/entities/types.ts`의 `SimulationParams.yieldPreset` 선언 위 주석에 다음을 덧붙인다.

```ts
  // **계산에 쓰이지 않는다.** 자산 폼의 「수익률 일괄 채우기」가 마지막으로 채운 프리셋의
  // 표식이며, customYieldSnapshot 되돌리기의 기준이다. 수익률도 변동성도 이 값에서
  // 유도하지 않는다(2026-08-22 수익률 가정 축 분리).
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `npx vitest run src/tests/core/usecases/montecarlo/`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "fix: 몬테카를로 변동성이 옛 프리셋에 굳지 않는다

리스크 성향을 「입력 수익률 유지」로 바꿔도 화면은 strategy.riskProfile만 고치고
params.yieldPreset은 그대로 둔다. 그래서 수익률은 사용자 값(가중평균 7.6%)인데
변동성만 안정형 10%p로 남았다 — 유도값은 16%p대다.

프리셋이 수익률을 지배하던 시절에는 「프리셋을 고른 경우는 유도해도 같은 값이
나온다」가 성립했지만, 그 지배가 사라진 지금 이 분기는 옛 값에 σ를 묶어 두는 일만
한다. 언제나 실제 수익률에서 유도한다."
```

---

### Task 4: 자산배분 추천 축을 제거한다

**Files:**
- Modify: `src/core/strategy/StrategyGenerator.ts` (`AssetAllocationPreset`, `StrategyDimensions.assetAllocation`, `AllocationCandidate`, `cloneProjection`, `strategyFor`, 314-320·347·358·391·394행, `baselineDimensions` 223-225행, 180행)
- Modify: `src/core/usecases/dashboard/strategyFieldMap.ts:265-290`(`key: 'assetAllocation'` 축), `:333`(`candidatePreset`)
- Test: `src/tests/core/usecases/scenario/StrategyGenerator.test.ts`

**Interfaces:**
- Produces: `StrategyDimensions` — `assetAllocation` 필드 없음.
- Produces: `strategyFor(seed, dimensions, spending)` — 넷째 인자 `allocation` 제거.
- **삭제:** `AssetAllocationPreset`, `AllocationCandidate`, `cloneProjection`.

**주의:** `RetirementStrategy.assetAllocation`(= `{ accountProjections }`)은 **다른 것이다.** 그 필드는 남는다. 지우는 것은 `StrategyDimensions.assetAllocation`(프리셋 라벨)뿐이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/tests/core/usecases/scenario/StrategyGenerator.test.ts` 끝에 추가:

```ts
describe('수익률 가정은 추천 축이 아니다', () => {
  // 「보수형/균형/성장형 자산배분」은 yieldPreset을 갈아끼우는 것만으로 구현되어 있었다.
  // 「성장형으로 바꾸세요」가 실질적으로 「수익률을 9%라고 가정하세요」였고, 당연히
  // 점수가 올랐다. 조언이 아니라 가정 변경이다.
  test('후보들이 서로 다른 수익률 가정을 갖지 않는다', () => {
    const { candidates } = generateStrategyCandidates(profileFixture(), goalsFixture(), seedFixture());

    const returns = new Set(
      candidates.flatMap((c) =>
        (c.strategy.assetAllocation?.accountProjections ?? []).map((p) => p.totalReturn)
      )
    );
    const seedReturns = new Set(
      (seedFixture().assetAllocation?.accountProjections ?? []).map((p) => p.totalReturn)
    );

    expect(returns).toEqual(seedReturns);
  });
});
```

`profileFixture` / `goalsFixture` / `seedFixture`는 이 파일에 이미 있는 헬퍼를 쓴다. 이름이 다르면 파일 상단의 기존 헬퍼 이름으로 바꾼다. `generateStrategyCandidates`의 실제 export 이름도 파일 상단 import에서 확인해 맞춘다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/tests/core/usecases/scenario/StrategyGenerator.test.ts`
Expected: FAIL — 후보들이 5/7/9%를 섞어 갖고 있다.

- [ ] **Step 3: 후보 목록과 루프를 지운다**

`src/core/strategy/StrategyGenerator.ts`에서:

1. `AllocationCandidate` 인터페이스(119-122행)를 지운다.
2. `AssetAllocationPreset` 타입(32행)을 지운다.
3. `cloneProjection` 함수(128-140행)를 지운다.
4. `StrategyDimensions`에서 `assetAllocation: AssetAllocationPreset;` 줄을 지운다.
5. `allocations` 선언(314-320행)과 `hasMarketAccount` 변수를 지운다. `hasMarketAccount`가 다른 곳에서 쓰이면 남긴다.
6. `for (const allocation of allocations) {` 루프(347행)와 짝이 되는 닫는 괄호를 지운다. 안쪽 블록의 들여쓰기를 한 단계 줄인다.
7. `dimensions` 리터럴에서 `assetAllocation: allocation.label,` 줄(358행)을 지운다.
8. 개수 집계에서 `assetAllocation: allocations.length,`(391행)를 지우고, `theoreticalCombinationCount`(394행)에서 `* allocations.length`를 지운다.

- [ ] **Step 4: strategyFor의 시그니처를 줄인다**

```ts
function strategyFor(
  seed: RetirementStrategy,
  dimensions: StrategyDimensions,
  spending: SpendingCandidate,
): RetirementStrategy {
  const withdrawalPolicy = {
    ...seed.withdrawalPolicy,
    accountWithdrawalPolicy: dimensions.withdrawalPolicy,
  };
  delete withdrawalPolicy.customWithdrawalOrder;

  // 모든 후보를 'target' 모드로 고정한다. 후보끼리 비교하려면 같은 기준의 목표 생활비를
  // 써야 하는데, 'max_sustainable'은 목표액 대신 엔진이 역산한 지속가능액을 쓰기 때문이다
  // (freezeSpendingPlan.ts).
  const spendingPolicy = {
    ...seed.spendingPolicy,
    mode: 'target' as const,
    ...(spending.curve ? { curve: spending.curve } : {}),
  };
  if (!spending.curve) delete spendingPolicy.curve;

  // **수익률은 후보마다 바뀌지 않는다.** 계좌 projection을 그대로 물려준다 —
  // 후보가 다르게 만드는 것은 인출 계획이지 시장 가정이 아니다.
  return {
    ...seed,
    retirementAge: dimensions.retirementAge,
    nationalPensionStartAge: dimensions.nationalPensionStartAge,
    withdrawalPolicy,
    spendingPolicy,
  };
}
```

호출부에서 넷째 인자를 지운다.

- [ ] **Step 5: baselineDimensions를 줄인다**

`baselineDimensions`에서 `const preset = seed.legacySettings.yieldPreset;` 줄과 `assetAllocation: ...` 삼항식(223-225행), 그 위 주석을 지운다.

- [ ] **Step 6: 대시보드의 자산배분 축을 지운다**

`src/core/usecases/dashboard/strategyFieldMap.ts`에서 `key: 'assetAllocation'`로 시작하는 축 객체 전체(265행부터 `key: 'spendingPattern'` 직전까지)와 `candidatePreset` 함수를 지운다. `applyYieldPreset` import가 남으면 지운다.

- [ ] **Step 7: 컴파일 + 테스트**

Run: `npx tsc --noEmit && npx vitest run src/tests/core/usecases/scenario/StrategyGenerator.test.ts src/tests/core/usecases/dashboard/`
Expected: PASS. `assetAllocation` 라벨을 단언하던 기존 테스트가 있으면 그 단언을 지운다.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "refactor: 「자산배분」 추천 축을 없앤다

이 축은 yieldPreset을 갈아끼우는 것만으로 구현되어 있었다. 「성장형으로 바꾸세요」가
실질적으로 「수익률을 9%라고 가정하세요」였고, 당연히 점수가 올랐다. 조언이 아니라
가정 변경이며, 사용자가 실행할 수 있는 행동도 아니다.

프리셋이 더 이상 수익률을 지배하지 않으므로 이 추천은 아무것도 바꾸지 못하는 상태가
됐다. 화면에 남겨 두면 「반영」 버튼이 눌러도 곡선이 그대로인 축이 된다.

후보 수가 최대 218에서 73으로 준다. 인출 계획·연금 개시·생활비 배분 축은 그대로다.

StrategyDimensions.assetAllocation(프리셋 라벨)만 지운다 —
RetirementStrategy.assetAllocation(계좌 projection)은 다른 것이며 남는다."
```

---

### Task 5: 민감도 표의 수익률 ±2%p를 프리셋 3행으로 교체한다

**Files:**
- Modify: `src/core/usecases/dashboard/computeSensitivityAnalysis.ts:7-8`(키 유니온), `:33-41`(`shiftReturn`), `:79-86`(정의)
- Test: `src/tests/core/usecases/dashboard/computeSensitivityAnalysis.test.ts`

**Interfaces:**
- Produces: `SensitivityScenario['key']` — `'returnDown' | 'returnUp'` 제거, `'yieldConservative' | 'yieldBase' | 'yieldAggressive'` 추가.
- **삭제:** `shiftReturn`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/tests/core/usecases/dashboard/computeSensitivityAnalysis.test.ts` 끝에 추가:

```ts
describe('수익률 축은 절대 앵커로 잰다', () => {
  // ±2%p는 사용자 가정 대비 상대 이동이라, 가중평균이 7.6%인 계획에서 5.6%/9.6%가 되어
  // 프리셋(5/7/9%)과 사실상 같은 자리를 잰다. 절대 앵커 쪽이 「내 가정이 시장 통념 대비
  // 어디쯤인가」를 답하므로 목표 기반 흐름에 맞는다.
  test('프리셋 3행이 나오고 ±2%p 행은 없다', () => {
    const analysis = computeSensitivityAnalysis(paramsFixture(), new SimulationEngine());

    const keys = analysis.scenarios.map((s) => s.key);
    expect(keys).toContain('yieldConservative');
    expect(keys).toContain('yieldBase');
    expect(keys).toContain('yieldAggressive');
    expect(keys).not.toContain('returnDown');
    expect(keys).not.toContain('returnUp');
  });

  test('공격형 행은 프리셋 수익률로 계산된다', () => {
    const params = paramsFixture();
    const engine = new SimulationEngine();
    const analysis = computeSensitivityAnalysis(params, engine);

    const row = analysis.scenarios.find((s) => s.key === 'yieldAggressive')!;
    const frozen = freezeSpendingPlan(params, engine);
    const expected = runFrozenPlan(engine, mapFrozenPlan(frozen, (p) => applyYieldPreset(p, 'aggressive')));

    expect(row.endingAssets).toBeCloseTo(expected.endingAssets, 6);
  });
});
```

`paramsFixture`는 이 파일의 기존 헬퍼를 쓴다. 필요한 import를 상단에 추가한다.

```ts
import { applyYieldPreset } from '@/core/usecases/scenario/applyYieldPreset';
import { freezeSpendingPlan, runFrozenPlan, mapFrozenPlan } from '@/core/usecases/spending/freezeSpendingPlan';
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/tests/core/usecases/dashboard/computeSensitivityAnalysis.test.ts`
Expected: FAIL — `expected [ 'returnDown', ... ] to contain 'yieldConservative'`

- [ ] **Step 3: 키 유니온을 고친다**

`SensitivityScenario`의 `key` 타입을 다음으로 교체한다.

```ts
  key: 'yieldConservative' | 'yieldBase' | 'yieldAggressive'
    | 'inflationUp' | 'inflationDown' | 'retirementEarlier' | 'retirementLater';
```

- [ ] **Step 4: shiftReturn을 지우고 정의를 교체한다**

`shiftReturn` 함수와 그 위 주석을 지운다. `SCENARIO_DEFINITIONS`를 다음으로 교체한다.

```ts
// 수익률 축은 «절대 앵커»로 잰다. ±%p 상대 이동은 사용자 가정이 이미 높으면 프리셋과
// 같은 자리를 재게 되고, 「내 가정이 시장 통념 대비 어디쯤인가」에도 답하지 못한다.
//
// 몬테카를로의 σ와 겹치지 않는다 — σ는 「기대는 맞지만 해마다 흔들린다면」이고,
// 이 세 행은 「기대 자체가 다르다면」이다.
const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  { key: 'yieldConservative', label: '안정형 가정 (주식 5%)', buildParams: (p) => applyYieldPreset(p, 'conservative') },
  { key: 'yieldBase', label: '중립형 가정 (주식 7%)', buildParams: (p) => applyYieldPreset(p, 'base') },
  { key: 'yieldAggressive', label: '공격형 가정 (주식 9%)', buildParams: (p) => applyYieldPreset(p, 'aggressive') },
  { key: 'inflationUp', label: '물가상승률 +1%p', buildParams: (p) => shiftInflation(p, 1) },
  { key: 'inflationDown', label: '물가상승률 -1%p', buildParams: (p) => shiftInflation(p, -1) },
  { key: 'retirementEarlier', label: '은퇴시점 -3년', buildParams: (p) => shiftRetirementAge(p, -3) },
  { key: 'retirementLater', label: '은퇴시점 +3년', buildParams: (p) => shiftRetirementAge(p, 3) },
];
```

파일 상단에 import를 추가한다.

```ts
import { applyYieldPreset } from '../scenario/applyYieldPreset';
```

- [ ] **Step 5: 컴파일 + 테스트**

Run: `npx tsc --noEmit && npx vitest run src/tests/core/usecases/dashboard/ src/tests/web/features/Dashboard/`
Expected: PASS. `'투자수익률 -2%p'` 문자열로 행을 찾던 화면 테스트가 있으면 새 라벨로 고친다.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: 민감도의 수익률 축을 절대 앵커로 바꾼다

±2%p는 사용자 가정 대비 «상대» 이동이라, 가중평균이 7.6%인 계획에서 5.6%/9.6%가 되어
프리셋(5/7/9%)과 사실상 같은 자리를 잰다. 절대 앵커 쪽이 「내 가정이 시장 통념 대비
어디쯤인가」를 답하므로 목표 기반 흐름에 맞는다.

프리셋이 계획을 지배하지 못하게 된 뒤로, 안정형·공격형을 보여줄 자리는 여기다 —
계획을 바꾸지 않고 결과만 비교하는 렌즈다.

몬테카를로의 σ와는 겹치지 않는다. σ는 「기대는 맞지만 해마다 흔들린다면」이고
이 세 행은 「기대 자체가 다르다면」이다."
```

---

### Task 6: 입력 도우미를 넣고 잠금을 푼다

**Files:**
- Create: `src/web/features/AssetForm/YieldPresetHelper.tsx`
- Modify: `src/web/features/AssetForm/AssetFormSection.tsx` (`yieldGovernedBy` 제거, 651행 배너 제거, `disabled` 제거, 도우미 삽입)
- Modify: `src/web/features/AssetForm/AssetForm.module.css` (도우미 스타일)
- Test: `src/tests/web/features/AssetForm/YieldPresetHelper.test.tsx`

**Interfaces:**
- Consumes: `applyYieldPreset(params, preset)`, `restoreCustomYieldPreset(params)` (`core/usecases/scenario/applyYieldPreset.ts`).
- Produces: `<YieldPresetHelper params={SimulationParams} onChangeParams={(p: SimulationParams) => void} />`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/tests/web/features/AssetForm/YieldPresetHelper.test.tsx` 생성:

```tsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YieldPresetHelper } from '@/web/features/AssetForm/YieldPresetHelper';
import { SimulationParams } from '@/core/entities/types';

function params(over: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    assets: [{
      id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 100_000_000,
      totalReturn: 9.5, dividendYield: 0.4, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW', assetMarket: 'US_ETF',
    }],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP', balance: 10_000_000,
      monthlyContribution: 0, totalReturn: 6.4, dividendYield: 0, currency: 'KRW',
    }],
    isaAccounts: [], otherIncomes: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 2.5, inflationMode: 'real', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    ...over,
  } as unknown as SimulationParams;
}

describe('YieldPresetHelper', () => {
  test('안정형을 누르면 저장값이 5%/3%로 채워진다', async () => {
    const onChange = vi.fn();
    render(<YieldPresetHelper params={params()} onChangeParams={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /보수적 5%/ }));

    const next = onChange.mock.calls[0][0] as SimulationParams;
    expect(next.assets[0].totalReturn).toBe(5);
    expect(next.privatePensions[0].totalReturn).toBe(3);
  });

  test('되돌리기 버튼은 스냅샷이 있을 때만 보인다', () => {
    const { rerender } = render(<YieldPresetHelper params={params()} onChangeParams={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /되돌리기/ })).toBeNull();

    rerender(
      <YieldPresetHelper
        params={params({
          yieldPreset: 'conservative',
          customYieldSnapshot: { assets: { a: 9.5 }, privatePensions: { p: 6.4 }, isaAccounts: {} },
        } as Partial<SimulationParams>)}
        onChangeParams={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /되돌리기/ })).toBeTruthy();
  });

  test('되돌리기는 직전 입력값을 복원한다', async () => {
    const onChange = vi.fn();
    render(
      <YieldPresetHelper
        params={params({
          assets: [{ ...params().assets[0], totalReturn: 5 }],
          privatePensions: [{ ...params().privatePensions[0], totalReturn: 3 }],
          yieldPreset: 'conservative',
          customYieldSnapshot: { assets: { a: 9.5 }, privatePensions: { p: 6.4 }, isaAccounts: {} },
        } as Partial<SimulationParams>)}
        onChangeParams={onChange}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /되돌리기/ }));

    const next = onChange.mock.calls[0][0] as SimulationParams;
    expect(next.assets[0].totalReturn).toBe(9.5);
    expect(next.privatePensions[0].totalReturn).toBe(6.4);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/tests/web/features/AssetForm/YieldPresetHelper.test.tsx`
Expected: FAIL — 모듈을 찾을 수 없다.

- [ ] **Step 3: 컴포넌트를 만든다**

`src/web/features/AssetForm/YieldPresetHelper.tsx` 생성:

```tsx
import React from 'react';
import { SimulationParams } from '../../../core/entities/types';
import {
  YIELD_PRESET_RATES,
  applyYieldPreset,
  restoreCustomYieldPreset,
} from '../../../core/usecases/scenario/applyYieldPreset';
import styles from './AssetForm.module.css';

interface YieldPresetHelperProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
}

const PRESETS = [
  { key: 'conservative', label: '보수적 5%' },
  { key: 'base', label: '중립 7%' },
  { key: 'aggressive', label: '공격 9%' },
] as const;

/**
 * 수익률 입력칸을 한 번에 채워 주는 도우미.
 *
 * **프리셋은 계획을 지배하지 않는다.** 예전에는 「투자 전략」의 리스크 성향이 계산 시점에
 * 모든 계좌의 총수익률을 덮어썼고, 화면은 저장값을 그대로 보여줘 사용자가 자기 시뮬레이션이
 * 몇 %로 돌았는지 알 방법이 없었다. 이제 프리셋은 여기서 «저장값 자체»를 바꾼다 —
 * 값이 입력칸에 찍히고, 보이고, 개별로 고칠 수 있고, 되돌릴 수 있다.
 *
 * 되돌리기는 applyYieldPreset이 남긴 customYieldSnapshot을 쓴다.
 */
export function YieldPresetHelper({ params, onChangeParams }: YieldPresetHelperProps) {
  const canRestore = params.customYieldSnapshot !== undefined;

  return (
    <div className={styles.yieldPresetHelper}>
      <span className={styles.yieldPresetLabel}>수익률 일괄 채우기</span>
      {PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          className={styles.yieldPresetButton}
          onClick={() => onChangeParams(applyYieldPreset(params, preset.key))}
          title={`주식·ISA ${YIELD_PRESET_RATES[preset.key].stockGrowth}%, 사적연금 ${YIELD_PRESET_RATES[preset.key].pensionReturn}%로 채웁니다`}
        >
          {preset.label}
        </button>
      ))}
      {canRestore && (
        <button
          type="button"
          className={styles.yieldPresetButton}
          onClick={() => onChangeParams(restoreCustomYieldPreset(params))}
        >
          직접 입력값으로 되돌리기
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 스타일을 넣는다**

`src/web/features/AssetForm/AssetForm.module.css` 끝에 추가:

```css
.yieldPresetHelper {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.yieldPresetLabel {
  font-size: 0.8rem;
  color: var(--foreground-muted);
}

.yieldPresetButton {
  padding: 0.25rem 0.6rem;
  font-size: 0.8rem;
  border: 1px solid var(--card-border);
  border-radius: 4px;
  background: transparent;
  color: var(--foreground);
  cursor: pointer;
}

.yieldPresetButton:hover {
  background: var(--summary-bg-hover);
}
```

토큰 이름은 이 파일이 이미 쓰는 것들이다(`--foreground-muted`, `--card-border`, `--summary-bg-hover`, `--foreground`).

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `npx vitest run src/tests/web/features/AssetForm/YieldPresetHelper.test.tsx`
Expected: PASS

- [ ] **Step 6: 폼에서 잠금을 풀고 도우미를 넣는다**

`src/web/features/AssetForm/AssetFormSection.tsx`에서:

1. `yieldGovernedBy` 선언(87행)과 `yieldFetchTitle` 안의 그 분기(118-119행)를 지운다.
2. 651-656행의 안내 배너 블록(`{yieldGovernedBy && (<p …>…</p>)}`)을 지운다.
3. `disabled={yieldGovernedBy !== null}`를 전부 지운다(914, 1318, 1369, 1546, 1597, 1609행).
4. `disabled={fetchingInfoMap[x] || … || yieldGovernedBy !== null}`에서 `|| yieldGovernedBy !== null` 부분만 지운다(923, 947, 1327, 1351, 1555, 1579행).
5. `resolveRiskProfileYieldPreset` / `isEconomicScenarioGoverning` import가 안 쓰이면 지운다.
6. 탭 메뉴 바로 위(옛 배너 자리)에 도우미를 넣는다.

```tsx
<YieldPresetHelper params={params} onChangeParams={onChangeParams} />
```

`params` / `onChangeParams`의 실제 prop 이름은 이 컴포넌트의 시그니처에서 확인해 맞춘다. import를 추가한다.

```tsx
import { YieldPresetHelper } from './YieldPresetHelper';
```

- [ ] **Step 7: 폼 테스트를 확인한다**

Run: `npx vitest run src/tests/web/features/AssetForm/`
Expected: PASS. 「비활성화되어 있다」를 단언하던 테스트가 있으면 지운다 — 그 동작이 사라지는 것이 이 태스크의 목적이다.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: 수익률 프리셋을 입력 도우미로 바꾸고 입력칸 잠금을 푼다

프리셋이 더 이상 계산 시점에 수익률을 덮어쓰지 않으므로 입력칸을 잠글 이유가 없다.
잠금을 풀면 세 결함이 함께 닫힌다.

  - 잠긴 칸이 엔진이 쓰지 않는 저장값을 보여주던 것 (JEPI 칸에 0%, QQQ 칸에 9.5%가
    보이는데 엔진은 5%를 쓰고 있었다)
  - ReturnBreakdownHint가 그 저장값으로 「가격상승 −7.9%」를 띄우던 것 (실제 −2.9%)
  - 총수익률은 잠기는데 배당률은 안 잠겨, 잠기지 않은 칸이 잠긴 값의 효과를 바꾸던 것

프리셋은 「수익률 일괄 채우기」 버튼으로 옮긴다. 이제 저장값 «자체»를 바꾸므로 값이
입력칸에 찍히고, 보이고, 개별로 고칠 수 있고, 되돌릴 수 있다.

되돌리기는 restoreCustomYieldPreset을 쓴다. 그 함수는 호출부가 없는 죽은 코드였고
주석이 「되돌릴 UI가 다시 생기면 그대로 쓸 수 있도록 남겨 둔다」고 적어 두었다."
```

---

### Task 7: 선택지 문구를 실제 동작에 맞춘다

**Files:**
- Modify: `src/web/features/StrategySettings/strategyOptions.tsx` (`RISK_PROFILE_OPTIONS`, `ECONOMIC_SCENARIO_OPTIONS`)
- Test: `src/tests/web/features/StrategySettings/sections/EconomicAssumptionSection.test.tsx` 및 관련 섹션 테스트

**Interfaces:**
- Consumes: Task 2의 `RiskProfile = 'custom' | 'ai_recommended'`.

- [ ] **Step 1: 리스크 성향 선택지를 둘로 줄인다**

`RISK_PROFILE_OPTIONS`에서 `conservative`/`neutral`/`aggressive` 항목을 지우고 남는 둘의 설명을 고친다.

```tsx
{
  value: 'ai_recommended',
  label: '입력 수익률 유지',
  description: '입력한 수익률을 그대로 씁니다. 높고 낮은 수익률 가정 모두에서 견디는 인출 계획을 고릅니다.',
  recommended: true,
},
{
  value: 'custom',
  label: '입력값 그대로만',
  description: '입력한 수익률 하나로만 평가합니다. 여러 가정에서의 검증을 건너뜁니다.',
},
```

아이콘 prop이 있으면 지운 항목의 것만 함께 지운다.

- [ ] **Step 2: 경제 시나리오 설명에서 수익률 언급을 뺀다**

각 항목의 `description`을 실제로 바뀌는 값으로 고친다.

```tsx
long_term_average: '물가 2.5%, 환율 기준선.'
recession:         '물가 1.5%, 원화 약세를 가정합니다.'
high_inflation:    '물가 5%, 원화 약세를 가정합니다. 실질 구매력이 빠르게 줄어듭니다.'
low_growth:        '물가 2%, 환율 기준선.'
ai_recommended:    '입력한 물가·환율을 그대로 씁니다. 네 가지 경기 국면 모두에서 견디는 인출 계획을 고릅니다.'
```

「성장이 오래 정체되고」·「자산이 잘 늘지 않는」 같은 표현을 지운다 — 그 말은 주식 수익률 덮어쓰기를 가리키던 것이라 그대로 두면 거짓말이 된다.

- [ ] **Step 3: 컴파일 + 테스트**

Run: `npx tsc --noEmit && npx vitest run src/tests/web/features/StrategySettings/`
Expected: PASS. 지운 라벨 문자열로 요소를 찾던 테스트가 있으면 지우거나 새 라벨로 고친다.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "fix: 투자 전략 선택지가 실제로 바뀌는 값을 말하게 한다

경제 시나리오의 「성장이 오래 정체되고」·「자산이 잘 늘지 않는」은 주식 수익률
덮어쓰기를 가리키던 말이다. 그 동작이 사라졌으므로 그대로 두면 거짓말이 된다.
실제로 바뀌는 물가·환율을 적는다.

리스크 성향은 수익률을 정하는 축이 아니게 됐으므로 프리셋 세 항목을 지우고, 남는
둘의 설명을 「여러 가정에서 검증할지」로 고쳐 쓴다."
```

---

### Task 8: 기존 픽스처를 이관하고 골든값을 갱신한다

**Files:**
- Modify: 컴파일·테스트 오류가 난 픽스처 전부
- Modify: `src/tests/fixtures/engineRegression.json`
- Modify: `scripts/harness/personas.ts` (`riskProfile`을 쓰면)

**Interfaces:**
- Consumes: Task 1~7 전부.

- [ ] **Step 1: 전체 테스트를 돌린다**

Run: `npm test`
Expected: 실패 목록을 얻는다. `SimulationEngine.auditFindings.test.ts`의 4건은 **예상된 실패**이므로 무시한다(Task 0 주의 참조).

- [ ] **Step 2: 픽스처를 이관한다**

`riskProfile`이 프리셋 값인 픽스처를 `'ai_recommended'`로 바꾼다. 그 결과 기대값이 깨지는 테스트는 **개별로 확인한다** — 깨졌다는 것 자체가 그 테스트가 덮어쓰기를 검증하고 있었다는 신호다. 기대값을 새 동작에 맞춰 다시 계산하고, 왜 움직여도 되는지를 테스트 주석에 한 줄 남긴다. 일괄 치환하지 않는다.

- [ ] **Step 3: 골든 픽스처를 갱신한다**

`engineRegression.json`의 두 케이스에는 `strategy` 키가 없어 `runSingle`을 직접 부르므로 **값이 움직이지 않아야 한다.** 움직였다면 Task 1~7 중 무언가가 의도를 넘어섰다는 뜻이므로 원인을 찾는다.

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.regressionFixture.test.ts`
Expected: PASS (변경 없이)

- [ ] **Step 4: 하니스로 실제 시나리오를 재확인한다**

```bash
LEDGER_INPUT=src/tests/fixtures/auditReportCase.json \
HARNESS_OUT=/tmp/ledger-after \
  npx vitest run --config vitest.harness.config.ts scripts/harness/ledger.harness.ts

node -e "
const b=require('/tmp/ledger-before/summary.json'), a=require('/tmp/ledger-after/summary.json');
console.log('before 고갈:', b.deterministic.depletionAge, '| after:', a.deterministic.depletionAge);
console.log('before 지속가능:', Math.round(b.deterministic.calculatedTargetSpending/1e4), '| after:', Math.round(a.deterministic.calculatedTargetSpending/1e4));
console.log('원장 위반 after:', a.ledgerViolations.length);
console.log('MC after:', JSON.stringify(a.monteCarlo.rates), 'sigma', a.monteCarlo.config.annualStdDev);
"
```

Expected: `auditReportCase.json`에는 `strategy`가 없어(따라서 프리셋 지배도 없어) 결정론 결과는 **before와 같아야 한다.** `원장 위반 after`는 0. σ는 유도값으로 바뀔 수 있다(그 픽스처에는 `yieldPreset`이 없으므로 before와 같을 가능성이 높다).

- [ ] **Step 5: 페르소나 하니스를 돌린다**

Run: `npm run harness:personas`
Expected: 완주한다(단언 없음). `scripts/harness/out/personas.csv`를 이전 커밋의 것과 diff해 어느 페르소나가 얼마나 움직였는지 확인하고, 프리셋을 쓰던 페르소나만 움직였는지 본다.

- [ ] **Step 6: 전체 테스트 통과를 확인한다**

Run: `npm test`
Expected: `SimulationEngine.auditFindings.test.ts`의 4건을 제외하고 전부 통과.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "test: 프리셋 덮어쓰기를 전제하던 픽스처를 이관한다

riskProfile이 프리셋 값이던 픽스처를 'ai_recommended'로 옮겼다. 기대값이 깨진
테스트는 개별로 확인했다 — 깨졌다는 것 자체가 그 테스트가 덮어쓰기를 검증하고
있었다는 신호이므로, 일괄 치환하지 않고 하나씩 새 동작에 맞춰 다시 계산했다.

engineRegression.json의 두 케이스는 strategy 키가 없어 runSingle을 직접 부르므로
값이 움직이지 않았다. 그 사실이 이번 변경이 «전략 컴파일 경계»에만 손댔다는 증거다."
```

---

## Self-Review

**스펙 커버리지**

| 스펙 절 | 태스크 |
|---|---|
| 1. 경제 시나리오에서 수익률 제거 | Task 1 |
| 2. 리스크 성향 지배 값 제거 | Task 2 |
| 3. `applyYieldPreset` 호출부 이동 | Task 2(제거) · Task 5(민감도) · Task 6(도우미). 강건성은 이미 호출 중이라 변경 없음 |
| 4. σ 유도 고정 | Task 3 |
| 5. 민감도 프리셋 3행 | Task 5 |
| 6. 입력 도우미 + 잠금 해제 | Task 6 |
| 7. 자산배분 후보 축 제거 | Task 4 |
| 8. 문구 | Task 7 |
| 테스트 1~7 | Task 1·2·3·5·6·4 각 Step 1 |
| 기존 픽스처 이관 | Task 8 |

**남는 위험 — 실행 중 확인할 것**

- Task 5·6·7의 화면 테스트는 라벨 문자열로 요소를 찾는 것이 많다. 라벨을 바꾸면 함께 고친다.
