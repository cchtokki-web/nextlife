import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IncomeCompositionTooltip, IncomeChartRow } from '@/web/features/Dashboard/charts/IncomeCompositionChart';

// 재현 시나리오(국민연금만 등록): 예전 툴팁은 항목 이름 없이 ": 2,288만원 / : 0원 / : 0원 / : 0원"
// 으로 나왔다 — formatter가 name을 빈 문자열로 만들고 있었고, 0원 소득원까지 나열했다.
const pensionOnlyRow: IncomeChartRow = {
  age: 67,
  국민연금: 22880000,
  사적연금: 0,
  배당소득: 0,
  기타소득: 0,
  hasTaxWarning: false,
  targetMonthly: 3500000,
};

describe('IncomeCompositionTooltip', () => {
  test('항목 이름과 금액을 함께 보여주고 0원 소득원은 생략한다', () => {
    render(<IncomeCompositionTooltip active label={67} rows={[pensionOnlyRow]} currency="KRW" />);

    expect(screen.getByText('67세')).toBeInTheDocument();
    expect(screen.getByText('국민연금')).toBeInTheDocument();
    expect(screen.getByText('2,288만원')).toBeInTheDocument();
    expect(screen.queryByText('사적연금')).not.toBeInTheDocument();
    expect(screen.queryByText('배당소득')).not.toBeInTheDocument();
  });

  test('은퇴 후에는 목표 생활비 대비 충당률을 덧붙인다', () => {
    render(<IncomeCompositionTooltip active label={67} rows={[pensionOnlyRow]} currency="KRW" />);

    // 연 2,288만원 → 월 190.7만원 / 목표 350만원 = 54.5%
    expect(screen.getByText('목표 생활비 충당률')).toBeInTheDocument();
    expect(screen.getByText('54%')).toBeInTheDocument();
  });

  // 은퇴 전 구간에는 목표 생활비가 정의되지 않는다(computeMonthlySpendingComposition은
  // 은퇴 후만 돌려준다). 비율을 지어내면 안 된다.
  test('목표 생활비를 모르는 해에는 충당률을 표시하지 않는다', () => {
    render(
      <IncomeCompositionTooltip
        active
        label={55}
        rows={[{ ...pensionOnlyRow, age: 55, 국민연금: 0, targetMonthly: undefined }]}
        currency="KRW"
      />
    );

    expect(screen.queryByText('목표 생활비 충당률')).not.toBeInTheDocument();
    expect(screen.getByText(/연금·배당·기타소득이 없습니다/)).toBeInTheDocument();
  });

  test('활성 상태가 아니거나 해당 나이의 행이 없으면 아무것도 렌더링하지 않는다', () => {
    const { container: inactive } = render(
      <IncomeCompositionTooltip active={false} label={67} rows={[pensionOnlyRow]} currency="KRW" />
    );
    expect(inactive).toBeEmptyDOMElement();

    const { container: noRow } = render(
      <IncomeCompositionTooltip active label={99} rows={[pensionOnlyRow]} currency="KRW" />
    );
    expect(noRow).toBeEmptyDOMElement();
  });
});
