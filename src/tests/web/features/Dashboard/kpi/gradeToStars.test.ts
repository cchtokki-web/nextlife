import { describe, test, expect } from 'vitest';
import { scoreToStars } from '@/web/features/Dashboard/kpi/gradeToStars';

describe('scoreToStars', () => {
  test('90점 이상(매우 안정)이면 별 5개', () => {
    expect(scoreToStars(95)).toBe(5);
  });

  test('80~89점(안정)이면 별 4개', () => {
    expect(scoreToStars(85)).toBe(4);
  });

  test('70~79점(보통)이면 별 3개', () => {
    expect(scoreToStars(72)).toBe(3);
  });

  test('60~69점(주의)이면 별 2개', () => {
    expect(scoreToStars(65)).toBe(2);
  });

  test('60점 미만(위험)이면 별 1개', () => {
    expect(scoreToStars(40)).toBe(1);
  });
});
