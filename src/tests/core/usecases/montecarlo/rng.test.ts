import { describe, test, expect } from 'vitest';
import { mulberry32, deriveSeed, nextStandardNormal } from '@/core/usecases/montecarlo/rng';

// **코어는 Math.random()을 쓰지 않는다.**
//
// 같은 입력 → 같은 출력은 이 저장소 도메인 계층의 계약이고, 골든/스냅샷 테스트가 그 위에
// 서 있다. 시드를 주입받는 PRNG를 쓰면 확률 시뮬레이션도 그 계약 안에 남는다.
//
// 몬테카를로 결과가 재현되지 않으면 사용자가 아무것도 바꾸지 않았는데 새로고침마다
// 성공률이 88%↔91%로 흔들려 그 숫자를 믿을 수 없게 된다.
describe('mulberry32', () => {
  test('같은 시드는 같은 수열을 만든다', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);

    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());

    expect(seqA).toEqual(seqB);
  });

  test('다른 시드는 다른 수열을 만든다', () => {
    const a = Array.from({ length: 10 }, mulberry32(1));
    const b = Array.from({ length: 10 }, mulberry32(2));

    expect(a).not.toEqual(b);
  });

  test('출력은 항상 [0, 1) 범위다', () => {
    const rand = mulberry32(7);

    for (let i = 0; i < 5000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('충분히 균등하게 분포한다', () => {
    const rand = mulberry32(99);
    const buckets = new Array(10).fill(0);
    const n = 100000;

    for (let i = 0; i < n; i++) buckets[Math.floor(rand() * 10)]++;

    // 균등이면 각 구간이 10%다. 편차 1%p 이내를 요구한다.
    for (const count of buckets) {
      expect(Math.abs(count / n - 0.1)).toBeLessThan(0.01);
    }
  });
});

describe('deriveSeed', () => {
  // 시행별 독립 시드가 필요한 이유: 하나의 난수원을 1000시행이 순차 소비해도 재현은
  // 되지만, "i번째 시행"을 단독으로 다시 만들 수 없다. 최악 경로를 나중에 재실행해
  // 상세를 뽑거나(메모리 절약), 시행 구간을 나눠 처리할 때 시행 단위 재현성이 필요하다.
  test('연속된 인덱스가 서로 상관없는 수열을 만든다', () => {
    const first = Array.from({ length: 5 }, mulberry32(deriveSeed(42, 0)));
    const second = Array.from({ length: 5 }, mulberry32(deriveSeed(42, 1)));

    expect(first).not.toEqual(second);
    // 순차 시드를 그대로 쓰면(seed, seed+1) 첫 출력이 비슷하게 나오는 PRNG가 있다.
    // 믹서를 거치므로 그런 상관이 없어야 한다.
    expect(Math.abs(first[0] - second[0])).toBeGreaterThan(0.001);
  });

  test('같은 (기준 시드, 인덱스)는 같은 시드를 준다', () => {
    expect(deriveSeed(42, 7)).toBe(deriveSeed(42, 7));
  });

  test('기준 시드가 다르면 다른 시드를 준다', () => {
    expect(deriveSeed(42, 7)).not.toBe(deriveSeed(43, 7));
  });

  test('100개 인덱스가 모두 서로 다른 시드를 준다', () => {
    const seeds = new Set(Array.from({ length: 100 }, (_, i) => deriveSeed(2026, i)));

    expect(seeds.size).toBe(100);
  });
});

describe('nextStandardNormal', () => {
  test('표준정규분포의 평균과 표준편차를 따른다', () => {
    const rand = mulberry32(2026);
    const samples = Array.from({ length: 50000 }, () => nextStandardNormal(rand));

    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;

    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(Math.sqrt(variance) - 1)).toBeLessThan(0.02);
  });

  test('같은 난수원 상태에서 같은 값을 준다', () => {
    expect(nextStandardNormal(mulberry32(5))).toBe(nextStandardNormal(mulberry32(5)));
  });

  test('유한한 값만 만든다', () => {
    // Box-Muller는 u가 정확히 0이면 log(0) = -Infinity가 된다. 그 경계를 막아야 한다.
    const rand = mulberry32(31337);

    for (let i = 0; i < 20000; i++) {
      expect(Number.isFinite(nextStandardNormal(rand))).toBe(true);
    }
  });
});
