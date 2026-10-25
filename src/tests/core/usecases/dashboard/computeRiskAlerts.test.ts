import { describe, test, expect } from 'vitest';
import { computeRiskAlerts } from '@/core/usecases/dashboard/computeRiskAlerts';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';

function makeResult(yearlyResults: SimulationYearlyResult[]): SimulationResult {
  return {
    yearlyResults,
    fireAge: 60,
    depletionAge: null,
    endingAssets: 0,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const paramsWithPensionLimit: SimulationParams = {
  ...baseParams,
  taxSettings: {
    enableComprehensiveTax: true,
    enableHealthInsurance: true,
    usDividendTaxRate: 15,
    domesticDividendTaxRate: 15.4,
    comprehensiveTaxRate: 15,
    healthInsuranceRate: 5,
    privatePensionLimit: 15000000,
  },
};

describe('computeRiskAlerts', () => {
  test('금융소득종합과세 위험이 있으면 첫 발생 연령을 포함한 알림을 반환한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 65, hasTaxWarning: false }),
      makeYearlyResult({ age: 70, hasTaxWarning: true }),
    ];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('comprehensiveTax');
    expect(alerts[0].message).toContain('70세');
    expect(alerts[0].message).toContain('2,000만원');
  });

  test('사적연금이 저율과세 한도를 초과하는 연속 구간이 있으면 연령대와 한도 금액을 포함한 알림을 반환한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 65, privatePensionIncome: 20000000, pensionTaxPaid: 1000000 }),
      makeYearlyResult({ age: 66, privatePensionIncome: 20000000, pensionTaxPaid: 1000000 }),
      makeYearlyResult({ age: 67, privatePensionIncome: 5000000, pensionTaxPaid: 0 }),
    ];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), paramsWithPensionLimit);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('privatePensionLimit');
    expect(alerts[0].message).toContain('65~66세');
    expect(alerts[0].message).toContain('1,500만원');
  });

  test('건강보험료가 소득 대비 임계값(5%)을 초과하는 연도가 있으면 알림을 반환한다', () => {
    const yearlyResults = [makeYearlyResult({ age: 70, totalIncome: 10000000, healthInsurancePaid: 600000 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('healthInsurance');
    expect(alerts[0].message).toContain('70세');
    expect(alerts[0].message).toContain('5%');
  });

  test('건강보험료 비율이 정확히 임계값과 같으면 포함한다(>=)', () => {
    const yearlyResults = [makeYearlyResult({ age: 70, totalIncome: 10000000, healthInsurancePaid: 500000 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('healthInsurance');
  });

  test('totalIncome이 0인 해는 건강보험료 비율 계산에서 제외한다(0으로 나누기 방지)', () => {
    const yearlyResults = [makeYearlyResult({ age: 70, totalIncome: 0, healthInsurancePaid: 100 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(0);
  });

  test('여러 리스크가 동시에 발생하면 시작 연령이 이른 순으로 정렬한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 65, totalIncome: 10000000, healthInsurancePaid: 600000 }),
      makeYearlyResult({ age: 70, hasTaxWarning: true, totalIncome: 10000000, healthInsurancePaid: 0 }),
      makeYearlyResult({
        age: 75,
        privatePensionIncome: 20000000,
        pensionTaxPaid: 1000000,
        totalIncome: 10000000,
        healthInsurancePaid: 0,
      }),
    ];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), paramsWithPensionLimit);

    expect(alerts.map((a) => a.key)).toEqual(['healthInsurance', 'comprehensiveTax', 'privatePensionLimit']);
  });

  test('아무 리스크도 없으면 빈 배열을 반환한다', () => {
    const yearlyResults = [makeYearlyResult({ age: 65, totalIncome: 10000000, healthInsurancePaid: 100000 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toEqual([]);
  });

  describe('목표 상속자산 미달 알림 (userProfile.targetBequest)', () => {
    test('targetBequest가 설정되지 않으면 잔여자산이 얼마든 알림이 없다', () => {
      const result = { ...makeResult([]), endingAssets: 0 };
      const alerts = computeRiskAlerts(result, baseParams);
      expect(alerts).toEqual([]);
    });

    test('targetBequest가 0원(다 쓰고 가기)이면 잔여자산이 얼마든 알림이 없다', () => {
      const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, targetBequest: 0 } };
      const result = { ...makeResult([]), endingAssets: 0 };
      const alerts = computeRiskAlerts(result, params);
      expect(alerts).toEqual([]);
    });

    test('예상 잔여자산이 목표 상속자산에 못 미치면 알림이 발생하고 두 금액을 모두 언급한다', () => {
      const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, targetBequest: 200000000 } };
      const result = { ...makeResult([]), endingAssets: 50000000 };
      const alerts = computeRiskAlerts(result, params);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].key).toBe('bequestShortfall');
      expect(alerts[0].message).toContain('5,000만원');
      expect(alerts[0].message).toContain('2억원');
    });

    // **「만원」·「억원」은 원화의 단위다.** 엔진이 내놓는 금액은 원화가 아니라 표시 통화
    // 기준이므로(types.ts의 totalAssets 주석), 구분 없이 만원으로 옮기면 달러를 쓰는
    // 사용자에게 «$50,000이 5만원»으로 찍힌다 — 숫자도 단위도 틀린 문장이 된다.
    // AGENTS.md의 「단위 변환은 표시 계층에서만」이 막으려는 것이 정확히 이 상황이다.
    test('표시 통화가 달러면 원화 단위를 붙이지 않는다', () => {
      const params: SimulationParams = {
        ...baseParams,
        displayCurrency: 'USD',
        userProfile: { ...baseParams.userProfile, targetBequest: 200_000 },
      };
      const result = { ...makeResult([]), endingAssets: 50_000 };

      const alerts = computeRiskAlerts(result, params);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].message).toContain('$50,000');
      expect(alerts[0].message).toContain('$200,000');
      expect(alerts[0].message).not.toContain('만원');
      expect(alerts[0].message).not.toContain('억');
    });

    test('예상 잔여자산이 목표 상속자산 이상이면 알림이 없다', () => {
      const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, targetBequest: 200000000 } };
      const result = { ...makeResult([]), endingAssets: 200000000 };
      const alerts = computeRiskAlerts(result, params);
      expect(alerts).toEqual([]);
    });

    // C6: endingAssets는 시뮬레이션 종료(기대수명) 시점의 잔액(types.ts)이다. 라벨과 정렬
    // 기준을 고정값이 아니라 그 계획의 기대수명에서 읽어야 두 값이 어긋나지 않는다.
    test('라벨은 그 계획의 기대수명을 쓴다', () => {
      const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, expectancy: 95, targetBequest: 200000000 } };
      const result = { ...makeResult([]), endingAssets: 50000000 };
      const alerts = computeRiskAlerts(result, params);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].message).toContain('95세');
      expect(alerts[0].message).not.toContain('90세');
    });

    test('기대수명 기준으로 정렬된다', () => {
      const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, expectancy: 95, targetBequest: 200000000 } };
      // 92세는 기대수명(95)보다 이르므로 상속 부족 알림보다 앞에 온다.
      const yearlyResults = [makeYearlyResult({ age: 92, hasTaxWarning: true })];
      const result = { ...makeResult(yearlyResults), endingAssets: 50000000 };
      const alerts = computeRiskAlerts(result, params);

      expect(alerts.map((a) => a.key)).toEqual(['comprehensiveTax', 'bequestShortfall']);
    });

    // A1: 상속 부족 알림은 "사용자가 명시적으로 금액 목표를 세웠는가"로 판정해야 한다.
    // userProfile.targetBequest의 존재 여부로 판정하면, 기본 전략('leave_some')이
    // compileStrategy를 거쳐 실체화되는 순간(= 패널에서 아무 필드나 건드리는 순간)
    // 같은 계획에 없던 알림이 새로 생긴다.
    test('전략 실체화(compileStrategy) 전후로 알림 집합이 동일하다', () => {
      // 잔여자산 1,000만원 < 적정선(월 300만 * 24개월 = 7,200만원) — 실체화된
      // targetBequest 기준으로는 "미달"이 되는 값이다.
      const result = { ...makeResult([]), endingAssets: 10000000 };
      const compiled = compileStrategy({ ...baseParams, strategy: DEFAULT_RETIREMENT_STRATEGY }).params;

      expect(computeRiskAlerts(result, compiled)).toEqual(computeRiskAlerts(result, baseParams));
      expect(computeRiskAlerts(result, compiled)).toEqual([]);
    });

    test("상속 전략이 '일부 남기기'면 잔여자산이 적정선에 못 미쳐도 알림이 없다", () => {
      const params: SimulationParams = {
        ...baseParams,
        strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'leave_some' },
        userProfile: { ...baseParams.userProfile, targetBequest: 72000000 },
      };
      const result = { ...makeResult([]), endingAssets: 10000000 };

      expect(computeRiskAlerts(result, params)).toEqual([]);
    });

    test("상속 전략이 '목표 금액'이면 미달 시 알림이 발생한다", () => {
      const params: SimulationParams = {
        ...baseParams,
        strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'target_amount' },
        userProfile: { ...baseParams.userProfile, targetBequest: 200000000 },
      };
      const result = { ...makeResult([]), endingAssets: 50000000 };

      expect(computeRiskAlerts(result, params).map((a) => a.key)).toEqual(['bequestShortfall']);
    });

    test('다른 리스크와 함께 발생하면 기대수명 시점 이벤트라 가장 나중(가장 늦은 나이)으로 정렬된다', () => {
      const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, targetBequest: 200000000 } };
      const yearlyResults = [makeYearlyResult({ age: 65, hasTaxWarning: true })];
      const result = { ...makeResult(yearlyResults), endingAssets: 50000000 };
      const alerts = computeRiskAlerts(result, params);

      expect(alerts.map((a) => a.key)).toEqual(['comprehensiveTax', 'bequestShortfall']);
    });
  });

  describe('건강보험 피부양자 자격 경계 알림', () => {
    // 이 경고는 계산이 아니라 정직성 장치다. 이 시뮬레이터의 건보료는 문턱 초과분에만
    // 요율을 곱하는 연속 함수지만, 실제 제도는 피부양자 자격을 잃는 순간 소득 전체와
    // 재산에 부과되어 계단식으로 뛴다. 그 계단을 계산에 넣으면 이진탐색의 단조성 전제가
    // 깨지므로(TaxEngine 주석 참고), 위험은 경고로만 전달한다.
    const THRESHOLD = 20000000;

    test('부과 기준 소득이 문턱 근처인 해가 있으면 경고한다', () => {
      const yearlyResults = [
        makeYearlyResult({ age: 65, healthInsuranceIncomeBasis: 10000000 }),
        makeYearlyResult({ age: 66, healthInsuranceIncomeBasis: THRESHOLD * 0.95 }),
        makeYearlyResult({ age: 67, healthInsuranceIncomeBasis: THRESHOLD * 1.05 }),
      ];

      const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);
      const cliff = alerts.find((a) => a.key === 'healthInsuranceCliff');

      expect(cliff).toBeDefined();
      expect(cliff!.title).toBe('피부양자 자격 위험');
      expect(cliff!.message).toContain('66~67세');
      expect(cliff!.message).toContain('세후 실수령액과 다릅니다');
      expect(cliff!.message).toContain('예상 건강보험료가 0원이더라도');
    });

    test('문턱에서 충분히 떨어져 있으면 경고하지 않는다', () => {
      const farBelow = [makeYearlyResult({ age: 65, healthInsuranceIncomeBasis: THRESHOLD * 0.5 })];
      const farAbove = [makeYearlyResult({ age: 65, healthInsuranceIncomeBasis: THRESHOLD * 3 })];

      expect(computeRiskAlerts(makeResult(farBelow), baseParams).map((a) => a.key))
        .not.toContain('healthInsuranceCliff');
      // 이미 크게 넘어선 사용자는 '건강보험료 증가 구간' 경고가 담당한다.
      expect(computeRiskAlerts(makeResult(farAbove), baseParams).map((a) => a.key))
        .not.toContain('healthInsuranceCliff');
    });

    // "계단식으로 뜁니다"만으로는 사용자가 대비할 수 없다. 얼마나 뛰는지를 금액으로
    // 말해야 전략을 바꿀지 판단할 수 있다(estimateHealthInsuranceCliff).
    test('자격 상실 시 보험료를 금액으로 함께 알린다', () => {
      const yearlyResults = [
        makeYearlyResult({ age: 66, healthInsuranceIncomeBasis: THRESHOLD * 0.95 }),
        makeYearlyResult({ age: 67, healthInsuranceIncomeBasis: THRESHOLD * 1.05 }),
      ];

      const cliff = computeRiskAlerts(makeResult(yearlyResults), baseParams)
        .find((a) => a.key === 'healthInsuranceCliff')!;

      // 기준소득 2,100만원 · 요율 7.09% 기준
      //   현재 모델 = (2,100만 − 2,000만) × 7.09% =   7.09만원/년 →   0.6만원/월
      //   자격 상실 =  2,100만          × 7.09% = 148.89만원/년 →  12.4만원/월
      expect(cliff.message).toContain('월 12만원');
      expect(cliff.message).toContain('67세');
    });

    // 재산·자동차 점수는 입력이 없어 계산하지 않는다. 그 사실을 말하지 않으면 사용자는
    // 이 금액을 실제 부담 전액으로 오해한다 — 실제로는 이보다 더 낸다.
    test('재산·자동차분이 빠져 있다는 사실을 함께 밝힌다', () => {
      const yearlyResults = [
        makeYearlyResult({ age: 66, healthInsuranceIncomeBasis: THRESHOLD * 0.95 }),
        makeYearlyResult({ age: 67, healthInsuranceIncomeBasis: THRESHOLD * 1.05 }),
      ];

      const cliff = computeRiskAlerts(makeResult(yearlyResults), baseParams)
        .find((a) => a.key === 'healthInsuranceCliff')!;

      expect(cliff.message).toContain('재산');
    });
  });
});
