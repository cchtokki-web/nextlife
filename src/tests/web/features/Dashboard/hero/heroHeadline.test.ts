import { describe, test, expect } from 'vitest';
import { buildHeroHeadline } from '@/web/features/Dashboard/hero/heroHeadline';

describe('buildHeroHeadline', () => {
  test('점수가 높고(안정 등급) 자산 고갈이 없으면 초록 이모지와 안정 문구를 반환한다', () => {
    const headline = buildHeroHeadline(92, null, 90, 'sustained');
    expect(headline.emoji).toBe('🟢');
    expect(headline.text).toContain('안정');
    expect(headline.text).toContain('90세');
    expect(headline.text).toContain('고갈');
  });

  test('점수가 낮은(위험 등급) 상태이고 자산이 기대수명 전에 고갈되면 빨간 이모지와 경고 문구를 반환한다', () => {
    const headline = buildHeroHeadline(45, 80, 90, 'depleted');
    expect(headline.emoji).toBe('🔴');
    expect(headline.text).toContain('80세');
    expect(headline.text).toContain('고갈');
  });

  test('보통/주의 등급이면 노란 이모지를 반환한다', () => {
    const headline = buildHeroHeadline(65, null, 90, 'sustained');
    expect(headline.emoji).toBe('🟡');
  });

  // 가구 종료 나이(둘 중 늦게 사망하는 쪽)가 본인 기대수명보다 클 수 있다.
  // 본인 기대수명과 비교하면 배우자 단독 생존 구간에서 파산하는 계획이 "고갈 위험 없음"으로 표시된다.
  test('본인 기대수명(75세) 이후·가구 종료 나이(100세) 이전에 고갈되면 고갈 위험으로 판정한다', () => {
    const headline = buildHeroHeadline(37, 76, 100, 'depleted');

    expect(headline.text).toContain('76세');
    expect(headline.text).toContain('고갈될 위험');
  });

  test('가구 종료 나이까지 고갈이 없으면 그 나이를 기준으로 안전 문구를 만든다', () => {
    const headline = buildHeroHeadline(92, null, 100, 'sustained');

    expect(headline.text).toContain('100세');
    expect(headline.text).not.toContain('고갈될 위험');
  });

  test('기준 시나리오가 유지돼도 몬테카를로 위험이 있으면 확률과 노란 신호를 표시한다', () => {
    const headline = buildHeroHeadline(92, null, 90, 'sustained', {
      successRate: 0.8,
      fullSpendingRate: 0.47,
    });

    expect(headline.emoji).toBe('🟡');
    expect(headline.text).toContain('기준 시나리오에서는');
    expect(headline.text).toContain('80%');
    expect(headline.text).toContain('47%');
    expect(headline.text).not.toContain('고갈 위험이 없습니다');
  });

  // 투자자산을 하나도 등록하지 않은 사용자는 엔진이 첫 해에 depletionAge를 잡아
  // "51세에 자산이 고갈될 위험이 있습니다"가 나왔다. 그에게는 고갈시킬 자산 자체가 없다.
  test('투자자산 미보유면 고갈 나이가 있어도 고갈이라고 말하지 않는다', () => {
    const headline = buildHeroHeadline(32, 51, 90, 'no_investable_asset');

    expect(headline.emoji).toBe('🔴');
    expect(headline.text).toContain('위험 수준의 은퇴 준비 상태입니다.'); // 등급 자체는 정확하다
    expect(headline.text).toContain('투자자산이 없어');
    expect(headline.text).not.toContain('고갈');
    expect(headline.text).not.toContain('51세');
  });
});
