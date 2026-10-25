import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

describe('SimulationEngine 사적연금 브릿지 조기인출(Phase 4)', () => {
  const baseParams: SimulationParams = {
    userProfile: {
      currentAge: 50,
      retirementAge: 60,
      expectancy: 55,
      targetMonthlySpending: 0,
    },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [
      {
        id: 'p1',
        type: 'irp',
        balance: 100000000,
        monthlyContribution: 0,
        totalReturn: 0,
        currency: 'KRW',
        earlyChannelingEnabled: true,
      },
    ],
    isaAccounts: [
      {
        id: 'isa1',
        type: 'general',
        balance: 0,
        monthlyContribution: 0,
        totalReturn: 0,
        dividendYield: 0,
        currency: 'KRW',
        maturityYears: 99, // 테스트 기간 내 만기가 발생하지 않도록 충분히 길게 설정
      },
    ],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };

  test('55세 미만에는 브릿지 조기인출이 발동하지 않아 사적연금 잔액이 그대로 유지된다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({ ...baseParams, userProfile: { ...baseParams.userProfile, expectancy: 54 } });

    const at54 = result.yearlyResults.find((r) => r.age === 54);
    expect(at54!.pensionAssets).toBeCloseTo(100000000, 2);
  });

  test('55세부터 저율과세 한도(연 1500만원)만큼 조기 인출되어 사적연금 잔액이 감소한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams); // expectancy: 55

    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55!.pensionAssets).toBeCloseTo(100000000 - 15000000, 2);
  });

  test('인출된 순액(세후)만큼만 총자산이 줄어든다(나머지는 ISA로 이동해 총자산에는 그대로 남음)', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams); // expectancy: 55

    const at54 = result.yearlyResults.find((r) => r.age === 54);
    const at55 = result.yearlyResults.find((r) => r.age === 55);
    const expectedTax = 15000000 * 0.055; // 55세 세율 5.5%(PRIVATE_PENSION_TAX_BRACKETS)
    expect(at54!.totalAssets - at55!.totalAssets).toBeCloseTo(expectedTax, 2);
  });

  test('브릿지 구간에서는 privatePensionIncome(생활비 소득)에 반영되지 않는다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(baseParams); // expectancy: 55

    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55!.privatePensionIncome).toBe(0);
  });

  // 목표 생활비를 0이 아닌 값으로 준다. 은퇴 후 정기 인출은 부족분까지만 일어나므로
  // (정기 인출 상한), 목표가 0이면 인출도 0이라 «경로 복귀»를 관찰할 수 없다.
  test('retirementAge 이후에는 기존 인출 로직으로 복귀해 privatePensionIncome에 반영된다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 60, targetMonthlySpending: 2_000_000 },
    });

    const at59 = result.yearlyResults.find((r) => r.age === 59);
    const at60 = result.yearlyResults.find((r) => r.age === 60);
    expect(at59!.privatePensionIncome).toBe(0); // 아직 브릿지 구간(재직 중)
    expect(at60!.privatePensionIncome).toBeGreaterThan(0); // retirementAge 도달, 기존 로직으로 복귀
  });

  test('earlyChannelingEnabled가 없으면(기본값) 55세가 지나도 조기인출이 발동하지 않는다', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [{ ...baseParams.privatePensions[0], earlyChannelingEnabled: undefined }],
    };
    const result = engine.run(params);

    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55!.pensionAssets).toBeCloseTo(100000000, 2);
  });

  test('ISA 계좌가 없으면 earlyChannelingEnabled가 켜져 있어도 브릿지 조기인출이 발동하지 않는다(자금 소실 방지)', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...baseParams,
      isaAccounts: [], // ISA 계좌 없음
    };
    const result = engine.run(params);

    const at55 = result.yearlyResults.find((r) => r.age === 55);
    expect(at55!.pensionAssets).toBeCloseTo(100000000, 2); // 사적연금 잔액이 변하지 않음
  });

  test('ISA 잔여 납입 한도가 부분적으로만 남아 있으면 그 한도만큼만 인출하고 자금 소실은 없다', () => {
    const engine = new SimulationEngine();
    // ISA가 월 한도(20,000,000/12 = 1,666,666.67원) 중 1,000,000원을 이미 정기납입으로 소진 →
    // 브릿지가 쓸 수 있는 잔여 룸은 666,666.67원. 세율 5.5%이므로 세전 인출 상한은
    // 666,666.67 / (1 - 0.055) = 705,467.37원.
    const isaMonthlyContribution = 1000000;
    const params: SimulationParams = {
      ...baseParams,
      isaAccounts: [{ ...baseParams.isaAccounts![0], monthlyContribution: isaMonthlyContribution }],
    };
    const result = engine.run(params);

    const at54 = result.yearlyResults.find((r) => r.age === 54)!;
    const at55 = result.yearlyResults.find((r) => r.age === 55)!;

    // 자금 보존: (인출액 - 세금)이 ISA에 적립된 브릿지 순크레딧과 정확히 같아야 한다(초과분 소실
    // 없음). ISA 잔액 증가분에는 브릿지 크레딧 외에 ISA 자체의 정기납입(연 1,200만원 — 브릿지와
    // 무관하게 currentAge:50부터 매년 발생하는 외부 자금 유입)도 섞여 있으므로, 단순히
    // totalAssets(54)-totalAssets(55)를 세금과 비교하면 이 정기납입 유입분(12,000,000원) 때문에
    // 어긋난다. 따라서 정기납입분을 분리해 브릿지 크레딧만 비교한다.
    const drawnPreTax = 100000000 - at55.pensionAssets;
    const isaBalanceAt54 = at54.totalAssets - at54.pensionAssets;
    const isaBalanceAt55 = at55.totalAssets - at55.pensionAssets;
    const isaAnnualInflow = isaBalanceAt55 - isaBalanceAt54;
    const bridgeNetCreditToIsa = isaAnnualInflow - isaMonthlyContribution * 12;
    expect(drawnPreTax - at55.pensionTaxPaid).toBeCloseTo(bridgeNetCreditToIsa, 2);
    // 인출은 저율과세 한도(15,000,000)가 아니라 ISA 룸에 의해 캡된다.
    expect(drawnPreTax).toBeLessThan(15000000);
    expect(drawnPreTax).toBeCloseTo((666666.67 / (1 - 0.055)) * 12, 0);
    // 법정 한도: ISA 연간 신규 납입 총액(정기납입 + 브릿지 크레딧)은 20,000,000원을 넘을 수 없다
    // (부동소수점 누적 오차를 감안해 1원 미만 초과는 허용). 이번 케이스는 정기납입(12,000,000) +
    // 브릿지가 남은 룸을 전부 채우므로 정확히 한도에 닿는다.
    expect(isaAnnualInflow).toBeLessThanOrEqual(20000000 + 1);
    expect(isaAnnualInflow).toBeCloseTo(20000000, 2);
  });

  test('ISA 잔여 납입 한도가 0이면 브릿지 인출 자체가 일어나지 않는다(세금도 내지 않는다)', () => {
    const engine = new SimulationEngine();
    // ISA가 월 한도를 전부 정기납입으로 소진 → 브릿지 룸 0 → 인출 0
    const params: SimulationParams = {
      ...baseParams,
      isaAccounts: [{ ...baseParams.isaAccounts![0], monthlyContribution: 20000000 / 12 }],
    };
    const result = engine.run(params);

    const at55 = result.yearlyResults.find((r) => r.age === 55)!;
    expect(at55.pensionAssets).toBeCloseTo(100000000, 2); // 연금 잔액 그대로
    expect(at55.pensionTaxPaid).toBeCloseTo(0, 2);         // 세금도 없음
  });

  test('사적연금 계좌가 2개여도 저율과세 한도는 계좌 간에 공유된다', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [
        { ...baseParams.privatePensions[0], id: 'p1', balance: 100000000 },
        { ...baseParams.privatePensions[0], id: 'p2', balance: 100000000, earlyChannelingEnabled: true },
      ],
    };
    const result = engine.run(params);
    const at54 = result.yearlyResults.find((r) => r.age === 54)!;
    const at55 = result.yearlyResults.find((r) => r.age === 55)!;
    // 계좌당 15,000,000(합계 30,000,000)이 아니라, 두 계좌 합계로 15,000,000만 인출되어야 한다
    // (remainingBridgeLimitKRW가 forEach 바깥, m 루프 안에서 선언되어 계좌 간에 공유되기 때문).
    expect(at54.pensionAssets - at55.pensionAssets).toBeCloseTo(15000000, 0);
  });

  test('첫 계좌 잔액이 한도보다 적으면 나머지를 두 번째 계좌가 채운다', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [
        { ...baseParams.privatePensions[0], id: 'p1', balance: 5000000 },
        { ...baseParams.privatePensions[0], id: 'p2', balance: 100000000, earlyChannelingEnabled: true },
      ],
    };
    const result = engine.run(params);
    const at54 = result.yearlyResults.find((r) => r.age === 54)!;
    const at55 = result.yearlyResults.find((r) => r.age === 55)!;

    // p1(잔액 5,000,000)이 첫 4개월 만에 소진되고, 남은 8개월분(10,000,000)을 p2가 채운다 —
    // 합계는 여전히 15,000,000이다. 엔진이 계좌별이 아닌 합산 pensionAssets만 반환하므로 합계
    // 감소분으로 검증한다.
    expect(at54.pensionAssets - at55.pensionAssets).toBeCloseTo(15000000, 0);
  });

  test('USD 사적연금 + KRW ISA에서도 저율과세 한도가 원화 기준으로 정확히 적용된다(통화 변환 방향 검증)', () => {
    const engine = new SimulationEngine();
    // 사적연금이 USD(200,000), baseExchangeRate 1350 → 원화 환산 270,000,000원. ISA는 KRW라
    // 브릿지 크레딧을 계산할 때 pension(USD) <-> KRW(저율과세 한도) <-> ISA(KRW) 사이를
    // convertValue로 세 번 오간다 — 인자 순서(from/to)가 하나라도 뒤바뀌면 이 테스트가 실패한다.
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [
        { ...baseParams.privatePensions[0], balance: 200000, currency: 'USD' },
      ],
    };
    const result = engine.run(params);

    const at54 = result.yearlyResults.find((r) => r.age === 54)!;
    const at55 = result.yearlyResults.find((r) => r.age === 55)!;
    // pensionAssets는 displayCurrency('KRW') 기준이므로, 저율과세 한도(연 15,000,000원)만큼
    // 원화 환산 잔액이 감소해야 한다.
    expect(at54.pensionAssets - at55.pensionAssets).toBeCloseTo(15000000, 0);
  });
});
