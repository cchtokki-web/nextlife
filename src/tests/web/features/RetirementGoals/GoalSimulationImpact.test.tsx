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

  // 회귀: 이 카드는 데스크톱에서 360px 고정 사이드바 안에 들어간다. 2단 분기를 뷰포트
  // 기준(sm:)으로 걸면 화면이 넓을수록 오히려 150px짜리 칸이 생겨 문장이 토막 난다.
  // 분기 기준은 반드시 «이 카드가 실제로 쥔 폭»(컨테이너 질의)이어야 한다.
  test('2단 분기는 뷰포트가 아니라 컨테이너 폭을 기준으로 한다', () => {
    const { container } = render(
      <GoalSimulationImpact
        params={params}
        goals={[{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'SOFT' }]}
      />,
    );

    const section = container.querySelector('section');
    expect(section?.className).toContain('@container');

    const twoColumn = container.querySelector('[class*="grid-cols-2"]');
    expect(twoColumn).not.toBeNull();
    expect(twoColumn?.className).toContain('@min-[26rem]:grid-cols-2');
    expect(twoColumn?.className).not.toContain('sm:grid-cols-2');
  });
});
