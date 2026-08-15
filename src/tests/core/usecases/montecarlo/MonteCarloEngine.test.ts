import { describe, test, expect, vi } from 'vitest';
import {
  isSuccessfulTrial,
  MonteCarloEngine,
  runMonteCarlo,
} from '@/core/usecases/montecarlo/MonteCarloEngine';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { resolveMonteCarloConfig, VOLATILITY_BY_YIELD_PRESET } from '@/core/usecases/montecarlo/volatilityPresets';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';
import { MonteCarloConfig } from '@/core/entities/montecarlo';
import { freezeSpendingPlan, runFrozenPlan } from '@/core/usecases/spending/freezeSpendingPlan';
import { buildReturnShockPath } from '@/core/usecases/montecarlo/returnPath';
import { mulberry32, deriveSeed } from '@/core/usecases/montecarlo/rng';
import { simulationYearCount } from '@/core/usecases/montecarlo/horizon';

const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2500000 },
    assets: [
      { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 400, averagePrice: 500000,
        annualGrowthRate: 7, dividendYield: 2, monthlyContribution: 500000, reinvestDividend: true, currency: 'KRW' },
    ],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 1000000 },
    privatePensions: [
      { id: 'p1', type: 'irp', balance: 50000000, monthlyContribution: 300000, annualReturn: 4, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

function config(overrides: Partial<MonteCarloConfig> = {}): MonteCarloConfig {
  return { trials: 200, seed: 2026, annualStdDev: 15, ...overrides };
}

describe('runMonteCarlo', () => {
  // **σ=0이면 몬테카를로는 결정론이어야 한다.**
  //
  // 이 테스트가 MC 전체의 회귀 장치다: 확률 계층이 엔진 결과를 어떤 식으로든 왜곡하면
  // 여기서 잡힌다. 분위수도 전부 같은 값이어야 한다(모든 시행이 동일하므로).
  test('변동성이 0이면 모든 시행이 결정론 결과와 정확히 일치한다', () => {
    const deterministic = engine.runSingle(params());
    const mc = runMonteCarlo(params(), engine, config({ annualStdDev: 0, trials: 10 }));

    expect(mc.endingAssets.p10).toBeCloseTo(deterministic.endingAssets, 6);
    expect(mc.endingAssets.p50).toBeCloseTo(deterministic.endingAssets, 6);
    expect(mc.endingAssets.p90).toBeCloseTo(deterministic.endingAssets, 6);
    expect(mc.deterministicEndingAssets).toBeCloseTo(deterministic.endingAssets, 6);
  });

  test('같은 시드는 완전히 같은 결과를 준다', () => {
    const a = runMonteCarlo(params(), engine, config());
    const b = runMonteCarlo(params(), engine, config());

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('다른 시드는 다른 결과를 준다', () => {
    const a = runMonteCarlo(params(), engine, config({ seed: 1 }));
    const b = runMonteCarlo(params(), engine, config({ seed: 2 }));

    expect(a.endingAssets.p50).not.toBe(b.endingAssets.p50);
  });

  test('성공률은 0과 1 사이다', () => {
    const mc = runMonteCarlo(params(), engine, config());

    expect(mc.successRate).toBeGreaterThanOrEqual(0);
    expect(mc.successRate).toBeLessThanOrEqual(1);
  });

  test('모든 해에서 p10 ≤ p50 ≤ p90이다', () => {
    const mc = runMonteCarlo(params(), engine, config());

    expect(mc.assetBand.length).toBeGreaterThan(0);
    for (const year of mc.assetBand) {
      expect(year.p10).toBeLessThanOrEqual(year.p50);
      expect(year.p50).toBeLessThanOrEqual(year.p90);
    }
  });

  test('변동성이 커지면 결과 분포가 넓어진다', () => {
    const narrow = runMonteCarlo(params(), engine, config({ annualStdDev: 5 }));
    const wide = runMonteCarlo(params(), engine, config({ annualStdDev: 25 }));

    const spread = (mc: typeof narrow) => mc.endingAssets.p90 - mc.endingAssets.p10;
    expect(spread(wide)).toBeGreaterThan(spread(narrow));
  });

  // **변동성 손실(volatility drag).**
  //
  // 충격의 기대값이 0이어도 복리로 굴리면 기하평균 < 산술평균이라 중앙값이 결정론보다
  // 낮게 나온다. 이건 버그가 아니라 "연 7%가 30년 내리 유지되는 경우는 거의 없다"는
  // 지적의 정량적 실체다. 숨기지 않고 이 방향을 테스트로 고정한다.
  test('변동성이 있으면 중앙값이 결정론 결과보다 낮다', () => {
    const mc = runMonteCarlo(params(), engine, config({ annualStdDev: 20, trials: 300 }));

    expect(mc.endingAssets.p50).toBeLessThan(mc.deterministicEndingAssets);
  });

  test('연도별 밴드는 시뮬레이션 연수와 같은 길이다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 20 }));

    expect(mc.assetBand).toHaveLength(85 - 55 + 1);
    expect(mc.assetBand[0].age).toBe(55);
    expect(mc.assetBand[mc.assetBand.length - 1].age).toBe(85);
  });

  test('시행 수와 시드, 변동성을 결과에 남긴다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 37, seed: 99, annualStdDev: 18 }));

    expect(mc.trials).toBe(37);
    expect(mc.seed).toBe(99);
    expect(mc.annualStdDev).toBe(18);
  });

  test('시행이 1회여도 동작한다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 1 }));

    expect(mc.trials).toBe(1);
    expect(Number.isFinite(mc.endingAssets.p50)).toBe(true);
  });

  // 성공 기준 나이는 결정론 시뮬레이션이 실제로 돌린 종료 나이와 같아야 한다 —
  // 두 판정이 다른 나이를 보면 몬테카를로의 성공률과 화면의 고갈 문구가 어긋난다.
  test('성공 기준 나이는 결정론 시뮬레이션의 종료 나이(본인 기대수명)와 같다', () => {
    const p = params();

    const mc = runMonteCarlo(p, engine, config({ trials: 10 }));

    const deterministic = engine.runSingle(p);
    const lastSimulatedAge = deterministic.yearlyResults[deterministic.yearlyResults.length - 1].age;
    expect(mc.successAge).toBe(lastSimulatedAge);
    expect(mc.successAge).toBe(p.userProfile.expectancy);
  });

  test('고갈된 시행이 없으면 고갈 통계는 비어 있다', () => {
    // 충격 없이 넉넉한 계획이면 아무도 고갈되지 않는다.
    const mc = runMonteCarlo(params(), engine, config({ annualStdDev: 0, trials: 10 }));

    expect(mc.depletion.count).toBe(0);
    expect(mc.depletion.earliestAge).toBeNull();
    expect(mc.depletion.medianAge).toBeNull();
  });

  test('고갈된 시행이 있으면 가장 이른 나이를 보고한다', () => {
    // 자산이 거의 없는 계획이면 대부분 고갈된다.
    const poor = params({ assets: [], privatePensions: [], nationalPension: { expectedMonthlyAmount: 0 } });
    const mc = runMonteCarlo(poor, engine, config({ trials: 10 }));

    expect(mc.depletion.count).toBeGreaterThan(0);
    expect(mc.depletion.earliestAge).not.toBeNull();
    expect(mc.successRate).toBeLessThan(1);
  });

  // **max_sustainable은 시행 전에 한 번만 해소한다.**
  //
  // 시행마다 이진탐색을 다시 돌리면 그 시행이 겪을 미래를 미리 알고 생활비를 정하는 셈이라
  // (완벽한 예지력) 성공률이 구조적으로 100%에 붙는다. MC가 묻는 것은 "이 계획이 여러
  // 미래에서 얼마나 견디는가"지 "미래를 알았다면 얼마나 썼을까"가 아니다.
  test('max_sustainable 전략은 시행마다 생활비를 다시 탐색하지 않는다', () => {
    const spy = vi.spyOn(engine, 'runSingle');
    const maxSus = params({ spendingStrategy: 'max_sustainable' });

    runMonteCarlo(maxSus, engine, config({ trials: 5 }));

    // 시행마다 30회 이진탐색을 돌면 150회를 훌쩍 넘는다. 한 번만 해소하면
    // (해소 1회 = run() 31회) + 결정론 1회 + 시행 5회 수준에 머문다.
    expect(spy.mock.calls.length).toBeLessThan(60);
    spy.mockRestore();
  });

  test('max_sustainable 전략에서도 성공률이 100%에 고정되지 않는다', () => {
    const maxSus = params({ spendingStrategy: 'max_sustainable' });

    const mc = runMonteCarlo(maxSus, engine, config({ annualStdDev: 20, trials: 100 }));

    // 지속가능 최대치로 쓰면서 변동성을 겪으면 상당수 시행이 실패해야 정상이다.
    expect(mc.successRate).toBeLessThan(1);
  });

  test('계획 생활비를 온전히 쓴 시행의 비율을 함께 보고한다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 50 }));

    expect(mc.spendingSuccessRate).toBeGreaterThanOrEqual(0);
    expect(mc.spendingSuccessRate).toBeLessThanOrEqual(1);
    expect(mc.goalSuccessProbability).toBeLessThanOrEqual(mc.spendingSuccessRate);
    expect(mc.goalSuccessProbability).toBeLessThanOrEqual(mc.successRate);
  });

  test('validate는 optimizer용 이름으로 옮기기만 하고 값을 새로 만들지 않는다', () => {
    // **세 확률이 서로 달라야 의미가 있는 테스트다.**
    // 기본 fixture는 successRate = spendingSuccessRate = goalSuccessProbability = 0.62라,
    // 세 필드를 서로 바꿔 연결해도(cross-wiring) 단언이 전부 통과했다. validate()에서 `?? 0`
    // 폴백을 걷어낸 근거가 "이제 순수한 이름 변환"이라는 것이므로, 어느 원본에서 읽는지를
    // 실제로 구분하지 못하면 그 근거를 지키는 장치가 없는 셈이다.
    //
    // assetFloor가 인출을 막아 자산은 100% 보존되지만 생활비는 자주 미달하고(자산 보존 ≠
    // 생활 유지), 그 위의 상속 목표가 다시 걸러진다(목표 성공 ≠ 생활 유지).
    const discriminating = params({
      assetFloor: 200_000_000,
      userProfile: { ...params().userProfile, targetBequest: 700_000_000 },
    });
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(discriminating));
    const cfg = config({ trials: 60 });
    const direct = runMonteCarlo(discriminating, engine, cfg);
    const validated = new MonteCarloEngine(engine).validate(
      input.profile,
      input.goals,
      input.strategy,
      cfg,
    );

    // fixture가 퇴화하면(세 값이 같아지면) 아래 단언들이 무력해지므로 먼저 확인한다.
    expect(new Set([
      direct.successRate,
      direct.spendingSuccessRate,
      direct.goalSuccessProbability,
    ]).size).toBe(3);
    expect(new Set([
      direct.endingAssets.p10,
      direct.endingAssets.p50,
      direct.endingAssets.p90,
    ]).size).toBe(3);

    // 같은 seed·trials이므로 두 실행은 동일해야 한다. 이름만 달라진다.
    expect(validated.spendingSuccessProbability).toBe(direct.spendingSuccessRate);
    expect(validated.assetSurvivalProbability).toBe(direct.successRate);
    expect(validated.goalSuccessProbability).toBe(direct.goalSuccessProbability);
    expect(validated.terminalAssetMedian).toBe(direct.endingAssets.p50);
    expect(validated.terminalAssetP10).toBe(direct.endingAssets.p10);
    expect(validated.terminalAssetP90).toBe(direct.endingAssets.p90);
    expect(validated.shortfallProbability).toBeCloseTo(1 - direct.spendingSuccessRate, 12);
  });

  test('목표 성공확률은 명시된 기말자산 목표까지 같은 시행에서 만족해야 한다', () => {
    const impossibleBequest = params({
      userProfile: {
        ...params().userProfile,
        targetBequest: 10_000_000_000_000,
      },
    });

    const mc = runMonteCarlo(
      impossibleBequest,
      engine,
      config({ annualStdDev: 0, trials: 10 }),
    );

    expect(mc.spendingSuccessRate).toBe(1);
    expect(mc.successRate).toBe(1);
    expect(mc.goalSuccessProbability).toBe(0);
  });

  // **이 테스트가 지표 재정의의 존재 이유다 — 정의 자체를 잠근다.**
  //
  // 옛 정의(fullSpendingRate)는 `succeeded.filter(!hasUnmetSpending)`이었다. 즉 자산이
  // 살아남은 시행 안에서만 결손 없음을 셌고, 그래서 "자산은 바닥났지만 종신연금이 생활비를
  // 끝까지 대는" 경로를 실패로 집계했다. 그 접합(conjunction)에는 의미상 근거가 없다 —
  // 사용자가 묻는 것은 "쓰기로 한 만큼 쓰며 살았는가"이고, 거기에 "그리고 돈이 남았는가"를
  // 덧붙일 이유가 없다.
  //
  // **실측 참고**: 이 엔진에서 두 정의는 대부분의 계획에서 같은 숫자를 낸다. 인출 경로가
  // 매달 `min(잔액, 필요액)`으로 깎기 때문에, 적자 구간에서 자산이 0에 닿는 해는 거의 항상
  // 그 해에 결손도 함께 낸다(300시행 × 자산규모 6종에서 "고갈했으나 결손 없음"이 0건이었다).
  // 갈리는 것은 경계 사례 — 기대수명에 정확히 고갈되는 시행(isSuccessfulTrial은 실패로
  // 보지만 그 해 생활비는 소득이 채운 경우) — 이라 특정 픽스처로 재현하기 어렵다.
  // 그래서 숫자 관계를 단언하는 대신, **집계 모집단이 전체 시행인지**를 직접 검증한다:
  // 같은 시드로 시행을 재현해 결손 없는 시행의 비율을 독립적으로 세고 비교한다.
  test('생활 유지 성공률은 자산 생존 여부와 무관하게 전체 시행에서 센다', () => {
    const cfg = config({ trials: 40, annualStdDev: 20 });
    const target = params();

    const mc = runMonteCarlo(target, engine, cfg);

    // runMonteCarlo와 같은 시드 규칙(deriveSeed(seed, index))으로 같은 시행을 재현한다.
    const planned = freezeSpendingPlan(target, engine);
    const years = simulationYearCount(planned.params);
    let noShortfall = 0;
    let allCoreGoals = 0;
    for (let i = 0; i < cfg.trials; i++) {
      const path = buildReturnShockPath(years, cfg.annualStdDev, mulberry32(deriveSeed(cfg.seed, i)));
      const trial = runFrozenPlan(engine, planned, path);
      // **여기에 depletionAge 조건을 걸지 않는다** — 그것이 이 지표의 정의다.
      if (!trial.yearlyResults.some((y) => y.unmetSpending > 0)) noShortfall++;
      if (
        !trial.yearlyResults.some((y) => y.unmetSpending > 0)
        && isSuccessfulTrial(trial.depletionAge, planned.params.userProfile.expectancy)
      ) allCoreGoals++;
    }

    expect(mc.spendingSuccessRate).toBe(noShortfall / cfg.trials);
    expect(mc.goalSuccessProbability).toBe(allCoreGoals / cfg.trials);
  });

  // 판정 기준이 되는 월 생활비를 함께 실어야 화면이 "계획 생활비 월 223만원 기준"이라고
  // 밝힐 수 있다. 「평생 소비 최적화」에서 이 값은 사용자가 입력한 목표가 아니다.
  test('판정 기준이 된 월 생활비를 함께 보고한다', () => {
    const target = runMonteCarlo(params(), engine, config({ trials: 5 }));
    expect(target.plannedMonthlySpending).toBe(2500000);

    const maxSus = runMonteCarlo(
      params({ spendingStrategy: 'max_sustainable' }), engine, config({ trials: 5 })
    );
    expect(maxSus.plannedMonthlySpending).not.toBe(2500000);
    expect(maxSus.plannedMonthlySpending).toBeGreaterThan(0);
  });
});

describe('MonteCarloEngine strategy validation', () => {
  test('같은 seed로 최종 검증 지표 7개를 재현한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(params());
    const validator = new MonteCarloEngine(engine);
    const cfg = config({ trials: 30, seed: 77 });

    const first = validator.validate(input.profile, input.goals, input.strategy, cfg);
    const second = validator.validate(input.profile, input.goals, input.strategy, cfg);

    expect(second).toEqual(first);
    expect(first).toMatchObject({ trials: 30, seed: 77 });
    expect(first.goalSuccessProbability).toBeGreaterThanOrEqual(0);
    expect(first.spendingSuccessProbability).toBeGreaterThanOrEqual(0);
    expect(first.assetSurvivalProbability).toBeGreaterThanOrEqual(0);
    expect(first.terminalAssetP10).toBeLessThanOrEqual(first.terminalAssetMedian);
    expect(first.terminalAssetMedian).toBeLessThanOrEqual(first.terminalAssetP90);
    expect(first.shortfallProbability).toBeCloseTo(1 - first.spendingSuccessProbability, 12);
  });
});

describe('resolveMonteCarloConfig', () => {
  // 변동성을 새 입력 UI로 받지 않고 기존 리스크 성향(yieldPreset) 축에 얹는다.
  // 사용자는 이미 「투자 전략」에서 성향을 고르는데, 그 선택이 기대수익률만 바꾸고
  // 변동성은 안 바꾸는 것이 오히려 비일관이었다.
  test('수익률 프리셋에 따라 변동성이 정해진다', () => {
    expect(resolveMonteCarloConfig(params({ yieldPreset: 'conservative' })).annualStdDev)
      .toBe(VOLATILITY_BY_YIELD_PRESET.conservative);
    expect(resolveMonteCarloConfig(params({ yieldPreset: 'aggressive' })).annualStdDev)
      .toBe(VOLATILITY_BY_YIELD_PRESET.aggressive);
  });

  test('프리셋이 없거나 custom이면 base 변동성을 쓴다', () => {
    expect(resolveMonteCarloConfig(params()).annualStdDev).toBe(VOLATILITY_BY_YIELD_PRESET.base);
    expect(resolveMonteCarloConfig(params({ yieldPreset: 'custom' })).annualStdDev)
      .toBe(VOLATILITY_BY_YIELD_PRESET.base);
  });

  test('시드는 고정 상수다', () => {
    // 시각 기반이면 아무것도 바꾸지 않았는데 새로고침마다 성공률이 흔들린다.
    expect(resolveMonteCarloConfig(params()).seed).toBe(resolveMonteCarloConfig(params()).seed);
  });

  test('보수적일수록 변동성이 낮다', () => {
    expect(VOLATILITY_BY_YIELD_PRESET.conservative).toBeLessThan(VOLATILITY_BY_YIELD_PRESET.base);
    expect(VOLATILITY_BY_YIELD_PRESET.base).toBeLessThan(VOLATILITY_BY_YIELD_PRESET.aggressive);
  });
});

describe('goalFailure — 목표 달성 확률을 떨어뜨린 원인', () => {
  test('원인별 시행 수를 goalSuccessProbability와 같은 판정으로 집계한다', () => {
    const config: MonteCarloConfig = { trials: 60, seed: 7, annualStdDev: 18 };
    const result = runMonteCarlo(params(), engine, config);

    // 세 조건을 모두 통과한 시행 수 = goalSuccessProbability * trials.
    // 어느 원인에도 걸리지 않은 시행이 그보다 적으면 집계가 판정과 갈라진 것이다.
    const succeeded = Math.round(result.goalSuccessProbability * config.trials);
    const { spendingShortfall, assetDepletion, terminalShortfall } = result.goalFailure;
    for (const count of [spendingShortfall, assetDepletion, terminalShortfall]) {
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(config.trials);
      expect(count).toBeLessThanOrEqual(config.trials - succeeded);
    }
    // 실패한 시행은 반드시 어떤 원인에든 잡혀야 한다.
    if (succeeded < config.trials) {
      expect(Math.max(spendingShortfall, assetDepletion, terminalShortfall)).toBeGreaterThan(0);
    }
  });

  test('사적연금 인출 상한이 걸린 계획은 자산이 남는데도 생활비 미달로 실패한다', () => {
    // 자산 대부분이 사적연금에 있고 월 인출 상한이 낮으면, 일반계좌를 다 쓴 뒤로는 목표
    // 생활비를 채울 방법이 없다. 그런데 연금 잔액은 그대로 남으므로 고갈로는 잡히지 않는다.
    // 이 조합이 "기말자산은 큰데 목표 달성 확률만 바닥"의 원인이다.
    const capped = runMonteCarlo(params({
      privatePensions: [
        { id: 'p1', type: 'irp', balance: 1_500_000_000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
      ],
      withdrawalPlan: { privatePensionMonthlyTarget: 300_000 },
    }), engine, { trials: 30, seed: 7, annualStdDev: 12 });

    expect(capped.goalFailure.spendingShortfall).toBeGreaterThan(capped.goalFailure.assetDepletion);
    expect(capped.goalFailure.medianFirstShortfallAge).not.toBeNull();
  });

  test('생활비 미달 시행이 없으면 medianFirstShortfallAge는 null이다', () => {
    // 목표 생활비가 국민연금만으로도 덮이는 계획.
    const easy = runMonteCarlo(params({
      userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 500_000 },
    }), engine, { trials: 20, seed: 7, annualStdDev: 5 });

    expect(easy.goalFailure.spendingShortfall).toBe(0);
    expect(easy.goalFailure.medianFirstShortfallAge).toBeNull();
  });
});

describe('goalSuccessProbability — 선택한 목표가 판정 조건을 정한다', () => {
  const config: MonteCarloConfig = { trials: 40, seed: 7, annualStdDev: 15 };
  // 이 fixture가 절대 도달할 수 없는 기말자산 목표액.
  const unreachableBequest = 100_000_000_000_000;

  test('레거시 시나리오(목표 없음)는 목표 도입 이전과 같은 조건을 쓴다', () => {
    const legacy = runMonteCarlo(
      params({ userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2500000, targetBequest: unreachableBequest } }),
      engine, config,
    );

    expect(legacy.goalConditions.basis).toBe('legacy_plan');
    expect(legacy.goalConditions.terminalAssetGoal).toBe(unreachableBequest);
    expect(legacy.goalSuccessProbability).toBe(0);
  });

  test('상속을 고르지 않았으면 남아 있는 상속 목표액이 확률을 깎지 않는다', () => {
    // 구 UI에서 넣어 둔 금액이 목표 화면을 거친 뒤에도 조건으로 살아 있으면, 사용자는
    // 화면 어디에도 보이지 않는 값 때문에 0%를 받는다.
    const withGoals = runMonteCarlo(params({
      userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2500000, targetBequest: unreachableBequest },
      retirementGoals: [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' }],
    }), engine, config);

    expect(withGoals.goalConditions.basis).toBe('selected_goals');
    expect(withGoals.goalConditions.terminalAssetGoal).toBe(0);
    expect(withGoals.goalFailure.terminalShortfall).toBe(0);
    expect(withGoals.goalSuccessProbability).toBeGreaterThan(0);
  });

  test('고르지 않은 조건은 실패 사유로도 세지 않는다', () => {
    // 생활비만 골랐으면 고갈은 이 확률이 묻는 것이 아니다. 판정하지 않은 조건을 사유로만
    // 보고하면 확률과 화면이 어긋난다.
    const spendingOnly = runMonteCarlo(params({
      retirementGoals: [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' }],
    }), engine, config);

    expect(spendingOnly.goalConditions.requireAssetSurvival).toBe(false);
    expect(spendingOnly.goalFailure.assetDepletion).toBe(0);
    // 원본 지표는 그대로 남는다 — 조건에서 빠졌다고 자산 보존 성공률까지 지우지 않는다.
    expect(spendingOnly.successRate).toBeLessThanOrEqual(1);
  });

  test('판정할 수 없는 목표만 골라도 100%가 되지 않는다', () => {
    const qualitativeOnly = runMonteCarlo(params({
      retirementGoals: [{ type: 'TAX_OPTIMIZATION', priority: 1, constraintType: 'SOFT' }],
    }), engine, config);

    expect(qualitativeOnly.goalConditions.basis).toBe('plan_defaults');
    expect(qualitativeOnly.goalConditions.unmeasuredGoals).toEqual(['TAX_OPTIMIZATION']);
    expect(qualitativeOnly.goalConditions.requireSpendingTarget).toBe(true);
    expect(qualitativeOnly.goalConditions.requireAssetSurvival).toBe(true);
  });

  test('상속을 고르면 그 목표액이 다시 조건이 된다', () => {
    const withInheritance = runMonteCarlo(params({
      retirementGoals: [{
        type: 'INHERITANCE', priority: 1, constraintType: 'SOFT', targetValue: unreachableBequest,
      }],
    }), engine, config);

    expect(withInheritance.goalConditions.terminalAssetGoal).toBe(unreachableBequest);
    expect(withInheritance.goalSuccessProbability).toBe(0);
  });
});
