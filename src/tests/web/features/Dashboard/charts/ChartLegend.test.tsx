import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChartLegend, type ChartLegendItem } from '@/web/features/Dashboard/charts/ChartLegend';

// **왜 recharts의 <Legend>를 쓰지 않는가.**
//
// `height` prop은 이 버전에서 래퍼의 CSS 높이만 정하고 차트 영역을 밀어내지 않는다.
// 실측하면 플롯 상단이 항상 `margin.top + 36`(기본 범례 높이)에 고정되어, 항목이 한 줄에
// 다 들어가지 않는 순간 두 번째 줄부터 그래프와 Y축 눈금 위에 겹쳐 찍혔다.
// 모바일 390px의 재원 구성 차트가 7개 항목 3줄로 정확히 그 상태였다.
const items: ChartLegendItem[] = [
  { dataKey: '국민연금', label: '국민연금', color: '#10B981' },
  { dataKey: '배당소득', label: '배당소득', color: '#3B82F6' },
  { dataKey: '월생활비', label: '월 생활비', color: '#F59E0B', shape: 'line' },
];

describe('ChartLegend', () => {
  test('모든 항목을 라벨로 렌더링한다', () => {
    render(<ChartLegend items={items} hiddenKeys={{}} onToggle={vi.fn()} />);

    items.forEach((item) => {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    });
  });

  // 기존 onLegendClick 핸들러는 payload의 dataKey로 hiddenKeys를 뒤집는다.
  // 그 계약을 그대로 지켜야 recharts 범례를 걷어내도 동작이 달라지지 않는다.
  test('클릭하면 dataKey를 담은 payload로 토글을 알린다', () => {
    const onToggle = vi.fn();
    render(<ChartLegend items={items} hiddenKeys={{}} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: /배당소득/ }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0][0]).toMatchObject({ dataKey: '배당소득' });
  });

  test('숨겨진 항목은 눌린 상태가 아니라고 알린다', () => {
    render(<ChartLegend items={items} hiddenKeys={{ 배당소득: true }} onToggle={vi.fn()} />);

    expect(screen.getByRole('button', { name: /배당소득/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /국민연금/ })).toHaveAttribute('aria-pressed', 'true');
  });

  // 라벨만 읽으면 스크린리더 사용자는 클릭이 무엇을 하는지 알 수 없다.
  test('누르면 무슨 일이 일어나는지 라벨에 밝힌다', () => {
    render(<ChartLegend items={items} hiddenKeys={{ 배당소득: true }} onToggle={vi.fn()} />);

    expect(screen.getByRole('button', { name: '배당소득 표시' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '국민연금 숨기기' })).toBeInTheDocument();
  });

  // 좁은 화면에서 줄이 늘어나야 차트가 그만큼 아래로 밀린다 — 그것이 이 컴포넌트의 존재 이유다.
  test('여러 줄로 접힐 수 있도록 flex-wrap으로 배치한다', () => {
    const { container } = render(<ChartLegend items={items} hiddenKeys={{}} onToggle={vi.fn()} />);

    expect(container.querySelector('ul')?.className).toContain('flex-wrap');
  });

  test('항목 라벨은 어절 중간에서 잘리지 않는다', () => {
    render(<ChartLegend items={items} hiddenKeys={{}} onToggle={vi.fn()} />);

    expect(screen.getByRole('button', { name: /월 생활비/ }).className).toContain('whitespace-nowrap');
  });
});
