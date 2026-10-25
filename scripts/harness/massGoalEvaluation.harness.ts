// 목표별 달성 판정 보조 하니스. massScenarios.harness.ts와 «같은 시나리오»에 대해 현재
// 계획의 목표별 평가(GoalEvaluation)만 뽑는다.
//
// **왜 분리했나.** 본 하니스는 시나리오당 2.7초(대부분 Monte Carlo와 후보 탐색)라 축을 하나
// 더 볼 때마다 12분을 다시 쓴다. 목표별 평가는 결정론 시뮬레이션 한 번이면 나오므로
// (시나리오당 30ms) 따로 도는 편이 싸다. 두 출력은 `no`로 이어 붙는다.
//
// 재는 것: 사용자가 고른 목표 하나하나가 «달성으로 판정되는가», 그리고 그 점수가 몇 점인가.
// 화면의 목표 카드와 추천 카드가 그대로 읽는 값이다.
import { test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { LegacyRecommendationEngine } from '@/core/recommendation/LegacyRecommendationEngine';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { DefaultGoalEvaluationEngine } from '@/core/evaluation/GoalEvaluationEngine';
import { buildMassScenarios } from './massScenarios';

const OUT_DIR = process.env.HARNESS_OUT ?? path.join(process.cwd(), 'scripts/harness/out/mass');
const SCENARIO_COUNT = Number(process.env.SCENARIO_COUNT ?? 1000);

test('목표별 판정 하니스', { timeout: 3_600_000 }, () => {
  const engine = new LegacySimulationEngine();
  const legacyRecommender = new LegacyRecommendationEngine(engine);
  const evaluator = new DefaultGoalEvaluationEngine();

  const lines: string[] = [];
  for (const { no, params } of buildMassScenarios(SCENARIO_COUNT)) {
    try {
      // 화면과 같은 effective params로 판정한다. 센티널이 채운 축(국민연금 개시 나이 등)이
      // 결과를 바꾸므로, 채우기 «전»으로 재면 사용자가 본 판정이 아니다.
      const compiled = compileStrategy(params);
      let recommendation;
      try {
        recommendation = legacyRecommender.recommendLegacyConfig(compiled.params, compiled.utilityConfig);
      } catch { /* 개선 카드 실패는 여기서 재는 대상이 아니다 — 센티널만 비게 둔다 */ }
      const effective = applyAiSentinels(compiled, recommendation).compiled;

      const input = LegacySimulationAdapter.fromLegacy(effective.params, effective.utilityConfig);
      const result = engine.simulate(input.profile, input.strategy);
      const evaluation = evaluator.evaluate(input.profile, input.goals, input.strategy, result);

      for (const goal of evaluation.goalEvaluations) {
        lines.push(JSON.stringify({
          no,
          goalType: goal.goalType,
          score: goal.score,
          achieved: goal.achieved ? 1 : 0,
        }));
      }
      lines.push(JSON.stringify({
        no,
        goalType: '__scenario__',
        weightedScore: evaluation.weightedScore,
        hardFailures: evaluation.hardConstraintFailures.map((f) => f.code).join('|'),
        unsupportedHardGoals: (evaluation.unsupportedHardGoals ?? []).join('|'),
        goalConflict: evaluation.goalConflict ? 1 : 0,
        yieldedGoal: evaluation.yieldedGoal ?? '',
      }));
    } catch (error) {
      lines.push(JSON.stringify({
        no, goalType: '__error__',
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'goal-evaluations.jsonl'), lines.join('\n') + '\n', 'utf-8');
});
