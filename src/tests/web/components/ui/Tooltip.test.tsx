import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip } from '@/web/components/ui/Tooltip';

describe('Tooltip', () => {
  test('기본 상태에서는 role=tooltip 요소가 렌더링되지 않는다', () => {
    render(
      <Tooltip label="설명입니다">
        <span>용어</span>
      </Tooltip>
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('포커스를 받으면 role=tooltip 요소가 나타나고 트리거가 aria-describedby로 연결된다', () => {
    render(
      <Tooltip label="설명입니다">
        <span>용어</span>
      </Tooltip>
    );
    const trigger = screen.getByText('용어').parentElement!; // tabIndex를 가진 포커스 가능 래퍼
    fireEvent.focus(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('설명입니다');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
  });

  test('포커스가 벗어나면(blur) 툴팁이 사라진다', () => {
    render(
      <Tooltip label="설명입니다">
        <span>용어</span>
      </Tooltip>
    );
    const trigger = screen.getByText('용어').parentElement!;
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('마우스 hover로도 나타나고 mouseLeave로 사라진다', () => {
    render(
      <Tooltip label="설명입니다">
        <span>용어</span>
      </Tooltip>
    );
    const trigger = screen.getByText('용어');
    fireEvent.mouseEnter(trigger.parentElement!);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(trigger.parentElement!);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
