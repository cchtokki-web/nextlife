import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// 총자산 보존 불변식.
//
//   기말자산 = 기초자산 + (외부에서 들어온 돈) − (밖으로 나간 돈)
//
// 골든값 테스트는 계산이 틀린 채로 굳을 수 있지만 보존식은 그럴 수 없다. 이 한 파일이
// 세 종류의 결함을 동시에 잡는다:
//   (1) 세금을 두 번 뗐다      — 유출이 실제보다 커져 좌변 < 우변
//   (2) 세금이 증발했다        — 세금 필드에는 기록됐는데 자산에서 빠지지 않아 좌변 > 우변
//   (3) 매도액/인출액이 사라졌다 — 원가 회계나 통화 변환 실수
//
// ## 왜 성장률을 0으로 두는가
//
// 투자 수익은 "외부에서 들어온 돈"인데 SimulationYearlyResult에 노출되지 않는다(연간
// 성장분 필드가 없다). 성장률이 0이 아니면 우변을 결과 필드만으로 재구성할 수 없다.
// 배당은 preTaxTotalIncome에 실려 있으므로 배당수익률은 0이 아니어도 된다 — 즉 이
// 픽스처는 "성장 없는 고배당 포트폴리오"이며, 세금 경로(배당세·종합과세·건보료·연금세)는
// 전부 살아 있다.
//
// ## 왜 ISA를 넣지 않는가
//
// ISA 만기 정산세(SimulationEngine.ts:541-549)가 결과 타입에 필드로 노출되지 않아
// 우변에서 셀 방법이 없다. ISA를 포함한 보존 검증은 isaAssets 필드 도입 이후에나 가능하다.
//
// ## 우변의 구성
//
// preTaxTotalIncome은 "외부 유입"과 "내부 이동"을 섞어 담는다 — 사적연금 인출은 연금
// 계좌(이미 totalAssets 안)에서 소득으로 옮기는 내부 이동이지 새로 들어온 돈이 아니다.
// 그래서 사적연금 인출 세전액을 빼야 한다. 그 값은 직접 노출되지 않지만 아래 항등식으로
// 복원된다(SimulationEngine.ts:848-850 — 연말 초과세 조정 A는 한쪽에서 빼고 다른 쪽에
// 더하므로 합에서 상쇄된다):
//
//   privatePensionIncome + pensionTaxPaid = (ΣdrawNet − A) + (ΣdrawTax + A) = Σ drawPreTax
//
// 초과세 A 자체는 자산에서 직접 빠져나가는 진짜 유출이며, pensionTaxPaid에 포함된 채로
// 유출 항에서 정확히 한 번 세어진다.

interface Flows {
  externalInflow: number;
  outflow: number;
}

// 결과 한 해에서 외부 유입/유출을 재구성한다.
function flowsOf(r: {
  preTaxTotalIncome: number;
  privatePensionIncome: number;
  pensionTaxPaid: number;
  spending: number;
  dividendTaxPaid: number;
  nationalPensionTaxPaid: number;
  comprehensiveTaxPaid: number;
  healthInsurancePaid: number;
  capitalGainsTaxPaid: number;
}): Flows {
  const privatePensionDrawPreTax = r.privatePensionIncome + r.pensionTaxPaid;
  return {
    // 배당 + 국민연금 + 기타소득 (전부 세전). 사적연금 인출은 내부 이동이라 제외.
    externalInflow: r.preTaxTotalIncome - privatePensionDrawPreTax,
    outflow:
      r.spending +
      r.dividendTaxPaid +
      r.pensionTaxPaid +
      r.nationalPensionTaxPaid +
      r.comprehensiveTaxPaid +
      r.healthInsurancePaid +
      r.capitalGainsTaxPaid,
  };
}

function initialTotalAssets(params: SimulationParams): number {
  const assets = params.assets.reduce((s, a) => s + a.quantity * a.averagePrice, 0);
  const pensions = (params.privatePensions ?? []).reduce((s, p) => s + p.balance, 0);
  return assets + pensions;
}

// 은퇴 전 월 적립은 자산·연금 잔액을 늘리는 외부 유입이다. 은퇴 후에는 납입이 멈춘다
// (SimulationEngine.ts:565, :608).
function annualContribution(params: SimulationParams, age: number): number {
  if (age >= params.userProfile.retirementAge) return 0;
  const assets = params.assets.reduce((s, a) => s + a.monthlyContribution * 12, 0);
  const pensions = (params.privatePensions ?? []).reduce((s, p) => s + p.monthlyContribution * 12, 0);
  return assets + pensions;
}

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 61, expectancy: 78, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'A', name: '무성장 고배당1',
      quantity: 4000, averagePrice: 100000,
      annualGrowthRate: 0, dividendYield: 5,
      monthlyContribution: 500000, reinvestDividend: false, currency: 'KRW',
    },
    {
      id: 'a2', type: 'etf', ticker: 'B', name: '무성장 고배당2',
      quantity: 2000, averagePrice: 100000,
      annualGrowthRate: 0, dividendYield: 3,
      monthlyContribution: 300000, reinvestDividend: false, currency: 'KRW',
    },
  ],
  isaAccounts: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    {
      id: 'p1', type: 'irp', balance: 300000000,
      monthlyContribution: 400000, annualReturn: 0, currency: 'KRW',
    },
  ],
  otherIncomes: [{ id: 'o1', label: '임대소득', monthlyAmount: 500000, currency: 'KRW' }],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

// 오차 허용치. 통화 변환이 없는 KRW 단일 통화 픽스처이므로 부동소수점 누적분만 남는다.
const TOLERANCE_KRW = 1;

describe('SimulationEngine - 총자산 보존 불변식', () => {
  test('연도별로 기말자산 = 기초자산 + 외부유입 − 유출 이 성립한다', () => {
    const result = new SimulationEngine().run(baseParams);

    let openingAssets = initialTotalAssets(baseParams);
    const violations: string[] = [];

    for (const year of result.yearlyResults) {
      const { externalInflow, outflow } = flowsOf(year);
      const expected = openingAssets + annualContribution(baseParams, year.age) + externalInflow - outflow;
      const diff = year.totalAssets - expected;

      if (Math.abs(diff) > TOLERANCE_KRW) {
        violations.push(
          `${year.age}세: 실제 ${Math.round(year.totalAssets).toLocaleString()} vs `
          + `기대 ${Math.round(expected).toLocaleString()} (차이 ${Math.round(diff).toLocaleString()})`
        );
      }
      openingAssets = year.totalAssets;
    }

    expect(violations).toEqual([]);
  });

  test('자산이 고갈되는 해에도 세금이 증발하지 않는다', () => {
    // 생활비를 감당 못 할 만큼 키워 자산을 확실히 소진시킨다. 자산이 0이 된 뒤에도
    // 결과에 기록된 세금은 전부 어딘가에서 실제로 빠져나갔어야 한다.
    const depletingParams: SimulationParams = {
      ...baseParams,
      userProfile: { ...baseParams.userProfile, targetMonthlySpending: 12000000 },
    };
    const result = new SimulationEngine().run(depletingParams);

    expect(result.depletionAge).not.toBeNull();

    let openingAssets = initialTotalAssets(depletingParams);
    const violations: string[] = [];

    for (const year of result.yearlyResults) {
      const { externalInflow, outflow } = flowsOf(year);
      const expected = openingAssets + annualContribution(depletingParams, year.age) + externalInflow - outflow;
      const diff = year.totalAssets - expected;

      if (Math.abs(diff) > TOLERANCE_KRW) {
        violations.push(
          `${year.age}세: 실제 ${Math.round(year.totalAssets).toLocaleString()} vs `
          + `기대 ${Math.round(expected).toLocaleString()} (차이 ${Math.round(diff).toLocaleString()})`
        );
      }
      openingAssets = year.totalAssets;
    }

    expect(violations).toEqual([]);
  });

  test('양도소득세가 발생하는 해에도 보존이 성립한다', () => {
    // 위 두 픽스처는 KR_ETW(비과세)라 양도세 경로를 한 번도 타지 않는다. 원가 회계
    // (applySale)가 매도액과 원가를 비례로 깎는데, 그 계산이 틀리면 자산이 소리 없이
    // 늘거나 줄어든다 — 세금 필드만 봐서는 드러나지 않는 종류의 결함이라 보존식으로 잡는다.
    const overseasParams: SimulationParams = {
      ...baseParams,
      // 기본 픽스처는 배당·기타소득이 생활비를 덮어 매도가 한 번도 일어나지 않는다.
      // 매도가 없으면 양도차익도 없으므로 생활비를 올려 실제로 팔게 만든다.
      userProfile: { ...baseParams.userProfile, targetMonthlySpending: 6000000 },
      assets: baseParams.assets.map((a) => ({
        ...a,
        assetMarket: 'US_ETF' as const,
        // 평가액의 30%만 취득원가 → 매도액의 70%가 차익으로 실현된다.
        acquisitionCostBasis: a.quantity * a.averagePrice * 0.3,
      })),
    };
    const result = new SimulationEngine().run(overseasParams);

    // 전제 확인: 실제로 양도세가 부과되는 해가 있어야 이 테스트가 의미를 갖는다.
    expect(result.yearlyResults.some((y) => y.capitalGainsTaxPaid > 0)).toBe(true);

    let openingAssets = initialTotalAssets(overseasParams);
    const violations: string[] = [];

    for (const year of result.yearlyResults) {
      const { externalInflow, outflow } = flowsOf(year);
      const expected = openingAssets + annualContribution(overseasParams, year.age) + externalInflow - outflow;
      const diff = year.totalAssets - expected;

      if (Math.abs(diff) > TOLERANCE_KRW) {
        violations.push(
          `${year.age}세: 실제 ${Math.round(year.totalAssets).toLocaleString()} vs `
          + `기대 ${Math.round(expected).toLocaleString()} (차이 ${Math.round(diff).toLocaleString()})`
        );
      }
      openingAssets = year.totalAssets;
    }

    expect(violations).toEqual([]);
  });
});
