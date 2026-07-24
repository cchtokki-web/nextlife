import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SecondaryKpiCollapse } from '@/web/features/Dashboard/kpi/SecondaryKpiCollapse';

describe('SecondaryKpiCollapse', () => {
  test('기본적으로 닫혀 있고, 열면 CoreMetricsCards 내용이 보인다', () => {
    render(
      <SecondaryKpiCollapse
        depletionAge={null}
        expectancyAge={90}
        monthlyTarget={3000000}
        isMonthlyTargetPossible
        formatValue={(v) => `${v}원`}
      />
    );

    expect(screen.queryByText('예상 자산 고갈 시점')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '추가 지표 더 보기' }));
    expect(screen.getByText('예상 자산 고갈 시점')).toBeInTheDocument();
  });
});
