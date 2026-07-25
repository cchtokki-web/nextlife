import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoreKpiGrid } from '@/web/features/Dashboard/kpi/CoreKpiGrid';

describe('CoreKpiGrid', () => {
  test('4개 KPI(생존가능성/순자산/월생활비/Utility)를 모두 렌더링한다', () => {
    render(
      <CoreKpiGrid
        survivalScore={92}
        expectancy={90}
        endingAssets={500000000}
        monthlyTarget={3000000}
        utilityScore={81}
        formatValue={(v) => `${v}원`}
      />
    );

    expect(screen.getByText(/생존 가능성/)).toBeInTheDocument();
    expect(screen.getByText('예상 순자산')).toBeInTheDocument();
    expect(screen.getByText('예상 월 생활비')).toBeInTheDocument();
    expect(screen.getByText('평생 효용')).toBeInTheDocument();
    expect(screen.getByText('500000000원')).toBeInTheDocument();
    expect(screen.getByText('3000000원')).toBeInTheDocument();
    expect(screen.getByText('81점')).toBeInTheDocument();
  });

  test('utilityScore가 없으면 Utility 카드를 렌더링하지 않는다', () => {
    render(
      <CoreKpiGrid
        survivalScore={92}
        expectancy={90}
        endingAssets={500000000}
        monthlyTarget={3000000}
        formatValue={(v) => `${v}원`}
      />
    );

    expect(screen.queryByText('평생 효용')).not.toBeInTheDocument();
  });
});
