import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  IncomeCompositionTooltip,
  IncomeChartRow,
  INCOME_LEGEND,
} from '@/web/features/Dashboard/charts/IncomeCompositionChart';

const legendColor = (dataKey: string) =>
  INCOME_LEGEND.find((item) => item.dataKey === dataKey)!.color;

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
  fixedIncomeCoverageRate: 22880000 / 12 / 3500000,
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
        rows={[{
          ...pensionOnlyRow,
          age: 55,
          국민연금: 0,
          targetMonthly: undefined,
          fixedIncomeCoverageRate: undefined,
        }]}
        currency="KRW"
      />
    );

    expect(screen.queryByText('목표 생활비 충당률')).not.toBeInTheDocument();
    expect(screen.getByText(/연금·배당·기타소득이 없습니다/)).toBeInTheDocument();
  });

  // 막대는 색으로 소득원을 구분하는데 툴팁은 흰 글자로만 나열해서, 어느 줄이 어느 띠인지
  // 눈으로 잇는 일을 사용자가 했다. 자산 추이 차트 툴팁은 이미 계열 색으로 말한다.
  //
  // 색의 출처는 INCOME_LEGEND 하나다 — 툴팁에 색을 다시 적으면 범례·막대·툴팁 세 곳이
  // 각자의 색을 갖게 되고, 그 어긋남은 아무 오류도 내지 않는다.
  test('소득원 줄을 범례와 같은 색으로 표시한다', () => {
    render(
      <IncomeCompositionTooltip
        active
        label={67}
        rows={[{ ...pensionOnlyRow, 사적연금: 17180000 }]}
        currency="KRW"
      />
    );

    expect(screen.getByText('국민연금')).toHaveStyle({ color: legendColor('국민연금') });
    expect(screen.getByText('2,288만원')).toHaveStyle({ color: legendColor('국민연금') });
    expect(screen.getByText('사적연금')).toHaveStyle({ color: legendColor('사적연금') });
    expect(screen.getByText('1,718만원')).toHaveStyle({ color: legendColor('사적연금') });
  });

  // 충당률은 소득원이 아니라 판정이다. 어느 계열의 색도 쓰지 않아야 소득원 줄과 구분된다.
  test('충당률 줄에는 계열 색을 쓰지 않는다', () => {
    render(<IncomeCompositionTooltip active label={67} rows={[pensionOnlyRow]} currency="KRW" />);

    expect(screen.getByText('목표 생활비 충당률')).not.toHaveStyle({ color: legendColor('국민연금') });
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
