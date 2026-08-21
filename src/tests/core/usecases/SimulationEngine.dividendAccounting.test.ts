import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams, InvestmentAsset, SimulationYearlyResult } from '@/core/entities/types';

// 배당 회계의 불변식.
//
// 2026-08-21 리포트에서 「목표 달성 확률 5%」·「90세 중앙값 0원」이 보고됐을 때 가장 먼저
// 의심한 것이 배당 이중계산과 사적연금 이중차감이었다. 이 스위트는 그 의심을 **숫자로**
// 답할 수 있게 고정한다 — 다시 같은 질문이 나왔을 때 코드를 읽는 대신 이 파일을 돌린다.
//
// 세 갈래를 함께 잠근다.
//   (1) 총수익률은 배당을 «포함»한다      — 7% + 3% = 10%가 되지 않는다
//   (2) 배당은 자산에서 다시 빠지지 않는다 — 실질 총수익이 1%로 줄지 않는다
//   (3) 계좌 안에 남은 배당은 소득이 아니다 — 재투자분·ISA 내부 배당은 생활비 재원이 아니다

const engine = new SimulationEngine();

// 세금·물가·연금·지출을 모두 끈 «한 해짜리» 관측대. 배당 산술만 남긴다.
//
// assetMarket='other'는 배당세 0%·금융소득 제외다(getMarketTaxTreatment). 세율을 0으로
// 두는 것은 세금을 무시하려는 것이 아니라, 배당의 «크기»를 재는 자리에서 세금 크기가 섞이면
// 어느 쪽이 틀렸는지 구분할 수 없기 때문이다. 세금 경로는 taxCombinedGolden 등이 따로 잠근다.
function oneYear(asset: Partial<InvestmentAsset>, overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 50, targetMonthlySpending: 0 },
    assets: [{
      id: 'a', type: 'etf', ticker: 'T', name: '관측용',
      quantity: 1, averagePrice: 100_000_000,
      totalReturn: 7, dividendYield: 3,
      monthlyContribution: 0, reinvestDividend: false,
      currency: 'KRW', assetMarket: 'OTHER',
      ...asset,
    }],
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

const firstYear = (params: SimulationParams): SimulationYearlyResult =>
  engine.runSingle(params).yearlyResults[0];

// 엔진은 배당을 **월 단리로 그달의 평가액에** 붙인다(divRateMonthly = 연배당률 / 12).
// 평가액이 해 안에서 자라므로 연간 배당 합계는 「연초 평가액 × 배당률」보다 조금 크다.
//   Σ V_m × d/12,  V_m = V₀ × (1+g)^(m/12)
//
// 총수익률 7%·배당률 3%(가격상승 4%)·평가액 1억원에서 실측:
//   가격수익 4,000,000  (정확히 4%)
//   배당     3,054,611  (3,000,000 대비 +1.82%)
//   총수익   7,054,611  (7,000,000 대비 +0.78% = +0.055%p)
//
// 이것은 결함이 아니라 «월 발생» 규약의 산술이며, 실제 ETF도 분배금을 그 시점의 NAV에
// 대해 지급한다. 아래 단언은 그 규약분을 허용치로 «명시»한다 — 허용치를 두는 이유가
// "얼마나 틀려도 되는가"가 아니라 "규약이 만드는 차이는 여기까지"임을 적어 두기 위해서다.
//
// 이 허용치는 실제 결함과 40배 이상 떨어져 있다: 배당을 총수익률에 더하면 +43%(7%→10%),
// 배당을 자산에서 한 번 더 빼면 −43%다. 어느 쪽도 이 문을 통과할 수 없다.
const TOTAL_RETURN_ACCRUAL_TOLERANCE = 0.01;
const DIVIDEND_ACCRUAL_TOLERANCE = 0.03;

describe('배당 회계 - 총수익률 분해', () => {
  // §21 Test 1.
  test('총수익 = 가격수익 + 배당이고, 그 합은 자산 × 총수익률이다', () => {
    const year = firstYear(oneYear({}));
    const { priceGain, dividend, total } = year.ledger!.investmentReturn;

    // 가격상승률 = 총수익률 − 배당률 = 4%. 월 복리이므로 연 환산이 정확히 4%다.
    expect(priceGain).toBeCloseTo(4_000_000, 0);
    // 「연초 평가액 × 배당률」보다 월 발생 규약분만큼 크다(위 MONTHLY_ACCRUAL_TOLERANCE 주석).
    expect(dividend).toBeGreaterThanOrEqual(3_000_000);
    expect(dividend / 3_000_000 - 1).toBeLessThan(DIVIDEND_ACCRUAL_TOLERANCE);
    expect(total).toBeCloseTo(priceGain + dividend, 6);
    expect(total).toBeGreaterThanOrEqual(7_000_000);
    expect(total / 7_000_000 - 1).toBeLessThan(TOTAL_RETURN_ACCRUAL_TOLERANCE);
  });

  // §21 Test 6. 배당률을 총수익률에 «더하면» 10%가 된다. 그 결함은 이 저장소가 실제로 겪었다
  // (2026-08-19 리포트가 90세 21.3억으로 "고갈 없음"이었던 원인).
  test('배당률은 총수익률에 더해지지 않는다 (7% + 3% ≠ 10%)', () => {
    const total = firstYear(oneYear({})).ledger!.investmentReturn.total;

    expect(total).toBeLessThan(100_000_000 * 0.08);
    expect(total).toBeGreaterThan(100_000_000 * 0.069);
  });

  // §21 Test 7. 반대 방향의 결함 — 배당을 수익으로 세면서 평가액에서도 빼면 총수익이
  // 가격상승분(4%)이나 그 이하로 주저앉는다.
  test('배당은 자산에서 다시 차감되지 않는다 (총수익이 1%로 줄지 않는다)', () => {
    const total = firstYear(oneYear({})).ledger!.investmentReturn.total;

    expect(total).toBeGreaterThan(100_000_000 * 0.069);
  });

  // 배당률이 0이면 총수익률 전부가 가격상승이다. 위 두 방향의 결함이 서로 상쇄해 총합만
  // 맞는 경우를 배제한다.
  test('배당률 0이면 총수익 전부가 가격수익이다', () => {
    const year = firstYear(oneYear({ dividendYield: 0 }));

    expect(year.ledger!.investmentReturn.dividend).toBe(0);
    expect(year.ledger!.investmentReturn.priceGain).toBeCloseTo(7_000_000, 0);
  });

  // §21 Test 2. 세금이 없고 배당을 전액 재투자하면 기말자산은 정확히 원금 × (1 + 총수익률)
  // 이어야 한다 — 월 발생 규약분만큼의 오차 안에서.
  test('배당 전액 재투자 시 기말자산 = 원금 × (1 + 총수익률)', () => {
    const year = firstYear(oneYear({ reinvestDividend: true }));

    expect(year.totalAssets).toBeGreaterThanOrEqual(107_000_000);
    expect(year.totalAssets / 107_000_000 - 1).toBeLessThan(TOTAL_RETURN_ACCRUAL_TOLERANCE);
  });
});

describe('배당 회계 - 몬테카를로 충격은 총수익률에 가산된다', () => {
  // §16. 몬테카를로가 바꾸는 것은 «연도별 총수익률» 하나뿐이어야 한다.
  //
  //   sampled_price_return = sampled_total_return − dividend_yield
  //
  // 즉 충격은 가격상승률에 실리고 배당«률»은 그대로다. 이것을 「충격 경로 = 총수익률을
  // 그만큼 올린 입력」이라는 동치로 잰다 — 자산이 하나뿐이라 충격 배율(shockBeta)이 1이므로
  // 두 경로는 비트 단위로 같아야 한다.
  //
  // 틀린 구현이 잡히는 방식:
  //   배당률에도 충격을 실으면  → 배당률 6%짜리와 같아져 배당 발생액이 두 배가 된다.
  //   배당을 충격에 더하면      → 총수익이 13%가 된다.
  test('충격 +3%p는 「총수익률 10%·배당률 3%」와 완전히 같다', () => {
    const viaShock = engine.runSingle(oneYear({}), [3]).yearlyResults[0];
    const viaParams = firstYear(oneYear({ totalReturn: 10 }));

    expect(JSON.stringify(viaShock)).toBe(JSON.stringify(viaParams));

    // 배당률을 함께 올린 것과는 달라야 한다.
    const dividendAlsoShocked = firstYear(oneYear({ totalReturn: 10, dividendYield: 6 }));
    expect(viaShock.ledger!.investmentReturn.dividend)
      .not.toBeCloseTo(dividendAlsoShocked.ledger!.investmentReturn.dividend, 0);
  });

  test('충격 +3%p를 받은 해의 총수익은 자산의 10%이지 13%가 아니다', () => {
    const { total, priceGain } = engine.runSingle(oneYear({}), [3]).yearlyResults[0].ledger!.investmentReturn;

    // 가격상승률 = (7 + 3) − 3 = 7%. 월 복리라 연 환산이 정확히 7%다.
    expect(priceGain).toBeCloseTo(7_000_000, 0);
    expect(total).toBeGreaterThanOrEqual(10_000_000);
    expect(total / 10_000_000 - 1).toBeLessThan(TOTAL_RETURN_ACCRUAL_TOLERANCE);
    expect(total).toBeLessThan(13_000_000);
  });

  test('음의 충격도 대칭이다: −3%p는 「총수익률 4%·배당률 3%」와 같다', () => {
    const viaShock = engine.runSingle(oneYear({}), [-3]).yearlyResults[0];
    const viaParams = firstYear(oneYear({ totalReturn: 4 }));

    expect(JSON.stringify(viaShock)).toBe(JSON.stringify(viaParams));
  });
});

describe('배당 회계 - 계좌 안에 남은 배당은 소득이 아니다', () => {
  // §4. 재투자한 배당은 계좌를 떠나지 않으므로 생활비로 쓸 수 없다. 예전에는 이 금액이
  // dividendIncome에 잡혀, 배당을 전액 재투자하는 계획에도 화면에 「배당소득」이 찍혔다.
  test('재투자한 배당은 dividendIncome에 잡히지 않고 원장의 retained로 간다', () => {
    const year = firstYear(oneYear({ reinvestDividend: true }));

    expect(year.dividendIncome).toBe(0);
    expect(year.ledger!.investmentReturn.dividendPaidOutNet).toBe(0);
    expect(year.ledger!.investmentReturn.dividendRetainedNet)
      .toBeCloseTo(year.ledger!.investmentReturn.dividend, 6);
  });

  test('재투자하지 않은 배당은 그대로 dividendIncome이 된다', () => {
    const year = firstYear(oneYear({ reinvestDividend: false }));

    expect(year.dividendIncome).toBeGreaterThan(0);
    expect(year.ledger!.investmentReturn.dividendPaidOutNet).toBeCloseTo(year.dividendIncome, 6);
    expect(year.ledger!.investmentReturn.dividendRetainedNet).toBe(0);
  });

  // §6. ISA 계좌 «안에서» 생긴 배당은 전액 계좌에 남는다. 실측 시나리오의 커버드콜 ISA는
  // 분배율이 21.2%였고, 그 전부가 배당소득으로 보고되어 화면의 「배당소득」 절반 이상을
  // 실재하지 않는 현금이 차지했다.
  test('ISA 내부 배당은 배당소득이 아니라 투자수익이다', () => {
    const params = oneYear({}, {
      assets: [],
      isaAccounts: [{
        id: 'isa', type: 'general', balance: 100_000_000, monthlyContribution: 0,
        totalReturn: 7, dividendYield: 21.2, currency: 'KRW', maturityYears: 10,
      }],
    });
    const year = firstYear(params);

    expect(year.dividendIncome).toBe(0);
    expect(year.ledger!.investmentReturn.dividend).toBeGreaterThan(20_000_000);
    expect(year.ledger!.investmentReturn.dividendRetainedNet)
      .toBeCloseTo(year.ledger!.investmentReturn.dividend, 6);
    // 분배율이 총수익률(7%)보다 크므로 NAV는 줄지만, 분배금이 계좌에 남아 총수익은 7%다.
    expect(year.ledger!.investmentReturn.total / 7_000_000 - 1).toBeLessThan(0.01);
    expect(year.isaAssets / 107_000_000 - 1).toBeLessThan(0.01);
  });

  // §5. 연금 계좌는 총수익률만으로 굴린다(배당을 분해하지 않는다). 그래서 연금 배당률을
  // 아무리 올려도 결과가 움직이면 안 된다 — 움직이면 연금 배당이 어딘가에서 소득이 됐다는 뜻.
  test('사적연금 배당률은 결과에도 배당소득에도 닿지 않는다', () => {
    const withDividend = oneYear({}, {
      assets: [],
      privatePensions: [{
        id: 'p', type: 'irp', balance: 100_000_000, monthlyContribution: 0,
        totalReturn: 7, dividendYield: 10, currency: 'KRW',
      }],
    });
    const withoutDividend = oneYear({}, {
      assets: [],
      privatePensions: [{
        id: 'p', type: 'irp', balance: 100_000_000, monthlyContribution: 0,
        totalReturn: 7, dividendYield: 0, currency: 'KRW',
      }],
    });

    const a = firstYear(withDividend);
    const b = firstYear(withoutDividend);

    expect(a.dividendIncome).toBe(0);
    expect(a.ledger!.investmentReturn.dividend).toBe(0);
    expect(a.totalAssets).toBe(b.totalAssets);
    expect(a.ledger!.investmentReturn.total).toBeCloseTo(7_000_000, 0);
  });
});

describe('배당 회계 - 사적연금 인출은 총자산을 줄이지 않는다', () => {
  // §21 Test 4 / §7. 인출은 계좌 «사이»의 이동이고, 총자산은 실제로 소비할 때만 줄어든다.
  //
  // 수익률·물가·세금을 모두 0으로 두어 인출과 소비 외의 움직임을 없앤다. 그래서 기말자산은
  // 「기초 − 생활비」여야 하고, 인출액만큼 한 번 더 줄어드는 이중차감이면 이 단언이 깨진다.
  test('연금을 빼서 생활비로 쓰면 총자산은 「생활비 + 세금」만큼만 준다', () => {
    const params: SimulationParams = {
      userProfile: { currentAge: 65, retirementAge: 65, expectancy: 65, targetMonthlySpending: 20_000_000 / 12 },
      assets: [],
      isaAccounts: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [{
        id: 'p', type: 'irp', balance: 100_000_000, monthlyContribution: 0,
        totalReturn: 0, currency: 'KRW',
      }],
      otherIncomes: [],
      inflationRate: 0,
      inflationMode: 'nominal',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
    };
    const year = firstYear(params);

    // 65세 사적연금 소득세는 5.5%(세법 프로필). 세후 2,000만원을 손에 쥐려면
    // 20,000,000 / (1 − 0.055) = 21,164,021원을 빼야 하고 세금은 1,164,021원이다.
    expect(year.privatePensionWithdrawal).toBeCloseTo(21_164_021, 0);
    expect(year.taxes).toBeCloseTo(1_164_021, 0);
    expect(year.spending).toBeCloseTo(20_000_000, 0);

    // 총자산은 «실제로 나간 것»만큼만 준다: 생활비 2,000만원 + 세금 116만원.
    expect(year.totalAssets).toBeCloseTo(100_000_000 - 20_000_000 - 1_164_021, 0);
    // 인출액을 자산 감소로도 세는 이중차감이면 여기가 된다.
    expect(year.totalAssets).not.toBeCloseTo(100_000_000 - 21_164_021 - 20_000_000, 0);

    expect(year.ledger!.internalWithdrawals.privatePension).toBeCloseTo(year.privatePensionWithdrawal, 6);
    // 인출은 항등식에 들어가지 않는다 — 들어갔다면 residual이 인출액만큼 벌어진다.
    expect(Math.abs(year.ledger!.residual)).toBeLessThan(1);
  });

  // §21 Test 5 / §9. 사적연금으로 채운 몫을 일반계좌에서 «다시» 인출하면 안 된다.
  test('사적연금이 채운 생활비를 일반계좌에서 다시 인출하지 않는다', () => {
    const params: SimulationParams = {
      userProfile: { currentAge: 65, retirementAge: 65, expectancy: 65, targetMonthlySpending: 42_000_000 / 12 },
      assets: [{
        id: 'a', type: 'etf', ticker: 'T', name: '일반계좌',
        quantity: 1, averagePrice: 500_000_000, totalReturn: 0, dividendYield: 0,
        monthlyContribution: 0, reinvestDividend: false, currency: 'KRW', assetMarket: 'OTHER',
      }],
      isaAccounts: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [{
        id: 'p', type: 'irp', balance: 500_000_000, monthlyContribution: 0,
        totalReturn: 0, currency: 'KRW',
      }],
      otherIncomes: [{ id: 'o', label: '임대소득', monthlyAmount: 5_000_000 / 12, currency: 'KRW' }],
      inflationRate: 0,
      inflationMode: 'nominal',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
      // 사적연금이 매달 250만원(연 3,000만원, 세전)을 먼저 대게 하고, 나머지를 일반계좌가 채우게 한다.
      withdrawalPlan: { privatePensionMonthlyTarget: 30_000_000 / 12 },
    };
    const year = firstYear(params);

    expect(year.privatePensionWithdrawal).toBeCloseTo(30_000_000, 0);
    expect(year.otherIncome).toBeCloseTo(5_000_000, 0);
    // 세전 3,000만원의 세후는 3,000만 × (1 − 0.055) = 2,835만원.
    // 42,000,000 − 28,350,000 − 5,000,000 = 8,650,000
    expect(year.generalAssetWithdrawal).toBeCloseTo(8_650_000, 0);
    // 세후 사적연금 소득은 여기서 한 번 더 줄어든다 — 세전 3,000만원이 저율과세 한도
    // (연 1,500만원)를 넘어 초과분에 한도초과세가 붙기 때문이다. 그 세금은 연말에 자산에서
    // 따로 징수되므로 «생활비 재원 계산»에는 영향을 주지 않는다(위 인출액이 그대로인 이유).
    expect(year.privatePensionIncome).toBeLessThan(28_350_000);
    expect(year.privatePensionIncome + year.pensionTaxPaid).toBeCloseTo(30_000_000, 0);
    // 사적연금이 채운 몫을 빼놓고 일반계좌에서 다시 빼면 3,700만원이 된다.
    expect(year.generalAssetWithdrawal).toBeLessThan(10_000_000);
    expect(year.spending).toBeCloseTo(42_000_000, 0);
    expect(year.unmetSpending).toBe(0);
  });
});
