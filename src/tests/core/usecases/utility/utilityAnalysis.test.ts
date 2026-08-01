import { describe, test, expect } from 'vitest';
import { analyzeCurrentStrategy, explainBequestAdequacy, formatManwon } from '@/core/usecases/utility/utilityAnalysis';
import { SimulationParams, SimulationResult, UtilityBreakdown } from '@/core/entities/types';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';

function makeUtility(components: UtilityBreakdown['components']): UtilityBreakdown {
  const score = Object.values(components).reduce((a, b) => a + b, 0);
  return { score, components };
}

describe('formatManwon', () => {
  test('1억원 미만이면 "N,NNN만원"만 표기한다', () => {
    expect(formatManwon(50000000)).toBe('5,000만원');
  });

  test('1억원 이상이고 나머지가 있으면 "N억 M,MMM만원"으로 표기한다 (예: 179,169만원 -> 17억 9,169만원)', () => {
    expect(formatManwon(1791690000)).toBe('17억 9,169만원');
  });

  test('억 단위로 정확히 나누어 떨어지면 "N억원"만 표기한다', () => {
    expect(formatManwon(200000000)).toBe('2억원');
  });

  test('음수 금액도 부호를 유지하며 억 단위로 표기한다', () => {
    expect(formatManwon(-172710000)).toBe('-1억 7,271만원');
  });
});

describe('analyzeCurrentStrategy', () => {
  test('배점 대비 80% 이상인 항목은 강점으로 분류한다', () => {
    // consumption 배점 35 -> 80% = 28
    const utility = makeUtility({
      consumption: 30, // 30/35 ≈ 85.7% -> 강점
      depletionSafety: 5, // 5/20 = 25% -> 약점
      pensionUtilization: 8, // 8/15 ≈ 53% -> 중간(강점도 약점도 아님)
      taxEfficiency: 5,
      taxationRisk: 5,
      bequestAdequacy: 5,
    });

    const analysis = analyzeCurrentStrategy(utility);
    expect(analysis.strengths.some((s) => s.includes('소비 만족도'))).toBe(true);
    expect(analysis.weaknesses.some((s) => s.includes('자산 고갈 방지'))).toBe(true);
  });

  test('배점 대비 50% 이하인 항목은 약점으로 분류한다', () => {
    const utility = makeUtility({
      consumption: 17, // 17/35 = 48.57% -> 약점
      depletionSafety: 18,
      pensionUtilization: 8,
      taxEfficiency: 5,
      taxationRisk: 5,
      bequestAdequacy: 5,
    });

    const analysis = analyzeCurrentStrategy(utility);
    expect(analysis.weaknesses.some((s) => s.includes('소비 만족도'))).toBe(true);
  });

  test('강점이 하나도 없으면 폴백 문구를 반환한다', () => {
    const utility = makeUtility({
      consumption: 20, // 20/35 ≈ 57% -> 중간
      depletionSafety: 10, // 10/20 = 50% -> 약점(경계값 포함)
      pensionUtilization: 8,
      taxEfficiency: 5,
      taxationRisk: 5,
      bequestAdequacy: 5,
    });

    const analysis = analyzeCurrentStrategy(utility);
    expect(analysis.strengths.length).toBe(1);
    expect(analysis.strengths[0]).toContain('균형');
  });

  test('약점이 하나도 없으면 폴백 문구를 반환한다', () => {
    const utility = makeUtility({
      consumption: 35,
      depletionSafety: 20,
      pensionUtilization: 15,
      taxEfficiency: 10,
      taxationRisk: 10,
      bequestAdequacy: 10,
    });

    const analysis = analyzeCurrentStrategy(utility);
    expect(analysis.weaknesses.length).toBe(1);
    expect(analysis.weaknesses[0]).toContain('약점');
  });

  test('배점이 0인 커스텀 cfg가 주어져도 0으로 나누기 오류 없이 안전하게 처리한다', () => {
    const zeroWeightCfg = {
      ...DEFAULT_UTILITY_CONFIG,
      weights: { ...DEFAULT_UTILITY_CONFIG.weights, consumption: 0 },
    };
    const utility = makeUtility({
      consumption: 0,
      depletionSafety: 20,
      pensionUtilization: 15,
      taxEfficiency: 10,
      taxationRisk: 10,
      bequestAdequacy: 10,
    });

    expect(() => analyzeCurrentStrategy(utility, zeroWeightCfg)).not.toThrow();
  });
});

function makeParams(targetMonthlySpending: number): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 85, targetMonthlySpending },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
  };
}

function makeResult(endingAssets: number): SimulationResult {
  return {
    yearlyResults: [],
    fireAge: null,
    depletionAge: null,
    endingAssets,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 0,
    retirementAssetsAtRetirement: 0,
    householdEndAge: 90,
  };
}

describe('explainBequestAdequacy', () => {
  test('잔여자산이 적정 기준(월생활비*appropriateBequestMonths)보다 많으면 배수를 언급하며 감점 이유를 설명한다', () => {
    // 적정 기준: 300만원 * 24개월 = 7,200만원. 잔여자산 7억 2천만원 -> 정확히 10배
    const text = explainBequestAdequacy(makeParams(3000000), makeResult(720000000));
    expect(text).toContain('10.0배');
    expect(text).toContain('감점');
  });

  test('잔여자산이 적정 기준 이하이면 부족하다는 문구를 반환한다', () => {
    const text = explainBequestAdequacy(makeParams(3000000), makeResult(10000000));
    expect(text).toContain('부족');
  });

  test('목표 월 생활비가 0이면 계산 불가 문구를 반환한다', () => {
    const text = explainBequestAdequacy(makeParams(0), makeResult(100000000));
    expect(text).toContain('계산할 수 없습니다');
  });
});

describe('explainBequestAdequacy - userProfile.targetBequest 지정 시', () => {
  function makeParamsWithTarget(targetBequest: number): SimulationParams {
    const base = makeParams(3000000);
    return { ...base, userProfile: { ...base.userProfile, targetBequest } };
  }

  test('목표 상속자산을 초과하면 목표 금액과 배수를 언급하며 감점 이유를 설명한다', () => {
    // 목표 1억원, 잔여자산 3억원 -> 정확히 3배
    const text = explainBequestAdequacy(makeParamsWithTarget(100000000), makeResult(300000000));
    expect(text).toContain('목표 상속자산');
    expect(text).toContain('3.0배');
    expect(text).toContain('감점');
  });

  test('목표 상속자산에 못 미치면 목표 금액 대비 부족하다는 문구를 반환한다', () => {
    const text = explainBequestAdequacy(makeParamsWithTarget(200000000), makeResult(50000000));
    expect(text).toContain('목표 상속자산');
    expect(text).toContain('부족');
  });

  test('목표 상속자산이 0원(다 쓰고 가기)이고 잔여자산이 0이면 목표를 달성했다는 문구를 반환한다', () => {
    const text = explainBequestAdequacy(makeParamsWithTarget(0), makeResult(0));
    expect(text).toContain('0원');
    expect(text).not.toContain('감점');
  });

  test('목표 상속자산이 0원인데 잔여자산이 남으면 초과로 설명하며 감점 이유를 언급한다', () => {
    const text = explainBequestAdequacy(makeParamsWithTarget(0), makeResult(50000000));
    expect(text).toContain('0원');
    expect(text).toContain('감점');
  });
});
