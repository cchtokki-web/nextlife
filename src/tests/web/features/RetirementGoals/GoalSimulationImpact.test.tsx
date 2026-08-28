import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { SimulationParams } from '@/core/entities/types';
import { GoalSimulationImpact } from '@/web/features/RetirementGoals/GoalSimulationImpact';

const params = {
  displayCurrency: 'KRW',
  userProfile: { retirementAge: 62 },
} as SimulationParams;

describe('GoalSimulationImpact', () => {
  test('목표에서 직접 바뀌는 계산 기준을 보여준다', () => {
    render(
      <GoalSimulationImpact
        params={params}
        goals={[
          { type: 'EARLY_RETIREMENT', priority: 1, targetValue: 60, constraintType: 'HARD' },
          {
            type: 'LIVING_EXPENSE_STABILITY', priority: 2, targetValue: 3_500_000,
            targetValueSource: 'user', constraintType: 'SOFT',
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: '이 목표가 시뮬레이션을 바꾸는 방식' })).toBeInTheDocument();
    expect(screen.getByText('60세 은퇴를 기준으로 계산합니다.')).toBeInTheDocument();
    expect(screen.getByText('목표 생활비는 월 3,500,000원입니다.')).toBeInTheDocument();
    expect(screen.getByText(/국민연금 시점, 사적연금 인출액/)).toBeInTheDocument();
    expect(screen.getByText(/수익률·물가·세금·건강보험료/)).toBeInTheDocument();
  });

  test('확정하지 않은 금액은 제안 상태로 설명한다', () => {
    render(
      <GoalSimulationImpact
        params={params}
        goals={[{
          type: 'INHERITANCE', priority: 1, targetValue: 100_000_000, constraintType: 'HARD',
        }]}
      />,
    );

    expect(screen.getByText('목표 금액을 확정하면 최소 상속자산 조건으로 계산합니다.')).toBeInTheDocument();
  });
});
