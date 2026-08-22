import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// 연금만 있고 55세 미만이라 «법적으로» 인출할 수 없는 해를 만든다.
function tooYoungForPension(): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 50, expectancy: 52, targetMonthlySpending: 3_000_000 },
    assets: [], isaAccounts: [], otherIncomes: [],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
      balance: 500_000_000, monthlyContribution: 0,
      totalReturn: 0, dividendYield: 0, currency: 'KRW',
    }],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    hardSpendingFloor: 3_000_000,
  } as unknown as SimulationParams;
}

describe('설명되지 않는 부족은 남지 않는다', () => {
  test('법정 나이에 막힌 해는 사유가 남는다', () => {
    const result = new SimulationEngine().runSingle(tooYoungForPension());

    for (const year of result.yearlyResults) {
      const d = year.ledger!.diagnostics;
      if (d.unmetHardSpending > 0) {
        expect(d.blockedWithdrawalReason, `${year.age}세`).toBe('legalAge');
      }
    }
  });

  test('바닥을 채우려고 선호를 깬 해는 그 사실이 남는다', () => {
    const result = new SimulationEngine().runSingle({
      ...tooYoungForPension(),
      userProfile: { currentAge: 60, retirementAge: 60, expectancy: 62, targetMonthlySpending: 5_000_000 },
      taxSettings: { limitPrivatePensionToTaxLimit: true },
      hardSpendingFloor: 4_000_000,
    } as unknown as SimulationParams);

    const first = result.yearlyResults[0];
    expect(first.ledger!.diagnostics.brokenPreferences).toContain('pensionTaxLimit');
    expect(first.ledger!.diagnostics.overrideReason).toBe('hardSpendingFloor');
  });

  test('바닥이 없으면 진단이 비어 있다', () => {
    const params = tooYoungForPension();
    delete (params as unknown as Record<string, unknown>).hardSpendingFloor;

    const result = new SimulationEngine().runSingle(params);

    for (const year of result.yearlyResults) {
      expect(year.ledger!.diagnostics.brokenPreferences).toEqual([]);
      expect(year.ledger!.diagnostics.unmetHardSpending).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 위 세 건은 «사유가 남는가»를 고정한다. 아래는 그 반대편 — 사유가 없을 때 실제로 «던지는가»,
// 그리고 각 사유가 실제 원인일 때만 붙는가를 고정한다.
//
// 이 절이 없던 동안 `assetFloorBlockedWithdrawal = true`를 `false`로 바꿔도 전체 2,451건이
// 그대로 통과했다. 불변식은 던지는 것이 존재 이유이므로, 던지는 경로에 테스트가 없으면
// 불변식이 조용해진 것을 아무도 알아채지 못한다.
// ─────────────────────────────────────────────────────────────────────────────

import { buildYearLedger, assertSpendingShortfallExplained } from '@/core/usecases/ledger/YearLedger';
import { SimulationConsistencyError } from '@/core/entities/errors';
import type { YearLedgerDiagnostics } from '@/core/entities/types';

function ledgerWith(diagnostics: YearLedgerDiagnostics) {
  return buildYearLedger({
    age: 60, beginningAssets: 0, endingAssets: 0,
    priceGain: 0, grossDividend: 0, dividendPaidOutNet: 0, dividendRetainedNet: 0,
    nationalPensionPreTax: 0, otherIncome: 0, contributions: 0,
    privatePensionWithdrawal: 0, taxableAccountWithdrawal: 0, isaWithdrawal: 0,
    living: 0, tax: 0, healthInsurance: 0,
    diagnostics,
  });
}

const noReason: YearLedgerDiagnostics = {
  brokenPreferences: [],
  unmetHardSpending: 32_100_000,
  unmetTargetSpending: 32_100_000,
};

describe('불변식은 실제로 던진다', () => {
  test('닿을 수 있는 돈이 남았는데 사유가 없으면 던진다', () => {
    expect(() => assertSpendingShortfallExplained(ledgerWith(noReason), 480_000_000))
      .toThrow(SimulationConsistencyError);
    // 메시지는 사용자가 아니라 «고치는 사람»이 읽는다. 두 금액이 함께 있어야 어느 쪽이
    // 이상한지 판단할 수 있으므로 둘 다 고정한다.
    expect(() => assertSpendingShortfallExplained(ledgerWith(noReason), 480_000_000))
      .toThrow('60세: 인출 가능 자산 480,000,000원이 있는데 HARD 생활비 32,100,000원이 부족한데 사유가 기록되지 않았습니다.');
  });

  test('사유가 있으면 던지지 않는다', () => {
    for (const reason of ['assetFloor', 'legalAge', 'isaPrincipalExhausted'] as const) {
      expect(() => assertSpendingShortfallExplained(
        ledgerWith({ ...noReason, blockedWithdrawalReason: reason }), 480_000_000
      )).not.toThrow();
    }
  });

  // 비대칭. 꺼낼 것이 없는 부족은 «정의상» 설명된 것이라 사유가 필요 없다 —
  // 이 두 건이 깨지면 불변식이 정상 고갈 시나리오 전부에서 던지기 시작한다.
  test('꺼낼 것이 없으면 사유가 없어도 던지지 않는다', () => {
    expect(() => assertSpendingShortfallExplained(ledgerWith(noReason), 0)).not.toThrow();
  });

  test('부족이 원 미만이면 던지지 않는다', () => {
    expect(() => assertSpendingShortfallExplained(
      ledgerWith({ ...noReason, unmetHardSpending: 1e-9 }), 480_000_000
    )).not.toThrow();
  });
});

const isaAccount = (balance: number, totalReturn: number) => ({
  id: 'i', type: 'general', investmentType: 'etf', name: 'ISA',
  balance, monthlyContribution: 0, totalReturn, dividendYield: 0,
  currency: 'KRW', maturityYears: 100,
});

function withdrawalBlocked(over: Record<string, unknown>): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 63, targetMonthlySpending: 5_000_000 },
    assets: [{
      id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 300_000_000,
      totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
    }],
    isaAccounts: [], otherIncomes: [], privatePensions: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    hardSpendingFloor: 5_000_000,
    ...over,
  } as unknown as SimulationParams;
}

// 상속 하한선이 인출을 막는 것은 «2단계 전용» 사실이다. 1단계(HARD 생활비 바닥)는 계층 1이라
// 계층 2인 하한선을 넘겨서라도 채우므로 1단계에서는 막히지 않는다
// (SimulationEngine.assetFloorBreak.test.ts). 그래서 아래 두 시나리오는 바닥을 목표 생활비보다
// «낮게» 두어 2단계가 실제로 도는 해를 만든다 — 그 2단계가 하한선에 막힌다.
describe('막힌 사유는 실제 원인일 때만 붙는다', () => {
  test('상속 하한선이 2단계 인출을 자른 해는 assetFloor가 남는다', () => {
    const result = new SimulationEngine().runSingle(
      withdrawalBlocked({ assetFloor: 280_000_000, hardSpendingFloor: 1_000_000 })
    );

    for (const year of result.yearlyResults) {
      const d = year.ledger!.diagnostics;
      // 계층 1은 끝까지 채워진다 — 하한선이 자른 것은 목표 생활비(계층 3)뿐이다.
      expect(d.unmetHardSpending, `${year.age}세`).toBe(0);
      expect(d.unmetTargetSpending, `${year.age}세`).toBeGreaterThan(0);
      expect(d.blockedWithdrawalReason, `${year.age}세`).toBe('assetFloor');
    }
  });

  // 이 태스크의 핵심 회귀. 예전에는 연말에 포트폴리오를 훑어 「수익금이 잠긴 ISA가 있는가」로
  // 판정했다. 수익이 조금이라도 난 ISA는 첫해부터 그 조건을 만족하므로, 실제 원인이
  // 하한선인데도 ISA가 사유 자리를 차지했다. 그러면 사용자는 틀린 설명을 읽고, 하한선
  // 기록이 사라져도 불변식이 조용해진다.
  test('수익이 난 ISA를 들고 있어도 하한선이 원인이면 ISA를 사유로 적지 않는다', () => {
    const result = new SimulationEngine().runSingle(withdrawalBlocked({
      assetFloor: 280_000_000,
      hardSpendingFloor: 1_000_000,
      isaAccounts: [isaAccount(10_000_000, 5)],
    }));

    for (const year of result.yearlyResults) {
      const d = year.ledger!.diagnostics;
      expect(d.unmetTargetSpending, `${year.age}세`).toBeGreaterThan(0);
      expect(d.blockedWithdrawalReason, `${year.age}세`).toBe('assetFloor');
      expect(d.blockedWithdrawalReason, `${year.age}세`).not.toBe('isaPrincipalExhausted');
    }
  });

  test('납입원금이 말라 수익금에 닿지 못한 해는 isaPrincipalExhausted가 남는다', () => {
    const result = new SimulationEngine().runSingle(withdrawalBlocked({
      userProfile: { currentAge: 60, retirementAge: 60, expectancy: 66, targetMonthlySpending: 10_000_000 },
      hardSpendingFloor: 10_000_000,
      assets: [],
      isaAccounts: [isaAccount(300_000_000, 8)],
    }));

    // 원금이 남아 있는 동안은 다 채우므로 사유가 없고, 마른 뒤에만 사유가 붙는다.
    const blocked = result.yearlyResults.filter((y) => y.ledger!.diagnostics.unmetHardSpending > 0);
    expect(blocked.length).toBeGreaterThan(0);
    for (const year of blocked) {
      expect(year.ledger!.diagnostics.blockedWithdrawalReason, `${year.age}세`)
        .toBe('isaPrincipalExhausted');
      // 잔액은 «남아 있는데» 못 쓴다. 이것이 원시 잔액과 인출 가능액을 구분하는 이유다.
      expect(year.totalAssets, `${year.age}세`).toBeGreaterThan(0);
    }
    for (const year of result.yearlyResults) {
      if (year.ledger!.diagnostics.unmetHardSpending === 0) {
        expect(year.ledger!.diagnostics.blockedWithdrawalReason, `${year.age}세`).toBeUndefined();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 위 네 건은 «손으로 만든» 원장으로 불변식 함수만 검사한다. 그것으로는 「엔진이 그 불변식에
// 도달하는가」가 고정되지 않는다. 실측: recordBlockedWithdrawal을 통째로 no-op으로 바꿔도
// 전체 테스트 중 SimulationConsistencyError로 깨지는 것은 «한 건도 없었다». 사유가 남는 기존
// 시나리오는 전부 「닿을 수 있는 돈이 0인 해」라 전제(withdrawableNowAtFloorPhase > 1원)에서
// 걸러졌기 때문이다 — 불변식의 살아 있는 경로는 테스트되지 않은 채였다.
//
// 아래 한 건이 그 빈칸을 메운다. 실제 엔진 실행에서 «부족 > 1원»과 «인출 가능 자산 > 1원»이
// 같은 해에 동시에 참이 되게 만든다.
// ─────────────────────────────────────────────────────────────────────────────

// 두 조건을 한 해에 겹치는 방법: ISA 만기.
//   ① 납입원금이 먼저 마른다 → 그 뒤 달들은 «잔액이 있는데» 못 꺼내 부족이 쌓이고
//      사유(isaPrincipalExhausted)가 남는다.
//   ② 같은 해 12월에 ISA가 만기(3년 = 36개월)를 맞아 잔액 전액이 일반자산으로 옮겨진다
//      → 그 순간부터 «전액이 인출 가능»해지고, 12월치를 쓰고도 돈이 남은 채 해가 끝난다.
// 그래서 연말의 인출 가능액은 0이 아니고, 그 해의 부족은 사유로만 설명된다.
function isaPrincipalDriesThenMatures(): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 66, targetMonthlySpending: 10_000_000 },
    // 만기 자금을 받을 그릇. 일부러 작게 둬 첫 달에 비고, 이후 인출은 전부 ISA가 감당한다.
    assets: [{
      id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 1_000_000,
      totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
    }],
    isaAccounts: [{
      id: 'i', type: 'general', investmentType: 'etf', name: 'ISA',
      balance: 300_000_000, monthlyContribution: 0, totalReturn: 8, dividendYield: 0,
      currency: 'KRW', maturityYears: 3,
    }],
    // 만기 자금의 목적지를 «명시»한다. 미지정 기본값은 'pension'이고, 연금이 없을 때
    // 일반자산으로 떨어지는 것은 뒤쪽 폴백이다 — 이 테스트가 폴백에 기대지 않게 한다.
    withdrawalPlan: { isaMaturityDestination: 'asset' },
    otherIncomes: [], privatePensions: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    hardSpendingFloor: 10_000_000,
  } as unknown as SimulationParams;
}

describe('불변식의 엔진 경로', () => {
  test('부족과 인출 가능 자산이 같은 해에 겹쳐도, 사유가 남아 있으면 던지지 않는다', () => {
    // 사유 기록을 없애면 이 호출 자체가 SimulationConsistencyError로 던진다 — 그것이 이
    // 테스트가 지키는 것이다(위 절 주석의 실측).
    const result = new SimulationEngine().runSingle(isaPrincipalDriesThenMatures());

    const blocked = result.yearlyResults.filter((y) => y.ledger!.diagnostics.unmetHardSpending > 1);
    expect(blocked.length).toBeGreaterThan(0);

    // 불변식의 «전제»가 실제로 성립한 해가 있어야 이 테스트가 의미를 갖는다. 전제가 깨지면
    // (연말 인출 가능액이 0이 되면) 사유를 지워도 던지지 않으므로, 아래 두 단언이 함께
    // 서 있어야 한다.
    const armed = blocked.filter((y) => y.totalAssets > 1);
    expect(armed.length, '부족과 잔여 인출 가능 자산이 겹치는 해가 없다').toBeGreaterThan(0);

    for (const year of armed) {
      const d = year.ledger!.diagnostics;
      expect(d.blockedWithdrawalReason, `${year.age}세`).toBe('isaPrincipalExhausted');

      // 엔진이 만든 «그 해의 실제 숫자»로 불변식을 다시 돌린다. 사유만 지우면 던져야 한다.
      // 연말 총자산을 인출 가능액 자리에 넣는 것은 이 해에는 정확하다 — ISA는 이미 만기
      // 정산으로 비었고 남은 것은 전부 일반자산이다.
      const { blockedWithdrawalReason: _removed, ...withoutReason } = d;
      expect(() => assertSpendingShortfallExplained(
        { ...year.ledger!, diagnostics: withoutReason }, year.totalAssets
      ), `${year.age}세`).toThrow(SimulationConsistencyError);
    }
  });
});
