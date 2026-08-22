// 진단 하니스. `npx vitest run --config vitest.harness.config.ts scripts/harness/ledger.harness.ts`
//
// **회귀 테스트가 아니다.** personas.harness.ts와 같은 관례를 따른다 — 단언하지 않고
// 지표를 뽑아 파일로 남긴다. 목적은 하나다: 리포트에 실린 숫자 하나하나가 어느 식에서
// 나왔는지 연도별로 대조할 수 있게 만드는 것.
//
// 화면과 «같은 파이프라인»을 태운다(useStrategyPipeline.ts). 원본 JSON을 엔진에 바로 넣으면
// compileStrategy가 채우는 전략 기본값(상속 하한선·인출 계획 등)이 빠져 리포트 숫자가
// 재현되지 않는다.
//
//   raw JSON
//     → normalizeSimulationParams   (저장 데이터 정제 + 옛 키 마이그레이션)
//     → migrateRetirementGoals      (목표 축 정규화)
//     → compileStrategy             (전략 언어 → 엔진 파라미터)
//     → recommendLegacyConfig       (AI 추천)
//     → applyAiSentinels            (미정 축을 추천값으로 채움)
//     → effective.params            ← 엔진·MC·민감도가 실제로 보는 것
//
// 입력 파일은 LEDGER_INPUT 환경변수로 바꾼다. 기본값은 지시문 리포트의 재현본이다.
import { test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SimulationParams, SimulationResult, YearlyLedger } from '@/core/entities/types';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';
import { migrateRetirementGoals } from '@/core/usecases/goals/retirementGoalAdapter';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { LegacyRecommendationEngine } from '@/core/recommendation/LegacyRecommendationEngine';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { simulateLegacyConfig } from '@/core/application/simulateLegacyConfig';
import { runMonteCarlo } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '@/core/usecases/montecarlo/volatilityPresets';
import { computeSensitivityAnalysis } from '@/core/usecases/dashboard/computeSensitivityAnalysis';
import { computeShortfallSummary } from '@/core/usecases/dashboard/computeShortfallSummary';
import { resolveGoalSuccessConditions } from '@/core/usecases/goals/goalSuccessConditions';
import { resolvePlanOutcome } from '@/core/usecases/dashboard/resolvePlanOutcome';
import { ledgerTolerance } from '@/core/usecases/ledger/YearLedger';

const OUT_DIR = process.env.HARNESS_OUT ?? path.join(process.cwd(), 'scripts/harness/out/ledger');
const INPUT = process.env.LEDGER_INPUT
  ?? path.join(process.cwd(), 'scripts/harness/input/report-case.json');

// 기본 경로의 파일은 «저장소에 없다» — 실제 사용자의 자산·소득이 담긴 시나리오라
// 커밋하지 않기 때문이다(.gitignore). 없을 때 raw ENOENT를 내면 「하니스가 고장났다」로
// 읽히므로, 무엇을 해야 하는지 말하고 멈춘다.
if (!fs.existsSync(INPUT)) {
  throw new Error(
    `원장 하니스에 입력이 필요합니다: ${INPUT}\n`
    + '  LEDGER_INPUT=<시나리오.json> npm run harness:ledger\n'
    + '  (기본 경로의 파일은 실제 재무 데이터라 저장소에 두지 않습니다)'
  );
}

const 만 = 10_000;

function writeOut(name: string, body: string) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), body);
}

// CSV 한 칸. 숫자는 원 단위 반올림으로 적는다 — 표시 단위(만원)로 접으면 60~64세처럼
// 작은 차이를 대조해야 하는 구간에서 반올림이 곧 결론이 된다.
const n = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? '' : String(Math.round(v));

test('진단 원장', { timeout: 3_600_000 }, () => {
  const rawFile = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const raw = rawFile.params ?? rawFile;

  // --- 파이프라인 (화면과 동일) ---
  const normalized = migrateRetirementGoals(normalizeSimulationParams(raw));
  const engine = new LegacySimulationEngine();
  const compiled = compileStrategy(normalized);

  let recommendation;
  let recommendationError: string | null = null;
  try {
    recommendation = new LegacyRecommendationEngine(engine)
      .recommendLegacyConfig(compiled.params, compiled.utilityConfig);
  } catch (err) {
    recommendationError = err instanceof Error ? err.message : String(err);
  }
  const sentinels = applyAiSentinels(compiled, recommendation);
  const effective = sentinels.compiled;
  const params: SimulationParams = effective.params;

  const result: SimulationResult = simulateLegacyConfig(engine, params, effective.utilityConfig);

  // --- 1. 연도별 원장 ---
  const ledgerRows = result.yearlyResults.map((y) => {
    const l: YearlyLedger | undefined = y.ledger;
    return {
      age: y.age,
      year: y.year,
      openingAssets: y.openingAssets,

      targetSpending: y.targetSpending,
      spending: y.spending,
      unmetSpending: y.unmetSpending,
      healthcareSpending: y.healthcareSpending,

      nationalPensionIncome: y.nationalPensionIncome,
      privatePensionIncome: y.privatePensionIncome,
      dividendIncome: y.dividendIncome,
      otherIncome: y.otherIncome,
      totalIncome: y.totalIncome,
      preTaxTotalIncome: y.preTaxTotalIncome,

      withdrawalPrivatePension: y.privatePensionWithdrawal,
      withdrawalGeneralAsset: y.generalAssetWithdrawal,
      withdrawalIsa: y.isaWithdrawal,
      withdrawalTotal: y.withdrawal,

      dividendTaxPaid: y.dividendTaxPaid,
      pensionTaxPaid: y.pensionTaxPaid,
      nationalPensionTaxPaid: y.nationalPensionTaxPaid,
      comprehensiveTaxPaid: y.comprehensiveTaxPaid,
      capitalGainsTaxPaid: y.capitalGainsTaxPaid,
      healthInsurancePaid: y.healthInsurancePaid,
      healthInsuranceIncomeBasis: y.healthInsuranceIncomeBasis,
      taxesTotal: y.taxes,

      investmentReturn: y.investmentReturn,
      ledgerPriceGain: l?.investmentReturn.priceGain,
      ledgerDividendGross: l?.investmentReturn.dividend,
      ledgerDividendPaidOutNet: l?.investmentReturn.dividendPaidOutNet,
      ledgerDividendRetainedNet: l?.investmentReturn.dividendRetainedNet,
      ledgerContributions: l?.externalIncome.contributions,

      stockAssets: y.stockAssets,
      pensionAssets: y.pensionAssets,
      isaAssets: y.isaAssets,
      cashAssets: y.cashAssets,
      totalAssets: y.totalAssets,

      // 회계 항등식. residual이 tolerance를 넘으면 엔진이 이미 throw했을 것이다.
      expectedEndingAssets: l === undefined ? undefined : l.endingAssets - l.residual,
      actualEndingAssets: l?.endingAssets,
      difference: l?.residual,
      tolerance: l === undefined ? undefined : ledgerTolerance(l),

      // 「자산은 남았는데 생활비가 모자란 해」 표식. 지시문 §9가 요구한 판정.
      liquidAssetsAtYearEnd: y.stockAssets + y.pensionAssets + y.isaAssets + y.cashAssets,
      shortfallWithAssetsRemaining:
        y.unmetSpending > 0 && (y.stockAssets + y.pensionAssets + y.isaAssets + y.cashAssets) > 0,
    };
  });

  const headers = Object.keys(ledgerRows[0] ?? {});
  const csv = [
    headers.join(','),
    ...ledgerRows.map((row) =>
      headers.map((h) => {
        const v = (row as Record<string, unknown>)[h];
        if (typeof v === 'number') return n(v);
        if (typeof v === 'boolean') return v ? 'TRUE' : '';
        return v === undefined || v === null ? '' : String(v);
      }).join(',')
    ),
  ].join('\n');
  writeOut('ledger.csv', csv);
  writeOut('ledger.json', JSON.stringify(ledgerRows, null, 2));

  // --- 2. 몬테카를로 ---
  const mcConfig = resolveMonteCarloConfig(params);
  const mc = runMonteCarlo(params, engine, mcConfig);
  // 같은 시드로 한 번 더 돌려 재현성을 확인한다(지시문 §16).
  const mcRepeat = runMonteCarlo(params, engine, mcConfig);

  const mcOut = {
    config: mcConfig,
    reproducible: JSON.stringify(mc) === JSON.stringify(mcRepeat),
    successAge: mc.successAge,
    rates: {
      assetSurvival: mc.successRate,
      spendingSuccess: mc.spendingSuccessRate,
      goalSuccess: mc.goalSuccessProbability,
    },
    // 지시문 §12의 산술 검산: 고갈 841회면 자산생존율은 15.9%여야 한다.
    assetSurvivalFromDepletionCount: (mc.trials - mc.depletion.count) / mc.trials,
    assetSurvivalMatchesDepletionCount:
      Math.abs(mc.successRate - (mc.trials - mc.depletion.count) / mc.trials) < 1e-12,
    depletion: mc.depletion,
    goalFailure: mc.goalFailure,
    goalConditions: mc.goalConditions,
    plannedMonthlySpending: mc.plannedMonthlySpending,
    endingAssets: mc.endingAssets,
    deterministicEndingAssets: mc.deterministicEndingAssets,
    assumptions: mc.assumptions,
    annualStdDev: mc.annualStdDev,
    assetBandsTail: mc.assetBands.slice(-6),
  };
  writeOut('montecarlo.json', JSON.stringify(mcOut, null, 2));

  // --- 3. 민감도 ---
  const sensitivity = computeSensitivityAnalysis(params, engine);
  writeOut('sensitivity.json', JSON.stringify(sensitivity, null, 2));

  // --- 4. 계획 요약 ---
  const shortfall = computeShortfallSummary(params, result);
  const outcome = resolvePlanOutcome(result, params);
  const at = (age: number) => result.yearlyResults.find((y) => y.age === age);

  const summary = {
    input: INPUT,
    // 파이프라인이 실제로 무엇을 정했는지. Priority 1·2·5의 판별자가 전부 여기 있다.
    resolved: {
      spendingStrategy: params.spendingStrategy,
      targetMonthlySpending: params.userProfile.targetMonthlySpending,
      targetBequest: params.userProfile.targetBequest,
      assetFloor: params.assetFloor,
      inflationMode: params.inflationMode,
      inflationRate: params.inflationRate,
      retirementGoals: params.retirementGoals,
      withdrawalPlan: params.withdrawalPlan,
      strategy: params.strategy,
      limitPrivatePensionToTaxLimit: params.taxSettings?.limitPrivatePensionToTaxLimit,
      reinvestDividend: params.assets.map((a) => ({ id: a.id, reinvest: a.reinvestDividend })),
    },
    sentinelsApplied: sentinels.appliedFields,
    sentinelValues: sentinels.appliedValues,
    recommendationError,
    goalConditions: resolveGoalSuccessConditions(params),
    deterministic: {
      depletionAge: result.depletionAge,
      endingAssets: result.endingAssets,
      calculatedTargetSpending: result.calculatedTargetSpending,
      retirementScore: result.retirementScore,
      goalAchievementRate: result.goalAchievementRate,
      totalAssetsByAge: Object.fromEntries(
        [60, 65, 70, 75, 80, 85, 90].map((age) => [age, at(age)?.totalAssets ?? null])
      ),
    },
    planOutcome: outcome,
    shortfall,
    // 60~64세 국민연금 공백 구간(지시문 §7).
    pensionGapYears: result.yearlyResults
      .filter((y) => y.age >= 60 && y.age <= 64)
      .map((y) => ({
        age: y.age,
        targetMonthly: Math.round(y.targetSpending / 12 / 만),
        actualMonthly: Math.round(y.spending / 12 / 만),
        unmetMonthly: Math.round(y.unmetSpending / 12 / 만),
        nationalMonthly: Math.round(y.nationalPensionIncome / 12 / 만),
        privateMonthly: Math.round(y.privatePensionIncome / 12 / 만),
        dividendMonthly: Math.round(y.dividendIncome / 12 / 만),
        generalWithdrawal: Math.round(y.generalAssetWithdrawal / 만),
        isaWithdrawal: Math.round(y.isaWithdrawal / 만),
        liquidRemaining: Math.round(
          (y.stockAssets + y.pensionAssets + y.isaAssets + y.cashAssets) / 만
        ),
      })),
    // 65~70세(지시문 §8).
    postPensionYears: result.yearlyResults
      .filter((y) => y.age >= 65 && y.age <= 70)
      .map((y) => ({
        age: y.age,
        targetMonthly: Math.round(y.targetSpending / 12 / 만),
        actualMonthly: Math.round(y.spending / 12 / 만),
        unmetMonthly: Math.round(y.unmetSpending / 12 / 만),
        nationalMonthly: Math.round(y.nationalPensionIncome / 12 / 만),
        privateMonthly: Math.round(y.privatePensionIncome / 12 / 만),
        dividendMonthly: Math.round(y.dividendIncome / 12 / 만),
        endingAssets: Math.round(y.totalAssets / 만),
      })),
    // 「자산 있는데 부족」이 실제로 일어난 해 전부(지시문 §9·§27).
    shortfallWithAssetsRemaining: ledgerRows
      .filter((r) => r.shortfallWithAssetsRemaining)
      .map((r) => ({
        age: r.age,
        unmet: Math.round(r.unmetSpending / 만),
        stock: Math.round(r.stockAssets / 만),
        pension: Math.round(r.pensionAssets / 만),
        isa: Math.round(r.isaAssets / 만),
        cash: Math.round(r.cashAssets / 만),
      })),
    ledgerViolations: ledgerRows
      .filter((r) => r.difference !== undefined && r.tolerance !== undefined
        && Math.abs(r.difference) > r.tolerance)
      .map((r) => ({ age: r.age, difference: r.difference, tolerance: r.tolerance })),
    monteCarlo: mcOut,
  };
  writeOut('summary.json', JSON.stringify(summary, null, 2));

  // 콘솔에도 핵심만 찍는다 — 파일을 열기 전에 판정이 되는 것들.
  /* eslint-disable no-console */
  console.log('\n===== 진단 요약 =====');
  console.log('spendingStrategy      :', params.spendingStrategy);
  console.log('targetMonthlySpending :', params.userProfile.targetMonthlySpending);
  console.log('targetBequest         :', params.userProfile.targetBequest);
  console.log('assetFloor            :', params.assetFloor);
  console.log('goalConditions        :', JSON.stringify(summary.goalConditions));
  console.log('depletionAge          :', result.depletionAge);
  console.log('endingAssets          :', Math.round(result.endingAssets));
  console.log('sustainable(월)       :', Math.round((result.calculatedTargetSpending ?? 0) / 만), '만원');
  console.log('--- Monte Carlo ---');
  console.log('trials/seed/sigma     :', mcConfig.trials, mcConfig.seed, mcConfig.annualStdDev);
  console.log('reproducible          :', mcOut.reproducible);
  console.log('자산 생존률           :', (mc.successRate * 100).toFixed(1) + '%');
  console.log('생활 유지률           :', (mc.spendingSuccessRate * 100).toFixed(1) + '%');
  console.log('목표 달성률           :', (mc.goalSuccessProbability * 100).toFixed(1) + '%');
  console.log('고갈 횟수             :', mc.depletion.count, '/', mc.trials,
    '→ 자산생존', (mcOut.assetSurvivalFromDepletionCount * 100).toFixed(1) + '%',
    '(일치:', mcOut.assetSurvivalMatchesDepletionCount, ')');
  console.log('goalFailure           :', JSON.stringify(mc.goalFailure));
  console.log('--- 자산 있는데 생활비 부족한 해 ---');
  console.log(summary.shortfallWithAssetsRemaining.length, '개년');
  console.log('--- 원장 항등식 위반 ---');
  console.log(summary.ledgerViolations.length, '개년');
  console.log('\n출력:', OUT_DIR);
  /* eslint-enable no-console */
});
