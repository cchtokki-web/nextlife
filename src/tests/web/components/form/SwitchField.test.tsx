import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SwitchField } from '@/web/components/form/SwitchField';

describe('SwitchField', () => {
  test('라벨과 설명문을 렌더링한다', () => {
    render(
      <SwitchField
        label="자동 인출"
        description="매월 정해진 금액을 자동으로 인출합니다."
        checked={false}
        onChange={vi.fn()}
      />
    );

    expect(screen.getByText('자동 인출')).toBeInTheDocument();
    expect(screen.getByText('매월 정해진 금액을 자동으로 인출합니다.')).toBeInTheDocument();
  });

  test('checked가 스위치 상태에 반영된다', () => {
    render(
      <SwitchField label="자동 인출" description="설명" checked onChange={vi.fn()} />
    );

    expect(screen.getByRole('switch', { name: /자동 인출/ })).toBeChecked();
  });

  test('checked가 false이면 스위치가 꺼져 있다', () => {
    render(
      <SwitchField label="자동 인출" description="설명" checked={false} onChange={vi.fn()} />
    );

    expect(screen.getByRole('switch', { name: /자동 인출/ })).not.toBeChecked();
  });

  test('클릭하면 onChange가 뒤집힌 boolean으로 호출된다', () => {
    const onChange = vi.fn();
    render(
      <SwitchField label="자동 인출" description="설명" checked={false} onChange={onChange} />
    );

    fireEvent.click(screen.getByRole('switch', { name: /자동 인출/ }));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('changed가 true면 "사용자 설정" 배지를 표시한다', () => {
    render(
      <SwitchField label="자동 인출" description="설명" checked={false} onChange={vi.fn()} changed />
    );

    expect(screen.getByText('사용자 설정')).toBeInTheDocument();
  });

  test('changed가 false면 배지를 표시하지 않는다', () => {
    render(
      <SwitchField label="자동 인출" description="설명" checked={false} onChange={vi.fn()} />
    );

    expect(screen.queryByText('사용자 설정')).not.toBeInTheDocument();
  });

  test('disabled면 스위치가 비활성화되고 클릭해도 onChange가 호출되지 않는다', () => {
    const onChange = vi.fn();
    render(
      <SwitchField label="자동 인출" description="설명" checked={false} onChange={onChange} disabled />
    );

    const sw = screen.getByRole('switch', { name: /자동 인출/ });
    expect(sw).toBeDisabled();

    fireEvent.click(sw);

    expect(onChange).not.toHaveBeenCalled();
  });

  test('tooltipText가 있으면 도움말 버튼을 렌더링한다', () => {
    render(
      <SwitchField
        label="자동 인출"
        description="설명"
        checked={false}
        onChange={vi.fn()}
        tooltipText="세법상 유의 사항이 있습니다."
      />
    );

    expect(screen.getByLabelText('도움말')).toBeInTheDocument();
  });
});
