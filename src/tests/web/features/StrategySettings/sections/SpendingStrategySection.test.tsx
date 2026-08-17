import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpendingStrategySection } from '@/web/features/StrategySettings/sections/SpendingStrategySection';
import { resolveStrategy } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';
import type { SimulationParams } from '@/core/entities/types';

// initialParams: 현재 50세 · 은퇴 65세 · 기대수명 85세 · 목표 월 350만원.
const withShape = (shape: 'flat' | 'front_loaded' | 'care_heavy'): SimulationParams => ({
  ...initialParams,
  strategy: { ...resolveStrategy(initialParams), spendingShape: shape },
});

const renderSection = (params: SimulationParams) => render(
  <SpendingStrategySection
    params={params}
    onChangeParams={vi.fn()}
    mode="simple"
    changed={new Set<string>()}
  />
);

describe('SpendingStrategySection', () => {
  test('세 가지 배분을 선택지로 제공한다', () => {
    renderSection(withShape('flat'));

    expect(screen.getByRole('radio', { name: /일정하게 유지/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /통계 기준으로 감소/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /완만하게 감소/ })).toBeInTheDocument();
  });

  // 고르는 «그 자리»에서 결과가 보여야 한다. 이 선택은 은퇴 목표 단계에서 입력한 월 350만원의
  // 뜻을 나이대별로 바꾸는데, 금액을 보여주지 않으면 사용자는 총액을 정한 화면과 이 화면이
  // 서로 다른 말을 한다고 읽는다.
  test('고른 배분이 내 계획에서 얼마가 되는지 구간별로 보여준다', () => {
    renderSection(withShape('front_loaded'));

    // 통계 곡선 [1, 0.86, 0.76] × 350만원.
    const bands = screen.getByTestId('spending-band-preview');
    expect(bands).toHaveTextContent('65~69세');
    expect(bands).toHaveTextContent('350만원');
    expect(bands).toHaveTextContent('70~79세');
    expect(bands).toHaveTextContent('301만원');
    expect(bands).toHaveTextContent('80~85세');
    expect(bands).toHaveTextContent('266만원');
  });

  // 입력한 금액이 «60대에 쓸 금액»이라는 계약. 첫 구간이 목표와 다르면 사용자는 자기가
  // 넣은 적 없는 금액으로 은퇴 직후를 계획하게 된다.
  test('두 곡선 모두 첫 구간은 입력한 목표 금액 그대로다', () => {
    for (const shape of ['front_loaded', 'care_heavy'] as const) {
      const { unmount } = renderSection(withShape(shape));
      expect(screen.getByTestId('spending-band-preview'), shape).toHaveTextContent('350만원');
      unmount();
    }
  });

  test('일정하게 유지면 구간을 나열하지 않는다', () => {
    renderSection(withShape('flat'));

    expect(screen.queryByTestId('spending-band-preview')).not.toBeInTheDocument();
  });
});
