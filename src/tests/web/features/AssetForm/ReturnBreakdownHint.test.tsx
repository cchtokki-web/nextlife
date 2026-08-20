import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReturnBreakdownHint } from '@/web/features/AssetForm/ReturnBreakdownHint';

describe('ReturnBreakdownHint', () => {
  test('총수익률을 가격상승분과 배당분으로 나눠 보여준다', () => {
    render(<ReturnBreakdownHint totalReturn={10.5} dividendYield={3.5} />);
    expect(screen.getByText(/가격상승 7%/)).toBeInTheDocument();
    expect(screen.getByText(/배당 3.5%/)).toBeInTheDocument();
  });

  test('가격상승분이 양수면 안내 문구를 띄우지 않는다', () => {
    render(<ReturnBreakdownHint totalReturn={10.5} dividendYield={3.5} />);
    expect(screen.queryByText(/NAV가 줄어드는/)).not.toBeInTheDocument();
  });

  // 커버드콜·고배당 ETF는 분배금이 총수익률을 넘는다. 입력 오류로 오해하지 않도록
  // 그때만 설명을 붙인다.
  test('가격상승분이 음수면 안내 문구를 함께 띄운다', () => {
    render(<ReturnBreakdownHint totalReturn={7} dividendYield={21.2} />);
    expect(screen.getByText(/가격상승 −14.2%/)).toBeInTheDocument();
    expect(screen.getByText(/NAV가 줄어드는/)).toBeInTheDocument();
  });

  test('부동소수 뺄셈의 꼬리를 표시에 흘리지 않는다', () => {
    render(<ReturnBreakdownHint totalReturn={9.4} dividendYield={1.4} />);
    expect(screen.getByText(/가격상승 8%/)).toBeInTheDocument();
  });
});
