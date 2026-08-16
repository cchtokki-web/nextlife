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

function SelectorHarnessWithBequest() {
  const [goals, setGoals] = useState<RetirementGoal[]>([]);
  return (
    <RetirementGoalSelector
      goals={goals}
      displayCurrency="KRW"
      retirementAge={60}
      targetMonthlySpending={3500000}
      targetBequest={100_000_000}
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

  // 시드 규칙은 삭제된 「은퇴 목표」 섹션이 지키던 것이다. 상속 목표는 금액을 입력받는데,
  // 처음 고른 순간 비어 있으면 사용자가 0을 넣거나 빈 칸으로 두게 되고 그 값이 그대로
  // 계산에 들어간다. 그래서 엔진이 쓰던 추정치(월 생활비 × 24개월)를 출발점으로 준다.
  test('상속 목표를 처음 고르면 2년치 생활비를 목표 금액으로 시드한다', () => {
    render(<SelectorHarness />);

    fireEvent.click(screen.getByRole('button', { name: /상속 자산 확보/ }));

    expect(screen.getByLabelText('남기고 싶은 최소 자산'))
      .toHaveValue((3500000 * 24).toLocaleString());
  });

  test('이미 입력한 목표 상속자산이 있으면 시드가 덮어쓰지 않는다', () => {
    render(<SelectorHarnessWithBequest />);

    fireEvent.click(screen.getByRole('button', { name: /상속 자산 확보/ }));

    expect(screen.getByLabelText('남기고 싶은 최소 자산')).toHaveValue((100_000_000).toLocaleString());
  });

  // 금액 입력은 자동저장과 겹친다. 숫자가 아닌 값이 통과하면 NaN이 저장되고, 그 시나리오는
  // 다시 열어도 고칠 수 없다.
  test('목표값 입력은 숫자만 받고 비우면 미입력으로 둔다', () => {
    render(<SelectorHarness />);
    fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
    const input = screen.getByLabelText('목표 월 생활비');

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(input).toHaveValue((3500000).toLocaleString());

    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
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
