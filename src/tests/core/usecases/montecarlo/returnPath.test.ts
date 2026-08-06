import { describe, test, expect } from 'vitest';
import { buildReturnShockPath } from '@/core/usecases/montecarlo/returnPath';
import { mulberry32 } from '@/core/usecases/montecarlo/rng';

describe('buildReturnShockPath', () => {
  test('요청한 길이만큼 만든다', () => {
    expect(buildReturnShockPath(35, 15, mulberry32(1))).toHaveLength(35);
  });

  // 변동성 0은 "결정론"이다. 이 성질이 있어야 몬테카를로가 σ=0에서 기존 엔진 결과와
  // 정확히 일치하고, 그 일치를 회귀 테스트로 쓸 수 있다.
  test('변동성이 0이면 모든 해의 충격이 0이다', () => {
    expect(buildReturnShockPath(30, 0, mulberry32(1)).every((v) => v === 0)).toBe(true);
  });

  test('같은 시드는 같은 경로를 만든다', () => {
    expect(buildReturnShockPath(30, 15, mulberry32(77)))
      .toEqual(buildReturnShockPath(30, 15, mulberry32(77)));
  });

  test('다른 시드는 다른 경로를 만든다', () => {
    expect(buildReturnShockPath(30, 15, mulberry32(1)))
      .not.toEqual(buildReturnShockPath(30, 15, mulberry32(2)));
  });

  // 충격의 기대값은 0이어야 한다 — 사용자가 입력한 기대수익률이 곧 평균이 되도록.
  // (그래도 복리로 굴리면 중앙값은 결정론보다 낮게 나온다. 그것이 변동성 손실이며
  //  숨기지 않고 화면에 드러낸다.)
  test('충격의 평균은 0에 수렴하고 표준편차는 지정한 값에 수렴한다', () => {
    const rand = mulberry32(2026);
    const samples = buildReturnShockPath(50000, 15, rand);

    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length);

    expect(Math.abs(mean)).toBeLessThan(0.3);
    expect(Math.abs(sd - 15)).toBeLessThan(0.3);
  });

  test('길이가 0이면 빈 경로를 준다', () => {
    expect(buildReturnShockPath(0, 15, mulberry32(1))).toEqual([]);
  });

  test('음수 변동성은 0으로 다룬다', () => {
    // 표준편차에 음수는 의미가 없다. 던지는 대신 결정론으로 떨어뜨린다.
    expect(buildReturnShockPath(10, -5, mulberry32(1)).every((v) => v === 0)).toBe(true);
  });

  test('모든 값이 유한하다', () => {
    expect(buildReturnShockPath(1000, 20, mulberry32(3)).every(Number.isFinite)).toBe(true);
  });
});
