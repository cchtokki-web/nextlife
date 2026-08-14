import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { RetirementGoal } from '@/core/entities/retirementGoal';
import { RetirementGoalSelector } from '@/web/features/RetirementGoals/RetirementGoalSelector';

function SelectorHarness({ initial = [] }: { initial?: RetirementGoal[] }) {
  const [goals, setGoals] = useState(initial);
  return (
    <RetirementGoalSelector
      goals={goals}
      displayCurrency="KRW"
      retirementAge={60}
      targetMonthlySpending={3500000}
      onChange={setGoals}
    />
  );
}

describe('RetirementGoalSelector', () => {
  test('10개의 목표 후보를 제공한다', () => {
    render(<SelectorHarness />);

    for (const label of [
      '생활비 안정', '빠른 은퇴', '자산 고갈 방지', '여유 있는 소비', '주거 안정',
      '연금 최대 활용', '세금 최소화', '투자 위험 최소화', '상속 자산 확보', '자산 성장',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  test('5개를 선택하면 나머지 목표 선택을 비활성화한다', () => {
    render(<SelectorHarness />);

    for (const label of ['생활비 안정', '빠른 은퇴', '자산 고갈 방지', '여유 있는 소비', '주거 안정']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    }

    expect(screen.getByText('5/5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /연금 최대 활용/ })).toBeDisabled();
  });

  test('목표 카드에서 target 값과 HARD/SOFT 조건을 최소 입력으로 수정한다', () => {
    render(<SelectorHarness />);
    fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

    const target = screen.getByLabelText('목표 월 생활비');
    expect(target).toHaveValue('3,500,000');
    fireEvent.change(target, { target: { value: '4,000,000' } });
    expect(target).toHaveValue('4,000,000');

    const constraint = screen.getByLabelText('생활비 안정 조건 강도');
    fireEvent.change(constraint, { target: { value: 'HARD' } });
    expect(constraint).toHaveValue('HARD');
  });

  test('우선순위 이동 버튼으로 선택 순서를 바꾼다', () => {
    render(<SelectorHarness />);
    fireEvent.click(screen.getByRole('button', { name: /빠른 은퇴/ }));
    fireEvent.click(screen.getByRole('button', { name: /자산 고갈 방지/ }));
    fireEvent.click(screen.getByRole('button', { name: '자산 고갈 방지 우선순위 올리기' }));

    const priorities = screen.getAllByText(/^[12]$/).map((item) => item.textContent);
    expect(priorities).toEqual(['1', '2']);
    expect(screen.getByRole('button', { name: '자산 고갈 방지 우선순위 올리기' })).toBeDisabled();
  });
});
