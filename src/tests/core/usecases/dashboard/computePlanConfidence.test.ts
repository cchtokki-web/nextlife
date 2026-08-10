import { describe, test, expect } from 'vitest';
import {
  computePlanConfidence, getPlanConfidenceBand, PLAN_CONFIDENCE_THRESHOLDS,
} from '@/core/usecases/dashboard/computePlanConfidence';

describe('getPlanConfidenceBand', () => {
  test.each([
    [1.0, '안정'],
    [PLAN_CONFIDENCE_THRESHOLDS.stable, '안정'],
    [0.89, '양호'],
    [PLAN_CONFIDENCE_THRESHOLDS.good, '양호'],
    [0.79, '주의'],
    [PLAN_CONFIDENCE_THRESHOLDS.caution, '주의'],
    [0.69, '위험'],
    [PLAN_CONFIDENCE_THRESHOLDS.risky, '위험'],
    [0.49, '매우 위험'],
    [0, '매우 위험'],
  ])('성공률 %s → %s', (rate, band) => {
    expect(getPlanConfidenceBand(rate)).toBe(band);
  });

  // 밴드는 보정 점수가 아니라 성공률에서 직접 나온다. 점수를 다시 구간화하면 결정론
  // 점수가 낮은 계획과 성공률이 낮은 계획이 같은 밴드에 섞인다.
  test('결정론 점수가 달라도 같은 성공률이면 같은 밴드다', () => {
    expect(computePlanConfidence(95, 0.37).band).toBe(computePlanConfidence(40, 0.37).band);
  });
});

describe('computePlanConfidence', () => {
  // 리포트가 보고한 상황: 준비도 64점(주의)인데 MC 성공률은 37%였다.
  test('리포트 사례 — 64점 · 성공률 37%는 44점 매우 위험으로 보정된다', () => {
    const confidence = computePlanConfidence(64, 0.37);

    expect(confidence.score).toBe(44); // round(64 * (0.5 + 0.5*0.37))
    expect(confidence.band).toBe('매우 위험');
    expect(confidence.deterministicScore).toBe(64);
    expect(confidence.successRate).toBe(0.37);
    expect(confidence.basis).toBe('probabilistic');
  });

  test('성공률 100%면 결정론 점수를 그대로 둔다', () => {
    expect(computePlanConfidence(64, 1).score).toBe(64);
  });

  // 0으로 깎지 않는다 — MC 실패는 고갈을 뜻하지 계획에 아무 가치가 없다는 뜻이 아니다.
  test('성공률 0%여도 절반까지만 깎는다', () => {
    expect(computePlanConfidence(64, 0).score).toBe(32);
  });

  test('보정 점수는 성공률에 대해 단조증가한다', () => {
    const scores = [0, 0.25, 0.5, 0.75, 1].map((r) => computePlanConfidence(80, r).score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  // 엔진의 95점 하한 오버라이드(SimulationEngine.ts:519)를 받은 계획도 이 보정을 통과한다 —
  // 결정론상 "매우 안정"인데 시장 변동에서는 반만 살아남는 계획이 실제로 있었다.
  test('결정론 95점 계획도 성공률이 낮으면 보정된다', () => {
    const confidence = computePlanConfidence(95, 0.5);

    expect(confidence.score).toBe(71);
    expect(confidence.band).toBe('위험');
  });

  describe('MC가 없을 때', () => {
    test('결정론 점수를 그대로 쓰고 밴드를 만들어 내지 않는다', () => {
      const confidence = computePlanConfidence(64);

      expect(confidence.score).toBe(64);
      expect(confidence.deterministicScore).toBe(64);
      expect(confidence.band).toBeUndefined();
      expect(confidence.successRate).toBeUndefined();
      expect(confidence.basis).toBe('deterministic');
    });
  });

  describe('범위를 벗어난 성공률', () => {
    test.each([
      [1.5, 1],
      [-0.2, 0],
    ])('%s는 %s으로 clamp된다', (input, expected) => {
      expect(computePlanConfidence(64, input).successRate).toBe(expected);
    });
  });
});
