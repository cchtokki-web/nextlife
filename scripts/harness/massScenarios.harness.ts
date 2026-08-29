// 대량 시나리오 실행기. `npm run harness:mass`(또는 샤딩 스크립트)로만 돈다.
//
// **회귀 테스트가 아니다.** 단언하지 않고 지표를 JSONL로 남긴다. 집계·보고서는
// massScenariosReport.harness.ts가 그 JSONL을 읽어 만든다 — 실행을 여러 프로세스로 쪼개도
// 집계가 한 곳에 남게 하기 위해서다.
//
// **화면과 «같은 순서»로 계산한다.** 여기가 이 하니스의 핵심이고, personas.harness.ts와
// 다른 점이다. 그쪽은 compiled를 그대로 엔진에 넣지만 실제 화면은 센티널 자동 채움을 거친
// effective로 돈다(useStrategyPipeline). 그리고 오늘 제품의 추천 카드(안정형·균형형·여유형)는
// recommendStrategy가 아니라 StrategyOptimizer가 만든다(strategyOptimization.worker.ts).
// 두 경로를 모두 태워야 「사용자가 실제로 본 화면」의 숫자가 된다.
//
//   params ─ compileStrategy ─→ compiled
//            └ LegacyRecommendationEngine → recommendation(개선 카드)
//              └ applyAiSentinels → effective
//                 ├ simulateLegacyConfig → 현재 계획 결정론 결과
//                 ├ runMonteCarlo        → 현재 계획 목표 달성 확률
//                 └ StrategyOptimizer    → 안정형·균형형·여유형 추천
import { test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { SimulationParams, SimulationResult } from '@/core/entities/types';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { LegacyRecommendationEngine } from '@/core/recommendation/LegacyRecommendationEngine';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { simulateLegacyConfig } from '@/core/application/simulateLegacyConfig';
import { MonteCarloEngine, runMonteCarlo } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '@/core/usecases/montecarlo/volatilityPresets';
import { StrategyOptimizer } from '@/core/strategy/StrategyOptimizer';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { improvesOnCurrentPlan } from '@/core/recommendation/RecommendationEngine';
import { migrateRetirementGoals } from '@/core/usecases/goals/retirementGoalAdapter';
import { buildMassScenarios } from './massScenarios';

const OUT_DIR = process.env.HARNESS_OUT ?? path.join(process.cwd(), 'scripts/harness/out/mass');
const SHARD_INDEX = Number(process.env.SHARD_INDEX ?? 0);
const SHARD_COUNT = Number(process.env.SHARD_COUNT ?? 1);
const SCENARIO_COUNT = Number(process.env.SCENARIO_COUNT ?? 1000);

const sumBy = (r: SimulationResult, pick: (y: SimulationResult['yearlyResults'][number]) => number) =>
  r.yearlyResults.reduce((s, y) => s + pick(y), 0);

const totalTax = (r: SimulationResult) => sumBy(r, (y) =>
  y.dividendTaxPaid + y.pensionTaxPaid + y.nationalPensionTaxPaid
  + y.comprehensiveTaxPaid + y.capitalGainsTaxPaid);

function initialAssetKRW(p: SimulationParams): number {
  let v = 0;
  for (const a of p.assets) v += a.quantity * a.averagePrice * (a.currency === 'USD' ? p.baseExchangeRate : 1);
  for (const q of p.privatePensions) v += q.balance;
  for (const i of p.isaAccounts ?? []) v += i.balance;
  return v;
}

test('대량 시나리오 하니스', { timeout: 7_200_000 }, () => {
  const engine = new LegacySimulationEngine();
  const legacyRecommender = new LegacyRecommendationEngine(engine);
  const optimizer = new StrategyOptimizer(engine, undefined, undefined, new MonteCarloEngine(engine));

  const all = buildMassScenarios(SCENARIO_COUNT);

  // **도달 가능성 자가 점검**(AGENTS.md 1~3단계). 생성한 params가 저장·로드 왕복을 지나며
  // 바뀐다면 그 시나리오는 「사용자가 만들 수 있는 상태」가 아니고, 그 위에서 잰 숫자는
  // 제품 이야기가 아니다. 결과를 내기 «전»에 막는다 — 보고서가 나온 뒤에 알면 늦다.
  const drifted = all.filter((s) =>
    JSON.stringify(migrateRetirementGoals(JSON.parse(JSON.stringify(s.params)))) !== JSON.stringify(s.params));
  if (drifted.length > 0) {
    throw new Error(`저장·로드 왕복에서 값이 바뀌는 시나리오 ${drifted.length}건 (예: no=${drifted[0].no}) — 도달 가능한 입력이 아니다`);
  }

  const mine = all.filter((_, i) => i % SHARD_COUNT === SHARD_INDEX);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `shard-${SHARD_INDEX}.jsonl`);
  const lines: string[] = [];

  const started = Date.now();
  for (const scenario of mine) {
    const { no, meta, params } = scenario;
    const row: Record<string, unknown> = {
      no,
      ...meta,
      goalTypes: meta.goalTypes.join('|'),
      hardGoalTypes: meta.hardGoalTypes.join('|'),
      confirmedGoalTypes: meta.confirmedGoalTypes.join('|'),
      goalCount: meta.goalTypes.length,
      hardGoalCount: meta.hardGoalTypes.length,
      // 목표가 정한 «계획의» 축. 씨앗과 다를 수 있고, 그 차이 자체가 관찰 대상이다.
      planRetirementAge: params.userProfile.retirementAge,
      planMonthlySpending: params.userProfile.targetMonthlySpending,
      planTargetBequest: params.userProfile.targetBequest ?? '',
      initialAssetsResolved: Math.round(initialAssetKRW(params)),
      assetCount: params.assets.length,
    };

    try {
      const compiled = compileStrategy(params);

      let recommendation;
      let legacyRecFailed = 0;
      try {
        recommendation = legacyRecommender.recommendLegacyConfig(compiled.params, compiled.utilityConfig);
      } catch {
        legacyRecFailed = 1;
      }
      const sentinels = applyAiSentinels(compiled, recommendation);
      const effective = sentinels.compiled;

      const result = simulateLegacyConfig(engine, effective.params, effective.utilityConfig);
      const mcConfig = resolveMonteCarloConfig(effective.params);
      const mc = runMonteCarlo(effective.params, engine, mcConfig);
      // 화면이 「목표 달성 확률」로 읽는 바로 그 값(DashboardSection.currentGoalProbability).
      const currentGoalProbability = mc.simulationSuccessRate ?? mc.goalSuccessProbability;

      const input = LegacySimulationAdapter.fromLegacy(effective.params);
      const optimization = optimizer.optimize(input.profile, input.goals, input.strategy, {
        monteCarlo: { config: mcConfig, finalistLimit: 3 },
      });

      const finals = optimization.recommendations.recommendations;
      const primary = optimization.recommendations.primary;
      const improving = finals.filter((item) => improvesOnCurrentPlan(item.candidate, currentGoalProbability));

      Object.assign(row, {
        ok: 1,
        // ── 현재 계획(결정론) ──
        score: result.retirementScore,
        grade: result.retirementGrade,
        goalRate: result.goalAchievementRate,
        depletionAge: result.depletionAge ?? '',
        endingAssets: Math.round(result.endingAssets),
        unmetTotal: Math.round(sumBy(result, (y) => y.unmetSpending)),
        totalTax: Math.round(totalTax(result)),
        totalHealthIns: Math.round(sumBy(result, (y) => y.healthInsurancePaid)),
        utility: result.utility?.score ?? '',
        fireAge: result.fireAge ?? '',
        // ── 현재 계획(Monte Carlo) ──
        mcStdDev: mcConfig.annualStdDev,
        mcAssetSurvival: +(mc.successRate * 100).toFixed(1),
        mcSpendingSuccess: +(mc.spendingSuccessRate * 100).toFixed(1),
        mcGoalProbability: +(currentGoalProbability * 100).toFixed(1),
        mcSpendFulfillment: mc.averageSpendingFulfillmentRate !== undefined
          ? +(mc.averageSpendingFulfillmentRate * 100).toFixed(1) : '',
        mcP10: Math.round(mc.endingAssets.p10),
        mcP50: Math.round(mc.endingAssets.p50),
        mcDepletionMedian: mc.depletion.medianAge ?? '',
        goalFailSpending: mc.goalFailure.spendingShortfall,
        goalFailDepletion: mc.goalFailure.assetDepletion,
        goalFailTerminal: mc.goalFailure.terminalShortfall,
        observedDepletionTrials: mc.goalFailure.observedAssetDepletionCount,
        medianFirstShortfallAge: mc.goalFailure.medianFirstShortfallAge ?? '',
        condSpending: mc.goalConditions.requireSpendingTarget ? 1 : 0,
        condSurvival: mc.goalConditions.requireAssetSurvival ? 1 : 0,
        condTerminal: Math.round(mc.goalConditions.terminalAssetGoal),
        condBasis: mc.goalConditions.basis,
        unmeasuredGoals: (mc.goalConditions.unmeasuredGoals ?? []).join('|'),
        // ── 센티널 자동 채움 ──
        sentinelFields: sentinels.appliedFields.join('|'),
        sentinelCount: sentinels.appliedFields.length,
        // ── 개선 카드(구 추천) ──
        legacyRecFailed,
        legacyImproved: recommendation?.improved ? 1 : 0,
        legacyCandidates: recommendation?.totalCandidateCount ?? 0,
        legacyFailedCandidates: recommendation?.failedCandidateCount ?? 0,
        // ── 목표 기반 추천(안정형·균형형·여유형) ──
        outcome: optimization.outcome.kind,
        generated: optimization.debug.generatedCandidateCount,
        hardRejected: optimization.debug.hardConstraintRejectedCount,
        simulated: optimization.debug.simulatedCandidateCount,
        postRejected: optimization.debug.postSimulationRejectedCount,
        optFailed: optimization.debug.failedCandidateCount,
        accepted: optimization.debug.acceptedCandidateCount,
        shortlisted: optimization.debug.deterministicShortlistCount,
        mcValidated: optimization.debug.monteCarloValidatedCount,
        mcConfirmed: optimization.debug.monteCarloConfirmedCount,
        rankedCount: optimization.rankedCandidates.length,
        recCount: finals.length,
        recPersonas: finals.map((f) => f.label).join('|'),
        recImprovingCount: improving.length,
        primaryLabel: primary?.label ?? '',
        primaryGoalProbability: primary
          ? +(primary.candidate.monteCarlo.goalSuccessProbability * 100).toFixed(1) : '',
        primaryImproves: primary
          ? (improvesOnCurrentPlan(primary.candidate, currentGoalProbability) ? 1 : 0) : '',
        primaryRetirementAge: primary?.candidate.candidate.dimensions.retirementAge ?? '',
        primaryNpStartAge: primary?.candidate.candidate.dimensions.nationalPensionStartAge ?? '',
        primaryPolicy: primary?.candidate.candidate.dimensions.withdrawalPolicy ?? '',
        primarySpendingPattern: primary?.candidate.candidate.dimensions.spendingPattern ?? '',
        unsupportedHardGoals: (optimization.debug.unsupportedHardGoals ?? []).join('|'),
        rejectionReasons: JSON.stringify(optimization.debug.rejectionReasons ?? {}),
        simFailures: optimization.debug.simulationFailures.length,
        mcFailures: optimization.debug.monteCarloFailures.length,
        firstSimFailure: optimization.debug.simulationFailures[0]?.reason ?? '',
      });
    } catch (error) {
      Object.assign(row, {
        ok: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }

    lines.push(JSON.stringify(row));
  }

  fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf-8');
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  fs.writeFileSync(
    path.join(OUT_DIR, `shard-${SHARD_INDEX}.done`),
    `${mine.length} scenarios in ${seconds}s\n`,
    'utf-8',
  );
});
