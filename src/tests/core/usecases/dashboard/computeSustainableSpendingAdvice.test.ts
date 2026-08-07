import { describe, test, expect } from 'vitest';
import { computeSustainableSpendingAdvice } from '@/core/usecases/dashboard/computeSustainableSpendingAdvice';

// 엔진은 'target' 전략에서도 findMaxSustainableValue로 "월 얼마까지 쓸 수 있는가"를 항상
// 계산해 두지만(SimulationEngine.run), 화면은 그 값을 max_sustainable 전략일 때만 보여줬다.
// 그 결과 고정 생활비로 계획한 사용자는 상속 목표가 0원인데도 수억을 남기거나, 반대로
// 자산이 고갈되는데도 아무 말을 듣지 못했다.
//
// 이 함수는 그 값을 사용자 조언으로 번역한다. 양방향인 이유: 같은 비교 한 번으로
// "더 쓸 수 있다"와 "덜 써야 한다"가 모두 나오는데, 한쪽만 보여주면 더 위험한 쪽(과소비)이
// 조용히 묻힌다.
describe('computeSustainableSpendingAdvice', () => {
  test('지속가능액이 목표보다 충분히 크면 더 쓸 수 있다고 알린다', () => {
    const advice = computeSustainableSpendingAdvice('target', 3500000, 4420000);

    expect(advice).toEqual({
      kind: 'can_spend_more',
      sustainableMonthly: 4420000,
      currentMonthly: 3500000,
      difference: 920000,
    });
  });

  test('지속가능액이 목표보다 작으면 과소비를 경고한다', () => {
    const advice = computeSustainableSpendingAdvice('target', 3500000, 3190000);

    expect(advice).toEqual({
      kind: 'overspending',
      sustainableMonthly: 3190000,
      currentMonthly: 3500000,
      difference: 310000,
    });
  });

  // 임계값을 두지 않으면 이진탐색의 마지막 자릿수 차이만으로 배너가 떴다 사라진다.
  // 비대칭인 이유: 과소비는 자산 고갈로 직결되므로 더 민감하게(5%), 절약은 취향의
  // 영역이 섞여 있으므로 더 관대하게(10%) 잡는다.
  test('차이가 임계값 미만이면 조언하지 않는다', () => {
    expect(computeSustainableSpendingAdvice('target', 3500000, 3700000)).toBeNull(); // +5.7%
    expect(computeSustainableSpendingAdvice('target', 3500000, 3400000)).toBeNull(); // -2.9%
    expect(computeSustainableSpendingAdvice('target', 3500000, 3500000)).toBeNull();
  });

  test('임계값 경계에서 조언이 시작된다', () => {
    expect(computeSustainableSpendingAdvice('target', 1000000, 1100000)).toBeNull();
    expect(computeSustainableSpendingAdvice('target', 1000000, 1100001)?.kind).toBe('can_spend_more');

    expect(computeSustainableSpendingAdvice('target', 1000000, 950000)).toBeNull();
    expect(computeSustainableSpendingAdvice('target', 1000000, 949999)?.kind).toBe('overspending');
  });

  // max_sustainable은 이 값이 이미 실제 생활비로 적용된 상태라 제안할 것이 없다.
  // DashboardSection의 기존 "최대 고정 생활비 산출 완료" 배너가 그 사실을 이미 알린다.
  test('max_sustainable 전략에서는 조언하지 않는다', () => {
    expect(computeSustainableSpendingAdvice('max_sustainable', 3500000, 4420000)).toBeNull();
  });

  // dividend_only는 목표 생활비를 쓰지 않고 그달 소득만큼만 쓴다(SimulationEngine의
  // spendingStrategy 분기). 목표와 비교하는 것 자체가 성립하지 않는다.
  test('dividend_only 전략에서는 조언하지 않는다', () => {
    expect(computeSustainableSpendingAdvice('dividend_only', 3500000, 4420000)).toBeNull();
  });

  test('전략 미지정은 target과 같게 다룬다', () => {
    // SimulationEngine이 `params.spendingStrategy || 'target'`으로 폴백하는 것과 같은 규칙.
    expect(computeSustainableSpendingAdvice(undefined, 3500000, 4420000)?.kind).toBe('can_spend_more');
  });

  test('지속가능액이 없으면 조언하지 않는다', () => {
    expect(computeSustainableSpendingAdvice('target', 3500000, undefined)).toBeNull();
  });

  // 이진탐색이 0으로 수렴한 계획(어떤 생활비로도 목표를 만족하지 못함)에서 "월 0원까지 쓸 수
  // 있습니다"는 조언이 아니라 소음이다. 이 경우는 자산 고갈 경고가 이미 담당한다.
  test('지속가능액이 0이면 조언하지 않는다', () => {
    expect(computeSustainableSpendingAdvice('target', 3500000, 0)).toBeNull();
  });

  test('목표 생활비가 0이면 비율 비교가 성립하지 않으므로 조언하지 않는다', () => {
    expect(computeSustainableSpendingAdvice('target', 0, 4420000)).toBeNull();
  });
});
