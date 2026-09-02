import { describe, expect, test } from 'vitest';
import {
  RETIREMENT_GOAL_TYPES,
  hasMoneyTarget,
  type RetirementGoalType,
} from '@/core/entities/retirementGoal';
import { isQuantitativelyJudgedGoal } from '@/core/usecases/goals/goalSuccessConditions';
import {
  RETIREMENT_GOAL_CATALOG,
  retirementGoalDefinition,
} from '@/web/features/RetirementGoals/goalCatalog';

describe('목표 카탈로그와 도메인의 대응', () => {
  // **known-issues 1번의 재발을 막는 자리.** 화면이 「반드시 지키기」를 열어 주는 근거는
  // 「이 유형을 엔진이 판정하는가」인데, 판정 기준이 금액인 유형에 그 금액을 «넣을 칸»이
  // 없으면 사용자는 영원히 확정할 수 없고 그 HARD는 어떤 축도 켜지 못한다. 즉 화면이
  // 계산이 지키지 않을 조건을 못박게 해 준다.
  //
  // 예전에는 이 구멍을 화면이 런타임에 막았다(「금액을 넣을 칸이 없으면 HARD를 잠근다」).
  // 그 방어는 사용자에게 «고칠 수 없는» 상태를 설명하는 문구까지 달고 있었는데, 정작
  // 필요한 것은 개발자가 카탈로그를 고치는 일이다. 그래서 방어를 여기로 옮겼다 —
  // 다음에 금액형 목표가 하나 늘 때 빌드가 먼저 멈춘다.
  test('금액으로 판정하는 유형은 모두 금액 입력칸을 갖는다', () => {
    const moneyJudged = RETIREMENT_GOAL_TYPES.filter(hasMoneyTarget);
    const moneyAsked = RETIREMENT_GOAL_TYPES.filter(
      (type) => retirementGoalDefinition(type).target?.unit === 'currency');

    // 양방향으로 건다. 한 방향만 걸면 「묻기는 하는데 판정에는 안 쓰는 금액」이 생겨도
    // 통과하고, 그 값은 사용자가 입력한 뒤 아무 데도 닿지 않는다.
    expect(moneyAsked).toEqual([...moneyJudged]);
  });

  // 나이 목표의 금액 취급을 막는다. 단위가 섞이면 표시 계층이 「60」을 60원으로 찍는다
  // (AGENTS.md: 나이와 금액 단위를 혼용하지 않는다).
  test('나이를 묻는 목표는 금액 목표가 아니다', () => {
    const ageAsked = RETIREMENT_GOAL_TYPES.filter(
      (type) => retirementGoalDefinition(type).target?.unit === 'age');

    expect(ageAsked).toEqual(['EARLY_RETIREMENT'] satisfies RetirementGoalType[]);
    expect(ageAsked.some(hasMoneyTarget)).toBe(false);
  });

  // 금액을 «비워 둘 수 있다»고 선언한 목표의 카드는 「비워 두어도 목표는 채점됩니다」라고
  // 말한다. 그 문장이 참이려면 엔진이 그 유형을 실제로 정량 판정해야 한다 — 아니면 화면이
  // 채점되지 않는 목표를 채점된다고 말하는 셈이고, 그것이 known-issues 1번의 모양이다.
  test('금액을 비워 둘 수 있는 목표는 엔진이 정량 판정하는 유형이다', () => {
    const optional = RETIREMENT_GOAL_CATALOG
      .filter((definition) => definition.target?.optional === true)
      .map((definition) => definition.type);

    expect(optional.length).toBeGreaterThan(0);
    for (const type of optional) {
      expect(isQuantitativelyJudgedGoal(type), type).toBe(true);
    }
  });
});
