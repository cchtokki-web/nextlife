import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApplyRecommendationButton } from '@/web/features/Dashboard/recommendation/ApplyRecommendationButton';

describe('ApplyRecommendationButton', () => {
  test('mode가 current면 "추천 적용하기" 라벨을 보여주고 클릭 시 onToggle을 호출한다', () => {
    const onToggle = vi.fn();
    render(<ApplyRecommendationButton mode="current" onToggle={onToggle} />);

    const button = screen.getByRole('button', { name: '추천 적용하기' });
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  test('mode가 after면 "현재 전략으로 보기" 라벨을 보여준다', () => {
    render(<ApplyRecommendationButton mode="after" onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: '현재 전략으로 보기' })).toBeInTheDocument();
  });

  test('disabled면 버튼이 비활성화된다', () => {
    render(<ApplyRecommendationButton mode="current" onToggle={() => {}} disabled />);
    expect(screen.getByRole('button', { name: '추천 적용하기' })).toBeDisabled();
  });
});
