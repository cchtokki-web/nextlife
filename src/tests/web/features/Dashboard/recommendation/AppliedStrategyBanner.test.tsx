import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { AppliedStrategyBanner } from '@/web/features/Dashboard/recommendation/AppliedStrategyBanner';

const snapshot = {
  candidateId: 'candidate-1',
  label: '균형형',
  appliedLabels: ['은퇴 시점', '국민연금', '투자 성향'],
  skippedLabels: [],
};

describe('AppliedStrategyBanner', () => {
  test('무엇을 적용했는지 축 이름으로 밝힌다', () => {
    render(<AppliedStrategyBanner snapshot={snapshot} onUndo={vi.fn()} />);

    expect(screen.getByText(/균형형/)).toBeInTheDocument();
    expect(screen.getByText(/은퇴 시점, 국민연금, 투자 성향/)).toBeInTheDocument();
  });

  // 반영하지 못한 축을 숨기면 "전략 전체를 적용했다"는 화면의 약속과 실제가 어긋난다.
  // 사용자는 카드에서 본 확률이 자기 계획에도 그대로 적용됐다고 믿게 된다.
  test('반영하지 못한 축을 함께 고지한다', () => {
    render(
      <AppliedStrategyBanner
        snapshot={{ ...snapshot, skippedLabels: ['생활비 배분'] }}
        onUndo={vi.fn()}
      />
    );

    expect(screen.getByText(/생활비 배분/)).toBeInTheDocument();
    expect(screen.getByText(/반영하지 못했습니다/)).toBeInTheDocument();
  });

  test('반영하지 못한 축이 없으면 그 문구를 내지 않는다', () => {
    render(<AppliedStrategyBanner snapshot={snapshot} onUndo={vi.fn()} />);

    expect(screen.queryByText(/반영하지 못했습니다/)).not.toBeInTheDocument();
  });

  // 되돌리기는 이 세션에서만 가능하다(스냅샷을 저장하지 않는다). 그 사실을 밝히지 않으면
  // 사용자는 언제든 돌아갈 수 있다고 믿고 자리를 뜬다.
  test('되돌리기의 유효 범위를 밝힌다', () => {
    render(<AppliedStrategyBanner snapshot={snapshot} onUndo={vi.fn()} />);

    expect(screen.getByText(/새로고침하면/)).toBeInTheDocument();
  });

  test('되돌리기 버튼이 콜백을 부른다', () => {
    const onUndo = vi.fn();
    render(<AppliedStrategyBanner snapshot={snapshot} onUndo={onUndo} />);

    fireEvent.click(screen.getByRole('button', { name: '원래 설정으로 되돌리기' }));

    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
