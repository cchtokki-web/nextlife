import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { formatYearLedger, ledgerTolerance } from '@/core/usecases/ledger/YearLedger';
import { buildReturnShockPath } from '@/core/usecases/montecarlo/returnPath';
import { mulberry32 } from '@/core/usecases/montecarlo/rng';
import { SimulationParams, YearlyLedger } from '@/core/entities/types';

// 회계 원장의 불변식.
//
//   기말 = 기초 + 투자총수익 + 진짜외부유입 − 생활비 − 세금 − 건보료
//
// 엔진이 매년 스스로 검사하고 위반하면 던지므로(assertLedgerConsistent), 이 스위트가
// 실제로 하는 일은 «그 검사가 실제로 도는 경로를 넓게 밟는 것»이다. 검사가 한 번도 걸리지
// 않는 경로가 있으면 그 경로에서는 결함이 조용히 지나간다.
//
// SimulationEngine.conservation.test.ts와 겹치지 않는다: 저쪽은 결과 필드만으로 우변을
// 재구성할 수 있도록 «가격상승 0·ISA 없음»으로 픽스처를 좁혔다. 원장은 성장·배당·ISA·환율을
// 모두 켠 채로 같은 항등식을 검증한다.

const engine = new SimulationEngine();

function scenario(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 52, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
    assets: [
      { id: 'kr', type: 'etf', ticker: 'KODEX', name: '국내 ETF',
        quantity: 1, averagePrice: 80_000_000, totalReturn: 6, dividendYield: 2,
        monthlyContribution: 300_000, reinvestDividend: true, currency: 'KRW', assetMarket: 'KR_ETF' },
      { id: 'us', type: 'etf', ticker: 'SCHD', name: '미국 ETF',
        // 80,000 USD ≈ 1.1억원. 취득원가를 평가액의 절반으로 두어 매도 시 양도차익이 실제로 실현된다.
        quantity: 800, averagePrice: 100, totalReturn: 8, dividendYield: 3.5,
        monthlyContribution: 200, reinvestDividend: false, currency: 'USD', assetMarket: 'US_ETF',
        acquisitionCostBasis: 40_000 },
    ],
    isaAccounts: [{
      id: 'isa', type: 'general', balance: 20_000_000, monthlyContribution: 300_000,
      totalReturn: 7, dividendYield: 9, currency: 'KRW', maturityYears: 3,
    }],
    nationalPension: { expectedMonthlyAmount: 1_200_000 },
    privatePensions: [{
      id: 'irp', type: 'irp', balance: 90_000_000, monthlyContribution: 400_000,
      totalReturn: 5, dividendYield: 4, currency: 'KRW',
    }],
    otherIncomes: [{ id: 'rent', label: '임대소득', monthlyAmount: 400_000, currency: 'KRW' }],
    inflationRate: 2.5,
    inflationMode: 'real',
    baseExchangeRate: 1380,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

// 원장이 실제로 «검증됐는지»를 확인한다. 엔진이 던지지 않았다는 사실만으로는 부족하다 —
// ledger 자체가 붙지 않았다면 검사도 돌지 않았다는 뜻이기 때문이다.
function ledgersOf(result: { yearlyResults: { ledger?: YearlyLedger }[] }): YearlyLedger[] {
  const ledgers = result.yearlyResults.map((y) => y.ledger);
  expect(ledgers.every((l): l is YearlyLedger => l !== undefined)).toBe(true);
  return ledgers as YearlyLedger[];
}

function expectConsistent(result: { yearlyResults: { ledger?: YearlyLedger }[] }): YearlyLedger[] {
  const ledgers = ledgersOf(result);
  const violations = ledgers
    .filter((l) => Math.abs(l.residual) > ledgerTolerance(l))
    .map((l) => `${l.age}세: ${Math.round(l.residual).toLocaleString()}원`);

  expect(violations).toEqual([]);
  return ledgers;
}

describe('YearlyLedger - 회계 항등식', () => {
  test('성장·배당·ISA·환율·양도세를 모두 켠 시나리오에서 성립한다', () => {
    const ledgers = expectConsistent(engine.runSingle(scenario()));

    // 전제 확인: 검증이 의미를 가지려면 각 항이 실제로 0이 아니어야 한다.
    expect(ledgers.some((l) => l.investmentReturn.dividend > 0)).toBe(true);
    expect(ledgers.some((l) => l.investmentReturn.priceGain > 0)).toBe(true);
    expect(ledgers.some((l) => l.externalIncome.contributions > 0)).toBe(true);
    expect(ledgers.some((l) => l.externalIncome.nationalPension > 0)).toBe(true);
    expect(ledgers.some((l) => l.internalWithdrawals.privatePension > 0)).toBe(true);
    expect(ledgers.some((l) => l.internalWithdrawals.taxableAccount > 0)).toBe(true);
    expect(ledgers.some((l) => l.expenses.tax > 0)).toBe(true);
  });

  test('자산이 고갈되는 계획에서도 성립한다', () => {
    const result = engine.runSingle(scenario({
      userProfile: { currentAge: 52, retirementAge: 55, expectancy: 90, targetMonthlySpending: 12_000_000 },
    }));

    expect(result.depletionAge).not.toBeNull();
    expectConsistent(result);
  });

  test('명목 기준에서도 성립한다', () => {
    expectConsistent(engine.runSingle(scenario({ inflationMode: 'nominal' })));
  });

  test('표시 통화가 USD여도 성립한다', () => {
    expectConsistent(engine.runSingle(scenario({ displayCurrency: 'USD' })));
  });

  test('ISA·연금까지 인출 후보로 여는 계좌군 정책에서도 성립한다', () => {
    expectConsistent(engine.runSingle(scenario({
      withdrawalPlan: { accountWithdrawalPolicy: 'PENSION_FIRST', generalAssetWithdrawalStartAge: 70 },
    })));
  });

  test('상속 하한선을 건 계획에서도 성립한다', () => {
    expectConsistent(engine.runSingle(scenario({ assetFloor: 100_000_000 })));
  });

  test('의료비를 켠 계획에서도 성립한다', () => {
    expectConsistent(engine.runSingle(scenario({
      healthcare: {
        enabled: true, costGrowthRate: 1, baseMonthlyCost: 400_000,
        longTermCareEnabled: true, longTermCareStartAge: 82, longTermCareMonthlyCost: 1_500_000,
        shockEnabled: true, shockAge: 75, shockAmount: 30_000_000,
      },
    })));
  });

  // 몬테카를로가 바꾸는 것은 연도별 수익률뿐이므로 항등식은 모든 시행에서 그대로 성립해야
  // 한다. 성립하지 않는다면 충격 경로가 자산을 만들거나 없애고 있다는 뜻이다.
  test('몬테카를로 수익률 경로 30개 전부에서 성립한다', () => {
    const params = scenario();
    const years = params.userProfile.expectancy - params.userProfile.currentAge + 1;

    for (let i = 0; i < 30; i++) {
      const path = buildReturnShockPath(years, 15, mulberry32(1000 + i));
      expectConsistent(engine.runSingle(params, path));
    }
  });

  test('한 해를 사람이 읽는 형식으로 펼칠 수 있다', () => {
    const ledger = engine.runSingle(scenario()).yearlyResults.find((y) => y.age === 60)!.ledger!;
    const text = formatYearLedger(ledger);

    expect(text).toContain('[AGE 60]');
    expect(text).toContain('기초 총자산');
    expect(text).toContain('계좌 간 이동 (총자산 감소가 아님)');
    expect(text).toContain('기말 총자산');
  });
});

describe('YearlyLedger - 내부 이동은 항등식에 들어가지 않는다', () => {
  // §12. 사적연금 인출·일반계좌 매도·ISA 인출이 유출로 세어지면 그만큼 residual이 벌어진다.
  // 그 관계를 «수치로» 고정해, 나중에 누군가 이 항목들을 항등식에 더했을 때 어느 방향으로
  // 얼마나 틀리는지가 드러나게 한다.
  test('내부 이동을 유출로 세면 residual이 정확히 그 금액만큼 벌어진다', () => {
    const ledgers = ledgersOf(engine.runSingle(scenario()));
    const retirementYear = ledgers.find(
      (l) => l.internalWithdrawals.privatePension > 0 && l.internalWithdrawals.taxableAccount > 0
    )!;

    const internalTotal = retirementYear.internalWithdrawals.privatePension
      + retirementYear.internalWithdrawals.taxableAccount
      + retirementYear.internalWithdrawals.isa;

    expect(internalTotal).toBeGreaterThan(0);
    expect(Math.abs(retirementYear.residual)).toBeLessThan(ledgerTolerance(retirementYear));
    // 이중차감 시의 residual. 실제 값과 비교해 "지금은 그렇지 않다"를 고정한다.
    expect(Math.abs(retirementYear.residual - internalTotal)).toBeGreaterThan(1);
  });
});
