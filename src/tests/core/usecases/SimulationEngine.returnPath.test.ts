import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';
import {
  ECONOMIC_SCENARIO_PROFILES,
  PENSION_RETURN_SHOCK_BETA,
} from '@/core/usecases/scenario/economicScenarios';

// **연도별 시장 수익률 충격 통로.**
//
// 엔진은 수익률을 initializeAssets에서 딱 한 번 월 복리율로 변환하고 연/월 루프는 그
// 캐시된 값을 읽는다. 몬테카를로와 시퀀스 리스크는 해마다 다른 수익률이 필요하므로
// 통로를 낸다.
//
// 이 스위트의 첫 번째 테스트가 가장 중요하다: 경로를 주지 않으면 저장된 모든 시나리오의
// 숫자가 한 자리도 바뀌면 안 된다.
const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2000000 },
    assets: [
      { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 400, averagePrice: 500000,
        totalReturn: 7, dividendYield: 2, monthlyContribution: 500000, reinvestDividend: true, currency: 'KRW' },
    ],
    isaAccounts: [
      { id: 'i1', type: 'general', balance: 20000000, monthlyContribution: 200000,
        totalReturn: 5, dividendYield: 2, currency: 'KRW', maturityYears: 3 },
    ],
    nationalPension: { expectedMonthlyAmount: 1000000 },
    privatePensions: [
      { id: 'p1', type: 'irp', balance: 50000000, monthlyContribution: 300000, totalReturn: 4, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

const YEARS = 85 - 55 + 1;
const zeros = new Array(YEARS).fill(0);

describe('SimulationEngine - returnPath', () => {
  // 저장된 모든 시나리오가 이 경로를 탄다. 여기가 어긋나면 아무것도 건드리지 않은
  // 사용자의 숫자가 달라진다(cashYieldRate 도입 때와 같은 관례).
  test('경로 미지정과 전(全) 0 경로는 결과가 비트 단위로 같다', () => {
    const unset = engine.runSingle(params());
    const allZero = engine.runSingle(params(), zeros);

    expect(JSON.stringify(allZero)).toBe(JSON.stringify(unset));
  });

  // 전제 확인: 기준 계획에 자산이 남아야 아래 방향성 비교가 성립한다. 고갈되는 계획이면
  // 충격을 어느 쪽으로 주든 기말자산이 0으로 같아 비교가 무의미해진다.
  test('전제 확인: 기준 계획은 고갈되지 않는다', () => {
    const baseline = engine.runSingle(params());

    expect(baseline.endingAssets).toBeGreaterThan(0);
  });

  test('양의 충격은 자산을 늘리고, 음의 충격은 줄인다', () => {
    const baseline = engine.runSingle(params());
    const up = engine.runSingle(params(), new Array(YEARS).fill(2));
    const down = engine.runSingle(params(), new Array(YEARS).fill(-2));

    expect(up.endingAssets).toBeGreaterThan(baseline.endingAssets);
    expect(down.endingAssets).toBeLessThan(baseline.endingAssets);
  });

  test('충격으로 생긴 평가손익은 연초자산 이후 해당 연도 investmentReturn에 기록된다', () => {
    const singleYear = params({
      userProfile: {
        currentAge: 55,
        retirementAge: 60,
        expectancy: 55,
        targetMonthlySpending: 0,
      },
      assets: [{
        id: 'shock-only', type: 'etf', ticker: 'SHOCK', name: '충격 검증 자산',
        quantity: 1, averagePrice: 200_000_000, totalReturn: 0,
        dividendYield: 0, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW',
      }],
      isaAccounts: [],
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      inflationRate: 0,
    });

    const year = engine.runSingle(singleYear, [10]).yearlyResults[0];

    expect(year.openingAssets).toBe(200_000_000);
    expect(year.investmentReturn).toBeCloseTo(20_000_000, 6);
    expect(year.closingAssets).toBeCloseTo(
      year.openingAssets + year.investmentReturn,
      6
    );
  });

  // 상수 충격은 수익률을 통째로 올린 것과 같아야 한다 — 통로가 실제로 "연 수익률에 %p
  // 가산"으로 동작하는지를 고정한다. 사적연금·ISA까지 함께 움직이는지도 여기서 잡힌다.
  //
  // **사적연금 항만 배율이 붙는다.** 예전에는 세 버킷에 같은 +3을 더했는데, 그것이 곧
  // "연금이 100% 주식과 같은 폭으로 흔들린다"는 가정이었다(PENSION_RETURN_SHOCK_BETA 주석).
  test('상수 충격은 모든 계좌의 연 수익률을 그만큼 올린 것과 같다', () => {
    const shifted = params({
      assets: params().assets.map((a) => ({ ...a, totalReturn: a.totalReturn + 3 })),
      privatePensions: params().privatePensions.map((p) => ({
        ...p, totalReturn: p.totalReturn + 3 * PENSION_RETURN_SHOCK_BETA,
      })),
      isaAccounts: params().isaAccounts!.map((i) => ({ ...i, totalReturn: i.totalReturn + 3 })),
    });

    const viaParams = engine.runSingle(shifted);
    const viaPath = engine.runSingle(params(), new Array(YEARS).fill(3));

    expect(viaPath.endingAssets).toBeCloseTo(viaParams.endingAssets, 6);
  });

  // 충격은 주가 수익률에만 붙는다. 배당률·현금 이자율은 흔들지 않는다 — 배당은 주가보다
  // 안정적이고, 흔들면 소득 라인을 타고 종합과세·건보료·FIRE 판정까지 파급된다.
  test('충격은 현금 이자율에 영향을 주지 않는다', () => {
    // 투자자산 없이 현금만 쌓이는 계획. 충격이 현금에 새면 잔액이 달라진다.
    const cashOnly = params({
      assets: [], isaAccounts: [], privatePensions: [],
      otherIncomes: [{ id: 'rent', label: '임대소득', monthlyAmount: 5000000, currency: 'KRW' }],
      cashYieldRate: 3,
    });

    const baseline = engine.runSingle(cashOnly);
    const shocked = engine.runSingle(cashOnly, new Array(YEARS).fill(5));

    const cashOf = (r: typeof baseline) => r.yearlyResults[r.yearlyResults.length - 1].cashAssets;
    expect(cashOf(shocked)).toBeCloseTo(cashOf(baseline), 6);
  });

  test('배당수익률은 충격을 받지 않는다', () => {
    // 배당률이 그대로면, 같은 평가액에서 나오는 배당도 그대로다. 첫 달은 충격이 아직
    // 평가액을 벌리기 전이므로 첫 해 배당 차이가 미미해야 한다(평가액 증가분의 배당만큼만).
    const baseline = engine.runSingle(params());
    const shocked = engine.runSingle(params(), new Array(YEARS).fill(5));

    const firstYearDividend = (r: typeof baseline) => r.yearlyResults[0].dividendIncome;
    // 배당률 자체가 5%p 올랐다면 배당이 2~3배가 된다. 평가액 성장에 딸린 차이는 10% 미만이다.
    expect(firstYearDividend(shocked)).toBeLessThan(firstYearDividend(baseline) * 1.1);
  });

  // 길이가 모자란 경로는 던지지 않는다. 경로를 만드는 쪽이 항상 정확한 길이를 만들지만,
  // 저장·전송을 거친 경로가 짧아졌다고 해서 화면 전체가 죽는 편이 낫다고 볼 근거가 없다.
  test('경로가 시뮬레이션 기간보다 짧으면 남은 해는 충격 0으로 본다', () => {
    const short = [3, 3, 3];
    expect(() => engine.runSingle(params(), short)).not.toThrow();

    const result = engine.runSingle(params(), short);
    expect(result.yearlyResults).toHaveLength(YEARS);
  });

  test('빈 경로는 경로 미지정과 같은 결과를 준다', () => {
    expect(JSON.stringify(engine.runSingle(params(), [])))
      .toBe(JSON.stringify(engine.runSingle(params())));
  });

  // 연 −100%보다 나쁜 값은 자산을 음수로 만든다. 다른 요율과 같은 규칙(Math.max(0, 1+r))으로 막는다.
  test('극단적인 음의 충격에도 자산이 음수나 NaN이 되지 않는다', () => {
    const result = engine.runSingle(params(), new Array(YEARS).fill(-500));

    for (const year of result.yearlyResults) {
      expect(Number.isFinite(year.totalAssets)).toBe(true);
      expect(year.totalAssets).toBeGreaterThanOrEqual(0);
    }
  });

  // 총자산 보존 불변식(conservation.test.ts가 지키는 것)은 충격이 있어도 성립해야 한다.
  test('충격이 있어도 자산 구성의 합은 총자산과 같다', () => {
    const result = engine.runSingle(params(), new Array(YEARS).fill(-3));

    for (const year of result.yearlyResults) {
      expect(year.stockAssets + year.pensionAssets + year.isaAssets + year.cashAssets)
        .toBeCloseTo(year.totalAssets, 6);
    }
  });

  // **사적연금은 주식보다 작은 폭으로 흔들린다.**
  //
  // 이 저장소는 사적연금이 더 보수적으로 배분된다고 이미 가정하고 있다
  // (ECONOMIC_SCENARIO_PROFILES: 주식 7% / 연금 4%, economicScenarios.ts의 주석 참고).
  // 그런데 충격은 오래도록 두 버킷에 같은 폭으로 걸렸다 — **수익률에서만 보수적이고
  // 변동성에서는 100% 주식과 동일**했다. 그 결과 연금 비중이 큰 계획일수록 몬테카를로
  // 성공률이 실제보다 낮게 나왔다.
  //
  // 배율은 새로 만든 가정이 아니라 위 프로필에서 유도한 값이다. 여기서 그 유도를 다시
  // 적어 두는 이유는 프로필이 바뀌면 엔진도 함께 움직여야 함을 고정하기 위해서다.
  const pensionBeta =
    ECONOMIC_SCENARIO_PROFILES.long_term_average.pensionReturnRate
    / ECONOMIC_SCENARIO_PROFILES.long_term_average.stockGrowthRate;

  test('충격 배율은 장기 평균 프로필의 연금/주식 수익률 비에서 유도된다', () => {
    // 엔진이 쓰는 상수가 프로필과 따로 놀면, 프로필을 고쳐도 변동성만 옛 가정에 남는다.
    expect(PENSION_RETURN_SHOCK_BETA).toBe(pensionBeta);
    expect(PENSION_RETURN_SHOCK_BETA).toBeGreaterThan(0);
    expect(PENSION_RETURN_SHOCK_BETA).toBeLessThan(1);
  });

  function singleYearPlan(overrides: Partial<SimulationParams>): SimulationParams {
    return params({
      userProfile: { currentAge: 55, retirementAge: 60, expectancy: 55, targetMonthlySpending: 0 },
      assets: [],
      isaAccounts: [],
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      inflationRate: 0,
      ...overrides,
    });
  }

  const STOCK_ONLY = singleYearPlan({
    assets: [{
      id: 's', type: 'etf', ticker: 'S', name: '주식', quantity: 1, averagePrice: 200_000_000,
      totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW',
    }],
  });

  const PENSION_ONLY = singleYearPlan({
    privatePensions: [{
      id: 'p', type: 'irp', balance: 200_000_000, monthlyContribution: 0,
      totalReturn: 0, currency: 'KRW',
    }],
  });

  test('같은 충격에서 사적연금은 같은 규모의 주식자산보다 덜 흔들린다', () => {
    const stock = engine.runSingle(STOCK_ONLY, [10]).yearlyResults[0];
    const pension = engine.runSingle(PENSION_ONLY, [10]).yearlyResults[0];

    // 전제: 충격이 없으면 두 계획의 기말자산이 같다(둘 다 수익률 0%).
    expect(engine.runSingle(PENSION_ONLY).yearlyResults[0].closingAssets)
      .toBeCloseTo(engine.runSingle(STOCK_ONLY).yearlyResults[0].closingAssets, 6);

    expect(pension.closingAssets).toBeLessThan(stock.closingAssets);
    expect(pension.closingAssets).toBeGreaterThan(200_000_000);
  });

  test('사적연금이 받는 충격은 주식 충격에 연금/주식 수익률 비를 곱한 값이다', () => {
    const shocked = engine.runSingle(PENSION_ONLY, [10]).yearlyResults[0];

    expect(shocked.closingAssets).toBeCloseTo(200_000_000 * (1 + 0.1 * pensionBeta), 6);
  });

  // 순서가 결과를 바꾼다는 것 자체가 시퀀스 리스크의 정의다. 같은 원소를 순서만 바꿔
  // 넣었을 때 인출이 있는 계획에서는 결과가 달라져야 한다.
  test('같은 충격이라도 순서가 다르면 결과가 달라진다', () => {
    const ascending = [...Array(YEARS)].map((_, i) => (i < YEARS / 2 ? -10 : 10));
    const descending = [...ascending].reverse();

    const worstFirst = engine.runSingle(params(), ascending);
    const bestFirst = engine.runSingle(params(), descending);

    expect(worstFirst.endingAssets).not.toBeCloseTo(bestFirst.endingAssets, 0);
  });
});
