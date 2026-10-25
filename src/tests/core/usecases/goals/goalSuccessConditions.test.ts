import { describe, test, expect } from 'vitest';
import {
  isQuantitativelyJudgedGoal,
  resolveGoalSuccessConditions,
  resolveHardViolations,
} from '@/core/usecases/goals/goalSuccessConditions';
import { RETIREMENT_GOAL_TYPES, type RetirementGoal } from '@/core/entities/retirementGoal';
import type { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1_000_000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const withGoals = (goals: RetirementGoal[], overrides: Partial<SimulationParams> = {}): SimulationParams => ({
  ...baseParams,
  ...overrides,
  retirementGoals: goals,
});

describe('resolveGoalSuccessConditions', () => {
  describe('레거시 시나리오 (목표 화면을 거친 적 없음)', () => {
    test('목표 도입 이전과 같은 세 조건을 그대로 쓴다', () => {
      const conditions = resolveGoalSuccessConditions({
        ...baseParams,
        userProfile: { ...baseParams.userProfile, targetBequest: 84_000_000 },
      });

      expect(conditions.basis).toBe('legacy_plan');
      expect(conditions.requireSpendingTarget).toBe(true);
      expect(conditions.requireAssetSurvival).toBe(true);
      expect(conditions.terminalAssetGoal).toBe(84_000_000);
    });

    test('targetBequest가 없으면 assetFloor를 기말자산 조건으로 쓴다', () => {
      const conditions = resolveGoalSuccessConditions({ ...baseParams, assetFloor: 50_000_000 });

      expect(conditions.terminalAssetGoal).toBe(50_000_000);
    });
  });

  describe('목표 기반 시나리오', () => {
    test('고르지 않은 상속 목표액은 조건이 되지 않는다', () => {
      // 구 UI에서 넣어 둔 상속 목표액(또는 기본 전략이 실체화한 24개월치)이 남아 있어도,
      // 목표 화면에서 상속을 고르지 않았으면 확률을 깎아서는 안 된다.
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT', targetValue: 3_500_000, targetValueSource: 'user' }],
        { userProfile: { ...baseParams.userProfile, targetBequest: 3_000_000_000 } },
      ));

      expect(conditions.basis).toBe('selected_goals');
      expect(conditions.terminalAssetGoal).toBe(0);
      expect(conditions.requireSpendingTarget).toBe(true);
    });

    test('고르지 않은 조건은 판정하지 않는다', () => {
      // 생활비만 골랐으면 고갈 조건은 이 확률이 묻는 것이 아니다.
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' }],
      ));

      expect(conditions.requireAssetSurvival).toBe(false);
    });

    test('자산 고갈 방지를 고르면 고갈 조건이 켜진다', () => {
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' }],
      ));

      expect(conditions.requireAssetSurvival).toBe(true);
      expect(conditions.requireSpendingTarget).toBe(false);
    });

    test('상속 목표를 고르면 그 목표액이 기말자산 조건이 된다', () => {
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'INHERITANCE', priority: 1, constraintType: 'SOFT', targetValue: 500_000_000, targetValueSource: 'user' }],
      ));

      expect(conditions.terminalAssetGoal).toBe(500_000_000);
    });

    test('상속 목표에 금액이 없으면 계획이 실체화한 targetBequest를 쓴다', () => {
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'INHERITANCE', priority: 1, constraintType: 'SOFT' }],
        { userProfile: { ...baseParams.userProfile, targetBequest: 84_000_000 } },
      ));

      expect(conditions.terminalAssetGoal).toBe(84_000_000);
    });

    test('판정할 수 없는 목표는 조건이 아니라 미반영 목록으로 남는다', () => {
      const conditions = resolveGoalSuccessConditions(withGoals([
        { type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' },
        { type: 'TAX_OPTIMIZATION', priority: 2, constraintType: 'SOFT' },
        { type: 'PENSION_OPTIMIZATION', priority: 3, constraintType: 'HARD' },
      ]));

      expect(conditions.unmeasuredGoals).toEqual(['TAX_OPTIMIZATION', 'PENSION_OPTIMIZATION']);
    });

    test('판정 가능한 목표가 하나도 없으면 계획의 기본 조건으로 되돌아간다', () => {
      // 판정할 목표가 없다고 100%를 주면, 세금 목표만 고른 사용자에게 "완벽한 계획"이라고
      // 말하게 된다. 기말자산 조건은 넣지 않는다 — 요구한 적 없는 금액이기 때문이다.
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'TAX_OPTIMIZATION', priority: 1, constraintType: 'SOFT' }],
        { userProfile: { ...baseParams.userProfile, targetBequest: 3_000_000_000 } },
      ));

      expect(conditions.basis).toBe('plan_defaults');
      expect(conditions.requireSpendingTarget).toBe(true);
      expect(conditions.requireAssetSurvival).toBe(true);
      expect(conditions.terminalAssetGoal).toBe(0);
      expect(conditions.unmeasuredGoals).toEqual(['TAX_OPTIMIZATION']);
    });

    test('판정 가능한 목표를 골라도 활성 조건이 없으면 계획의 기본 조건으로 되돌아간다', () => {
      // 「자산 성장」은 판정 가능한 유형이지만 목표액을 묻는 UI가 없어(goalCatalog에 target이
      // 없다) 단독으로 고르면 세 조건이 «모두» 빈다. 유형만 보는 가드는 이것을 통과시켜,
      // 62세에 자산이 바닥나는 계획에도 언제나 100%를 준다.
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'ASSET_GROWTH', priority: 1, constraintType: 'SOFT' }],
      ));

      expect(conditions.basis).toBe('plan_defaults');
      expect(conditions.requireSpendingTarget).toBe(true);
      expect(conditions.requireAssetSurvival).toBe(true);
      expect(conditions.terminalAssetGoal).toBe(0);
      // 「자산 성장」은 조건이 비었을 뿐 판정 대상 «유형»이다. 미반영 목록은 유형 기준
      // 그대로라 여기 들어가지 않는다 — 두 필드가 답하는 질문이 다르다.
      expect(conditions.unmeasuredGoals).toEqual([]);
    });

    test('자산 성장이라도 목표액이 살아 있으면 고른 목표 기준을 유지한다', () => {
      // 구멍만 막는다. 조건이 «하나라도» 나오는 정상 경로는 건드리지 않는다.
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'ASSET_GROWTH', priority: 1, constraintType: 'SOFT', targetValue: 500_000_000, targetValueSource: 'user' }],
      ));

      expect(conditions.basis).toBe('selected_goals');
      expect(conditions.terminalAssetGoal).toBe(500_000_000);
      expect(conditions.requireAssetSurvival).toBe(false);
    });

    test('빠른 은퇴는 계획에 이미 반영되므로 미반영 목록에 넣지 않는다', () => {
      // 목표 은퇴 나이는 applyRetirementGoals가 userProfile.retirementAge로 옮겨 모든 시행이
      // 그 나이에 은퇴한다. 미반영이라고 말하면 반영된 목표를 반영되지 않았다고 하는 셈이다.
      const conditions = resolveGoalSuccessConditions(withGoals([
        { type: 'EARLY_RETIREMENT', priority: 1, constraintType: 'HARD', targetValue: 60 },
        { type: 'ASSET_SURVIVAL', priority: 2, constraintType: 'HARD' },
      ]));

      expect(conditions.unmeasuredGoals).toEqual([]);
    });

    test('목표를 모두 해제하면 기본 조건으로 판정한다', () => {
      const conditions = resolveGoalSuccessConditions(withGoals([]));

      expect(conditions.basis).toBe('plan_defaults');
      expect(conditions.terminalAssetGoal).toBe(0);
    });
  });
});

// hardRequirements는 세 조건 중 어느 것이 «확정된 HARD 목표»에서 왔는지 가른다. Task 2의
// HARD 성공률이 이 축을 읽으므로, legacy_plan·plan_defaults처럼 조건이 목표에서 온 것이
// 아닌 갈래에서 true를 주면 「사용자가 못박은 적 없는 조건」을 요구라고 거짓 보고하게 된다.
describe('resolveGoalSuccessConditions — hardRequirements', () => {
  test('레거시 시나리오(목표 배열 없음)는 HARD 요구가 하나도 없다', () => {
    const conditions = resolveGoalSuccessConditions({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, targetBequest: 84_000_000 },
    });

    expect(conditions.basis).toBe('legacy_plan');
    expect(conditions.hardRequirements).toEqual({
      spendingTarget: false, assetSurvival: false, terminalAsset: false,
    });
  });

  test('활성 조건이 없어 계획 기본값으로 떨어지면 HARD 요구가 없다', () => {
    // TAX_OPTIMIZATION을 HARD로 골라도 판정 가능한 유형이 아니라 plan_defaults로 떨어진다.
    // 여기서 true를 주면 사용자가 못박은 적 없는 생활비·고갈 조건을 요구로 보고하게 된다.
    const conditions = resolveGoalSuccessConditions(withGoals(
      [{ type: 'TAX_OPTIMIZATION', priority: 1, constraintType: 'HARD' }],
    ));

    expect(conditions.basis).toBe('plan_defaults');
    expect(conditions.hardRequirements).toEqual({
      spendingTarget: false, assetSurvival: false, terminalAsset: false,
    });
  });

  test('HARD로 고른 판정 가능 목표만 해당 축을 켠다', () => {
    const conditions = resolveGoalSuccessConditions(withGoals([
      { type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' },
      { type: 'LIVING_EXPENSE_STABILITY', priority: 2, constraintType: 'SOFT' },
    ]));

    expect(conditions.basis).toBe('selected_goals');
    expect(conditions.hardRequirements).toEqual({
      spendingTarget: false, assetSurvival: true, terminalAsset: false,
    });
  });

  test('SOFT로 고른 목표는 조건은 켜져도 HARD 요구로 세지 않는다', () => {
    const conditions = resolveGoalSuccessConditions(withGoals(
      [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' }],
    ));

    expect(conditions.basis).toBe('selected_goals');
    expect(conditions.requireSpendingTarget).toBe(true);
    expect(conditions.hardRequirements.spendingTarget).toBe(false);
  });

  test('확정된 HARD 상속 목표금액은 기말자산 축을 켠다', () => {
    const conditions = resolveGoalSuccessConditions(withGoals(
      [{ type: 'INHERITANCE', priority: 1, constraintType: 'HARD', targetValue: 500_000_000, targetValueSource: 'user' }],
    ));

    expect(conditions.basis).toBe('selected_goals');
    expect(conditions.terminalAssetGoal).toBe(500_000_000);
    expect(conditions.hardRequirements).toEqual({
      spendingTarget: false, assetSurvival: false, terminalAsset: true,
    });
  });

  test('확정되지 않은 목표금액(씨앗)을 가진 HARD 목표는 기말자산 요구로 세지 않는다', () => {
    // targetValueSource가 없는 목표금액은 화면이 깔아 준 씨앗이라 hardGoalAwaitsTargetConfirmation이
    // 참이다. terminalAssetGoal 자체는 계획이 실체화한 targetBequest로 양수가 되어
    // selected_goals로 빠지지만, 그 값은 이 HARD 목표가 확정한 값이 아니므로 요구는 false여야
    // 한다. terminalAssetGoalOf도 confirmedTargetValue로 같은 게이트를 쓰므로(값 자체는 씨앗을
    // 채택하지 않고 targetBequest로 대체됨), 여기서 다른 술어를 쓰면 두 곳이 갈라진다.
    const conditions = resolveGoalSuccessConditions(withGoals(
      [{ type: 'INHERITANCE', priority: 1, constraintType: 'HARD', targetValue: 500_000_000 }],
      { userProfile: { ...baseParams.userProfile, targetBequest: 84_000_000 } },
    ));

    expect(conditions.basis).toBe('selected_goals');
    expect(conditions.terminalAssetGoal).toBe(84_000_000);
    expect(conditions.hardRequirements.terminalAsset).toBe(false);
  });

  test('SOFT 상속이 확정한 금액을, 목표액 없는 HARD 자산성장 목표가 가로채지 않는다', () => {
    // ASSET_GROWTH의 목표액은 선택 입력이라 비워 둘 수 있고, 비면 targetValue가 undefined다.
    // isSuggestedTargetValue는 targetValue!==undefined를 요구하므로 그 상태에서는 false이고,
    // hardGoalAwaitsTargetConfirmation도 false다 — 「확정을 기다리는 씨앗이 없다」가
    // 「이미 확정했다」로 잘못 읽히면, 목표액을 실제로 확정한 것은 SOFT 상속인데도
    // terminalAsset이 true가 된다. 그 금액을 «가져온» 목표가 HARD인지를 봐야 한다.
    const conditions = resolveGoalSuccessConditions(withGoals([
      { type: 'INHERITANCE', priority: 1, constraintType: 'SOFT', targetValue: 500_000_000, targetValueSource: 'user' },
      { type: 'ASSET_GROWTH', priority: 2, constraintType: 'HARD' },
    ]));

    expect(conditions.basis).toBe('selected_goals');
    // 조건 자체는 살아 있다 — SOFT 상속이 여전히 기말자산 조건을 만든다.
    expect(conditions.terminalAssetGoal).toBe(500_000_000);
    // 그러나 그 금액을 확정한 목표는 SOFT다. HARD 요구로 세면 사용자가 못박은 적 없는
    // 것을 못박았다고 말하는 셈이다.
    expect(conditions.hardRequirements.terminalAsset).toBe(false);
  });

  test('기말자산 조건이 목표가 아니라 targetBequest 폴백에서 나오면 HARD 요구가 아니다', () => {
    // 목표금액을 아예 입력하지 않은(씨앗도 없는) 상속 목표라 confirmedTargetValue가
    // undefined를 돌려주고, terminalAssetGoal은 계획이 실체화한 targetBequest로 채워진다.
    // isSuggestedTargetValue는 targetValue가 있을 때만 참이므로, targetValue가 아예 없는 이
    // 목표는 hardGoalAwaitsTargetConfirmation도 거짓이다 — 「확정을 기다리는 씨앗이 없다」가
    // 「이 목표가 값을 확정했다」로 잘못 읽히면, targetBequest 폴백값을 이 HARD 목표가
    // 확정한 것처럼 보고하게 된다. 값을 만든 것은 어떤 목표도 아니므로 terminalAsset은
    // false여야 한다.
    const conditions = resolveGoalSuccessConditions(withGoals(
      [{ type: 'INHERITANCE', priority: 1, constraintType: 'HARD' }],
      { userProfile: { ...baseParams.userProfile, targetBequest: 84_000_000 } },
    ));

    expect(conditions.basis).toBe('selected_goals');
    expect(conditions.terminalAssetGoal).toBe(84_000_000);
    expect(conditions.hardRequirements.terminalAsset).toBe(false);
  });
});

// 기말자산 문턱이 답해야 하는 질문은 둘이고, 대상 목표가 다르다.
//
//   목표 달성 확률  「고른 목표를 다 채웠는가」 — 확정된 자산 목표 전부(HARD·SOFT)
//   HARD 판정 확률  「못박은 조건을 지켰는가」 — 확정 HARD 자산 목표만
//
// 한때 한 숫자가 둘 다에 쓰였고 「그 값을 준 목표 하나」에만 HARD를 귀속시켰다. 아래 셋은
// 그 설계가 실제로 틀리게 답하던 경우들이다.
describe('resolveGoalSuccessConditions — 기말자산 HARD 문턱', () => {
  const confirmed = (
    type: RetirementGoal['type'],
    constraintType: RetirementGoal['constraintType'],
    targetValue: number,
    priority: number,
  ): RetirementGoal => ({ type, priority, constraintType, targetValue, targetValueSource: 'user' });

  const endingAssets = (value: number) =>
    ({ depletionAge: null, endingAssets: value, hasSpendingShortfall: false });

  // **이 파일이 지키는 가장 중요한 사실.** 예전에는 SOFT 5억이 최댓값이라 출처가 SOFT가
  // 되고, 그 결과 HARD 축이 꺼져 3억을 «명백히» 어긴 시행이 「HARD 위반 없음」으로 집계됐다.
  // 사용자가 못박은 조건을 어긴 계획이 HARD 성공으로 세어지는 상태였다.
  test('SOFT 목표액이 더 커도 확정 HARD 하한을 어기면 위반으로 잡는다', () => {
    const conditions = resolveGoalSuccessConditions(withGoals([
      confirmed('INHERITANCE', 'HARD', 300_000_000, 1),
      confirmed('ASSET_GROWTH', 'SOFT', 500_000_000, 2),
    ]));

    expect(conditions.terminalAssetGoal).toBe(500_000_000);
    expect(conditions.hardTerminalAssetGoal).toBe(300_000_000);

    // 2억: HARD 3억 미달 → 위반
    expect(resolveHardViolations(endingAssets(200_000_000), conditions, 90)).toEqual(['terminalAsset']);
    // 4억: HARD 3억은 지켰다 → 위반 아님. SOFT 5억을 놓친 것은 목표 달성 확률의 몫이지
    // HARD 위반이 아니다 — 여기서 잡으면 사용자가 못박지 «않은» 금액을 요구로 보고한다.
    expect(resolveHardViolations(endingAssets(400_000_000), conditions, 90)).toEqual([]);
  });

  // 최댓값 하나가 기여한 HARD 목표 전부를 판정한다(`≥ 5억` ⟹ `≥ 3억`). 그래서 귀속도
  // 전부여야 한다 — 하나만 실으면 나머지는 판정됐는데도 화면이 그 이름을 부르지 못하고
  // resolveSimulationVerdict가 unjudged로 보고한다.
  test('HARD 자산 목표가 둘이면 문턱은 최댓값이고 귀속은 둘 다다', () => {
    const conditions = resolveGoalSuccessConditions(withGoals([
      confirmed('INHERITANCE', 'HARD', 300_000_000, 1),
      confirmed('ASSET_GROWTH', 'HARD', 500_000_000, 2),
    ]));

    expect(conditions.hardTerminalAssetGoal).toBe(500_000_000);
    expect(conditions.hardRequirementGoals.terminalAsset).toEqual(['INHERITANCE', 'ASSET_GROWTH']);
    expect(resolveHardViolations(endingAssets(400_000_000), conditions, 90)).toEqual(['terminalAsset']);
  });

  // 「0원을 남긴다」는 지킬 하한이 아니라 「다 쓰겠다」는 뜻이다(compileStrategy가
  // targetBequest > 0을 target_amount로 읽는 것과 같은 해석). 예전 유도에서는 이 목표가
  // source가 되어 축은 켜지고 문턱은 0인, 절대 실패하지 않는 유령 HARD 축이 생겼다.
  test('0원을 확정한 HARD 목표는 축을 세우지 않는다', () => {
    const conditions = resolveGoalSuccessConditions(withGoals([
      confirmed('INHERITANCE', 'HARD', 0, 1),
      { type: 'ASSET_SURVIVAL', priority: 2, constraintType: 'HARD' },
    ]));

    expect(conditions.hardTerminalAssetGoal).toBe(0);
    expect(conditions.hardRequirements.terminalAsset).toBe(false);
    expect(conditions.hardRequirementGoals.terminalAsset).toEqual([]);
  });

  // 셋이 한 헬퍼에서 나오므로 어긋날 수 없다. 「축은 켜져 있는데 문턱이 0」이나 「문턱은
  // 섰는데 귀속 목표가 없다」는 상태에서는 화면이 위반을 설명할 이름을 갖지 못한다.
  // 조합을 순회해 그 불변식을 고정한다.
  test('문턱·축·귀속 목록은 서로 어긋날 수 없다', () => {
    const cases: RetirementGoal[][] = [
      [],
      [confirmed('INHERITANCE', 'HARD', 300_000_000, 1)],
      [confirmed('INHERITANCE', 'SOFT', 300_000_000, 1)],
      [confirmed('INHERITANCE', 'HARD', 0, 1)],
      [{ type: 'ASSET_GROWTH', priority: 1, constraintType: 'HARD' }],
      [confirmed('INHERITANCE', 'HARD', 300_000_000, 1), confirmed('ASSET_GROWTH', 'SOFT', 500_000_000, 2)],
      [confirmed('INHERITANCE', 'SOFT', 300_000_000, 1), confirmed('ASSET_GROWTH', 'HARD', 500_000_000, 2)],
      [confirmed('INHERITANCE', 'HARD', 300_000_000, 1), confirmed('ASSET_GROWTH', 'HARD', 500_000_000, 2)],
      // 씨앗(확정 표시 없음)은 어느 쪽에도 기여하지 않는다.
      [{ type: 'INHERITANCE', priority: 1, constraintType: 'HARD', targetValue: 300_000_000 }],
    ];

    for (const goals of cases) {
      const label = JSON.stringify(goals);
      const c = resolveGoalSuccessConditions(withGoals(goals));

      expect(c.hardRequirements.terminalAsset, label).toBe(c.hardTerminalAssetGoal > 0);
      expect(c.hardRequirementGoals.terminalAsset.length > 0, label)
        .toBe(c.hardTerminalAssetGoal > 0);
      // HARD 하한은 「고른 목표를 다 채웠는가」의 문턱을 넘어설 수 없다 — HARD 목표는 그
      // 전체 집합의 부분집합이므로 최댓값도 작거나 같다. 이 부등식이 깨지면 HARD 판정이
      // 목표 달성보다 «엄격해져», 목표는 못 채웠는데 HARD는 지켰다는 관계가 뒤집힌다
      // (describeHardGoalRelationship이 인쇄하는 그 관계다).
      expect(c.hardTerminalAssetGoal, label).toBeLessThanOrEqual(c.terminalAssetGoal);
    }
  });
});

// 화면이 「정량 판정 대상 아님」을 어디에 붙일지 이 술어 하나로 정한다. 술어가 위 함수와
// 다른 답을 하기 시작하면 화면은 «엔진이 판정하는» 목표에 판정하지 않는다고 적게 된다.
describe('isQuantitativelyJudgedGoal', () => {
  test('모든 목표 유형에서 미반영 판정과 정확히 반대다', () => {
    for (const type of RETIREMENT_GOAL_TYPES) {
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type, priority: 1, constraintType: 'SOFT' }],
      ));

      expect(conditions.unmeasuredGoals.includes(type), type).toBe(!isQuantitativelyJudgedGoal(type));
    }
  });
});
