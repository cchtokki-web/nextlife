import { describe, test, expect } from 'vitest';
import { computeMonthlySpendingComposition } from '@/core/usecases/MonthlySpendingComposition';
import {
  SimulationParams,
  SimulationResult,
  SimulationYearlyResult,
  AssetCurrency,
} from '@/core/entities/types';

// 대시보드 차트와 PDF 리포트가 "월 생활비 재원 구성"을 동일하게 계산하도록
// 공유하는 computeMonthlySpendingComposition의 행동을 검증한다.
//
// 이 함수는 다음 순서로 월 생활비를 채운다:
//   1) 국민연금(nationalUsed): 항상 raw 값 그대로 전액 사용
//   2) 사적연금(privatePenUsed): min(사적연금 raw, 저율과세 월한도, 국민연금 이후 남은 필요분)
//   3) 배당/기타소득(dividendUsed/otherUsed): 남은 필요분을 raw 비율대로 채움 (0으로 나누기 방지)
//   4) 자산인출(assetWithdrawal): 그래도 남은 필요분

// 테스트에 필요한 최소한의 SimulationParams를 만드는 헬퍼.
// 함수가 실제로 참조하는 필드(userProfile, displayCurrency, baseExchangeRate,
// taxSettings.privatePensionLimit, inflationRate, inflationMode, spendingStrategy)만
// 의미 있게 채우고, 나머지 필수 필드는 로직에 영향을 주지 않는 빈 값으로 채운다.
function makeParams(overrides: {
  currentAge?: number;
  retirementAge?: number;
  targetMonthlySpending?: number;
  displayCurrency?: AssetCurrency;
  baseExchangeRate?: number;
  privatePensionLimit?: number;
  inflationMode?: 'nominal' | 'real';
  inflationRate?: number;
  spendingStrategy?: SimulationParams['spendingStrategy'];
}): SimulationParams {
  return {
    userProfile: {
      currentAge: overrides.currentAge ?? 60,
      retirementAge: overrides.retirementAge ?? 60,
      expectancy: 90,
      targetMonthlySpending: overrides.targetMonthlySpending ?? 2000000,
    },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: overrides.inflationRate ?? 2.5,
    inflationMode: overrides.inflationMode ?? 'real',
    baseExchangeRate: overrides.baseExchangeRate ?? 1300,
    exchangeScenario: 'base',
    displayCurrency: overrides.displayCurrency ?? 'KRW',
    spendingStrategy: overrides.spendingStrategy ?? 'target',
    taxSettings:
      overrides.privatePensionLimit !== undefined
        ? { ...defaultTaxSettings, privatePensionLimit: overrides.privatePensionLimit }
        : undefined,
  };
}

const defaultTaxSettings = {
  enableComprehensiveTax: false,
  enableHealthInsurance: false,
  usDividendTaxRate: 15,
  domesticDividendTaxRate: 15.4,
  comprehensiveTaxRate: 15,
  healthInsuranceRate: 5,
};

// 테스트에 필요한 연도별 결과(연간 금액 단위, 함수 내부에서 /12로 월 환산됨)를 만드는 헬퍼.
function makeYearlyResult(overrides: {
  age: number;
  nationalPensionIncomeAnnual?: number;
  privatePensionIncomeAnnual?: number;
  dividendIncomeAnnual?: number;
  otherIncomeAnnual?: number;
  spendingAnnual: number;
}): SimulationYearlyResult {
  return {
    age: overrides.age,
    year: overrides.age, // 테스트에서 의미 없음
    totalAssets: 0,
    stockAssets: 0,
    pensionAssets: 0,
    dividendIncome: overrides.dividendIncomeAnnual ?? 0,
    nationalPensionIncome: overrides.nationalPensionIncomeAnnual ?? 0,
    privatePensionIncome: overrides.privatePensionIncomeAnnual ?? 0,
    pensionIncome:
      (overrides.nationalPensionIncomeAnnual ?? 0) + (overrides.privatePensionIncomeAnnual ?? 0),
    otherIncome: overrides.otherIncomeAnnual ?? 0,
    totalIncome: 0,
    preTaxTotalIncome: 0,
    dividendTaxPaid: 0,
    pensionTaxPaid: 0,
    nationalPensionTaxPaid: 0,
    healthInsurancePaid: 0,
    comprehensiveTaxPaid: 0,
    spending: overrides.spendingAnnual,
    hasTaxWarning: false,
  };
}

function makeResult(yearlyResults: SimulationYearlyResult[]): SimulationResult {
  return {
    yearlyResults,
    fireAge: null,
    depletionAge: null,
    endingAssets: 0,
    retirementScore: 0,
    retirementGrade: '보통' as SimulationResult['retirementGrade'],
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

describe('computeMonthlySpendingComposition', () => {
  describe('사적연금 3중 클램프: min(사적연금 raw, 저율과세 월한도, 국민연금 이후 남은 필요분)', () => {
    test('저율과세 한도를 초과하면 한도가 이긴다 (privatePenUsed === monthlyPensionLimit)', () => {
      // 저율과세 연 한도 6,000,000원 -> 월 500,000원
      // 사적연금 raw 월 1,666,667원(연 20,000,000), 필요분(국민연금 이후) 월 1,500,000원
      // 셋 중 가장 작은 값은 한도(500,000)여야 한다.
      const params = makeParams({ privatePensionLimit: 6000000 });
      const yearly = makeYearlyResult({
        age: 60,
        nationalPensionIncomeAnnual: 0,
        privatePensionIncomeAnnual: 20000000,
        spendingAnnual: 18000000, // 월 1,500,000
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      const expectedMonthlyLimit = 6000000 / 12; // 500,000
      expect(composition.privatePenUsed).toBe(expectedMonthlyLimit);
      // 한도에 걸렸으므로 사적연금 raw(1,666,667)나 남은 필요분(1,500,000)보다 작아야 한다
      expect(composition.privatePenUsed).toBeLessThan(Math.round(20000000 / 12));
      expect(composition.privatePenUsed).toBeLessThan(1500000);
    });

    test('필요 생활비 자체가 적으면 남은 필요분(remainingAfterNational)이 이긴다', () => {
      // 국민연금이 이미 대부분을 충당해 남은 필요분이 매우 작다 (월 100,000원).
      // 사적연금 raw와 저율과세 한도는 모두 충분히 크다.
      const params = makeParams({}); // 기본 저율과세 한도(연 15,000,000 -> 월 1,250,000) 사용
      const yearly = makeYearlyResult({
        age: 60,
        nationalPensionIncomeAnnual: 22800000, // 월 1,900,000
        privatePensionIncomeAnnual: 12000000, // 월 1,000,000 (한도보다 작지만 남은 필요분보다는 훨씬 큼)
        spendingAnnual: 24000000, // 월 2,000,000 -> 남은 필요분 = 2,000,000 - 1,900,000 = 100,000
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      const remainingAfterNational = 100000;
      expect(composition.privatePenUsed).toBe(remainingAfterNational);
      expect(composition.privatePenUsed).toBeLessThan(Math.round(12000000 / 12));
      expect(composition.privatePenUsed).toBeLessThan(15000000 / 12);
    });

    test('사적연금 자체가 부족하면 사적연금 raw 값이 이긴다', () => {
      // 사적연금 raw가 월 100,000원으로 저율과세 한도(월 1,250,000)와
      // 남은 필요분(월 1,500,000)보다 훨씬 작다.
      const params = makeParams({}); // 기본 저율과세 한도
      const yearly = makeYearlyResult({
        age: 60,
        nationalPensionIncomeAnnual: 0,
        privatePensionIncomeAnnual: 1200000, // 월 100,000
        spendingAnnual: 18000000, // 월 1,500,000 -> 남은 필요분 1,500,000
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      const rawPrivatePenMonthly = Math.round(1200000 / 12); // 100,000
      expect(composition.privatePenUsed).toBe(rawPrivatePenMonthly);
      expect(composition.privatePenUsed).toBeLessThan(15000000 / 12);
      expect(composition.privatePenUsed).toBeLessThan(1500000);
    });
  });

  describe('배당/기타소득 합계가 0인 경우의 0으로 나누기 방지', () => {
    test('필요분이 남아있어도 dividend+other가 0이면 NaN/Infinity 없이 0으로 처리되고 나머지는 자산인출로 채워진다', () => {
      const params = makeParams({});
      const yearly = makeYearlyResult({
        age: 60,
        nationalPensionIncomeAnnual: 6000000, // 월 500,000
        privatePensionIncomeAnnual: 6000000, // 월 500,000
        dividendIncomeAnnual: 0,
        otherIncomeAnnual: 0,
        spendingAnnual: 24000000, // 월 2,000,000
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      // 배당/기타소득이 없으므로 0이어야 하고, NaN/Infinity가 발생하면 안 된다
      expect(composition.dividendUsed).toBe(0);
      expect(composition.otherUsed).toBe(0);
      expect(Number.isFinite(composition.dividendUsed)).toBe(true);
      expect(Number.isFinite(composition.otherUsed)).toBe(true);

      // 국민연금(500,000) + 사적연금(500,000)으로 채우지 못한 나머지(1,000,000)는
      // NaN 없이 자산인출로 정상 이전되어야 한다
      expect(composition.assetWithdrawal).toBe(1000000);
      expect(Number.isFinite(composition.assetWithdrawal)).toBe(true);
      expect(Number.isNaN(composition.assetWithdrawal)).toBe(false);

      // 모든 출력 필드가 유한한 숫자여야 한다
      for (const [key, value] of Object.entries(composition)) {
        expect(Number.isFinite(value), `${key} 필드가 유한해야 함`).toBe(true);
      }
    });
  });

  describe('displayCurrency === "USD"일 때 저율과세 한도를 환율로 나누는 분기', () => {
    test('동일한 입력이라도 KRW와 USD에서 사적연금 한도 클램프 결과가 달라진다', () => {
      const rawPensionLimit = 15000000; // 연 (원)
      const baseExchangeRate = 1300;

      // 사적연금 raw와 남은 필요분을 모두 한도보다 크게 설정해
      // KRW/USD 각각에서 "한도"가 클램프의 승자가 되도록 한다.
      const yearly = makeYearlyResult({
        age: 60,
        nationalPensionIncomeAnnual: 6000000, // 월 500,000
        privatePensionIncomeAnnual: 30000000, // 월 2,500,000 (두 통화 한도보다 훨씬 큼)
        spendingAnnual: 60000000, // 월 5,000,000 -> 남은 필요분 4,500,000 (역시 한도보다 큼)
      });

      const krwParams = makeParams({
        displayCurrency: 'KRW',
        baseExchangeRate,
        privatePensionLimit: rawPensionLimit,
      });
      const usdParams = makeParams({
        displayCurrency: 'USD',
        baseExchangeRate,
        privatePensionLimit: rawPensionLimit,
      });

      const [krwComposition] = computeMonthlySpendingComposition(
        [yearly],
        krwParams,
        makeResult([yearly])
      );
      const [usdComposition] = computeMonthlySpendingComposition(
        [yearly],
        usdParams,
        makeResult([yearly])
      );

      const expectedKrwLimit = rawPensionLimit / 12; // 1,250,000
      const expectedUsdLimit = rawPensionLimit / 12 / baseExchangeRate; // ≈ 961.54

      expect(krwComposition.privatePenUsed).toBeCloseTo(expectedKrwLimit, 6);
      expect(usdComposition.privatePenUsed).toBeCloseTo(expectedUsdLimit, 6);

      // 환율 나눗셈으로 인해 USD 쪽 한도가 훨씬 작으므로 결과도 작아야 한다
      expect(usdComposition.privatePenUsed).toBeLessThan(krwComposition.privatePenUsed);
      // KRW 한도를 baseExchangeRate로 나눈 값과 정확히 일치해야 한다
      expect(usdComposition.privatePenUsed).toBeCloseTo(
        krwComposition.privatePenUsed / baseExchangeRate,
        6
      );
    });
  });

  describe('정상 케이스: 국민연금 + 사적연금 + 배당/기타소득 조합', () => {
    test('각 재원 구성요소의 합은 실제 월 생활비 지출(spending 기준)과 일치해야 한다', () => {
      const params = makeParams({
        targetMonthlySpending: 2000000,
        inflationMode: 'real',
      });
      const yearly = makeYearlyResult({
        age: 60,
        nationalPensionIncomeAnnual: 12000000, // 월 1,000,000
        privatePensionIncomeAnnual: 6000000, // 월 500,000
        dividendIncomeAnnual: 3600000, // 월 300,000
        otherIncomeAnnual: 1200000, // 월 100,000
        spendingAnnual: 24000000, // 월 2,000,000
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      const actualSpendingMonthly = Math.round(24000000 / 12); // 2,000,000

      const totalCovered =
        composition.nationalUsed +
        composition.privatePenUsed +
        composition.dividendUsed +
        composition.otherUsed +
        composition.assetWithdrawal;

      expect(totalCovered).toBe(actualSpendingMonthly);

      // 개별 구성요소도 기대값과 일치하는지 확인 (회귀 방지)
      expect(composition.nationalUsed).toBe(1000000);
      expect(composition.privatePenUsed).toBe(500000);
      expect(composition.dividendUsed).toBe(300000);
      expect(composition.otherUsed).toBe(100000);
      expect(composition.assetWithdrawal).toBe(100000);
      expect(composition.shortfall).toBe(0);
    });

    test('배당/기타소득이 남은 필요분보다 커서 일부만 비례 사용되는 경우에도 합계가 일치한다', () => {
      const params = makeParams({
        targetMonthlySpending: 900000,
        inflationMode: 'real',
      });
      const yearly = makeYearlyResult({
        age: 60,
        nationalPensionIncomeAnnual: 6000000, // 월 500,000
        privatePensionIncomeAnnual: 1200000, // 월 100,000 (raw 자체가 가장 작아 그대로 사용됨)
        dividendIncomeAnnual: 3600000, // 월 300,000
        otherIncomeAnnual: 1200000, // 월 100,000 (배당/기타 합계 400,000)
        spendingAnnual: 10800000, // 월 900,000
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      const actualSpendingMonthly = Math.round(10800000 / 12); // 900,000
      const totalCovered =
        composition.nationalUsed +
        composition.privatePenUsed +
        composition.dividendUsed +
        composition.otherUsed +
        composition.assetWithdrawal;

      expect(totalCovered).toBe(actualSpendingMonthly);

      // 국민연금(500,000) + 사적연금(100,000) 이후 남은 필요분은 300,000인데
      // 배당/기타 합계(400,000)가 이를 초과하므로 ratio = 300,000/400,000 = 0.75로 비례 배분되어
      // 배당 300,000*0.75=225,000, 기타 100,000*0.75=75,000만 사용되고 나머지는 쓰이지 않는다.
      expect(composition.dividendUsed).toBe(225000);
      expect(composition.otherUsed).toBe(75000);
      expect(composition.assetWithdrawal).toBe(0);
    });
  });
});
