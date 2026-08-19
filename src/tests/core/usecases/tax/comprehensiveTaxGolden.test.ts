import { describe, test, expect } from 'vitest';
import { calculateComprehensiveTaxAndHealthInsuranceKRW } from '@/core/usecases/tax/TaxEngine';
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';

// 금융소득종합과세 비교과세 골든 테스트.
//
// 기댓값 옆에 손계산 유도를 반드시 남긴다. 식이 없으면 나중에 "왜 이 숫자냐"에 답할 수
// 없고, 그게 이중과세 결함이 오래 살아남은 이유다(단위 테스트는 있었지만 전부 예전 모델의
// 산식을 그대로 되풀이해 검증했다).
//
// 세법 근거(소득세법 §62 비교과세):
//   산출세액 = MAX( 2천만×14% + 누진세(초과분 + 다른 종합소득),
//                   금융소득 전액×14% + 누진세(다른 종합소득) )
//   결정세액 = 산출세액 − 기납부세액(원천징수분)
// 이 앱은 다른 종합소득이 0이라고 가정하므로
//   추가 납부 = max(0, 누진세(초과분)×1.1 − 초과분에 대한 원천징수액)
// 로 정리된다. 2천만원 이하 구간은 원천징수 14%와 산출세액 14%가 상쇄되어 사라진다.

const KR_WITHHOLDING = 0.154; // 국내 배당 원천징수율(국세 14% + 지방세 1.4%)

function krDividend(annualKRW: number) {
  return {
    annualRawFinancialIncomeKRW: annualKRW,
    annualPublicPensionIncomeKRW: 0,
    annualWithheldFinancialTaxKRW: annualKRW * KR_WITHHOLDING,
  };
}

describe('금융소득종합과세 — 비교과세(progressive_credit) 골든', () => {
  const ctx = resolveTaxContext();

  test('배당 1,900만원 — 문턱 아래이므로 추가 납부 0', () => {
    // 19,000,000 < 20,000,000 → 초과분 없음
    const r = calculateComprehensiveTaxAndHealthInsuranceKRW(krDividend(19_000_000), ctx);
    expect(r.comprehensiveTaxKRW).toBe(0);
  });

  test('배당 3,000만원 — 추가 납부 0 (이중과세 회귀 가드)', () => {
    // 초과분:       30,000,000 − 20,000,000        = 10,000,000
    // 누진세(국세): 10,000,000 × 6%                =    600,000   (1,400만원 이하 구간)
    // 지방세 포함:     600,000 × 1.1               =    660,000
    // 기납부(초과분): 10,000,000 × 15.4%           =  1,540,000
    // 추가 납부:    max(0, 660,000 − 1,540,000)    =          0
    //
    // 예전 모델은 10,000,000 × 15% = 1,500,000을 물렸다. 이미 15.4%를 원천징수해 놓고
    // 공제하지 않아 초과분 실효세율이 약 30.4%가 됐다 — 이것이 이 작업이 고친 결함이다.
    const r = calculateComprehensiveTaxAndHealthInsuranceKRW(krDividend(30_000_000), ctx);
    expect(r.comprehensiveTaxKRW).toBe(0);
  });

  test('배당 1억원 — 누진세가 원천징수를 넘어서므로 차액만 추가 납부', () => {
    // 초과분:       100,000,000 − 20,000,000       = 80,000,000
    // 누진세(국세): 80,000,000 × 24% − 5,760,000   = 13,440,000   (8,800만원 이하 구간)
    // 지방세 포함:  13,440,000 × 1.1               = 14,784,000
    // 기납부(초과분): 80,000,000 × 15.4%           = 12,320,000
    // 추가 납부:    14,784,000 − 12,320,000        =  2,464,000
    const r = calculateComprehensiveTaxAndHealthInsuranceKRW(krDividend(100_000_000), ctx);
    expect(r.comprehensiveTaxKRW).toBeCloseTo(2_464_000, -2);
  });

  test('미국 배당(원천징수 15%)은 국내 배당보다 기납부세액이 작아 추가 납부가 조금 더 크다', () => {
    // 외국납부세액공제를 따로 모델링하지 않아도, 실제 징수액을 기납부세액으로 쓰면
    // 15% vs 15.4% 차이가 그대로 반영된다.
    const amount = 100_000_000;
    const excess = amount - 20_000_000;

    const us = calculateComprehensiveTaxAndHealthInsuranceKRW(
      { annualRawFinancialIncomeKRW: amount, annualPublicPensionIncomeKRW: 0, annualWithheldFinancialTaxKRW: amount * 0.15 },
      ctx
    );
    const kr = calculateComprehensiveTaxAndHealthInsuranceKRW(krDividend(amount), ctx);

    // 차이 = 초과분 × (15.4% − 15%) = 80,000,000 × 0.004 = 320,000
    expect(us.comprehensiveTaxKRW - kr.comprehensiveTaxKRW).toBeCloseTo(excess * 0.004, -2);
  });

  test('문턱 바로 위에서 세액이 튀지 않는다 (연속성)', () => {
    // 초과분이 0에 수렴하면 추가 납부도 0에 수렴해야 한다. 계단이 생기면 이진탐색
    // (findMaxSustainableValue)의 단조성 전제가 깨진다.
    const justOver = calculateComprehensiveTaxAndHealthInsuranceKRW(krDividend(20_000_001), ctx);
    expect(justOver.comprehensiveTaxKRW).toBeCloseTo(0, 0);
  });
});

describe('금융소득종합과세 — flat 모드(예전 단순 모델)', () => {
  const flatCtx = resolveTaxContext({ comprehensiveTaxMode: 'flat', comprehensiveTaxRate: 15 });

  test('초과분에 지정 세율을 그대로 곱한다 (원천징수 미공제)', () => {
    // 10,000,000 × 15% = 1,500,000 — 예전 동작을 그대로 보존한다.
    const r = calculateComprehensiveTaxAndHealthInsuranceKRW(krDividend(30_000_000), flatCtx);
    expect(r.comprehensiveTaxKRW).toBeCloseTo(1_500_000);
  });

  test('같은 입력에서 flat이 progressive_credit보다 무겁다', () => {
    const flat = calculateComprehensiveTaxAndHealthInsuranceKRW(krDividend(30_000_000), flatCtx);
    const credit = calculateComprehensiveTaxAndHealthInsuranceKRW(krDividend(30_000_000), resolveTaxContext());

    expect(flat.comprehensiveTaxKRW).toBeGreaterThan(credit.comprehensiveTaxKRW);
  });
});

// TaxEngine 단위 테스트만으로는 "엔진이 원천징수액을 실제로 누적해 넘기는가"를 확인할 수
// 없다. 넘기지 않으면(0으로 넘기면) 공제가 사라져 예전 이중과세와 비슷한 크기의 세금이
// 다시 붙는데, 부호는 여전히 양수라 ">0" 같은 느슨한 단언은 통과한다.
describe('금융소득종합과세 — 엔진 통합(원천징수액 배선 검증)', () => {
  test('국내 ETF 배당 1억원인 해의 종합과세액이 손계산과 일치한다', () => {
    const result = new SimulationEngine().run({
      // 은퇴 직후부터 배당이 잡히도록 현재 나이 = 은퇴 나이.
      userProfile: { currentAge: 60, retirementAge: 60, expectancy: 61, targetMonthlySpending: 0 },
      assets: [
        {
          id: 'a1', type: 'etf', ticker: 'A', name: '국내 고배당 ETF',
          // 평가액 20억 × 5% = 연 1억원. 성장률 0으로 두어 평가액이 변하지 않게 한다.
          quantity: 20000, averagePrice: 100000,
          totalReturn: 0, dividendYield: 5,
          monthlyContribution: 0, reinvestDividend: false,
          currency: 'KRW', assetMarket: 'KR_ETF',
        },
      ],
      isaAccounts: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [],
      otherIncomes: [],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
    });

    const firstYear = result.yearlyResults[0];

    // 세전 배당은 20억 × 5% = 1억원이다.
    //
    // 예전에는 이 값이 1억보다 "조금 더" 컸다. 엔진이 그달의 잉여 현금(= 쓰지 않은 배당)을
    // 다시 자산에 집어넣어 배당 원본이 해 안에서 불어났기 때문이다. 잉여 현금을 별도 버킷에
    // 두면서 그 되먹임이 사라졌고, 이제 명목값과 정확히 일치한다.
    //
    // 이 테스트의 목적은 복리 계산이 아니라 "원천징수액이 비교과세로 넘어가는가"이므로,
    // 관측된 세전 배당에서 손계산 공식을 그대로 재현해 대조한다.
    const grossDividend = firstYear.preTaxTotalIncome;
    expect(grossDividend).toBeCloseTo(100_000_000, -2);

    // 원천징수는 국내 배당 15.4%
    expect(firstYear.dividendTaxPaid).toBeCloseTo(grossDividend * 0.154, -2);

    // 초과분:        grossDividend − 20,000,000
    // 누진세(국세):  초과분 × 24% − 5,760,000        (5,000만 초과 ~ 8,800만 이하 구간)
    // 지방세 포함:   × 1.1
    // 기납부(초과분): 초과분 × 15.4%
    // 추가 납부:     둘의 차액
    const excess = grossDividend - 20_000_000;
    expect(excess).toBeGreaterThan(50_000_000);
    expect(excess).toBeLessThan(88_000_000);
    const progressiveWithLocal = (excess * 0.24 - 5_760_000) * 1.1;
    const withheldOnExcess = excess * 0.154;

    expect(firstYear.comprehensiveTaxPaid).toBeCloseTo(progressiveWithLocal - withheldOnExcess, -2);

    // 예전 모델(초과분 × 15%)과 비교하면 절반 이하다 — 원천징수 공제가 실제로 작동한다는 뜻.
    expect(firstYear.comprehensiveTaxPaid).toBeLessThan(excess * 0.15 * 0.5);
  });
});

describe('금융소득종합과세 — 건강보험료는 모드와 무관하다', () => {
  test('건보료는 두 모드에서 동일하다', () => {
    const basis = krDividend(30_000_000);
    const credit = calculateComprehensiveTaxAndHealthInsuranceKRW(basis, resolveTaxContext());
    const flat = calculateComprehensiveTaxAndHealthInsuranceKRW(
      basis,
      resolveTaxContext({ comprehensiveTaxMode: 'flat' })
    );

    expect(credit.healthInsuranceKRW).toBe(flat.healthInsuranceKRW);
    // (30,000,000 − 20,000,000) × 7.09% = 709,000
    expect(credit.healthInsuranceKRW).toBeCloseTo(709_000);
  });
});
