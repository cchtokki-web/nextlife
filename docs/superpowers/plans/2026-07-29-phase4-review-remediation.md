# Phase 4 리뷰 지적사항 수정 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/pr-review-toolkit:review-pr` 5개 에이전트가 Phase 4(사적연금 조기수령 채널링)에서 찾은 Critical 4건과 사용자 노출 이슈를 수정한다.

**Architecture:** 엔진의 자금 소실을 인출 단계 캡으로 바꾸고(C2), 옵티마이저를 "하나의 번들 후보"에서 "두 개의 독립 후보"로 재구조화해 대조군 없는 비교를 제거한다(C3). 통화 버그(C1)와 시도 집계(C4)는 재구조화된 옵티마이저 안에서 함께 해결한다.

**Tech Stack:** TypeScript(strict), Vitest, 기존 Clean Architecture 계층 그대로.

## Global Constraints

- `any` 사용 금지, `strict: true` 유지. 주석·커밋 메시지는 한국어.
- 기존 `isRetired` 인출 경로(`SimulationEngine.ts`의 은퇴 후 분기)는 이번에도 변경하지 않는다.
- 사적연금 저율과세 한도 기본값 = `(currentTaxSettings.privatePensionLimit ?? 15000000)`, 월 환산은 `/12`.
- 세액공제 한도 상수 `750000`은 **원화 법정 한도**다 — 통화 변환 없이 다른 통화 계좌에 그대로 쓰면 안 된다.
- 각 Task 완료 시 `npx tsc --noEmit` + 해당 테스트 파일 통과를 확인하고 커밋한다.
- 검증 기준선: 작업 시작 시점 전체 스위트 59파일/474테스트 통과.

## 리뷰에서 확정된 설계 결정 (사용자 승인 완료)

- **C3 분리 방식**: 채널링 레그와 신규계좌 레그를 **독립 후보 2개**로 분리해 각각 baseline 대비 평가하고, 유리한 것만 채택한다. 체크리스트에도 별도 항목으로 표시한다.
- **C2 수정 방식**: 크레딧을 캡하는 게 아니라 **인출 자체를 캡**한다(놓을 곳 없는 돈은 애초에 빼지 않는다).
- **C1 수정 방식**: 신규 합성 계좌는 원화 상수를 쓰므로 `currency: 'KRW'`로 고정한다.

---

### Task 1: C2 — 브릿지 인출을 ISA 잔여 한도로 캡 (자금 소실 제거)

**문제:** 현재 `SimulationEngine.ts`의 브릿지 분기는 연금에서 전액 인출하고 과세까지 마친 뒤, ISA 월 납입 잔여 한도를 넘는 순액을 **어디에도 적립하지 않고 버린다**. ISA 정기납입이 월 약 485,417원을 넘으면 매달 발생한다. 기존 캡들(`:510` 연금 인출 캡, `:409` ISA 납입 캡)은 모두 유출 자체를 줄여 돈이 파괴되지 않으므로, 현재 코드의 "다른 capped 흐름과 동일한 방식"이라는 주석은 **사실이 아니다**.

**Files:**
- Modify: `src/core/usecases/SimulationEngine.ts` (브릿지 분기, 대략 `:528-566`)
- Test: `src/tests/core/usecases/SimulationEngine.privatePensionBridgeChanneling.test.ts` (기존 2개 케이스의 기대값을 반전 + 신규 케이스)

**Interfaces:**
- Produces: 브릿지 분기의 새 불변식 — `drawAmountRaw`는 `min(잔액, 저율과세 잔여한도, ISA 잔여룸으로 역산한 세전 상한)`이며, 인출된 세후 순액은 **항상 전액** `activeIsas[0]`에 적립된다. 자금 소실 0.

- [ ] **Step 1: 실패하는 테스트로 기존 기대값을 반전**

`SimulationEngine.privatePensionBridgeChanneling.test.ts`에서 "Fix 4" 관련 기존 2개 케이스를 찾는다(ISA가 월 한도를 일부/전부 소진한 상태를 다루는 케이스). 현재 이들은 "브릿지 인출은 그대로 발생하고 초과분은 유실된다"를 고정하고 있다. 다음으로 바꾼다:

```ts
  test('ISA 잔여 납입 한도가 부분적으로만 남아 있으면 그 한도만큼만 인출하고 자금 소실은 없다', () => {
    const engine = new SimulationEngine();
    // ISA가 월 한도(20,000,000/12 = 1,666,666.67원) 중 1,000,000원을 이미 정기납입으로 소진 →
    // 브릿지가 쓸 수 있는 잔여 룸은 666,666.67원. 세율 5.5%이므로 세전 인출 상한은
    // 666,666.67 / (1 - 0.055) = 705,467.9원.
    const params: SimulationParams = {
      ...baseParams,
      isaAccounts: [{ ...baseParams.isaAccounts![0], monthlyContribution: 1000000 }],
    };
    const result = engine.run(params);

    const at54 = result.yearlyResults.find((r) => r.age === 54)!;
    const at55 = result.yearlyResults.find((r) => r.age === 55)!;

    // 자금 보존: 총자산 감소분은 정확히 낸 세금과 같아야 한다(초과분 소실 없음).
    expect(at54.totalAssets - at55.totalAssets).toBeCloseTo(at55.pensionTaxPaid, 2);
    // 인출은 저율과세 한도(15,000,000)가 아니라 ISA 룸에 의해 캡된다.
    const drawnPreTax = 100000000 - at55.pensionAssets;
    expect(drawnPreTax).toBeLessThan(15000000);
    expect(drawnPreTax).toBeCloseTo((666666.67 / (1 - 0.055)) * 12, 0);
  });

  test('ISA 잔여 납입 한도가 0이면 브릿지 인출 자체가 일어나지 않는다(세금도 내지 않는다)', () => {
    const engine = new SimulationEngine();
    // ISA가 월 한도를 전부 정기납입으로 소진 → 브릿지 룸 0 → 인출 0
    const params: SimulationParams = {
      ...baseParams,
      isaAccounts: [{ ...baseParams.isaAccounts![0], monthlyContribution: 20000000 / 12 }],
    };
    const result = engine.run(params);

    const at55 = result.yearlyResults.find((r) => r.age === 55)!;
    expect(at55.pensionAssets).toBeCloseTo(100000000, 2); // 연금 잔액 그대로
    expect(at55.pensionTaxPaid).toBeCloseTo(0, 2);         // 세금도 없음
  });
```

기존 픽스처(`baseParams`)에 ISA가 없다면, 이 두 테스트용으로 파일 상단의 `baseParams`에 있는 ISA 계좌를 재사용하되 `monthlyContribution`만 덮어쓴다. `baseParams`의 ISA `maturityYears`는 테스트 기간 내 만기가 발생하지 않도록 충분히 길어야 한다(기존 픽스처가 이미 그렇게 되어 있으면 그대로 사용).

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.privatePensionBridgeChanneling.test.ts`
Expected: 위 2개 케이스 FAIL — 현재 코드는 전액 인출·과세 후 초과분을 버리므로 `totalAssets` 감소분이 세금보다 크고, 룸 0일 때도 연금 잔액이 줄어든다.

- [ ] **Step 3: 인출 단계에서 캡하도록 수정**

`SimulationEngine.ts` 브릿지 분기에서, ISA 크레딧을 캡하던 코드를 **인출액 자체를 캡**하는 코드로 교체한다:

```ts
            // 사적연금 조기수령 채널링(Phase 4): 은퇴 전(재직 중)이라도 55세부터 저율과세 한도
            // 내에서 조기 인출해 ISA로 재투자한다. 생활비 재원이 아니므로 monthlyPensionIncomeNetDisplay/
            // annualPrivatePensionIncome(소득 표시용 필드)에는 더하지 않는다 — 재직 중이라 생활비는
            // 이 시뮬레이터가 모델링하지 않는 근로소득으로 충당된다고 가정한다.
            const limitInPensionCurrency = this.convertValue(
              Math.max(0, remainingBridgeLimitKRW), 'KRW', pension.currency, exchangeRate
            );
            const taxRate = getPrivatePensionIncomeTaxRate(currentAge);

            // 인출액은 ISA가 이번 달 실제로 받을 수 있는 만큼으로 제한한다 — 놓을 곳이 없는 돈을
            // 먼저 빼서 과세한 뒤 버리면 자금이 소멸한다(총자산 보존 위반). 이 엔진의 다른 캡들
            // (:409 ISA 납입 캡, :510 연금 인출 캡)도 모두 유출 자체를 줄이는 방식이며, 이 분기만
            // 예외가 되어서는 안 된다. ISA 잔여 룸(세후 기준)을 세전으로 역산해 상한에 포함한다.
            const roomInPensionCurrency = this.convertValue(
              isaBridgeRoomRemainingInIsaCurrency, activeIsas[0].currency, pension.currency, exchangeRate
            );
            const maxRawByIsaRoom = taxRate < 1 ? roomInPensionCurrency / (1 - taxRate) : 0;
            const drawAmountRaw = Math.max(
              0,
              Math.min(pension.currentBalance, limitInPensionCurrency, maxRawByIsaRoom)
            );

            if (drawAmountRaw > 0) {
              remainingBridgeLimitKRW -= this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
              pension.currentBalance -= drawAmountRaw;

              const drawAmountTax = drawAmountRaw * taxRate;
              const drawAmountNet = drawAmountRaw - drawAmountTax;

              // 인출액이 이미 ISA 룸으로 캡되어 있으므로 순액은 전액 적립된다(소실 없음).
              const netInIsaCurrency = this.convertValue(drawAmountNet, pension.currency, activeIsas[0].currency, exchangeRate);
              activeIsas[0].currentBalance += netInIsaCurrency;
              activeIsas[0].totalInvested += netInIsaCurrency;
              isaBridgeRoomRemainingInIsaCurrency -= netInIsaCurrency;

              annualPensionTaxPaid += this.convertValue(drawAmountTax, pension.currency, displayCurrency, exchangeRate);
              annualPreTaxTotalIncome += this.convertValue(drawAmountRaw, pension.currency, displayCurrency, exchangeRate);
              annualPrivatePensionPreTaxKRW += this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
            }
```

부동소수점 오차로 `isaBridgeRoomRemainingInIsaCurrency`가 미세한 음수가 되지 않도록, 차감 후 `Math.max(0, ...)`로 clamp하는 것을 권장한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/tests/core/usecases/SimulationEngine.privatePensionBridgeChanneling.test.ts`
Expected: 전체 PASS (기존 케이스 + 반전된 2개)

- [ ] **Step 5: 타입 체크 및 커밋**

Run: `npx tsc --noEmit` → 에러 없음

```bash
git add src/core/usecases/SimulationEngine.ts src/tests/core/usecases/SimulationEngine.privatePensionBridgeChanneling.test.ts
git commit -m "$(cat <<'EOF'
fix: 브릿지 인출을 ISA 잔여 한도로 캡해 과세 후 자금 소실 제거

기존에는 연금에서 전액 인출·과세한 뒤 ISA 월 납입 한도를 넘는 순액을
어디에도 적립하지 않고 버려 총자산 보존이 깨졌다(ISA 정기납입이 월
48.5만원을 넘으면 매달 발생). 크레딧을 캡하던 것을 인출 자체를 캡하도록
바꿔, 놓을 곳이 없는 돈은 애초에 인출하지도 과세하지도 않는다. 이는
이 엔진의 다른 캡들(ISA 납입 캡, 연금 인출 캡)과 동일한 방식이다.
EOF
)"
```

---

### Task 2: C3 + C4 + C1 — 옵티마이저를 독립 후보 2개로 재구조화

**문제:**
- **C3**: 현재 후보는 "채널링"과 "신규계좌 월 75만원 납입"을 함께 켠다. 후자는 baseline에 없는 순유입(근로소득 미모델링)이라 전자의 손실을 가린다. 측정: baseline 60 → 채널링만 63 → **신규계좌만 68** → 전체 72. 최악 사례는 채널링 단독이 70→66(악화)인데도 Phase 4가 채택되어 사용자에게 "+2점"으로 표시된 경우다.
- **C4**: `totalCandidateCount`가 전제조건 미충족으로 시뮬레이션을 0회 돌려도 무조건 `+1`이라, AI 어드바이저의 `failedCandidateCount === totalCandidateCount` 엄격 등호가 ISA 미보유 사용자 전체에서 영원히 성립하지 않는다.
- **C1**: `NEW_PENSION_MONTHLY_CONTRIBUTION = 750000`(원화 법정한도)을 `currency: templatePension.currency`와 함께 쓴다. USD 연금 사용자는 월 75만 **달러** 납입이 되어 1,322억원 유령 자산이 생긴다.

**Files:**
- Modify: `src/core/usecases/strategy/PrivatePensionChannelingOptimizer.ts` (전면 재구조화)
- Modify: `src/core/entities/types.ts` (`StrategyRecommendation.recommendedPrivatePensionChanneling` 타입 조정)
- Modify: `src/core/usecases/strategy/RecommendationEngine.ts` (Phase 4 배선, `+1` → `attempted`)
- Test: `src/tests/core/usecases/strategy/PrivatePensionChannelingOptimizer.test.ts` (재작성)

**Interfaces:**
- Consumes: Task 1의 브릿지 동작(자금 보존), 기존 `paramsForCandidate`/`computeDeltas`/`computeLifetimeUtility`.
- Produces:
  ```ts
  export interface PrivatePensionChannelingResult {
    // 채널링 레그 채택 여부. 채택되면 true, 아니면 null(false는 생산하지 않는다).
    recommendedPrivatePensionChanneling: true | null;
    // 신규 연금계좌 납입 레그 채택 여부. 채택되면 true, 아니면 null.
    recommendedNewPensionContribution: true | null;
    // 채택된 레그별 항목(0~2개). 순서: 채널링 → 신규계좌.
    itemizedContributions: ItemizedContribution[];
    finalResult: SimulationResult;
    finalUtility: UtilityBreakdown;
    // 실제로 engine.runForUtility를 호출한 횟수(전제조건 미충족이면 0).
    attemptedCount: number;
    // 그중 DomainError로 실패한 횟수.
    failedCount: number;
  }
  ```
  Task 3/4가 `recommendedPrivatePensionChanneling`과 `itemizedContributions`를 사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`PrivatePensionChannelingOptimizer.test.ts`를 새 계약에 맞게 재작성한다. 기존 파일의 픽스처 헬퍼(`makePension`/`makeIsa`/`makeResult`, `UtilityEngine` mock)는 그대로 재사용하고 케이스만 교체한다. 반드시 포함할 케이스:

```ts
  test('사적연금이 없으면 두 레그 모두 평가하지 않는다', () => {
    // privatePensions: [] → attemptedCount 0, runForUtility 미호출
  });

  test('ISA가 없으면 채널링 레그는 평가하지 않지만 신규계좌 레그는 평가한다', () => {
    // isaAccounts: [] → 채널링 후보 없음, 신규계좌 후보 1회만 실행
    // expect(runForUtility).toHaveBeenCalledTimes(1)
    // expect(result.recommendedPrivatePensionChanneling).toBeNull()
  });

  test('retirementAge가 55 이하면 채널링 레그는 평가하지 않는다(브릿지 구간 없음)', () => {
    // retirementAge: 55 → 채널링 후보 없음
  });

  test('currentAge가 retirementAge 이상이면 신규계좌 레그도 평가하지 않는다(납입 기간 없음)', () => {
    // currentAge: 60, retirementAge: 60 → 두 레그 모두 없음, attemptedCount 0
  });

  test('채널링 후보에는 기존 계좌 전부가 켜지고 신규 계좌는 추가되지 않는다', () => {
    // 채널링 후보 params 검사:
    //  - 모든 기존 pension이 earlyChannelingEnabled: true
    //  - privatePensions.length === 기존 개수 (신규 계좌 없음)
    //  - withdrawalPlan.isaMaturityDestination === 'asset'
  });

  test('채널링 후보는 기존 계좌 납입을 신규 계좌로 이전해 순유입을 보존한다', () => {
    // 기존 계좌 monthlyContribution: 500000 → 채널링 후보에서
    //  - 기존 계좌는 monthlyContribution: 0
    //  - 이전용 계좌 1개가 monthlyContribution: 500000 으로 추가됨 (합계 보존)
    // 기존 계좌 납입이 0이면 이전용 계좌를 만들지 않는다(별도 케이스로 검증)
  });

  test('신규계좌 후보는 채널링을 켜지 않고 월 75만원 계좌만 추가한다', () => {
    // 신규계좌 후보 params 검사:
    //  - 기존 pension에 earlyChannelingEnabled 없음(falsy)
    //  - 추가된 계좌 monthlyContribution === 750000
    //  - withdrawalPlan.isaMaturityDestination을 건드리지 않음
  });

  test('신규 계좌의 통화는 템플릿과 무관하게 항상 KRW다', () => {
    // 기존 pension currency: 'USD' → 추가된 계좌 currency === 'KRW'
    // (750000은 원화 법정 한도이므로 USD로 해석되면 안 된다)
  });

  test('채널링만 유리하면 채널링만 채택한다', () => {
    // 채널링 후보 개선, 신규계좌 후보 비개선
    // → recommendedPrivatePensionChanneling: true, recommendedNewPensionContribution: null
    // → itemizedContributions 길이 1
  });

  test('두 레그가 모두 유리하면 둘 다 채택하고 항목도 2개다', () => {
    // → itemizedContributions 길이 2, finalResult는 둘 다 적용한 결과
  });

  test('두 레그 모두 불리하면 no-op이고 finalResult/finalUtility는 입력 그대로다', () => {
    // toBe로 참조 동일성까지 검증
  });

  test('한 레그가 DomainError로 실패해도 다른 레그는 계속 평가하고 failedCount를 센다', () => {
    // 첫 호출만 throw → failedCount 1, 나머지 레그는 정상 평가
  });

  test('DomainError가 아닌 예외는 그대로 다시 던진다', () => {
  });

  test('attemptedCount는 실제 시뮬레이션 실행 횟수와 일치한다', () => {
    // 전제조건 전부 충족 → 2 (두 레그 각각 1회) + 둘 다 채택 시 통합 검증 1회면 3
  });
```

**두 레그를 모두 채택했을 때의 `finalResult` 결정 방식**: 두 레그를 함께 적용한 params로 **한 번 더** 시뮬레이션해 그 결과를 `finalResult`로 쓴다(레그 간 상호작용 반영). 그 통합 결과가 baseline보다 나쁘면 더 나은 단일 레그만 채택한다 — Phase 3의 `DividendReinvestmentOptimizer` 통합 검증과 같은 안전장치다. 이 동작도 테스트로 고정한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/PrivatePensionChannelingOptimizer.test.ts`
Expected: FAIL — 새 반환 필드(`recommendedNewPensionContribution`, `itemizedContributions`, `attemptedCount`, `failedCount`)가 아직 없음.

- [ ] **Step 3: 옵티마이저 재구조화**

`PrivatePensionChannelingOptimizer.ts`를 다음 구조로 다시 쓴다:

- 상수: `NEW_PENSION_MONTHLY_CONTRIBUTION = 750000`(원화), `CHANNELING_TRANSFER_PENSION_ID`, `NEW_PENSION_ID`.
- `buildPensionAccount(templatePension, id, monthlyContributionKRW)`: 신규/이전용 계좌 생성 공통 헬퍼. **`currency: 'KRW'` 고정**, `annualReturn`/`investmentType`/`dividendYield`는 템플릿에서 복사, `balance: 0`, `type: 'irp'`. 상수가 원화 법정 한도라는 이유를 주석으로 명시한다.
- `buildChannelingParams(params)`: 기존 계좌 전부 `earlyChannelingEnabled: true` + `monthlyContribution: 0`, `withdrawalPlan.isaMaturityDestination: 'asset'`(필드만 덮어씀), 그리고 **기존 계좌 납입 합계가 0보다 크면** 그 합계만큼 납입하는 이전용 계좌를 1개 추가해 순유입을 보존한다. 통화가 섞여 있을 수 있으므로 합계는 KRW로 환산해 더한다 — 환율은 `params.baseExchangeRate`와 `params.exchangeScenario`를 쓰되, 엔진의 `getExchangeRate`와 동일한 식이어야 한다(엔진이 private이면 동일 계산을 여기서 수행하고 그 사실을 주석으로 남긴다).
- `buildNewPensionParams(params)`: 채널링을 켜지 않고 `NEW_PENSION_MONTHLY_CONTRIBUTION` 계좌만 추가. `withdrawalPlan`은 건드리지 않는다.
- 전제조건:
  - 공통: `params.privatePensions.length > 0` (템플릿 계좌 필요)
  - 채널링 레그: 추가로 `isaAccounts.length > 0` **그리고** `retirementAge > PRIVATE_PENSION_MIN_START_AGE` **그리고** `currentAge < retirementAge`
  - 신규계좌 레그: 추가로 `currentAge < retirementAge` (납입할 기간이 있어야 함)
- 평가: 각 레그를 독립적으로 `engine.runForUtility` → `computeLifetimeUtility`, baseline(`bestUtility`) 대비 개선 여부 판정. 각 레그의 `try/catch`는 `DomainError`만 삼키고 `failedCount++`, 그 외는 재던진다. **`try`는 `runForUtility` 호출만 감싸고** `computeLifetimeUtility`/`computeDeltas`는 밖으로 뺀다(리뷰 지적 L1).
- 둘 다 개선이면 통합 params로 1회 더 평가(위 Step 1 참고).
- `console.warn`에 식별 컨텍스트를 남긴다(Phase 3의 `asset.id` 대응):
  ```ts
  console.warn('Skipping private pension channeling candidate that failed to simulate', {
    leg, pensionCount: params.privatePensions.length, isaCount: params.isaAccounts?.length ?? 0,
    currentAge: params.userProfile.currentAge, retirementAge: params.userProfile.retirementAge,
  }, err);
  ```
- 항목 라벨은 실행에 필요한 수치를 포함한다:
  - 채널링: `'사적연금을 55세부터 저율과세 한도(연 1,500만원) 내에서 조기 수령해 ISA에 재투자합니다. 기존 연금 계좌 납입은 중단하고 같은 금액을 새 계좌로 옮기며, ISA 만기 자금은 일반 자산으로 이전합니다.'`
  - 신규계좌: `'연금 계좌를 새로 개설해 퇴직 전까지 월 75만원(연 900만원 세액공제 한도)을 추가로 납입합니다.'`
- 모듈 헤더 주석에 **모델 한계 caveat**를 반드시 적는다(현재 계획 문서에만 있고 코드에 없음):
  ```
  // 주의: 이 시뮬레이터는 은퇴 전 근로소득과 소득세를 모델링하지 않는다. 따라서 신규 연금 계좌
  // 납입의 실제 이점인 "세액공제"는 Utility 점수에 전혀 반영되지 않으며, 이 레그의 개선분은
  // 오직 "추가로 저축한 자금"의 효과다(추가 저축이므로 대체로 개선으로 나온다). 반면 채널링
  // 레그는 기존 자산의 재배치라 순유입이 보존되며, 세율·수익률 차이에 따른 진짜 최적화다.
  ```

- [ ] **Step 4: 타입 및 배선 갱신**

`types.ts`:
```ts
  // 사적연금 조기수령 채널링(Phase 4-A) 권장 여부. 채택되면 true, 아니면 null.
  // false는 생산되지 않는다 — 사용자가 직접 켤 수 있는 설정이 아니므로 "끄라는 추천"이 존재할 수 없다
  // (사용자 설정값을 뒤집을 수 있는 recommendedAssetReinvestment와의 결정적 차이).
  recommendedPrivatePensionChanneling: true | null;
  // 신규 연금계좌 추가 납입(Phase 4-B) 권장 여부. 채택되면 true, 아니면 null.
  recommendedNewPensionContribution: true | null;
```

`RecommendationEngine.ts`:
- `channelingOpt.itemizedContribution` 단수 → `channelingOpt.itemizedContributions` 복수를 `additionalItemizedContributions`에 spread.
- 반환값에 `recommendedNewPensionContribution` 추가.
- 집계를 정확하게:
  ```ts
  const totalCandidateCount = candidateStats.total + params.assets.length + channelingOpt.attemptedCount;
  const failedCandidateCount = candidateStats.failed + reinvestOpt.failedAssetCount + channelingOpt.failedCount;
  ```
  주석도 "무조건 +1"이 아니라 "실제 시뮬레이션 실행 횟수"로 정정한다.

`recommendedPrivatePensionChanneling: true | null`로 좁히면 `computeExecutionRoadmap.test.ts`의 `makeRecommendation(null, false)` 케이스가 컴파일 에러가 난다 — 표현 불가능해진 상태를 검증하던 테스트이므로 **해당 케이스를 삭제**한다.

- [ ] **Step 5: 전체 확인 및 커밋**

Run: `npx vitest run src/tests/core/usecases/strategy/` → PASS
Run: `npx tsc --noEmit` → 에러 없음
Run: `npm test` → 전체 PASS (기존 characterization 테스트가 깨지면 새 동작이 맞는지 케이스별로 판단해 기대값 갱신)

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: Phase 4를 독립 후보 2개로 분리하고 통화·시도집계 버그 수정

C3: "채널링"과 "신규계좌 납입"을 하나로 묶어 평가하던 것을 독립 후보로
분리했다. 후자는 baseline에 없는 순유입이라 전자의 손실을 가렸고, 실제로
채널링 단독이 악화(-4점)인데도 전체가 채택되어 사용자에게 +2점으로
표시되는 사례가 있었다. 채널링 후보는 기존 계좌 납입을 이전용 계좌로
옮겨 순유입을 보존한다.

C1: 신규 계좌 통화를 KRW로 고정했다. 750000은 원화 법정 한도인데 템플릿
계좌 통화를 그대로 복사해, USD 연금 사용자에게 월 75만 달러 납입이 되어
1,322억원 유령 자산이 생성됐다.

C4: totalCandidateCount가 시뮬레이션 0회에도 무조건 +1이라 AI 어드바이저의
실패 감지 등호가 ISA 미보유 사용자 전체에서 성립하지 않던 것을, 실제 실행
횟수(attemptedCount)를 집계하도록 고쳤다.
EOF
)"
```

---

### Task 3: I1 — 채택된 ISA 만기 목적지 변경을 사용자에게 노출

**문제:** 채널링 후보는 `isaMaturityDestination: 'asset'`을 강제하는데 `recommendStrategy()`가 반환하는 `recommendedPlan`에는 반영되지 않는다. `computeItemizedContributions`는 `recommendedPlan[field] !== identityPlan[field]`인 필드만 체크리스트 항목으로 만들고 `getIdentityPlan`은 `'pension'`을 반환하므로, 사용자는 이 변경을 **전혀 안내받지 못한다**. 그런데 화면에 표시되는 모든 수치(`recommendedUtility`, `recommendedResult`, `deltas`, Before/After, PDF)는 그 변경을 전제로 계산된 값이다. 사용자가 체크리스트대로 실행하면 이 override가 막으려던 트레드밀 손실을 그대로 맞는다.

**Files:**
- Modify: `src/core/usecases/strategy/RecommendationEngine.ts`
- Test: `src/tests/core/usecases/strategy/RecommendationEngine.test.ts`

**Interfaces:**
- Consumes: Task 2의 `channelingOpt.recommendedPrivatePensionChanneling`.
- Produces: 채널링 채택 시 `recommendedPlan.isaMaturityDestination === 'asset'`이 보장된다.

- [ ] **Step 1: 실패하는 테스트 작성**

`RecommendationEngine.test.ts`의 Phase 4 describe 블록에 추가:

```ts
  test('채널링이 채택되면 recommendedPlan에도 isaMaturityDestination 변경이 반영된다', () => {
    // Phase 4가 채택되는 기존 픽스처를 재사용한다.
    const result = recommendStrategy(params, engine);
    expect(result.recommendedPrivatePensionChanneling).toBe(true);
    // 후보 시뮬레이션이 전제한 값이 추천안에도 실제로 담겨야 한다 —
    // 그렇지 않으면 사용자가 체크리스트대로 해도 표시된 수치가 재현되지 않는다.
    expect(result.recommendedPlan?.isaMaturityDestination).toBe('asset');
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/RecommendationEngine.test.ts -t "isaMaturityDestination"`
Expected: FAIL — `recommendedPlan`이 `null`이거나 `'pension'`.

- [ ] **Step 3: 구현**

`RecommendationEngine.ts` 반환부에서, 채널링이 채택된 경우 `recommendedPlan`에 해당 필드를 반영한다. `bestPlan`이 `null`일 수도 있으므로 그때는 `identityPlan` 기반으로 완결된 plan을 만든다:

```ts
  // 채널링 후보는 isaMaturityDestination을 'asset'으로 강제해 평가됐다. 그 전제가 추천안에
  // 담기지 않으면 사용자가 체크리스트대로 실행해도 화면에 표시된 수치를 재현할 수 없고,
  // 오히려 이 override가 제거하려던 트레드밀 손실을 그대로 맞게 된다.
  const recommendedPlan: CompleteWithdrawalPlan | null =
    channelingOpt.recommendedPrivatePensionChanneling
      ? { ...(bestPlan ?? identityPlan), isaMaturityDestination: 'asset' }
      : bestPlan;
```
그리고 반환 객체의 `recommendedPlan: bestPlan`을 `recommendedPlan`으로 바꾼다.

주의: `computeItemizedContributions`는 이 값이 아니라 기존 `bestPlan` 기준으로 이미 계산되어 있다(`withdrawalItemizedContributions`). 채널링의 ISA 목적지 변경은 Task 2에서 채널링 항목 라벨에 이미 문구로 포함했으므로 중복 항목을 만들지 않는다 — 이 사실을 주석으로 남긴다.

- [ ] **Step 4: 통과 확인 및 커밋**

Run: `npx vitest run src/tests/core/usecases/strategy/RecommendationEngine.test.ts` → PASS
Run: `npx tsc --noEmit` → 에러 없음

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: 채널링 채택 시 ISA 만기 목적지 변경을 recommendedPlan에 반영

채널링 후보는 isaMaturityDestination을 'asset'으로 강제해 평가되는데
그 전제가 추천안에 담기지 않아, 사용자가 체크리스트대로 실행하면 화면에
표시된 수치가 재현되지 않고 오히려 트레드밀 손실을 맞게 되어 있었다.
EOF
)"
```

---

### Task 4: I2 — 로드맵과 자산 고갈 나이가 같은 시나리오를 가리키도록 통일

**문제:** 커밋 `e580a1a`가 로드맵의 사적연금 개시 나이를 `recommendedPrivatePensionChanneling` 기준으로 바꿨는데, 두 호출부의 `depletionAge` 선택은 여전히 `recommendedPlan` 기준이다. Phase 1/2가 개선을 못 찾고 Phase 4만 채택되면(`recommendedPlan === null`) 로드맵은 **추천 시나리오의 55세 마일스톤과 baseline 시나리오의 고갈 나이를 한 타임라인에 섞어** 보여준다. `DashboardSection.tsx:183-184`의 주석이 선언한 불변식이 바로 이것이며, 지금 깨져 있다.

**Files:**
- Modify: `src/web/features/Dashboard/DashboardSection.tsx` (대략 `:189`)
- Modify: `src/app/simulator/page.tsx` (대략 `:279`)
- Test: `src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts`

**Interfaces:** 없음(호출부 조건만 변경).

- [ ] **Step 1: 두 호출부의 선택 조건을 통일**

두 곳 모두 다음으로 바꾼다:

```ts
recommendation?.improved ? recommendation.recommendedResult.depletionAge : result.depletionAge
```

`improved`는 `channelingOpt.finalUtility.score > currentUtility.score`로 계산되므로 Phase 1~4 어느 축에서든 개선이 채택된 경우를 모두 포함한다. `DashboardSection.tsx`의 기존 주석도 "추천 plan이 있으면"이 아니라 "추천이 개선을 찾았으면"으로 정정한다.

- [ ] **Step 2: 로드맵 회귀 테스트 추가**

`computeExecutionRoadmap.test.ts`에 추가:

```ts
  test('Phase 4만 채택된 경우(recommendedPlan=null)에도 로드맵과 고갈 나이가 같은 시나리오를 가리킨다', () => {
    // computeExecutionRoadmap 자체는 depletionAge를 인자로 받으므로, 여기서는 채널링 채택 시
    // 55세 마일스톤이 나오는 것과 depletionAge 인자가 그대로 이벤트로 반영되는 것만 확인하고,
    // 호출부의 선택 조건은 위 Step 1에서 improved 기준으로 통일한 것으로 보장한다.
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null, true), 80);
    expect(roadmap.events.find((e) => e.age === 55)).toBeDefined();
    expect(roadmap.events.find((e) => e.age === 80)!.items.some((i) => i.severity === 'warning')).toBe(true);
  });
```

- [ ] **Step 3: 통과 확인 및 커밋**

Run: `npx vitest run src/tests/core/usecases/dashboard/computeExecutionRoadmap.test.ts` → PASS
Run: `npx tsc --noEmit` → 에러 없음

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: 로드맵 나이 이벤트와 자산 고갈 나이가 같은 시나리오를 가리키도록 통일

Phase 4만 채택되고 recommendedPlan이 null인 경우, 로드맵은 추천 시나리오의
55세 마일스톤과 baseline 시나리오의 고갈 나이를 섞어 보여줬다. 두 호출부의
선택 조건을 recommendedPlan 유무에서 improved로 통일했다.
EOF
)"
```

---

### Task 5: 테스트 공백 보강 및 주석 정정

**Files:**
- Test: `src/tests/core/usecases/SimulationEngine.privatePensionBridgeChanneling.test.ts`
- Test: `src/tests/core/usecases/strategy/RecommendationEnginePhase4Params.test.ts`
- Modify: `src/core/usecases/SimulationEngine.ts` (주석만)
- Modify: `src/core/usecases/dashboard/computeExecutionRoadmap.ts` (주석만)
- Modify: `src/core/entities/types.ts` (주석만)

**Interfaces:** 없음(테스트·주석 전용).

- [ ] **Step 1: 다계좌 브릿지 한도 공유 테스트 추가 (리뷰 9/10 우선순위)**

퇴직연금+연금저축 동시 보유는 흔한 구성인데 전 테스트가 단일 계좌다. `remainingBridgeLimitKRW`를 `forEach` 안으로 옮기는 리팩터링이면 계좌당 15M씩 인출(세법 위반)되는데 아무것도 실패하지 않는다.

```ts
  test('사적연금 계좌가 2개여도 저율과세 한도는 계좌 간에 공유된다', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [
        { ...baseParams.privatePensions[0], id: 'p1', balance: 100000000 },
        { ...baseParams.privatePensions[0], id: 'p2', balance: 100000000, earlyChannelingEnabled: true },
      ],
    };
    const result = engine.run(params);
    const at54 = result.yearlyResults.find((r) => r.age === 54)!;
    const at55 = result.yearlyResults.find((r) => r.age === 55)!;
    // 계좌당 15M(합계 30M)이 아니라 합계 15M만 인출되어야 한다.
    expect(at54.pensionAssets - at55.pensionAssets).toBeCloseTo(15000000, 0);
  });

  test('첫 계좌 잔액이 한도보다 적으면 나머지를 두 번째 계좌가 채운다', () => {
    // p1 balance 5,000,000 / p2 balance 100,000,000 → p1 전액 소진 후 p2에서 10,000,000
    // p1의 기말 잔액이 0에 가까운지, 합계 감소분이 15,000,000인지 검증
  });
```

- [ ] **Step 2: 통화 변환 테스트 추가 (리뷰 8/10 우선순위)**

전 픽스처가 KRW라 브릿지 분기의 `convertValue` 4곳이 전부 항등 no-op이다 — 인자 순서가 뒤바뀌어도 보이지 않는다.

```ts
  test('USD 사적연금 + KRW ISA에서도 저율과세 한도가 원화 기준으로 정확히 적용된다', () => {
    // pension currency 'USD', balance 200000 (=2.7억), ISA는 KRW
    // baseExchangeRate 1350 기준으로 원화 환산 인출액이 15,000,000원이어야 한다
    // (pensionAssets는 표시 통화 기준이므로 displayCurrency 'KRW'로 확인)
  });
```

- [ ] **Step 3: Phase 3 → Phase 4 자산 핸드오프 테스트 추가 (리뷰 8/10 우선순위)**

`RecommendationEnginePhase4Params.test.ts`의 `baseParams`가 `assets: []`이라 `paramsAfterPhase3`의 `assets` 매핑 분기가 **한 번도 실행되지 않는다**. 그 블록을 통째로 지워도 전체 스위트가 통과한다.

기존 `RecordingEngine` 하니스를 그대로 쓰고, Phase 3가 `reinvestDividend`를 뒤집는 자산을 픽스처에 추가한 뒤:

```ts
    const phase4Call = findPhase4Call(engine)!;
    expect(phase4Call.assets.find((a) => a.id === 'asset-1')!.reinvestDividend).toBe(false);
```

- [ ] **Step 4: 주석 정정**

1. `SimulationEngine.ts`의 두 한도 트래커 분리 주석 — 현재 *"두 한도는 서로 다른 인출 경로라 섞이면 안 된다"*는 **한국 세법 서술로 틀렸다**. 저율과세 한도는 인출 사유와 무관한 1인당 단일 연간 한도이며, 엔진도 두 경로를 `annualPrivatePensionPreTaxKRW`에 합산해 연말에 초과과세한다. 또한 두 캡의 적용 조건이 비대칭이다(브릿지는 항상, 은퇴 후는 `limitPrivatePensionToTaxLimit`가 켜졌을 때만 — 기본값 `false`). 다음 취지로 정정:
   > 같은 법정 한도(연 1,500만원)를 서로 다른 코드 경로가 각각 추적한다. 브릿지는 설정과 무관하게 항상 캡하고, 은퇴 후 경로는 `limitPrivatePensionToTaxLimit`가 켜졌을 때만 캡한다. 두 경로가 같은 해에 함께 소진될 수 있으므로 인출 캡만으로 연간 상한이 보장되지는 않으며, 초과분은 연말 `calculatePrivatePensionExcessTaxNeededKRW` 합산 과세로 처리된다. (다만 은퇴 전에는 `monthlyTargetSpending`이 0이라 부족분 후행 인출 경로가 발동하지 않으므로, 브릿지 구간에서 두 캡이 동시에 소진되는 일은 실제로는 발생하지 않는다.)

2. `computeExecutionRoadmap.ts`의 사적연금 나이 주석 — 채널링 채택 시에도 엔진의 `planStartAge`(= `clamp(retirementAge)`) 기준 정상 인출은 **여전히 존재**한다(브릿지는 생활비 재원이 아닌 ISA 채널링). 로드맵이 UI 단순화를 위해 조기 개시 시점만 표시한다는 사실을 명시한다.

3. `types.ts`의 `earlyChannelingEnabled` 주석 — 발동 조건 4개(`!isRetired`, `currentAge >= 55`, ISA 1개 이상 존재, 잔액 > 0)를 명시하고, 조건 미충족 시 **아무 경고 없이 무시**된다는 점을 적는다.

- [ ] **Step 5: 테스트 위생 정리**

- `SimulationEngine.privatePensionBridgeChanneling.test.ts`의 자기 자신을 검증하는 항진 단언(`expect(uncappedAnnualInflow).toBeGreaterThan(20000000)` 형태 — 바로 윗줄에서 테스트가 계산한 상수를 검증하므로 프로덕션 코드를 전혀 실행하지 않음)을 제거한다.
- 같은 파일의 미사용 변수(`monthlyLimit` 등)를 제거한다.
- `computeExecutionRoadmap.test.ts`의 `improved:` 필드 조작은 `computeExecutionRoadmap`이 `improved`를 읽지 않으므로 무의미하다 — 픽스처를 단순화한다.

- [ ] **Step 6: 전체 확인 및 커밋**

Run: `npm test` → 전체 PASS
Run: `npx tsc --noEmit` → 에러 없음

```bash
git add -A
git commit -m "$(cat <<'EOF'
test: Phase 4 테스트 공백 보강 및 부정확한 주석 정정

다계좌 한도 공유·통화 변환·Phase3→4 자산 핸드오프는 전부 무테스트라
회귀가 조용히 통과하던 상태였다(자산 핸드오프는 해당 블록을 통째로 지워도
스위트가 통과). 저율과세 한도를 "경로별 별개 한도"로 서술하던 주석은 한국
세법상 틀린 서술이라 정정했다.
EOF
)"
```

---

### Task 6: 최종 회귀 검증

**Files:** 없음(검증 전용).

- [ ] **Step 1: 전체 테스트**

Run: `npm test`
Expected: 전체 PASS. 기준선은 작업 시작 시점 59파일/474테스트이며, 이 계획으로 테스트가 추가되므로 개수는 늘어난다.

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit` → 에러 없음

- [ ] **Step 3: 성능 회귀 확인**

Run: `npx vitest run src/tests/core/usecases/strategy/RecommendationEngine.performance.test.ts`
Expected: PASS, 5초 이내. Phase 4가 최대 1회에서 최대 3회 시뮬레이션으로 늘었으므로 예산 여유를 확인한다. 초과하면 보고한다(임의로 예산을 늘리지 말 것).

- [ ] **Step 4: lint**

Run: `npx eslint src/core/usecases/strategy/PrivatePensionChannelingOptimizer.ts src/core/usecases/SimulationEngine.ts src/core/usecases/strategy/RecommendationEngine.ts src/core/entities/types.ts src/core/usecases/dashboard/computeExecutionRoadmap.ts`
Expected: 이번 변경으로 새로 생긴 에러 없음. `SimulationEngine.ts`에는 이 브랜치와 무관한 기존 `prefer-const` 에러 5건(`:373, :386, :694, :695, :696`)이 있으며 `develop` 기준선에도 존재하므로 그대로 둔다.

- [ ] **Step 5: 수정이 있었다면 커밋**

Step 1~4에서 수정이 발생했으면 별도 커밋한다. 없으면 커밋 없이 종료한다.

## 범위 밖 (이번 계획에서 다루지 않음)

- `DividendReinvestmentOptimizer.ts`(Phase 3)의 동일 계열 params 구성 문제 — 이미 출시·별도 리뷰된 기능이라 이번 수정 범위 밖이다. 다만 Phase 4의 baseline이 Phase 3 결과이므로 영향이 있다는 사실은 `RecommendationEngine.ts` 주석에 알려진 한계로 남긴다.
- `AssetFormSection.tsx`의 `handleUpdatePrivatePension` 타입 좁히기(내부 플래그 유출 방지) — 현재 web/app 레이어에 `earlyChannelingEnabled` 참조가 전혀 없어 실제 유출 경로가 아니다(이론적 방어). 별도 하드닝 작업으로 미룬다.
- 건강보험료가 재직 중 브릿지 소득에 부과되는 문제, 일반자산 부재 시 세금 미징수 폴백 — 전자는 채택에 불리하게(안전한 방향으로) 작용하고 후자는 기존 코드의 문제라 별도 작업으로 미룬다.
- `preTaxTotalIncome`/`totalIncome` 비대칭으로 인한 `taxEfficiency` 왜곡 — 지표 정의 자체를 건드려야 하므로 별도 설계가 필요하다.
