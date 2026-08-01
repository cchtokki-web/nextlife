import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldRow } from '@/web/components/form/FieldRow';

describe('FieldRow', () => {
  test('라벨과 자식 입력을 렌더링한다', () => {
    render(
      <FieldRow label="현재 나이">
        <input aria-label="현재 나이 입력" defaultValue="50" />
      </FieldRow>
    );

    expect(screen.getByText('현재 나이')).toBeInTheDocument();
    expect(screen.getByLabelText('현재 나이 입력')).toHaveValue('50');
  });

  // 금액 입력은 2열 격자 안에서 폭이 모자라 값이 잘린다. 호출부가 col-span-2 같은
  // 배치 클래스를 얹을 수 있어야 한다.
  test('className을 주면 루트 요소에 함께 붙는다', () => {
    const { container } = render(
      <FieldRow label="사적연금 저율과세 한도" className="col-span-2">
        <input />
      </FieldRow>
    );

    const root = container.firstElementChild!;
    expect(root).toHaveClass('col-span-2');
    // 기존 레이아웃 클래스를 덮어쓰면 라벨과 입력이 가로로 붙는다.
    expect(root).toHaveClass('flex', 'flex-col');
  });

  test('changed가 true면 "사용자 설정" 배지를 표시한다', () => {
    render(<FieldRow label="현재 나이" changed><input /></FieldRow>);

    expect(screen.getByText('사용자 설정')).toBeInTheDocument();
  });

  test('changed가 false면 배지를 표시하지 않는다', () => {
    render(<FieldRow label="현재 나이"><input /></FieldRow>);

    expect(screen.queryByText('사용자 설정')).not.toBeInTheDocument();
  });

  test('aiHint가 있으면 AI 추천값을 표시한다', () => {
    render(<FieldRow label="수령 시작" aiHint="70세"><input /></FieldRow>);

    expect(screen.getByText('AI 추천: 70세')).toBeInTheDocument();
  });

  test('tooltipText가 있으면 도움말 버튼을 렌더링한다', () => {
    render(<FieldRow label="실질수익률" tooltipText="물가를 뺀 수익률입니다."><input /></FieldRow>);

    expect(screen.getByLabelText('도움말')).toBeInTheDocument();
  });
});
