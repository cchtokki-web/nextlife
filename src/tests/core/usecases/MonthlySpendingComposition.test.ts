import { describe, test, expect } from 'vitest';
import { makeYearlyResult as makeYearlyResultFixture } from '@/tests/fixtures/yearlyResult';
import { computeMonthlySpendingComposition } from '@/core/usecases/MonthlySpendingComposition';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SINGLE_SURVIVOR_SPENDING_FACTOR } from '@/core/usecases/spouse/spouseRules';
import {
  SimulationParams,
  SimulationResult,
  SimulationYearlyResult,
  AssetCurrency,
  SpendingFactor,
} from '@/core/entities/types';

// 대시보드 차트와 PDF 리포트가 "월 생활비 재원 구성"을 동일하게 계산하도록
// 공유하는 computeMonthlySpendingComposition의 행동을 검증한다.
//
// 이 함수는 다음 순서로 월 생활비를 채운다:
//   1) 국민연금(nationalUsed): 항상 raw 값 그대로 전액 사용
//   2) 사적연금(privatePenUsed): min(사적연금 raw, 국민연금 이후 남은 필요분) — 실제 시뮬레이션
//      인출액(raw)을 그대로 반영하며, 저율과세 한도로 인위적으로 자르지 않는다(초과세 부담 여부는
//      comprehensiveTaxPaid/healthInsurancePaid 등 별도 필드로 확인 가능).
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
  healthcareSpendingAnnual?: number;
  spendingFactor?: SpendingFactor;
}): SimulationYearlyResult {
  // 이 스위트가 실제로 보는 필드(소득 항목별 금액과 지출)만 지정하고 나머지 기본값은
  // 공용 픽스처에 맡긴다. 전체 리터럴을 복제하면 SimulationYearlyResult에 필수 필드가
  // 추가될 때마다 여기서도 컴파일이 깨진다.
  return makeYearlyResultFixture({
    age: overrides.age,
    year: overrides.age, // 테스트에서 의미 없음
    dividendIncome: overrides.dividendIncomeAnnual ?? 0,
    nationalPensionIncome: overrides.nationalPensionIncomeAnnual ?? 0,
    privatePensionIncome: overrides.privatePensionIncomeAnnual ?? 0,
    pensionIncome:
      (overrides.nationalPensionIncomeAnnual ?? 0) + (overrides.privatePensionIncomeAnnual ?? 0),
    otherIncome: overrides.otherIncomeAnnual ?? 0,
    spending: overrides.spendingAnnual,
    healthcareSpending: overrides.healthcareSpendingAnnual ?? 0,
    spendingFactor: overrides.spendingFactor ?? 1,
  });
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
    householdEndAge: 90,
  };
}

describe('computeMonthlySpendingComposition', () => {
  describe('사적연금 2중 클램프: min(사적연금 raw, 국민연금 이후 남은 필요분)', () => {
    test('사적연금 raw가 저율과세 한도를 초과해도 더 이상 한도로 자르지 않고 실제 인출액을 그대로 반영한다', () => {
      // 사적연금 raw 월 1,666,667원(연 20,000,000, 구 기본 한도 월 1,250,000보다 큼).
      // 남은 필요분(국민연금 이후)이 이보다 더 크므로(월 2,500,000) raw 값이 그대로 쓰여야 한다.
      const params = makeParams({});
      const yearly = makeYearlyResult({
        age: 60,
        nationalPensionIncomeAnnual: 0,
        privatePensionIncomeAnnual: 20000000,
        spendingAnnual: 30000000, // 월 2,500,000
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      const rawPrivatePenMonthly = Math.round(20000000 / 12); // 1,666,667
      expect(composition.privatePenUsed).toBe(rawPrivatePenMonthly);
      // 구 기본 한도(월 1,250,000)보다 커야 함 — 더 이상 한도에 걸리지 않는다는 회귀 가드
      expect(composition.privatePenUsed).toBeGreaterThan(1250000);
    });

    test('필요 생활비 자체가 적으면 남은 필요분(remainingAfterNational)이 이긴다', () => {
      // 국민연금이 이미 대부분을 충당해 남은 필요분이 매우 작다 (월 100,000원).
      // 사적연금 raw는 충분히 크다.
      const params = makeParams({});
      const yearly = makeYearlyResult({
        age: 60,
        nationalPensionIncomeAnnual: 22800000, // 월 1,900,000
        privatePensionIncomeAnnual: 12000000, // 월 1,000,000 (남은 필요분보다는 훨씬 큼)
        spendingAnnual: 24000000, // 월 2,000,000 -> 남은 필요분 = 2,000,000 - 1,900,000 = 100,000
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      const remainingAfterNational = 100000;
      expect(composition.privatePenUsed).toBe(remainingAfterNational);
      expect(composition.privatePenUsed).toBeLessThan(Math.round(12000000 / 12));
    });

    test('사적연금 자체가 부족하면 사적연금 raw 값이 이긴다', () => {
      // 사적연금 raw가 월 100,000원으로 남은 필요분(월 1,500,000)보다 훨씬 작다.
      const params = makeParams({});
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

  describe('의료비(healthcareSpending)', () => {
    test('의료비도 필요분에 포함해 자산부족(shortfall)을 판정한다', () => {
      // 목표 생활비 월 200만원 + 의료비 월 50만원 = 필요분 월 250만원인데
      // 실제 지출은 월 220만원까지밖에 못 갔으므로 자산부족은 월 30만원이다.
      // 의료비를 필요분에 넣지 않으면 220만원 >= 200만원이라 부족이 0으로 숨는다.
      const params = makeParams({ targetMonthlySpending: 2000000 });
      const yearly = makeYearlyResult({
        age: 60,
        spendingAnnual: 26400000, // 월 2,200,000
        healthcareSpendingAnnual: 6000000, // 월 500,000
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      expect(composition.shortfall).toBe(300000);
    });

    test('의료비가 0이면 기존과 동일하게 판정한다', () => {
      const params = makeParams({ targetMonthlySpending: 2000000 });
      const yearly = makeYearlyResult({ age: 60, spendingAnnual: 26400000 });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      expect(composition.shortfall).toBe(0);
    });
  });

  describe('가구 규모 계수(spendingFactor)', () => {
    test('배우자 사망 후(계수 0.7)에는 축소된 필요분을 기준으로 판정해 가짜 부족분을 만들지 않는다', () => {
      // 엔진은 한 명만 남은 해의 목표 생활비에 0.7을 곱해 실제로 월 140만원을 인출한다.
      // 목표(분모)에도 같은 계수를 곱하지 않으면 매년 0.3 × 200만원 = 60만원의
      // 존재하지 않는 '자산부족'이 사망 시점부터 시뮬레이션 끝까지 보고된다.
      const params = makeParams({ targetMonthlySpending: 2000000 });
      const yearly = makeYearlyResult({
        age: 70,
        spendingAnnual: 16800000, // 월 1,400,000 = 200만원 × 0.7
        spendingFactor: 0.7,
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      expect(composition.shortfall).toBe(0);
    });

    test('계수와 의료비가 함께 있으면 계수는 생활비에만, 의료비는 이미 축소된 값 그대로 더한다', () => {
      // 목표 200만원 × 0.7 = 140만원, 의료비는 엔진이 이미 0.7을 곱해 월 35만원으로 계산해 둔 값이다.
      // 필요분 = 175만원. 실제 지출이 155만원이면 부족분은 20만원이어야 한다.
      // 의료비에 계수를 다시 곱하면(이중 적용) 필요분이 1,645,000원이 되어 부족분이 95,000원으로 어긋난다.
      const params = makeParams({ targetMonthlySpending: 2000000 });
      const yearly = makeYearlyResult({
        age: 70,
        spendingAnnual: 18600000, // 월 1,550,000
        healthcareSpendingAnnual: 4200000, // 월 350,000 (계수 이미 반영됨)
        spendingFactor: 0.7,
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      expect(composition.shortfall).toBe(200000);
    });

    test('targetMonthly에도 계수가 반영된 값이 실린다', () => {
      // 화면(생활비 구성 차트 툴팁)이 "목표 얼마 중 얼마 부족"을 말하려면 shortfall과
      // **같은 분모**를 받아야 한다. 이 값을 화면에서 다시 계산하면(물가·계수·의료비 규칙을
      // 복제하면) 배우자 사망 이후 구간에서 반드시 어긋난다.
      const params = makeParams({ targetMonthlySpending: 2000000 });
      const yearly = makeYearlyResult({
        age: 70,
        spendingAnnual: 16800000,
        spendingFactor: 0.7,
      });
      const result = makeResult([yearly]);

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      expect(composition.targetMonthly).toBe(1400000); // 200만원 × 0.7
    });

    test('max_sustainable로 역산된 목표에도 같은 계수를 적용한다', () => {
      const params = makeParams({ spendingStrategy: 'max_sustainable' });
      const yearly = makeYearlyResult({
        age: 70,
        spendingAnnual: 21000000, // 월 1,750,000 = 250만원 × 0.7
        spendingFactor: 0.7,
      });
      const result = { ...makeResult([yearly]), calculatedTargetSpending: 2500000 };

      const [composition] = computeMonthlySpendingComposition([yearly], params, result);

      expect(composition.shortfall).toBe(0);
    });
  });
});

// 위의 모든 테스트는 makeYearlyResult가 손으로 만든 SimulationYearlyResult를 먹인다.
// 그래서 엔진이 채우는 필드의 "의미"가 바뀌어도 — spendingFactor를 이미 곱한 spending을
// 넘기던 규약이 바뀌거나, healthcareSpending이 spending에 포함되지 않게 되거나,
// 은퇴 후 연도 집합이 본인 기대수명에서 끊기게 되거나 — 이 파일은 전부 초록인 채로
// 대시보드 차트와 PDF만 깨진다. 아래는 그 계약을 실제 엔진 출력으로 건다.
//
// 배우자와 의료비를 함께 켠 시나리오를 쓴다. spendingFactor / healthcareSpending이
// 가장 최근에 추가된 두 필드라 계약이 가장 깨지기 쉽고, 둘 다 목표(분모) 쪽 보정이
// 필요해서 한쪽만 반영하면 즉시 가짜 부족분으로 드러나기 때문이다.
describe('실제 SimulationEngine 출력과의 계약', () => {
  // 본인 60세 은퇴·85세 기대수명, 배우자는 5살 어리고 85세까지 → 본인 나이 기준 90세 사망.
  // 즉 가구는 본인 사후 5년(86~90세)을 배우자 단독으로 더 산다.
  // 자산은 넉넉히 두어 전 기간 목표 생활비를 전액 충당하게 한다(고갈되면 spending이 깎여
  // 아래 shortfall 단정의 의미가 사라진다 — 전제로 depletionAge === null을 함께 건다).
  const params: SimulationParams = {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2000000 },
    assets: [
      {
        id: 'a1', name: '국내 ETF', ticker: 'KODEX', type: 'etf', assetMarket: 'KR_ETF', currency: 'KRW',
        quantity: 20000, averagePrice: 100000, monthlyContribution: 0,
        annualGrowthRate: 6, dividendYield: 2, reinvestDividend: false,
      },
    ],
    nationalPension: { expectedMonthlyAmount: 1000000 },
    privatePensions: [
      {
        id: 'p1', name: '연금저축', type: 'savings', currency: 'KRW', balance: 300000000,
        monthlyContribution: 0, annualReturn: 4,
      },
    ],
    // 배당·기타소득이 동시에 있으면 두 항목이 remainingAfterPension을 비례 배분하면서
    // 각각 반올림되어 구성 합계가 ±1원 흔들린다. 계약 검증이 목적이므로 기타소득은 비운다.
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    spendingStrategy: 'target',
    spouse: {
      enabled: true, currentAge: 55, expectancy: 85,
    },
    healthcare: {
      enabled: true, costGrowthRate: 5, baseMonthlyCost: 400000,
      longTermCareEnabled: true, longTermCareStartAge: 80, longTermCareMonthlyCost: 1000000,
      shockEnabled: true, shockAge: 75, shockAmount: 30000000,
    },
  };

  const result = new SimulationEngine().run(params);
  const composition = computeMonthlySpendingComposition(result.yearlyResults, params, result);

  test('전제: 시나리오가 고갈되지 않고 배우자·의료비가 실제로 켜져 있다', () => {
    // 아래 단정들이 "아무 일도 일어나지 않아서" 통과하는 상태로 조용히 퇴화하는 것을 막는다.
    expect(result.depletionAge).toBeNull();
    expect(result.yearlyResults.some((y) => y.spendingFactor === SINGLE_SURVIVOR_SPENDING_FACTOR)).toBe(true);
    expect(result.yearlyResults.every((y) => y.age < 60 || y.healthcareSpending > 0)).toBe(true);
  });

  test('구성 대상 연도가 엔진이 실제로 돈 은퇴 후 전 기간과 일치한다', () => {
    // 가구 종료 나이(90)까지다. 소비처가 본인 기대수명(85)에서 끊으면 배우자 단독 생존
    // 구간 5년이 차트에서 통째로 사라진다.
    expect(result.householdEndAge).toBe(90);
    expect(composition.map((c) => c.age))
      .toEqual(result.yearlyResults.filter((y) => y.age >= 60).map((y) => y.age));
    expect(composition[composition.length - 1].age).toBe(90);
  });

  test('모든 해에서 재원 구성의 합이 엔진의 실제 월 지출과 정확히 일치한다', () => {
    for (const c of composition) {
      const actualMonthly = Math.round(
        result.yearlyResults.find((y) => y.age === c.age)!.spending / 12
      );
      const covered = c.nationalUsed + c.privatePenUsed + c.dividendUsed + c.otherUsed + c.assetWithdrawal;

      expect(covered, `${c.age}세의 재원 합계`).toBe(actualMonthly);
    }
  });

  test('국민연금 구성분이 엔진의 nationalPensionIncome 필드에서 그대로 온다', () => {
    // 필드 이름/단위(연간 세후 KRW) 계약을 건다. 월 단위로 바뀌거나 세전으로 바뀌면 깨진다.
    for (const c of composition) {
      const yearly = result.yearlyResults.find((y) => y.age === c.age)!;

      expect(c.nationalUsed, `${c.age}세의 국민연금`).toBe(Math.round(yearly.nationalPensionIncome / 12));
    }
  });

  test('자산이 충분한 계획에서는 어떤 해에도 가짜 부족분이 생기지 않는다', () => {
    // 목표(분모)는 여기서 다시 계산되고 실제 지출(분자)은 엔진이 계산한다. 두 계산이
    // spendingFactor·healthcareSpending에 대해 같은 규약을 쓰지 않으면 즉시 벌어진다:
    //   - 목표에만 계수를 안 곱하면 86세부터 (1-0.7) × 200만 = 60만원의 가짜 부족분
    //   - 목표에 의료비를 안 더하면 부족분이 음수로 눌려 0으로 숨는 대신, 반대로
    //     의료비에 계수를 이중 적용하면 다시 벌어진다
    //   - 75세 의료비 쇼크(3천만원)가 목표에 안 들어가면 그 해만 250만원어치가 어긋난다
    // 남는 오차는 실제 지출을 원 단위로 반올림한 것뿐이므로 1원 미만이어야 한다.
    for (const c of composition) {
      expect(c.shortfall, `${c.age}세의 부족분`).toBeLessThan(1);
    }
  });
});
