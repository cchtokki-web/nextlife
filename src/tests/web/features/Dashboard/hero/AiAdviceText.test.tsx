import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiAdviceText } from '@/web/features/Dashboard/hero/AiAdviceText';

describe('AiAdviceText', () => {
  test('advice가 비어있고 로딩 중이면 작성 중 문구를 보여준다', () => {
    render(<AiAdviceText displayAdvice="" isLoading error={null} isRuleBased={false} isStale={false} onRetry={vi.fn()} />);
    expect(screen.getByText('AI 분석 의견을 작성하고 있습니다...')).toBeInTheDocument();
  });

  test('에러가 있으면 에러 문구를 보여준다', () => {
    render(
      <AiAdviceText
        displayAdvice=""
        isLoading={false}
        error="문제 발생"
        isRuleBased={false}
        isStale={false}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText('문제 발생')).toBeInTheDocument();
  });

  test('**로 감싼 텍스트는 강조 표시된다', () => {
    render(
      <AiAdviceText
        displayAdvice="일반 텍스트와 **강조 텍스트**입니다"
        isLoading={false}
        error={null}
        isRuleBased={false}
        isStale={false}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText('강조 텍스트').tagName).toBe('STRONG');
  });

  test('isRuleBased면 안내 배지를 보여준다', () => {
    render(
      <AiAdviceText displayAdvice="기본 안내" isLoading={false} error={null} isRuleBased isStale={false} onRetry={vi.fn()} />
    );
    expect(screen.getByText('AI 서버 연결 불가 · 기본 안내 표시 중')).toBeInTheDocument();
  });

  test('isStale이고 rule-based가 아니며 로딩 중이 아니면 업데이트 버튼을 보여주고 클릭 시 onRetry를 호출한다', () => {
    const onRetry = vi.fn();
    render(
      <AiAdviceText displayAdvice="기존 의견" isLoading={false} error={null} isRuleBased={false} isStale onRetry={onRetry} />
    );
    screen.getByRole('button', { name: /의견 업데이트/ }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
