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

    // 호출부가 준 배치 클래스가 살아남는지만 본다. 내부 레이아웃 유틸(flex/flex-col)까지
    // 단언하면 CSS 모듈이나 grid로 리팩터링할 때 동작 변화 없이 깨진다.
    expect(container.firstElementChild!).toHaveClass('col-span-2');
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

  test('aiHintApplied가 true이면 "AI 적용" 접두어로 표시한다', () => {
    render(<FieldRow label="수령 시작" aiHint="68세부터 수령" aiHintApplied><input /></FieldRow>);

    expect(screen.getByText('AI 적용: 68세부터 수령')).toBeInTheDocument();
    expect(screen.queryByText('AI 추천: 68세부터 수령')).not.toBeInTheDocument();
  });

  test('tooltipText가 있으면 도움말 버튼을 렌더링한다', () => {
    render(<FieldRow label="실질수익률" tooltipText="물가를 뺀 수익률입니다."><input /></FieldRow>);

    expect(screen.getByLabelText('도움말')).toBeInTheDocument();
  });

  // 한쪽은 "지금 돌아간 계산의 사실"이고 다른 쪽은 "제안"인데, 예전에는 색·테두리·배경이
  // 모두 같아 접두어 글자 하나로만 갈렸다. 스캔으로 구분되지 않고 색맹 사용자에게는 단서가
  // 사실상 없다. 클래스가 아니라 data 속성으로 검사한다 — Tailwind 유틸을 단언하면
  // 스타일을 손볼 때마다 동작 변화 없이 깨진다.
  describe('적용/추천의 시각 구분', () => {
    const badge = () => document.querySelector('[data-ai-badge]');

    test('적용 상태와 추천 상태가 서로 다른 표식을 갖는다', () => {
      const { unmount } = render(
        <FieldRow label="수령 시작" aiHint="68세부터 수령" aiHintApplied><input /></FieldRow>
      );
      expect(badge()).toHaveAttribute('data-ai-badge', 'applied');
      unmount();

      render(<FieldRow label="수령 시작" aiHint="68세부터 수령"><input /></FieldRow>);
      expect(badge()).toHaveAttribute('data-ai-badge', 'suggested');
    });

    test('적용 상태는 색 말고도 아이콘으로 구분된다', () => {
      const { container } = render(
        <FieldRow label="수령 시작" aiHint="68세부터 수령" aiHintApplied><input /></FieldRow>
      );

      // 아이콘은 장식이므로 접근성 트리에서는 숨긴다(문구가 이미 '적용'을 말한다).
      const icon = container.querySelector('[data-ai-badge] svg');
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    test('추천 상태는 적용 상태와 다른 아이콘을 쓴다', () => {
      const applied = render(
        <FieldRow label="a" aiHint="68세" aiHintApplied><input /></FieldRow>
      );
      const appliedIcon = applied.container.querySelector('[data-ai-badge] svg')?.getAttribute('class');
      applied.unmount();

      const suggested = render(<FieldRow label="a" aiHint="68세"><input /></FieldRow>);
      const suggestedIcon = suggested.container.querySelector('[data-ai-badge] svg')?.getAttribute('class');

      expect(appliedIcon).toBeTruthy();
      expect(suggestedIcon).toBeTruthy();
      expect(appliedIcon).not.toBe(suggestedIcon);
    });
  });
});
