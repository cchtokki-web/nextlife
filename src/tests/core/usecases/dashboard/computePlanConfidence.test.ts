import { describe, test, expect } from 'vitest';
import {
  computePlanConfidence, getPlanConfidenceBand, PLAN_CONFIDENCE_THRESHOLDS,
} from '@/core/usecases/dashboard/computePlanConfidence';

// 두 확률을 함께 넘겨야 하는 시그니처라, 테스트가 매번 객체를 짜지 않도록 감싼다.
// 밴드는 생활 유지 성공률에서만 나오므로 자산 보존은 기본값을 둔다.
const rates = (spendingSuccessRate: number, assetSuccessRate = spendingSuccessRate) => ({
  spendingSuccessRate,
  assetSuccessRate,
});

describe('getPlanConfidenceBand', () => {
  test.each([
    [1.0, '매우 안정'],
    [PLAN_CONFIDENCE_THRESHOLDS.veryStable, '매우 안정'],
    [0.89, '안정'],
    [PLAN_CONFIDENCE_THRESHOLDS.stable, '안정'],
    [0.79, '보통'],
    [PLAN_CONFIDENCE_THRESHOLDS.moderate, '보통'],
    [0.69, '주의'],
    [PLAN_CONFIDENCE_THRESHOLDS.caution, '주의'],
    [0.49, '위험'],
    [PLAN_CONFIDENCE_THRESHOLDS.risky, '위험'],
    [0.29, '매우 위험'],
    [0, '매우 위험'],
  ] as const)('성공률 %s → %s', (rate, label) => {
    // 밴드는 키로 나오고 라벨은 별도 표에 있다. 여기서 라벨까지 확인해야 6구간의 경계가
    // 사용자에게 보이는 문구와 실제로 맞물려 있는지 잠긴다.
    expect(getPlanConfidenceBand(rate)).toBe(BAND_KEY_BY_LABEL[label]);
  });

  // 밴드는 보정 점수가 아니라 성공률에서 직접 나온다. 점수를 다시 구간화하면 결정론
  // 점수가 낮은 계획과 성공률이 낮은 계획이 같은 밴드에 섞인다.
  test('결정론 점수가 달라도 같은 성공률이면 같은 밴드다', () => {
    expect(computePlanConfidence(95, rates(0.37)).band).toBe(computePlanConfidence(40, rates(0.37)).band);
  });
});

const BAND_KEY_BY_LABEL = {
  '매우 안정': 'very_stable',
  '안정': 'stable',
  '보통': 'moderate',
  '주의': 'caution',
  '위험': 'risky',
  '매우 위험': 'very_risky',
} as const;

describe('computePlanConfidence', () => {
  // 리포트가 보고한 상황: 준비도 64점(주의)인데 시장 변동 성공률은 37%였다.
  test('리포트 사례 — 64점 · 성공률 37%는 44점 위험으로 보정된다', () => {
    const confidence = computePlanConfidence(64, rates(0.37));

    expect(confidence.score).toBe(44); // round(64 * (0.5 + 0.5*0.37))
    expect(confidence.band).toBe('risky');
    expect(confidence.deterministicScore).toBe(64);
    expect(confidence.rates).toEqual({ spendingSuccessRate: 0.37, assetSuccessRate: 0.37 });
    expect(confidence.basis).toBe('probabilistic');
  });

  // **밴드와 점수는 생활 유지 성공률에서만 나온다.** 자산 보존 축은 결정론 점수의
  // longevityScore에 이미 반영돼 있어, 여기서 다시 곱하면 같은 사실로 두 번 깎인다.
  test('자산 보존 성공률은 밴드와 점수를 바꾸지 않는다', () => {
    const withHighAsset = computePlanConfidence(64, rates(0.37, 0.95));
    const withLowAsset = computePlanConfidence(64, rates(0.37, 0.05));

    expect(withHighAsset.band).toBe(withLowAsset.band);
    expect(withHighAsset.score).toBe(withLowAsset.score);
    // 다만 표시용으로는 그대로 들고 있어야 한다 — 화면이 둘을 병기한다.
    expect(withHighAsset.rates?.assetSuccessRate).toBe(0.95);
    expect(withLowAsset.rates?.assetSuccessRate).toBe(0.05);
  });

  test('성공률 100%면 결정론 점수를 그대로 둔다', () => {
    expect(computePlanConfidence(64, rates(1)).score).toBe(64);
  });

  // 0으로 깎지 않는다 — MC 실패는 계획한 생활비를 한 해 못 채웠다는 뜻이지 계획에 아무
  // 가치가 없다는 뜻이 아니다.
  test('성공률 0%여도 절반까지만 깎는다', () => {
    expect(computePlanConfidence(64, rates(0)).score).toBe(32);
  });

  test('보정 점수는 성공률에 대해 단조증가한다', () => {
    const scores = [0, 0.25, 0.5, 0.75, 1].map((r) => computePlanConfidence(80, rates(r)).score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  // 엔진의 95점 하한 오버라이드(SimulationEngine.ts:519)를 받은 계획도 이 보정을 통과한다 —
  // 결정론상 "매우 안정"인데 시장 변동에서는 반만 살아남는 계획이 실제로 있었다.
  test('결정론 95점 계획도 성공률이 낮으면 보정된다', () => {
    const confidence = computePlanConfidence(95, rates(0.5));

    expect(confidence.score).toBe(71);
    expect(confidence.band).toBe('caution');
  });

  describe('MC가 없을 때', () => {
    test('결정론 점수를 그대로 쓰고 밴드를 만들어 내지 않는다', () => {
      const confidence = computePlanConfidence(64);

      expect(confidence.score).toBe(64);
      expect(confidence.deterministicScore).toBe(64);
      expect(confidence.band).toBeUndefined();
      expect(confidence.rates).toBeUndefined();
      expect(confidence.basis).toBe('deterministic');
    });
  });

  describe('범위를 벗어난 성공률', () => {
    test.each([
      [1.5, 1],
      [-0.2, 0],
    ])('%s는 %s으로 clamp된다', (input, expected) => {
      expect(computePlanConfidence(64, rates(input)).rates?.spendingSuccessRate).toBe(expected);
    });
  });
});
