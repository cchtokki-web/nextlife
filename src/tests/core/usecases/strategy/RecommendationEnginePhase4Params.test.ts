import { describe, test, expect, vi, afterEach } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { InvestmentAsset, SimulationParams, SimulationResult } from '@/core/entities/types';

// Fix 2 검증 전용 파일이다. RecommendationEngine.test.ts와 달리 테스트마다 StrategyCandidateGenerator를
// 다르게 모킹해 bestPlan(Phase 1+2 결과)을 결정론적으로 통제해야 하므로(자연스러운 5차원 그리드
// 탐색만으로는 특정 필드 값이 우연히 승리하는 시나리오를 안정적으로 재현하기 어렵다) 별도 파일로
// 분리하고, vi.mock(hoisted, 파일 전역) 대신 테스트별 vi.doMock + vi.resetModules를 쓴다.
afterEach(() => {
  vi.doUnmock('@/core/usecases/strategy/StrategyCandidateGenerator');
  vi.doUnmock('@/core/usecases/strategy/DividendReinvestmentOptimizer');
  vi.resetModules();
});

// engine.runForUtility에 전달되는 모든 candidate params를 기록해, 그중 Phase 4 후보를 찾아내기
// 위한 래퍼. 실제 계산은 SimulationEngine에 그대로 위임하므로 시뮬레이션 결과 자체는 real engine과
// 동일하다.
class RecordingEngine extends SimulationEngine {
  calls: SimulationParams[] = [];
  runForUtility(params: SimulationParams): SimulationResult {
    this.calls.push(params);
    return super.runForUtility(params);
  }
}

const PHASE4_NEW_PENSION_ID = 'phase4-new-private-pension';

// Phase 4는 독립된 두 레그(채널링 / 신규계좌 납입)를 각각 시뮬레이션한다. 두 레그 모두 Phase 3까지의
// 결정을 그대로 물려받아야 하므로, 여기서는 두 후보를 모두 찾아 각각 검증한다.
function findPhase4Calls(engine: RecordingEngine): SimulationParams[] {
  return engine.calls.filter((c) =>
    c.privatePensions.some((p) => p.id === PHASE4_NEW_PENSION_ID || p.earlyChannelingEnabled)
  );
}

const baseParams: SimulationParams = {
  // currentAge < retirementAge여야 Phase 4의 두 레그(브릿지 인출 구간 / 납입 기간)가 평가된다.
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 1000000, targetBequest: 0 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'pension-1', type: 'irp', balance: 5000000000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
  ],
  isaAccounts: [
    { id: 'isa-1', type: 'general', balance: 10000000, monthlyContribution: 0, annualReturn: 6, dividendYield: 0, currency: 'KRW', maturityYears: 99 },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

test(
  'Fix 2(a): Phase 2가 생활비 배수(monthlySpendingMultiplier)를 선택하면, Phase 4 candidate 시뮬레이션도 ' +
    '스케일링된 targetMonthlySpending을 받는다 (paramsForCandidate 재사용 검증)',
  async () => {
    // Phase 1(5차원 그리드)을 비워 Phase 2의 생활비 배수 후보가 확실히 경쟁 없이 채택되게 한다.
    vi.doMock('@/core/usecases/strategy/StrategyCandidateGenerator', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/core/usecases/strategy/StrategyCandidateGenerator')>();
      return { ...actual, generateCandidatePlans: () => [] };
    });
    const { recommendStrategy } = await import('@/core/usecases/strategy/RecommendationEngine');
    const engine = new RecordingEngine();
    const originalMonthlySpending = baseParams.userProfile.targetMonthlySpending;

    const result = recommendStrategy(baseParams, engine);

    // 사전 조건: Phase 2의 생활비 배수 탐색이 실제로 승리해야 이 테스트가 의미 있다.
    const multiplier = result.recommendedPlan?.monthlySpendingMultiplier ?? 1;
    expect(multiplier).not.toBe(1);

    const phase4Calls = findPhase4Calls(engine);
    expect(phase4Calls.length).toBeGreaterThanOrEqual(2); // 채널링 레그 + 신규계좌 레그
    for (const call of phase4Calls) {
      expect(call.userProfile.targetMonthlySpending).toBe(Math.round(originalMonthlySpending * multiplier));
    }
  }
);

test('Fix 2(b): bestPlan이 null(Phase 1+2 개선 없음)이면 Phase 4 candidate의 withdrawalPlan은 identityPlan으로 치환되지 않고 원래 params.withdrawalPlan을 그대로 유지한다', async () => {
  // Phase 1/2 모두 후보를 비워 bestPlan이 반드시 null이 되게 한다.
  vi.doMock('@/core/usecases/strategy/StrategyCandidateGenerator', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/usecases/strategy/StrategyCandidateGenerator')>();
    return { ...actual, generateCandidatePlans: () => [], generateSpendingAdjustmentCandidates: () => [] };
  });
  const { recommendStrategy } = await import('@/core/usecases/strategy/RecommendationEngine');
  const engine = new RecordingEngine();
  // identityPlan이 강제하는 기본값(nationalPensionStartAge=65, privatePensionMonthlyTarget=
  // targetMonthlySpending=1000000)과 명백히 다른 값을 원래 withdrawalPlan에 심어, identityPlan으로
  // 치환됐는지 여부를 구분할 수 있게 한다.
  const params: SimulationParams = {
    ...baseParams,
    withdrawalPlan: { nationalPensionStartAge: 62, privatePensionMonthlyTarget: 12345 },
  };

  const result = recommendStrategy(params, engine);

  expect(result.recommendedPlan).toBeNull();

  const phase4Calls = findPhase4Calls(engine);
  expect(phase4Calls.length).toBeGreaterThanOrEqual(2); // 채널링 레그 + 신규계좌 레그
  // identityPlan으로 치환됐다면 65 / 1000000이 됐을 것이다 — 원래 값(62 / 12345)이 그대로
  // 유지돼야 한다.
  for (const call of phase4Calls) {
    expect(call.withdrawalPlan?.nationalPensionStartAge).toBe(62);
    expect(call.withdrawalPlan?.privatePensionMonthlyTarget).toBe(12345);
  }
});

function makeAsset(overrides: Partial<InvestmentAsset>): InvestmentAsset {
  return {
    id: 'asset-1',
    type: 'etf',
    ticker: 'SPY',
    name: 'S&P500',
    quantity: 10,
    averagePrice: 400000,
    annualGrowthRate: 7,
    dividendYield: 3,
    monthlyContribution: 0,
    reinvestDividend: true,
    currency: 'KRW',
    ...overrides,
  };
}

test(
  'Phase 3(배당 재투자 최적화)가 뒤집은 자산의 reinvestDividend가 Phase 4 candidate params에도 그대로 전달된다 ' +
    '(paramsAfterPhase3의 assets 리매핑 검증 — baseParams.assets가 항상 []이면 이 분기는 한 번도 실행되지 않는다)',
  async () => {
    // Phase 1/2는 이 테스트의 관심사가 아니므로 비워서 bestPlan을 결정론적으로 null로 만든다.
    vi.doMock('@/core/usecases/strategy/StrategyCandidateGenerator', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/core/usecases/strategy/StrategyCandidateGenerator')>();
      return { ...actual, generateCandidatePlans: () => [], generateSpendingAdjustmentCandidates: () => [] };
    });
    // Phase 3(어떤 자산을 뒤집을지 스스로 판단하는 로직) 자체는 DividendReinvestmentOptimizer.test.ts가
    // 이미 검증한다. 여기서는 그 판단 결과가 "asset-1의 reinvestDividend: true -> false"라고 결정론적으로
    // 고정해, RecommendationEngine.ts가 그 결정을 paramsAfterPhase3.assets에 실제로 반영해 Phase 4로
    // 넘기는지(=핸드오프 배선 자체)만 검증한다.
    vi.doMock('@/core/usecases/strategy/DividendReinvestmentOptimizer', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/core/usecases/strategy/DividendReinvestmentOptimizer')>();
      return {
        ...actual,
        optimizeDividendReinvestment: (
          _params: SimulationParams,
          _bestPlan: unknown,
          bestResult: SimulationResult,
          bestUtility: unknown
        ) => ({
          recommendedAssetReinvestment: { 'asset-1': false },
          perAssetResults: [],
          finalResult: bestResult,
          finalUtility: bestUtility,
          failedAssetCount: 0,
        }),
      };
    });
    const { recommendStrategy } = await import('@/core/usecases/strategy/RecommendationEngine');
    const engine = new RecordingEngine();
    const params: SimulationParams = {
      ...baseParams,
      assets: [makeAsset({ id: 'asset-1', reinvestDividend: true })],
    };

    recommendStrategy(params, engine);

    const phase4Calls = findPhase4Calls(engine);
    expect(phase4Calls.length).toBeGreaterThanOrEqual(2); // 채널링 레그 + 신규계좌 레그
    for (const call of phase4Calls) {
      expect(call.assets.find((a) => a.id === 'asset-1')!.reinvestDividend).toBe(false);
    }
  }
);
