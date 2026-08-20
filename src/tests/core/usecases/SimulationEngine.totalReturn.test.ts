import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import type { InvestmentAsset, IsaAccount, PrivatePension, SimulationParams } from '@/core/entities/types';

// 물가 0·명목 기준으로 두어 수익률 외의 변수를 없앤다. 은퇴 전 1년만 굴리고
// 총자산을 본다 — 인출·세금·연금이 끼어들지 않는 구간이다.
function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 51, targetMonthlySpending: 0 },
    assets: [],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'nominal',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

function asset(over: Partial<InvestmentAsset> = {}): InvestmentAsset {
  return {
    id: 'a1', type: 'etf', ticker: 'A', name: '자산',
    quantity: 1000, averagePrice: 100000,
    totalReturn: 7, dividendYield: 0,
    monthlyContribution: 0, reinvestDividend: true, currency: 'KRW',
    ...over,
  };
}

function terminalAssets(p: SimulationParams): number {
  const years = new SimulationEngine().run(p).yearlyResults;
  return years[years.length - 1].totalAssets;
}

describe('총수익률 통일', () => {
  // 이번 버그의 직접 회귀 테스트. 예전에는 배당률이 총수익률 «위에» 더해져서
  // 총수익률 7%·배당 3%인 자산이 실효 10%로 굴렀다(비율 1.052).
  test('일반자산: 배당률은 총수익률을 나눌 뿐 더하지 않는다', () => {
    const withDividend = terminalAssets(params({ assets: [asset({ totalReturn: 7, dividendYield: 3 })] }));
    const withoutDividend = terminalAssets(params({ assets: [asset({ totalReturn: 7, dividendYield: 0 })] }));
    const ratio = withDividend / withoutDividend;

    // 배당으로 받는 몫은 배당소득세(국내 ETF 15.4%)를 떼고 재투자되므로, 같은 총수익률이면
    // 배당이 많을수록 «조금 손해»다. 그 방향이 옳다 — 배당은 수익률을 더하는 것이 아니라
    // 총수익률 중 세금이 먼저 붙는 몫이 얼마인가를 정한다.
    expect(ratio).toBeLessThan(1);
    // 그 손해는 세금만큼이지 수익률 차이가 아니다. 배당이 통째로 더해지던 예전에는
    // 이 비율이 1.05였다 — 부호부터 반대였다.
    expect(ratio).toBeGreaterThan(0.99);
  });

  test('ISA: 배당률은 총수익률을 나눌 뿐 더하지 않는다', () => {
    const isa = (dividendYield: number): IsaAccount => ({
      id: 'i1', type: 'general', investmentType: 'custom',
      balance: 100_000_000, monthlyContribution: 0,
      totalReturn: 7, dividendYield, currency: 'KRW', maturityYears: 100,
    });
    const withDividend = terminalAssets(params({ isaAccounts: [isa(3)] }));
    const withoutDividend = terminalAssets(params({ isaAccounts: [isa(0)] }));
    expect(withDividend / withoutDividend).toBeCloseTo(1, 2);
  });

  // 연금은 분해하지 않으므로 dividendYield가 결과에 «전혀» 영향을 주지 않는다.
  // 예전에는 investmentType이 'etf'면 총수익률에 그대로 더해졌다.
  test('사적연금: dividendYield가 결과에 영향을 주지 않는다', () => {
    const pension = (dividendYield: number): PrivatePension => ({
      id: 'p1', type: 'irp', investmentType: 'etf',
      balance: 100_000_000, monthlyContribution: 0,
      totalReturn: 4, dividendYield, currency: 'KRW',
    });
    expect(terminalAssets(params({ privatePensions: [pension(10)] })))
      .toBe(terminalAssets(params({ privatePensions: [pension(0)] })));
  });

  // 예금형 ISA는 화면에 배당 입력칸이 없다. 신규 ISA의 기본 dividendYield가 1.5라
  // 예전에는 예금을 골라도 연 1.5%가 «총수익률 위에» 더해졌다.
  //
  // 총수익률 모델에서는 남아 있는 배당률이 총합을 늘리지 못한다 — 1.5%p만큼 가격상승분이
  // 줄어들 뿐이다. 숨은 값을 아예 지우는 것은 정제 계층의 몫이며
  // (normalizeSimulationParams.test.ts), 여기서는 «더해지지 않는다»만 고정한다.
  test('예금형 ISA: 남아 있는 dividendYield가 총수익률을 늘리지 않는다', () => {
    const isa = (dividendYield: number): IsaAccount => ({
      id: 'i1', type: 'general', investmentType: 'deposit',
      balance: 100_000_000, monthlyContribution: 0,
      totalReturn: 3, dividendYield, currency: 'KRW', maturityYears: 100,
    });
    const withLeftover = terminalAssets(params({ isaAccounts: [isa(1.5)] }));
    const clean = terminalAssets(params({ isaAccounts: [isa(0)] }));

    // 남은 차이는 월율 규약 차이(성장은 기하 복리, 배당은 단리)뿐이라 0.1% 안쪽이다.
    // 예전에는 1.5%p가 통째로 더해져 이 비율이 1.015였다 — 자릿수가 다르다.
    expect(Math.abs(withLeftover / clean - 1)).toBeLessThan(0.001);
  });
});
