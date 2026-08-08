import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

describe('SimulationEngine withdrawalPlan (인출 정책 파라미터화)', () => {
  const baseParams: SimulationParams = {
    userProfile: {
      currentAge: 55,
      retirementAge: 60,
      expectancy: 90,
      targetMonthlySpending: 3000000, // 300만 원
    },
    assets: [
      {
        id: 'asset-1',
        type: 'etf',
        ticker: 'VOO',
        name: 'S&P 500 ETF',
        quantity: 100,
        averagePrice: 500, // 500 USD
        annualGrowthRate: 8,
        dividendYield: 2,
        monthlyContribution: 100,
        reinvestDividend: true,
        currency: 'USD',
      },
    ],
    nationalPension: {
      expectedMonthlyAmount: 1000000,
    },
    privatePensions: [
      {
        id: 'pension-1',
        type: 'irp',
        balance: 300000000, // 3억 원 (인출 정책 차이가 잘 드러나도록 충분히 큰 잔액)
        monthlyContribution: 500000,
        annualReturn: 5,
        currency: 'KRW',
      },
    ],
    otherIncomes: [
      {
        id: 'income-1',
        label: '임대소득',
        monthlyAmount: 500000,
        currency: 'KRW',
      },
    ],
    inflationRate: 2.5,
    inflationMode: 'nominal',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };

  // 회귀 가드 스냅샷을 둘로 나눈 이유.
  //
  // 예전에는 result 객체를 통째로 찍었다(32KB, 36개 연도 × 25개 필드). 그 형태에서는
  // 세율을 하나만 바꿔도 스냅샷 전체가 깨지고, diff를 읽어도 "계획 자체가 달라진 것"인지
  // "세금 항목만 조정된 것"인지 구분할 수 없다. 그래서 실무적으로는 -u로 통째 갱신하게
  // 되고, 그 순간 회귀 가드로서의 값어치가 사라진다.
  //
  // 요약 스칼라와 세금 상세를 분리하면 신호가 나뉜다:
  //   - 요약이 깨졌다  → 인출 계획·자산 곡선이 실제로 달라졌다. 반드시 근거를 따져야 한다.
  //   - 세금만 깨졌다  → 세율/과세 로직 변경의 예상된 결과. 방향만 확인하면 된다.
  //
  // 연도별 전체를 버리지 않기 위해 세금 상세는 대표 3개 연도(첫 해 / 은퇴 시점 /
  // 마지막 해)를 찍는다. 축적기·인출기·종료 시점에서 각각 다른 세금 경로가 살아 있다.

  test('회귀 가드(요약): withdrawalPlan 미지정 시 계획 수준 지표가 동일해야 한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams);

    expect({
      endingAssets: result.endingAssets,
      depletionAge: result.depletionAge,
      fireAge: result.fireAge,
      retirementScore: result.retirementScore,
      retirementGrade: result.retirementGrade,
      goalAchievementRate: result.goalAchievementRate,
      retirementAssetsAtRetirement: result.retirementAssetsAtRetirement,
      yearCount: result.yearlyResults.length,
      // 효용 점수도 계획 수준 지표다. 채점식(가중치·분모)이 바뀌면 사용자가 보는 점수가
      // 바뀌므로 반드시 근거를 따져야 한다 — 세금 항목만 바뀐 것과는 다른 종류의 변화다.
      utilityScore: result.utility?.score,
      utilityComponents: result.utility?.components,
    }).toMatchSnapshot();
  });

  test('회귀 가드(세금 상세): 대표 3개 연도의 세금·소득 내역이 동일해야 한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams);

    const { retirementAge } = baseParams.userProfile;
    const first = result.yearlyResults[0];
    const atRetirement = result.yearlyResults.find((r) => r.age === retirementAge);
    const last = result.yearlyResults[result.yearlyResults.length - 1];

    expect(atRetirement).toBeDefined();

    const detail = (r: (typeof result.yearlyResults)[number]) => ({
      age: r.age,
      totalAssets: r.totalAssets,
      stockAssets: r.stockAssets,
      pensionAssets: r.pensionAssets,
      preTaxTotalIncome: r.preTaxTotalIncome,
      totalIncome: r.totalIncome,
      spending: r.spending,
      dividendTaxPaid: r.dividendTaxPaid,
      pensionTaxPaid: r.pensionTaxPaid,
      nationalPensionTaxPaid: r.nationalPensionTaxPaid,
      comprehensiveTaxPaid: r.comprehensiveTaxPaid,
      capitalGainsTaxPaid: r.capitalGainsTaxPaid,
      healthInsurancePaid: r.healthInsurancePaid,
      healthInsuranceIncomeBasis: r.healthInsuranceIncomeBasis,
      privatePensionTaxMethod: r.privatePensionTaxMethod,
      hasTaxWarning: r.hasTaxWarning,
    });

    expect({
      첫해: detail(first),
      은퇴시점: detail(atRetirement!),
      마지막해: detail(last),
    }).toMatchSnapshot();
  });

  test('withdrawalPlan.privatePensionMonthlyTarget으로 사적연금 세전 인출액이 목표치 근방으로 제한된다', () => {
    const engine = new SimulationEngine();
    const monthlyTargetKRW = 1000000; // 월 100만 원(세전) 목표
    const result = engine.run({
      ...baseParams,
      withdrawalPlan: {
        privatePensionMonthlyTarget: monthlyTargetKRW,
      },
    });

    const retirementYears = result.yearlyResults.filter(
      (r) => r.age >= baseParams.userProfile.retirementAge && r.age < baseParams.userProfile.expectancy
    );

    // 잔액이 충분한 연도에는 세전 연간 인출액이 목표(연 1200만 원)를 크게 초과하지 않아야 한다.
    // (shortfall 충당으로 인한 추가 인출 여지를 감안해 넉넉한 상한을 둔다)
    const annualTargetKRW = monthlyTargetKRW * 12;
    for (const r of retirementYears.slice(0, 5)) {
      expect(r.privatePensionIncome).toBeLessThanOrEqual(annualTargetKRW * 1.5);
    }
  });

  test('withdrawalPlan.privatePensionMonthlyTarget은 사적연금 계좌 여러 개의 합산 기준으로 적용된다', () => {
    // 계좌마다 개별 적용되는 버그가 있다면, 계좌가 2개일 때 총 인출액이 목표의 약 2배가 된다.
    const engine = new SimulationEngine();
    const monthlyTargetKRW = 1000000; // 월 100만 원(세전) 목표 - 계좌 합산 기준이어야 함
    const multiPensionParams: SimulationParams = {
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 85,
        targetMonthlySpending: 100000, // shortfall이 발생하지 않도록 목표 생활비를 낮게 설정
      },
      assets: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 300000000, monthlyContribution: 0, annualReturn: 5, currency: 'KRW' },
        { id: 'pension-2', type: 'savings', balance: 300000000, monthlyContribution: 0, annualReturn: 5, currency: 'KRW' },
      ],
      otherIncomes: [
        { id: 'income-1', label: '임대소득', monthlyAmount: 3000000, currency: 'KRW' }, // shortfall 방지용 충분한 소득
      ],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
      withdrawalPlan: {
        privatePensionMonthlyTarget: monthlyTargetKRW,
      },
    };

    const result = engine.run(multiPensionParams);
    const resultAt60 = result.yearlyResults.find((r) => r.age === 60);
    expect(resultAt60).toBeDefined();

    // 목표는 계좌 합산 기준 월 100만원(세전)이어야 하므로, 세후 연간 사적연금 소득은
    // 대략 1,000,000*12*(1-0.055) ≈ 1134만원 근방이어야 한다.
    const expectedAnnualNet = monthlyTargetKRW * 12 * (1 - 0.055);
    expect(resultAt60!.privatePensionIncome).toBeLessThan(expectedAnnualNet * 1.3);
    expect(resultAt60!.privatePensionIncome).toBeGreaterThan(expectedAnnualNet * 0.7);
  });

  test('withdrawalPlan 없이 retirementAge가 55세 미만이면, 55세 전에는 사적연금을 인출하지 않고 55세부터 시작한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({
      userProfile: { currentAge: 50, retirementAge: 50, expectancy: 60, targetMonthlySpending: 400000 },
      assets: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 300000000, monthlyContribution: 0, annualReturn: 5, currency: 'KRW' },
      ],
      otherIncomes: [{ id: 'income-1', label: '임대소득', monthlyAmount: 1000000, currency: 'KRW' }], // 목표(40만원) 충분히 충당
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
    });

    const before55 = result.yearlyResults.filter((r) => r.age >= 50 && r.age < 55);
    expect(before55.length).toBeGreaterThan(0);
    for (const r of before55) {
      expect(r.privatePensionIncome).toBe(0);
    }

    const from55 = result.yearlyResults.filter((r) => r.age >= 55);
    expect(from55.some((r) => r.privatePensionIncome > 0)).toBe(true);
  });

  test('retirementAge가 55세 미만이고 생활비가 부족해도(shortfall), 55세 이전에는 사적연금을 조기 인출하지 않는다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({
      userProfile: { currentAge: 50, retirementAge: 50, expectancy: 60, targetMonthlySpending: 5000000 }, // 부족분 발생하도록 목표 생활비를 높게
      assets: [], // 일반자산 없음 -> shortfall 시 바로 사적연금으로 갈 수밖에 없는 상황
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 300000000, monthlyContribution: 0, annualReturn: 5, currency: 'KRW' },
      ],
      otherIncomes: [],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
    });

    const before55 = result.yearlyResults.filter((r) => r.age >= 50 && r.age < 55);
    expect(before55.length).toBeGreaterThan(0);
    for (const r of before55) {
      // 55세 미만이므로 shortfall이 있어도 사적연금을 인출할 수 없다 -> 인출 0, 목표 생활비 미충족
      expect(r.privatePensionIncome).toBe(0);
      expect(r.spending).toBeLessThan(5000000 * 12);
    }

    // 55세부터는 후행 인출로 부족분을 정상적으로 충당한다.
    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55).toBeDefined();
    expect(at55!.privatePensionIncome).toBeGreaterThan(0);
  });

  test('월 인출 목표를 정하면 후행 인출도 그 한도를 넘지 않는다', () => {
    // **예전에는 넘었다.** 정상 인출에서 목표만큼 뽑고, 부족분이 남으면 후행 인출이 잔액에서
    // 더 뽑아 갔다. 그래서 「연금 전략」의 인출 비율(100%/50%/25%)이 총액을 전혀 바꾸지 못하고
    // 인출 "순서"만 바꿨다 — 화면은 세 개의 다른 전략을 보여주는데 엔진에는 두 개만 있었다.
    //
    // 목표는 "이만큼 뽑겠다"가 아니라 "이 이상은 뽑지 않겠다"이기도 하다. 부족분은 사적연금
    // 대신 일반자산에서 충당되고, 그래도 모자라면 소비가 깎인다.
    const engine = new SimulationEngine();
    const monthlyTarget = 1000000;
    const result = engine.run({
      ...baseParams,
      assets: [], // 일반자산 없음 -> 부족분을 메울 다른 재원이 없다
      userProfile: {
        ...baseParams.userProfile,
        targetMonthlySpending: 5000000, // 목표(월 100만원)보다 훨씬 큰 생활비 -> 부족분 발생
      },
      withdrawalPlan: { privatePensionMonthlyTarget: monthlyTarget },
    });

    const resultAtRetirement = result.yearlyResults.find(
      (r) => r.age === baseParams.userProfile.retirementAge
    );
    expect(resultAtRetirement).toBeDefined();
    // 세후 수령액이므로 세전 한도(연 1200만원)를 넘을 수 없다.
    expect(resultAtRetirement!.privatePensionIncome).toBeLessThanOrEqual(monthlyTarget * 12);
    // 그래도 한도만큼은 실제로 인출된다(0으로 막혀 버린 것이 아니다).
    expect(resultAtRetirement!.privatePensionIncome).toBeGreaterThan(0);
    // 부족분을 메울 재원이 없으므로 소비가 목표에 못 미친다 — 정직하게 드러나야 한다.
    expect(resultAtRetirement!.spending).toBeLessThan(5000000 * 12);
  });

  test('월 인출 목표를 정하지 않으면 후행 인출이 잔액 전체를 쓴다', () => {
    // 캡은 목표를 명시한 경우에만 걸린다. 목표가 없으면(spending_first / ai_optimized)
    // 예전처럼 부족분을 최대한 충당한다.
    const engine = new SimulationEngine();
    const result = engine.run({
      ...baseParams,
      assets: [],
      userProfile: { ...baseParams.userProfile, targetMonthlySpending: 5000000 },
    });

    const resultAtRetirement = result.yearlyResults.find(
      (r) => r.age === baseParams.userProfile.retirementAge
    );
    expect(resultAtRetirement).toBeDefined();
    expect(resultAtRetirement!.privatePensionIncome).toBeGreaterThan(1000000 * 12);
  });
});
