import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { RETIREMENT_GOAL_TYPES, type RetirementGoal } from '@/core/entities/retirementGoal';
import type { SimulationParams, SpendingStrategyChoice } from '@/core/entities/types';
import { StrategyGenerator } from '@/core/strategy/StrategyGenerator';
import { migrateRetirementGoals } from '@/core/usecases/goals/retirementGoalAdapter';
import { compileStrategy, resolveStrategy } from '@/core/usecases/strategy/compileStrategy';
import {
  generateSpendingAdjustmentCandidates,
  getIdentityPlan,
} from '@/core/usecases/strategy/StrategyCandidateGenerator';
import { initialParams } from '@/infrastructure/storage/localStore';

/**
 * `max_sustainable`이 오늘 제품에서 «도달 불가»라는 사실을 잠근다(known-issues 13번, 결정 (b)).
 *
 * 그 전략은 엔진에 그대로 남아 있다 — 다시 노출될 때를 위한 안전장치다. 대신 지금은
 * 생성·저장·선택 중 어느 것도 되지 않아야 하고, 그것을 보장하는 잠금이 셋이다
 * (SpendingStrategy 주석에 근거가 모여 있다).
 *
 * **결과가 아니라 «장치»를 고정한다.** 픽스처 하나에서 `spendingChoice === 'target'`이 나오는
 * 것만 확인하면, 누군가 잠금에 「사용자가 골랐으면 존중한다」 같은 조건을 붙여도 그 픽스처는
 * 계속 통과한다. 그래서 아래 테스트는 잠금이 «조건 없이» 걸리는지를 조합으로 훑는다 —
 * 목표를 고른 적 없는 옛 시나리오, 목표를 다섯 개 고른 시나리오, 저수준 필드에만 전략이 남은
 * 시나리오가 전부 같은 답을 내야 한다.
 *
 * 잠금이 풀리는 것은 제품 의사결정이다. 그 결정을 내렸다면 이 파일도 함께 고쳐야 한다 —
 * 조용히 되살아나는 것을 막는 것이 이 파일의 목적이다.
 */

const SPENDING_CHOICES: readonly SpendingStrategyChoice[] = [
  'target', 'dividend_only', 'max_sustainable', 'ai',
];

// 「목표 화면을 거친 적 없음」과 「거쳤음」을 모두 담는다. 앞의 것은 retirementGoals 키 자체가
// 없는 상태이고, 정규화가 예외를 두기 쉬운 자리라 반드시 포함해야 한다.
const GOAL_SETS: ReadonlyArray<{ label: string; goals?: RetirementGoal[] }> = [
  { label: '목표 배열 자체가 없는 옛 시나리오' },
  { label: '목표 화면은 거쳤으나 아무것도 고르지 않음', goals: [] },
  {
    label: '생활비 안정 HARD 하나',
    goals: [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, targetValue: 2_500_000, constraintType: 'HARD' }],
  },
  {
    label: '상속 HARD 하나',
    goals: [{ type: 'INHERITANCE', priority: 1, targetValue: 300_000_000, constraintType: 'HARD' }],
  },
  {
    label: '다섯 개 가득',
    goals: RETIREMENT_GOAL_TYPES.slice(0, 5).map((type, index) => ({
      type, priority: index + 1, constraintType: index % 2 === 0 ? 'HARD' : 'SOFT',
    })),
  },
];

function savedScenario(
  choice: SpendingStrategyChoice,
  goals: RetirementGoal[] | undefined,
  withStrategyObject: boolean,
): SimulationParams {
  const params: SimulationParams = { ...initialParams };
  if (goals !== undefined) params.retirementGoals = goals;
  if (withStrategyObject) {
    params.strategy = { ...resolveStrategy(initialParams), spendingChoice: choice };
  } else {
    // strategy 객체가 없던 옛 시나리오. 전략은 저수준 필드에만 남아 있고 resolveStrategy가
    // 그것을 읽어 올린다 — 정규화가 이 경로를 놓치면 그쪽으로 되살아난다.
    delete params.strategy;
    if (choice !== 'ai') params.spendingStrategy = choice;
  }
  return params;
}

describe('잠금 2 — 저장 시나리오는 max_sustainable을 가질 수 없다', () => {
  // 로드 경로(useScenarios의 migrateParams)가 부르는 것이 migrateRetirementGoals이고,
  // 그 결과가 곧 화면과 계산이 보는 params다.
  for (const { label, goals } of GOAL_SETS) {
    for (const choice of SPENDING_CHOICES) {
      for (const withStrategyObject of [true, false]) {
        const shape = withStrategyObject ? 'strategy 객체' : '저수준 필드';
        test(`${label} + ${choice}(${shape})를 로드하면 target으로 고정된다`, () => {
          const loaded = migrateRetirementGoals(savedScenario(choice, goals, withStrategyObject));

          expect(resolveStrategy(loaded).spendingChoice).toBe('target');
          // 엔진에 실제로 들어가는 값. 사용자 언어(spendingChoice)만 눌러쓰고 저수준 필드가
          // 남으면 계산은 여전히 옛 전략으로 돈다.
          //
          // 미지정을 'target'과 같이 본다. 아무것도 바꾸지 않은 시나리오는 compileStrategy가
          // 입력을 그대로 통과시켜 이 키가 «없는» 상태로 남고, 엔진은 그때 'target'으로 읽는다
          // (SimulationEngine.run의 `params.spendingStrategy || 'target'`).
          expect(compileStrategy(loaded).params.spendingStrategy ?? 'target').toBe('target');
        });
      }
    }
  }

  // 조합을 하나하나 세는 대신, 「어떤 입력에서도 예외가 없다」를 한 줄로 다시 못 박는다.
  // 잠금에 조건이 붙으면 여기서 그 조건이 만든 구멍이 그대로 드러난다.
  test('훑은 조합 전부에서 예외가 하나도 없다', () => {
    const survivors: string[] = [];
    for (const { label, goals } of GOAL_SETS) {
      for (const choice of SPENDING_CHOICES) {
        for (const withStrategyObject of [true, false]) {
          const loaded = migrateRetirementGoals(savedScenario(choice, goals, withStrategyObject));
          if ((compileStrategy(loaded).params.spendingStrategy ?? 'target') !== 'target') {
            survivors.push(`${label}/${choice}/${withStrategyObject ? 'strategy' : 'legacy'}`);
          }
        }
      }
    }

    expect(survivors).toEqual([]);
    // 조합 수가 줄면 훑는 범위가 조용히 좁아진 것이다.
    expect(GOAL_SETS.length * SPENDING_CHOICES.length * 2).toBe(40);
  });

  // 정규화는 멱등이므로, 로드한 시나리오를 다시 저장하고 다시 로드해도 되살아나지 않는다.
  test('로드 → 재저장 → 재로드를 반복해도 되살아나지 않는다', () => {
    let params = savedScenario('max_sustainable', undefined, true);
    for (let i = 0; i < 3; i += 1) {
      params = migrateRetirementGoals(params);
      expect(resolveStrategy(params).spendingChoice).toBe('target');
    }
  });
});

describe('잠금 3 — 추천 후보는 max_sustainable일 수 없다', () => {
  function seedWithMode(mode: 'target' | 'max_sustainable' | 'dividend_only') {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    return {
      input,
      seed: { ...input.strategy, spendingPolicy: { ...input.strategy.spendingPolicy, mode } },
    };
  }

  // 씨앗이 무엇이든 격자 전체가 target이다 — 「씨앗을 따라간다」는 예외가 없다는 뜻이다.
  for (const mode of ['target', 'max_sustainable', 'dividend_only'] as const) {
    test(`씨앗이 ${mode}여도 격자 후보 전부가 target이다`, () => {
      const { input, seed } = seedWithMode(mode);
      const result = new StrategyGenerator().generate(input.profile, input.goals, seed);

      const grid = result.candidates.filter((c) => c.id !== result.debug.baselineCandidateId);
      expect(grid.length).toBeGreaterThan(100);
      expect(new Set(grid.map((c) => c.strategy.spendingPolicy.mode))).toEqual(new Set(['target']));
    });
  }

  // 격자 밖의 「현상 유지」 후보 한 장은 씨앗을 그대로 복사한다. 그것이 예외로 보이지만,
  // 그 씨앗은 사용자의 현재 계획이고 잠금 2가 이미 target으로 만들어 둔 값이다.
  // 이 테스트는 그 «이음매»를 적어 둔다 — 잠금 2가 풀리면 여기가 유일한 통로가 된다.
  test('현상 유지 후보는 씨앗을 복사하므로, 잠금 2가 그 씨앗을 이미 target으로 만든다', () => {
    const { input, seed } = seedWithMode('max_sustainable');
    const result = new StrategyGenerator().generate(input.profile, input.goals, seed);
    const baseline = result.candidates.find((c) => c.id === result.debug.baselineCandidateId);
    expect(baseline?.strategy.spendingPolicy.mode).toBe('max_sustainable');

    // 제품 경로의 씨앗은 로드된 시나리오에서 온다. 거기에는 그 모드가 없다.
    const loaded = migrateRetirementGoals(savedScenario('max_sustainable', [], true));
    const productSeed = LegacySimulationAdapter.fromLegacy(compileStrategy(loaded).params);
    expect(productSeed.strategy.spendingPolicy.mode).toBe('target');
  });

  // 대시보드의 생활비 조정 후보도 같은 답을 낸다 — 목표 금액이 인출을 결정하지 않는 계획에는
  // 배수 자체가 무의미하므로 후보를 하나도 만들지 않는다.
  test('생활비 조정 후보는 target이 아닌 계획에 아무것도 만들지 않는다', () => {
    const plan = getIdentityPlan(initialParams);
    expect(generateSpendingAdjustmentCandidates(
      { ...initialParams, spendingStrategy: 'max_sustainable' },
      plan,
      { allowIncrease: true, allowDecrease: true },
    )).toEqual([]);
  });
});

describe('잠금 1 — 화면에 고르는 자리가 없다', () => {
  // vitest의 루트는 저장소 루트다(vitest.config의 alias '@' → src와 같은 기준).
  const WEB_ROOT = resolve(process.cwd(), 'src/web');

  // 표시 문구는 남아도 된다. 잠기는 것은 «고르는 자리»이므로 파일 단위로만 본다 —
  // 라벨 문구를 다듬는 일로 이 테스트가 깨지면 안 된다.
  const DISPLAY_ONLY_FILES = ['features/Pdf/buildReportHtml.ts'];

  function sourceFiles(dir: string, prefix = ''): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return sourceFiles(full, `${prefix}${name}/`);
      return /\.tsx?$/.test(name) ? [`${prefix}${name}`] : [];
    });
  }

  test('src/web에서 max_sustainable을 언급하는 파일은 표시 코드뿐이다', () => {
    const mentioning = sourceFiles(WEB_ROOT)
      .filter((rel) => readFileSync(join(WEB_ROOT, rel), 'utf-8').includes('max_sustainable'));

    // 새 파일이 이 값을 언급하기 시작했다면 둘 중 하나다 — 고르는 화면이 생겼거나(제품
    // 의사결정이 필요하다), 표시 문구가 늘었거나(이 목록에 더하면 된다).
    expect(mentioning.sort()).toEqual(DISPLAY_ONLY_FILES);
  });
});

// 「지속가능 생활비」라는 «지표»는 이 잠금과 무관하게 살아 있다. 전략을 걷어내는 논의가
// 지표까지 지우면 오늘 제품의 모든 계획에서 그 숫자가 사라진다 — 경계를 여기서 못 박는다.
describe('전략과 지표의 경계', () => {
  test("잠금을 다 지난 'target' 계획에도 지속가능 생활비가 계산된다", async () => {
    const { SimulationEngine } = await import('@/core/usecases/SimulationEngine');
    const loaded = migrateRetirementGoals(savedScenario('max_sustainable', [], true));
    const compiled = compileStrategy(loaded).params;
    expect(compiled.spendingStrategy).toBe('target');

    const result = new SimulationEngine().run(compiled);
    expect(result.calculatedTargetSpending).toBeGreaterThan(0);
  });
});
