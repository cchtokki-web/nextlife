import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SpendingCompositionTooltip,
  SpendingChartRow,
  SPENDING_SOURCE_LEGEND,
} from '@/web/features/Dashboard/charts/SpendingCompositionChart';

const legendColor = (dataKey: string) =>
  SPENDING_SOURCE_LEGEND.find((item) => item.dataKey === dataKey)!.color;

// 재현 시나리오(국민연금만 등록): 목표 350만원 중 국민연금 191만원, 자산부족 159만원.
// 예전 기본 툴팁은 시리즈를 그대로 나열할 뿐이라 "얼마 중 얼마"를 알 수 없었고,
// 0원인 사적연금·배당·기타소득 줄까지 함께 나열돼 더 읽기 어려웠다.
const pensionOnlyRow: SpendingChartRow = {
  age: 72,
  목표생활비: 3500000,
  사적연금: 0,
  국민연금: 1910000,
  '현금 배당': 0,
  기타소득: 0,
  자산인출: 0,
  자산부족: 1590000,
  목표달성률: 1910000 / 3500000,
};

describe('SpendingCompositionTooltip', () => {
  test('목표 생활비와 충당률을 함께 보여준다', () => {
    render(
      <SpendingCompositionTooltip active label={72} rows={[pensionOnlyRow]} currency="KRW" />
    );

    expect(screen.getByText('72세 (월 생활비 구성)')).toBeInTheDocument();
    expect(screen.getByText('목표 생활비')).toBeInTheDocument();
    expect(screen.getByText('350만원')).toBeInTheDocument();
    expect(screen.getByText('충당률')).toBeInTheDocument();
    // (350 - 159) / 350 = 54.57% → 55%
    expect(screen.getByText('55%')).toBeInTheDocument();
  });

  test('0원인 재원 줄은 생략한다', () => {
    render(
      <SpendingCompositionTooltip active label={72} rows={[pensionOnlyRow]} currency="KRW" />
    );

    expect(screen.getByText('국민연금')).toBeInTheDocument();
    expect(screen.getByText('자산부족')).toBeInTheDocument();
    expect(screen.queryByText('사적연금')).not.toBeInTheDocument();
    expect(screen.queryByText('현금 배당')).not.toBeInTheDocument();
    expect(screen.queryByText('자산인출')).not.toBeInTheDocument();
  });

  // 사용자가 목표 생활비를 0으로 입력했거나 max_sustainable이 0으로 수렴한 해처럼
  // 목표가 0인 해에는 비율이 성립하지 않는다(0으로 나누기).
  test('목표 생활비가 0이면 충당률을 표시하지 않는다', () => {
    render(
      <SpendingCompositionTooltip
        active
        label={95}
        rows={[{ ...pensionOnlyRow, age: 95, 목표생활비: 0, 국민연금: 0, 자산부족: 0 }]}
        currency="KRW"
      />
    );

    expect(screen.queryByText('충당률')).not.toBeInTheDocument();
  });

  // 소득원 구성 툴팁과 같은 규칙이다 — 두 차트는 같은 자리에서 토글로 바뀌므로, 한쪽만
  // 색으로 말하면 토글할 때마다 규칙이 바뀌는 것으로 읽힌다. 색의 출처는 범례 하나다.
  test('재원 줄을 범례와 같은 색으로 표시한다', () => {
    render(
      <SpendingCompositionTooltip active label={72} rows={[pensionOnlyRow]} currency="KRW" />
    );

    expect(screen.getByText('국민연금')).toHaveStyle({ color: legendColor('국민연금') });
    expect(screen.getByText('자산부족')).toHaveStyle({ color: legendColor('자산부족') });
  });

  // 목표 생활비와 충당률은 재원이 아니라 기준·판정이다. 계열 색을 쓰면 재원 줄로 읽힌다.
  test('목표 생활비와 충당률 줄에는 계열 색을 쓰지 않는다', () => {
    render(
      <SpendingCompositionTooltip active label={72} rows={[pensionOnlyRow]} currency="KRW" />
    );

    expect(screen.getByText('목표 생활비')).not.toHaveStyle({ color: legendColor('국민연금') });
    expect(screen.getByText('충당률')).not.toHaveStyle({ color: legendColor('국민연금') });
  });

  test('활성 상태가 아니거나 해당 나이의 행이 없으면 아무것도 렌더링하지 않는다', () => {
    const { container: inactive } = render(
      <SpendingCompositionTooltip active={false} label={72} rows={[pensionOnlyRow]} currency="KRW" />
    );
    expect(inactive).toBeEmptyDOMElement();

    const { container: noRow } = render(
      <SpendingCompositionTooltip active label={99} rows={[pensionOnlyRow]} currency="KRW" />
    );
    expect(noRow).toBeEmptyDOMElement();
  });
});
