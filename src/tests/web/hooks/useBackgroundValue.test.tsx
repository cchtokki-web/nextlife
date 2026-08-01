import { describe, test, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import { useDeferredValue } from 'react';
import { useBackgroundValue } from '@/web/hooks/useBackgroundValue';

// B1: useDeferredValue를 연쇄하면 2단이 되지 않는다.
// React 19의 updateDeferredValueImpl은 "이미 비긴급 렌더"일 때 새 값을 그대로 반환하므로,
// 첫 useDeferredValue가 만든 지연 렌더 안에서 두 번째 useDeferredValue는 항상 no-op이다.
// 그래서 `second !== first`로 만든 로딩 상태는 프로덕션에서 단 한 번도 true가 되지 않는다.
//
// 렌더마다의 (입력, 지연값, 지연 여부)를 기록해 "지연된 렌더가 실제로 존재하는가"를 본다.
// 훅의 반환값만 act 밖에서 확인하면 이펙트가 이미 정리된 뒤라 항상 따라잡은 상태로 보인다.
interface Frame { value: number; deferred: number; isPending: boolean }

function renderProbe(useHook: (v: number) => readonly [number, boolean]) {
  const frames: Frame[] = [];

  function Probe({ value }: { value: number }) {
    const [deferred, isPending] = useHook(value);
    frames.push({ value, deferred, isPending });
    return null;
  }

  const view = render(<Probe value={1} />);
  return { frames, rerender: (v: number) => act(() => { view.rerender(<Probe value={v} />); }) };
}

describe('useDeferredValue 연쇄의 한계(회귀 근거)', () => {
  test('두 번째 useDeferredValue는 첫 번째를 한 단계 더 늦추지 못한다', () => {
    const { frames, rerender } = renderProbe((value) => {
      const first = useDeferredValue(value);
      const second = useDeferredValue(first);
      return [second, second !== first] as const;
    });

    rerender(2);

    // second가 first보다 뒤처진 렌더가 한 번도 없다 = 2단이 아니다.
    expect(frames.some((f) => f.isPending)).toBe(false);
  });
});

describe('useBackgroundValue', () => {
  test('처음에는 입력값을 그대로 돌려주고 대기 상태가 아니다', () => {
    const { frames } = renderProbe(useBackgroundValue);

    expect(frames[0]).toEqual({ value: 1, deferred: 1, isPending: false });
  });

  test('입력이 바뀌면 그 값을 아직 반영하지 않은 렌더가 실제로 존재한다', () => {
    const { frames, rerender } = renderProbe(useBackgroundValue);
    frames.length = 0;

    rerender(2);

    // 이것이 "탐색 중" 로딩 UI가 프로덕션에서 관측 가능해지는 근거다.
    expect(frames.some((f) => f.value === 2 && f.deferred === 1 && f.isPending)).toBe(true);
  });

  test('결국에는 최신 값을 따라잡고 대기 상태가 풀린다', () => {
    const { frames, rerender } = renderProbe(useBackgroundValue);

    rerender(2);

    expect(frames[frames.length - 1]).toEqual({ value: 2, deferred: 2, isPending: false });
  });

  test('같은 값으로 다시 렌더하면 대기 상태가 생기지 않는다', () => {
    const { frames, rerender } = renderProbe(useBackgroundValue);
    frames.length = 0;

    rerender(1);

    expect(frames.every((f) => !f.isPending)).toBe(true);
  });
});
