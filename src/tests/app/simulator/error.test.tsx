import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SimulatorError from '@/app/simulator/error';

// B4: 앱 전체에 error.tsx/ErrorBoundary가 하나도 없어 시뮬레이션 예외가 빈 화면이 됐다.
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => { consoleError = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { consoleError.mockRestore(); });

describe('simulator/error.tsx', () => {
  test('무슨 일이 일어났는지 알리고 재시도 수단을 준다', () => {
    const reset = vi.fn();
    render(<SimulatorError error={new Error('boom')} reset={reset} />);

    expect(screen.getByText('시뮬레이션을 계산하지 못했습니다')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /다시 시도/ }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  // reset()만 주면 같은 입력으로 같은 예외가 반복되어 사용자가 갇힌다.
  test('설정을 되돌리라는 안내와 홈으로 나갈 경로를 함께 제공한다', () => {
    render(<SimulatorError error={new Error('boom')} reset={vi.fn()} />);

    expect(screen.getByText(/마지막으로 바꾼 설정/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /홈으로 돌아가기/ })).toHaveAttribute('href', '/');
  });

  test('digest가 있으면 오류 코드를 보여준다', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' });
    render(<SimulatorError error={error} reset={vi.fn()} />);

    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });
});
