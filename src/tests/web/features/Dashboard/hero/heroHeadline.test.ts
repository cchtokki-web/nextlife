import { describe, test, expect } from 'vitest';
import { buildHeroHeadline } from '@/web/features/Dashboard/hero/heroHeadline';

describe('buildHeroHeadline', () => {
  test('점수가 높고(안정 등급) 자산 고갈이 없으면 초록 이모지와 안정 문구를 반환한다', () => {
    const headline = buildHeroHeadline(92, null, 90);
    expect(headline.emoji).toBe('🟢');
    expect(headline.text).toContain('안정');
    expect(headline.text).toContain('90세');
    expect(headline.text).toContain('고갈');
  });

  test('점수가 낮은(위험 등급) 상태이고 자산이 기대수명 전에 고갈되면 빨간 이모지와 경고 문구를 반환한다', () => {
    const headline = buildHeroHeadline(45, 80, 90);
    expect(headline.emoji).toBe('🔴');
    expect(headline.text).toContain('80세');
    expect(headline.text).toContain('고갈');
  });

  test('보통/주의 등급이면 노란 이모지를 반환한다', () => {
    const headline = buildHeroHeadline(65, null, 90);
    expect(headline.emoji).toBe('🟡');
  });
});
