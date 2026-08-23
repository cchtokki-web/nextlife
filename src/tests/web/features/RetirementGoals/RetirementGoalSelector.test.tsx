import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { RetirementGoal } from '@/core/entities/retirementGoal';
import { RetirementGoalSelector } from '@/web/features/RetirementGoals/RetirementGoalSelector';

function SelectorHarness({
  initial = [], onGoals,
}: { initial?: RetirementGoal[]; onGoals?: (goals: RetirementGoal[]) => void }) {
  const [goals, setGoals] = useState(initial);
  return (
    <RetirementGoalSelector
      goals={goals}
      displayCurrency="KRW"
      retirementAge={60}
      targetMonthlySpending={3500000}
      onChange={(next) => { onGoals?.(next); setGoals(next); }}
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

  // 강도의 «행동» 차이는 생활비 목표에서만 참이다. 「반드시 지키기」가 계좌 순서·월 인출
  // 목표·세제 최적화를 깨는 것은 인출 시점의 규칙이고, 은퇴 나이나 기말자산의 HARD는
  // 후보를 거르는 조건일 뿐이다. 같은 문구를 모든 목표에 붙이면 거짓 설명이 된다.
  test('강도 안내는 생활비 목표에만 붙는다', () => {
    render(<SelectorHarness />);

    fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
    expect(screen.getByText(/계좌 순서·월 인출 목표·세제 최적화보다 생활비 충당을 우선합니다/))
      .toBeInTheDocument();
    expect(screen.getByText(/세금이나 인출 순서를 강제로 깨지 않습니다/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /여유 있는 소비/ }));
    expect(screen.getAllByText(/생활비 충당을 우선합니다/)).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /빠른 은퇴/ }));
    expect(screen.getAllByText(/생활비 충당을 우선합니다/)).toHaveLength(2);
  });

  // 씨앗과 사용자 확정값을 «화면에서» 가른다.
  //
  // 미확정 금액은 부족분·HARD/SOFT 판정에 참가하지 않는다(confirmedTargetValue). 그 사실을
  // 숨기면 「반드시 지키기」를 골라 둔 사용자가 자기 금액이 강제되지 않는다는 것을 알 수 없고,
  // 이 수정이 목표를 조용히 약화시킨 것으로 나타난다.
  describe('목표금액의 출처', () => {
    test('목표를 고를 때 깔리는 금액에는 출처 표시가 붙지 않는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);

      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      expect(seen.at(-1)).toEqual([{
        type: 'LIVING_EXPENSE_STABILITY', priority: 1,
        targetValue: 3500000, constraintType: 'SOFT',
      }]);
      expect(seen.at(-1)![0].targetValueSource).toBeUndefined();
    });

    test('사용자가 입력창에 써넣은 금액에만 출처 표시가 붙는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      fireEvent.change(screen.getByLabelText('목표 월 생활비'), { target: { value: '4,000,000' } });

      expect(seen.at(-1)).toEqual([{
        type: 'LIVING_EXPENSE_STABILITY', priority: 1,
        targetValue: 4_000_000, targetValueSource: 'user', constraintType: 'SOFT',
      }]);
    });

    test('강도만 바꾸는 것으로는 제안이 확정되지 않는다', () => {
      const seen: RetirementGoal[][] = [];
      render(<SelectorHarness onGoals={(goals) => seen.push(goals)} />);
      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));

      fireEvent.change(screen.getByLabelText('생활비 안정 조건 강도'), { target: { value: 'HARD' } });

      expect(seen.at(-1)![0].constraintType).toBe('HARD');
      expect(seen.at(-1)![0].targetValueSource).toBeUndefined();
      expect(screen.getByText(/아직 제안 금액입니다/)).toBeInTheDocument();
    });

    test('제안 상태에는 「아직 제안 금액입니다」와 확정 방법이 함께 뜬다', () => {
      render(<SelectorHarness />);

      fireEvent.click(screen.getByRole('button', { name: /생활비 안정/ }));
      expect(screen.getByText(/아직 제안 금액입니다/)).toBeInTheDocument();
      expect(screen.getByText(/위 칸에 원하는 금액을 직접 입력하면 목표 금액으로 확정됩니다/))
        .toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('목표 월 생활비'), { target: { value: '4,000,000' } });
      expect(screen.queryByText(/아직 제안 금액입니다/)).not.toBeInTheDocument();
    });

    test('상속 목표의 씨앗도 제안으로 표시된다', () => {
      render(<SelectorHarness />);

      fireEvent.click(screen.getByRole('button', { name: /상속 자산 확보/ }));

      expect(screen.getByText(/아직 제안 금액입니다/)).toBeInTheDocument();
    });

    // 나이는 금액이 아니고, 그 씨앗은 사용자가 1단계에서 «직접 입력한» 은퇴 나이다.
    // 제안이라 부르면 사용자가 이미 말한 것을 말한 적 없다고 하는 셈이 된다.
    test('희망 은퇴 나이에는 제안 문구를 붙이지 않는다', () => {
      render(<SelectorHarness />);

      fireEvent.click(screen.getByRole('button', { name: /빠른 은퇴/ }));

      expect(screen.queryByText(/아직 제안 금액입니다/)).not.toBeInTheDocument();
    });
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
