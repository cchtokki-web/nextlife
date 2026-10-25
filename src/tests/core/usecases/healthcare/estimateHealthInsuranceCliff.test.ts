import { describe, test, expect } from 'vitest';
import { estimateHealthInsuranceCliff } from '@/core/usecases/healthcare/estimateHealthInsuranceCliff';
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';

// **피부양자 자격을 잃으면 실제로 얼마를 더 내는가.**
//
// 이 시뮬레이터의 건보료는 "문턱 초과분에만 요율을 곱하는" 연속 함수다(TaxEngine).
// 실제 제도는 자격을 잃는 순간 소득 **전체**에 부과되는 계단이라, 문턱 근처에서 실제
// 부담이 계산값보다 훨씬 크게 뛴다.
//
// 그 계단을 계산에 넣지 않는 이유는 TaxEngine 주석에 있다(재산 입력이 없어 절벽 양쪽이
// 모두 틀리고, 불연속이 findMaxSustainableValue 이진탐색의 단조성을 깨뜨린다). 그래서
// 시뮬레이션 본체는 그대로 두고, 여기서 **정보성 추정**만 따로 계산한다.
const ctx = resolveTaxContext();
const threshold = ctx.profile.financialIncomeThresholdKRW; // 2,000만원
const rate = ctx.settings.healthInsuranceRate; // 7.09%

describe('estimateHealthInsuranceCliff', () => {
  test('부과 기준 소득이 문턱을 넘는 해가 없으면 추정하지 않는다', () => {
    const years = [
      makeYearlyResult({ age: 65, healthInsuranceIncomeBasis: 10000000 }),
      makeYearlyResult({ age: 66, healthInsuranceIncomeBasis: 19999999 }),
    ];

    expect(estimateHealthInsuranceCliff(years, ctx)).toBeNull();
  });

  test('문턱을 넘는 해 중 부과 기준 소득이 가장 큰 해를 고른다', () => {
    const years = [
      makeYearlyResult({ age: 65, healthInsuranceIncomeBasis: 25000000 }),
      makeYearlyResult({ age: 70, healthInsuranceIncomeBasis: 40000000 }),
      makeYearlyResult({ age: 75, healthInsuranceIncomeBasis: 30000000 }),
    ];

    expect(estimateHealthInsuranceCliff(years, ctx)!.peakAge).toBe(70);
  });

  // 두 금액의 정의가 이 기능의 전부다.
  //   현재 모델  = (기준소득 − 문턱) × 요율   ← 시뮬레이션이 실제로 부과한 값
  //   자격 상실  =  기준소득 전체    × 요율   ← 지역가입자 소득분
  test('현재 모델 보험료와 자격 상실 시 보험료를 나란히 계산한다', () => {
    const incomeBasis = 40000000;
    const years = [makeYearlyResult({ age: 70, healthInsuranceIncomeBasis: incomeBasis })];

    const estimate = estimateHealthInsuranceCliff(years, ctx)!;

    expect(estimate.currentAnnual).toBeCloseTo((incomeBasis - threshold) * (rate / 100), 6);
    expect(estimate.ifDependentLostAnnual).toBeCloseTo(incomeBasis * (rate / 100), 6);
    expect(estimate.annualIncrease).toBeCloseTo(threshold * (rate / 100), 6);
  });

  test('월 환산 금액도 함께 제공한다', () => {
    const years = [makeYearlyResult({ age: 70, healthInsuranceIncomeBasis: 40000000 })];

    const estimate = estimateHealthInsuranceCliff(years, ctx)!;

    expect(estimate.currentMonthly).toBeCloseTo(estimate.currentAnnual / 12, 6);
    expect(estimate.ifDependentLostMonthly).toBeCloseTo(estimate.ifDependentLostAnnual / 12, 6);
  });

  test('자격 상실 시 부담은 항상 현재 모델보다 크다', () => {
    const years = [makeYearlyResult({ age: 70, healthInsuranceIncomeBasis: 21000000 })];

    const estimate = estimateHealthInsuranceCliff(years, ctx)!;

    expect(estimate.ifDependentLostAnnual).toBeGreaterThan(estimate.currentAnnual);
    expect(estimate.annualIncrease).toBeGreaterThan(0);
  });

  // 건보료를 끈 계획에서는 시뮬레이션이 보험료를 한 푼도 부과하지 않았다. 그 상태에서
  // "자격을 잃으면 얼마"를 말하면 화면의 다른 숫자와 근거가 어긋난다.
  test('건강보험료 계산이 꺼져 있으면 추정하지 않는다', () => {
    const disabledCtx = resolveTaxContext({ enableHealthInsurance: false });
    const years = [makeYearlyResult({ age: 70, healthInsuranceIncomeBasis: 40000000 })];

    expect(estimateHealthInsuranceCliff(years, disabledCtx)).toBeNull();
  });

  test('금융소득종합과세가 꺼져 있으면 추정하지 않는다', () => {
    // 엔진은 enableComprehensiveTax가 꺼지면 건보료까지 통째로 0을 반환한다(TaxEngine).
    const disabledCtx = resolveTaxContext({ enableComprehensiveTax: false });
    const years = [makeYearlyResult({ age: 70, healthInsuranceIncomeBasis: 40000000 })];

    expect(estimateHealthInsuranceCliff(years, disabledCtx)).toBeNull();
  });

  test('사용자가 조정한 요율을 그대로 따른다', () => {
    // 요율은 고급 설정에서 조정 가능하다. 상수를 새로 지어내지 않고 컨텍스트에서 읽는다.
    const customCtx = resolveTaxContext({ healthInsuranceRate: 10 });
    const years = [makeYearlyResult({ age: 70, healthInsuranceIncomeBasis: 40000000 })];

    const estimate = estimateHealthInsuranceCliff(years, customCtx)!;

    expect(estimate.ifDependentLostAnnual).toBeCloseTo(40000000 * 0.1, 6);
  });

  test('빈 결과에서는 추정하지 않는다', () => {
    expect(estimateHealthInsuranceCliff([], ctx)).toBeNull();
  });
});
