import { describe, test, expect } from 'vitest';
import { buildHeroHeadline } from '@/web/features/Dashboard/hero/heroHeadline';
import { computePlanConfidence } from '@/core/usecases/dashboard/computePlanConfidence';
import { PlanOutcome } from '@/core/usecases/dashboard/resolvePlanOutcome';

// 세 사건이 전부 없는 «건강한 계획»에서 출발해 한 축씩 켠다.
function outcome(overrides: Partial<PlanOutcome> = {}): PlanOutcome {
  return {
    assetStatus: 'sustained',
    investableDepletionAge: null,
    spendingShortfall: null,
    ...overrides,
  };
}

const confidence = (spendingSuccessRate: number, assetSuccessRate = spendingSuccessRate) =>
  computePlanConfidence(70, { spendingSuccessRate, assetSuccessRate });

describe('buildHeroHeadline', () => {
  test('세 사건이 없고 확률도 높으면 초록 신호와 유지 문구를 반환한다', () => {
    const headline = buildHeroHeadline({ expectancy: 90, outcome: outcome(), confidence: confidence(0.95) });

    expect(headline.emoji).toBe('🟢');
    expect(headline.text).toContain('90세까지 투자자산이 고갈되지 않고');
    expect(headline.text).toContain('95%');
  });

  // **리뷰에서 최우선으로 지적된 모순.** 결정론상 고갈이 없어도 성공률이 39%면 "안정적"이라고
  // 말해서는 안 된다. 예전 구현은 이 조합에서 `'기준 시나리오는 안정적이나...'`를 앞에 붙였다.
  test('결정론이 유지돼도 확률이 낮으면 "안정"이라고 말하지 않는다', () => {
    const headline = buildHeroHeadline({ expectancy: 90, outcome: outcome(), confidence: confidence(0.39) });

    expect(headline.emoji).toBe('🔴');
    expect(headline.text).toContain('시장이 나빠지면 계획이 무너질 가능성이 높습니다');
    expect(headline.text).toContain('39%');
    expect(headline.text).not.toContain('안정');
  });

  // **총자산은 유지되는데 투자자산만 소진되는 계획.** 국민연금 잉여가 현금으로 쌓이는 경로라
  // depletionAge가 잡히지 않아, 예전에는 이 사건 자체가 화면에서 사라졌다.
  test('투자자산 소진은 총자산이 유지돼도 문장에 나타난다', () => {
    const headline = buildHeroHeadline({
      expectancy: 90,
      outcome: outcome({ investableDepletionAge: 79 }),
      confidence: confidence(0.39),
    });

    expect(headline.text).toContain('79세에 투자자산이 모두 소진되지만');
    expect(headline.text).toContain('연금 소득이 계획한 생활비를 채웁니다');
  });

  // 생활비 부족은 가장 무거운 사실이므로 투자자산 소진과 함께 있으면 둘 다 말한다.
  test('생활비 부족 구간이 있으면 기간을 밝힌다', () => {
    const headline = buildHeroHeadline({
      expectancy: 90,
      outcome: outcome({ investableDepletionAge: 67, spendingShortfall: { years: 13, firstAge: 67, lastAge: 79 } }),
      confidence: confidence(0.12),
    });

    expect(headline.text).toContain('67세에 투자자산이 모두 소진되고');
    expect(headline.text).toContain('67세부터 13년간 계획한 생활비에 못 미칩니다');
    expect(headline.text).toContain('노후 생활비를 감당하기 어렵습니다');
  });

  // 두 확률이 크게 갈리면 그 방향 자체가 정보다 — 밝히지 않으면 사용자가 낮은 쪽만 본다.
  test('생활 유지가 자산 보존보다 크게 높으면 그 이유를 덧붙인다', () => {
    const headline = buildHeroHeadline({
      expectancy: 90,
      outcome: outcome({ investableDepletionAge: 80 }),
      confidence: confidence(0.92, 0.4),
    });

    expect(headline.text).toContain('자산이 바닥나도 연금 소득이 생활비를 메우는 경로');
  });

  test('자산 보존이 생활 유지보다 크게 높으면 반대 문장을 덧붙인다', () => {
    const headline = buildHeroHeadline({
      expectancy: 90,
      outcome: outcome({ spendingShortfall: { years: 5, firstAge: 80, lastAge: 84 } }),
      confidence: confidence(0.4, 0.92),
    });

    expect(headline.text).toContain('자산은 남아도 계획한 생활비를 다 쓰지 못하는 경로');
  });

  // 투자자산을 하나도 등록하지 않은 사용자는 엔진이 첫 해에 depletionAge를 잡아
  // "51세에 자산이 고갈될 위험이 있습니다"가 나왔다. 그에게는 고갈시킬 자산 자체가 없다.
  test('투자자산 미보유면 고갈이라고 말하지 않는다', () => {
    const headline = buildHeroHeadline({
      expectancy: 90,
      outcome: outcome({ assetStatus: 'no_investable_asset' }),
      confidence: confidence(0.2),
    });

    expect(headline.text).toContain('등록된 투자자산이 없');
    expect(headline.text).not.toContain('소진');
  });

  // MC를 받지 못한 상태에서 확률을 지어내지 않고, 그 사실 자체를 밝힌다.
  test('확률이 없으면 시장 변동성 미반영임을 명시한다', () => {
    const headline = buildHeroHeadline({
      expectancy: 90,
      outcome: outcome(),
      confidence: computePlanConfidence(85),
    });

    expect(headline.emoji).toBe('🟢'); // 85점 = 은퇴 준비도 임계표의 green
    expect(headline.text).toContain('시장 변동성 미반영');
    expect(headline.text).not.toContain('%');
  });
});
