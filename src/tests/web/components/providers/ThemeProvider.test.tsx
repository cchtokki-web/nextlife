import { describe, test, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '@/web/components/providers/ThemeProvider';

// 테마는 localStorage(React 바깥의 저장소)를 useSyncExternalStore로 구독한다. 그 구조가
// 깨지는 방식이 조용해서 — 리스너 누수, 같은 탭에서 반영 안 됨 — 여기서 고정한다.
function Probe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      현재:{theme}
    </button>
  );
}

const renderProbe = () => render(<ThemeProvider><Probe /></ThemeProvider>);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeProvider', () => {
  test('저장된 값이 없으면 다크로 시작한다', () => {
    renderProbe();
    expect(screen.getByRole('button')).toHaveTextContent('현재:dark');
  });

  test('저장된 테마를 읽어 첫 렌더부터 반영한다', () => {
    localStorage.setItem('theme', 'light');
    renderProbe();
    expect(screen.getByRole('button')).toHaveTextContent('현재:light');
  });

  // 손상된 값이 그대로 data-theme에 실리면 CSS 변수가 통째로 깨진다.
  test('알 수 없는 값이 저장돼 있으면 기본값으로 떨어진다', () => {
    localStorage.setItem('theme', 'neon');
    renderProbe();
    expect(screen.getByRole('button')).toHaveTextContent('현재:dark');
  });

  // storage 이벤트는 다른 탭에서만 발화한다. 자체 리스너가 없으면 같은 탭에서 토글해도
  // 화면이 전혀 바뀌지 않는다.
  test('같은 탭에서 토글하면 즉시 반영되고 저장된다', () => {
    renderProbe();
    const button = screen.getByRole('button');

    act(() => { button.click(); });

    expect(button).toHaveTextContent('현재:light');
    expect(localStorage.getItem('theme')).toBe('light');

    act(() => { button.click(); });

    expect(button).toHaveTextContent('현재:dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  test('테마를 DOM 속성으로 내려 CSS 변수를 갈아 끼운다', () => {
    renderProbe();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => { screen.getByRole('button').click(); });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  // 모듈 스코프 Set에 죽은 콜백이 쌓이면 라우트 전환마다 누적되고 토글이 전부 순회한다.
  test('언마운트하면 구독을 해제한다', () => {
    const first = renderProbe();
    const second = renderProbe();
    first.unmount();

    // 남은 인스턴스는 정상 동작해야 하고(해제가 남의 구독까지 지우지 않았다),
    // 사라진 인스턴스 때문에 예외가 나지도 않아야 한다.
    const remaining = second.getByRole('button');
    act(() => { remaining.click(); });

    expect(remaining).toHaveTextContent('현재:light');
  });
});
