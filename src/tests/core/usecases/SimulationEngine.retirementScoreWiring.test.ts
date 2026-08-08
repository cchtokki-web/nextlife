import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { HealthcareAssumptions, SimulationParams } from '@/core/entities/types';

// followups #3: computeRetirementTargetAssets는 순수 함수로 분리되어 산술 계약은 테스트되지만,
// calculateRetirementScore가 실제로 retirementStartResult.healthcareSpending을 넘기는지는
// 아무도 검증하지 않았다. `computeRetirementTargetAssets(target, 0)`으로 회귀시켜도 기존
// 테스트가 전부 통과하고 스냅샷도 깨지지 않는다(해당 fixture는 healthcare 0). 배선을
// end-to-end로 건다.
//
// 방법: "분모가 같아야 하는 두 시나리오"를 만들고 은퇴 준비도가 같은지 본다.
// 물가상승률 0 + 실질 모드 + 의료비 증가율 0으로 두면 의료비는 은퇴 후 매년 같은 금액이라
// 목표 생활비를 그만큼 올린 것과 현금흐름까지 완전히 같아진다.
const engine = new SimulationEngine();

const base: SimulationParams = {
  userProfile: {
    currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 1000000,
  },
  assets: [{
    id: 'a1', name: '현금성', ticker: 'CASH', type: 'stock', currency: 'KRW',
    quantity: 40000, averagePrice: 10000, monthlyContribution: 0,
    annualGrowthRate: 0, dividendYield: 0, reinvestDividend: false,
  }],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const flatHealthcare = (baseMonthlyCost: number): HealthcareAssumptions => ({
  enabled: true,
  costGrowthRate: 0,
  baseMonthlyCost,
  longTermCareEnabled: false,
  longTermCareStartAge: 80,
  longTermCareMonthlyCost: 0,
  shockEnabled: false,
  shockAge: 75,
  shockAmount: 0,
});

describe('calculateRetirementScore의 목표 자산 배선', () => {
  test('반복 의료비는 목표 생활비를 같은 금액만큼 올린 것과 같은 점수를 낸다', () => {
    // A: 월 300만원, 의료비 없음 → 분모 = 300만 × 12 × 25
    const withoutHealthcare = engine.run({
      ...base,
      userProfile: { ...base.userProfile, targetMonthlySpending: 3000000 },
    });

    // B: 월 100만원 + 반복 의료비 월 200만원 → 분모가 같으려면 healthcareSpending이 넘어가야 한다.
    // 배선이 빠지면(healthcare 인자에 0을 넘기면) B의 분모가 1/3로 줄어 assetScore가 뛴다.
    const withHealthcare = engine.run({
      ...base,
      userProfile: { ...base.userProfile, targetMonthlySpending: 1000000 },
      healthcare: flatHealthcare(2000000),
    });

    expect(withHealthcare.retirementScore).toBe(withoutHealthcare.retirementScore);
    // 회귀 시 실제로 점수가 갈리는 조건인지 확인한다 — 만점(=분모와 무관)이면 빈 테스트가 된다.
    expect(withoutHealthcare.retirementScore).toBeLessThan(100);
  });

  test('은퇴 시점 반복 의료비가 목표 자산 분모에 반영된다', () => {
    const withoutHealthcare = new SimulationEngine().run(base);
    const withHealthcare = new SimulationEngine().run({
      ...base,
      healthcare: {
        enabled: true, costGrowthRate: 5, baseMonthlyCost: 1000000,
        longTermCareEnabled: false, longTermCareStartAge: 80, longTermCareMonthlyCost: 0,
        shockEnabled: false, shockAge: 0, shockAmount: 0,
      },
    });

    // 목표 자산 분모가 커지므로 자산 점수가, 따라서 총점이 낮아진다.
    expect(withHealthcare.retirementScore).toBeLessThan(withoutHealthcare.retirementScore);
  });
});

// followups #4: 4% 룰은 "이 필요가 영구히 반복된다"는 가정이다. 일회성 의료비 쇼크가
// 은퇴 연도에 걸리면 그 목돈이 25배로 곱해져 목표 자산에 더해진다(3천만원 → 7.5억).
// 영구 연금 분모에는 반복 구성요소만 들어가야 한다.
describe('일회성 의료비 쇼크와 4% 룰 분모', () => {
  const withShockAt = (shockAge: number) => engine.run({
    ...base,
    userProfile: { ...base.userProfile, targetMonthlySpending: 1000000 },
    healthcare: {
      ...flatHealthcare(0),
      shockEnabled: true,
      shockAge,
      shockAmount: 50000000,
    },
  });

  // 쇼크 금액(5천만원)은 은퇴 자산(4억)에 비해 작아, 어느 해에 걸리든 assetScore는
  // 상한에 걸린다. 그런데도 두 계획의 은퇴 준비도가 갈린다면 그 차이는 계획의 차이가 아니라
  // 일회성 목돈을 영구 연금 분모에 넣은 산식의 결함이다(3천만원 → 7.5억).
  test('쇼크가 은퇴 연도에 걸려도 그 다음 해에 걸린 것과 은퇴 준비도가 같다', () => {
    expect(withShockAt(60).retirementScore).toBe(withShockAt(61).retirementScore);
  });

  test('쇼크를 켜도 반복 의료비만 있는 계획과 은퇴 준비도가 같다', () => {
    const noShock = engine.run({
      ...base,
      userProfile: { ...base.userProfile, targetMonthlySpending: 1000000 },
      healthcare: flatHealthcare(0),
    });

    expect(withShockAt(60).retirementScore).toBe(noShock.retirementScore);
  });
});
