import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { E2eeKeyManager } from '@/web/components/E2eeKeyManager';

// 6자리를 한 번에 붙여 넣으면 컴포넌트가 나머지 칸을 채우고 곧바로 복구를 시도한다.
async function enterKey(key: string) {
  const first = screen.getByLabelText('보안키 1번째 자리');
  await act(async () => {
    fireEvent.change(first, { target: { value: key } });
  });
}

async function failTimes(count: number) {
  for (let i = 0; i < count; i++) {
    await enterKey('WRONG1');
  }
}

const resetButton = () => screen.getByRole('button', { name: '모든 데이터 초기화 및 새 보안키 발급' });

function renderRestore(overrides: Partial<React.ComponentProps<typeof E2eeKeyManager>> = {}) {
  const handleRestoreKey = vi.fn(async () => false);
  const onResetScenarios = vi.fn(async () => {});
  const utils = render(
    <E2eeKeyManager
      needsKeyRestore
      handleRestoreKey={handleRestoreKey}
      onResetScenarios={onResetScenarios}
      {...overrides}
    />
  );
  return { ...utils, handleRestoreKey, onResetScenarios };
}

describe('E2eeKeyManager — 복구 실패와 탈출구', () => {
  // 탈출구가 있다는 사실은 처음부터 보이되, 데이터를 지우는 동작이므로 5회 실패 전에는 눌리지 않는다.
  test('5회 실패하기 전에는 초기화 버튼이 비활성이다', async () => {
    renderRestore();
    expect(resetButton()).toBeDisabled();

    await failTimes(1);
    expect(resetButton()).toBeDisabled();

    await failTimes(1);
    expect(resetButton()).toBeDisabled();

    await failTimes(2);
    expect(resetButton()).toBeDisabled();

    await failTimes(1);
    expect(resetButton()).toBeEnabled();
  });

  // 예전에는 잠금이 걸릴 때 실패 카운터를 0으로 되돌렸다. 초기화 버튼이 같은 카운터를 읽는
  // 지금 그러면 3·4회에 열렸던 탈출구가 5회에 다시 닫힌다 — 가장 필요한 순간에 사라진다.
  test('잠금이 걸려도 초기화 버튼은 계속 활성이다', async () => {
    renderRestore();
    await failTimes(5);

    // 입력은 잠긴다.
    expect(screen.getByLabelText('보안키 1번째 자리')).toBeDisabled();
    expect(screen.getByText(/초 후 다시 시도해 주세요/)).toBeInTheDocument();
    // 하지만 탈출구는 막지 않는다. 막으면 키를 모르는 사용자가 할 수 있는 일이 없다.
    expect(resetButton()).toBeEnabled();
  });

  test('복구에 성공하면 실패 횟수를 되돌린다', async () => {
    const handleRestoreKey = vi.fn(async () => false);
    renderRestore({ handleRestoreKey });

    await failTimes(4);
    expect(resetButton()).toBeDisabled();

    handleRestoreKey.mockResolvedValue(true);
    await enterKey('RIGHT1');

    expect(resetButton()).toBeDisabled();
  });

  test('훅이 준 복구 실패 사유를 그대로 보여 준다', () => {
    renderRestore({ restoreError: '서버에서 암호화된 데이터를 찾지 못해 보안키를 확인할 수 없습니다.' });
    expect(screen.getByRole('alert')).toHaveTextContent('암호화된 데이터를 찾지 못해');
  });

  // 되돌릴 수 없는 삭제라 한 번의 오클릭으로 실행되면 안 된다.
  test('초기화는 두 단계 확인을 거친다', async () => {
    const { onResetScenarios } = renderRestore();
    await failTimes(5);

    fireEvent.click(resetButton());
    expect(screen.getByText(/되돌릴 수 없습니다/)).toBeInTheDocument();
    expect(onResetScenarios).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onResetScenarios).not.toHaveBeenCalled();

    fireEvent.click(resetButton());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '삭제하고 새 키 받기' }));
    });
    expect(onResetScenarios).toHaveBeenCalledTimes(1);
  });
});

describe('E2eeKeyManager — 보안키 발급 안내', () => {
  const KEY = 'K7M2QP';

  test('전송에 성공하면 키를 화면에 띄우지 않는다', () => {
    const onAcknowledgeKey = vi.fn();
    render(
      <E2eeKeyManager
        keyNotice={{ status: 'sent', key: KEY }}
        onAcknowledgeKey={onAcknowledgeKey}
        needsKeyRestore={false}
        handleRestoreKey={vi.fn(async () => true)}
      />
    );

    // 이메일에만 남긴다 — 화면에 띄우면 어깨 너머로 새어 나간다.
    expect(screen.queryByText(KEY)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(onAcknowledgeKey).toHaveBeenCalledTimes(1);
  });

  test('전송에 실패하면 키를 보여 주고 재시도와 확인을 제공한다', async () => {
    const onAcknowledgeKey = vi.fn();
    const onRetrySendKey = vi.fn(async () => ({ success: false, error: '실패' }));
    render(
      <E2eeKeyManager
        keyNotice={{ status: 'failed', key: KEY, error: '메일 서버가 응답하지 않습니다.' }}
        onAcknowledgeKey={onAcknowledgeKey}
        onRetrySendKey={onRetrySendKey}
        needsKeyRestore={false}
        handleRestoreKey={vi.fn(async () => true)}
      />
    );

    expect(screen.getByText(KEY)).toBeInTheDocument();
    expect(screen.getByText(/메일 서버가 응답하지 않습니다/)).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: '다시 보내기' });
    await act(async () => { fireEvent.click(retry); });
    expect(onRetrySendKey).toHaveBeenCalledTimes(1);
    // 레이트 리밋을 태우지 않도록 쿨다운을 건다.
    expect(screen.getByRole('button', { name: /다시 보내기 \(\d+초\)/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '기록했습니다' }));
    expect(onAcknowledgeKey).toHaveBeenCalledTimes(1);
  });

  test('백업이 확인되지 않은 키도 같은 방식으로 안내한다', () => {
    render(
      <E2eeKeyManager
        keyNotice={{ status: 'unbacked', key: KEY }}
        onAcknowledgeKey={vi.fn()}
        needsKeyRestore={false}
        handleRestoreKey={vi.fn(async () => true)}
      />
    );

    expect(screen.getByText('보안키 백업이 확인되지 않았습니다')).toBeInTheDocument();
    expect(screen.getByText(KEY)).toBeInTheDocument();
  });

  test('이메일 전송 실패 시 같은 키를 다시 보낼 수 있다', () => {
    render(
      <E2eeKeyManager
        keyNotice={{
          status: 'failed',
          key: KEY,
          error: '이메일 전송에 실패했습니다.',
        }}
        onAcknowledgeKey={vi.fn()}
        onRetrySendKey={vi.fn(async () => ({ success: false }))}
        needsKeyRestore={false}
        handleRestoreKey={vi.fn(async () => true)}
      />
    );

    expect(screen.getByRole('button', { name: '다시 보내기' })).toBeInTheDocument();
  });

  // 발급 안내가 떠 있는 동안에는 복구 입력창이 뜨면 안 된다 — 둘 다 전면 모달이다.
  test('발급 안내가 복구 입력창보다 우선한다', () => {
    render(
      <E2eeKeyManager
        keyNotice={{ status: 'sending', key: KEY }}
        needsKeyRestore
        handleRestoreKey={vi.fn(async () => true)}
      />
    );

    expect(screen.getByText('보안키 발급 중')).toBeInTheDocument();
    expect(screen.queryByLabelText('보안키 1번째 자리')).not.toBeInTheDocument();
  });

  test('안내할 것이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(
      <E2eeKeyManager needsKeyRestore={false} handleRestoreKey={vi.fn(async () => true)} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  // 첫 칸 포커스는 모달이 그려진 뒤라야 하므로 100ms 지연을 둔다. 그 사이에 화면이 닫히면
  // 타이머도 함께 사라져야 한다 — 남으면 이미 없는 화면을 대신해 «다시 그려진» 다른 입력으로
  // 포커스가 튀고, 테스트 환경에서는 jsdom 정리 뒤 document에 닿아 unhandled error가 된다.
  test('포커스 타이머는 언마운트와 함께 정리된다', () => {
    vi.useFakeTimers();
    try {
      const { unmount } = render(
        <E2eeKeyManager needsKeyRestore handleRestoreKey={vi.fn(async () => true)} />
      );
      // 이 화면에는 잠금 카운트다운이 없으므로 걸려 있는 타이머는 포커스 지연 하나뿐이다.
      expect(vi.getTimerCount()).toBe(1);

      unmount();

      // 콜백이 무엇을 하는지가 아니라 «타이머가 남았는지»를 본다. 언마운트 뒤에는
      // getElementById가 어차피 null을 주므로 focus 호출 여부로는 정리 누락을 잡지 못한다.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // 복구 실패 뒤 입력칸을 비우고 첫 칸으로 돌려보내는 타이머도 같은 ref를 쓴다. 예전에는
  // 이쪽이 정리 대상 밖에 있어, 실패 직후 화면이 닫히면 그대로 남았다.
  test('복구 실패가 건 포커스 타이머도 언마운트와 함께 정리된다', async () => {
    // 실패가 «가짜 타이머 위에서» 일어나야 한다. 실제 타이머로 걸린 뒤에 useFakeTimers를
    // 켜면 getTimerCount가 그것을 세지 못해 단언이 공허해진다.
    vi.useFakeTimers();
    try {
      const { unmount } = render(
        <E2eeKeyManager needsKeyRestore handleRestoreKey={vi.fn(async () => false)} />
      );
      // 모달이 뜰 때 건 100ms 타이머를 먼저 흘려보낸다.
      await act(async () => { vi.advanceTimersByTime(200); });
      await enterKey('WRONG1');
      unmount();

      // 증상을 그대로 재현한다: 화면이 다시 그려져 같은 id의 «다른» 입력이 생긴 상황.
      // 타이머가 남아 있으면 이 입력을 붙잡는다. 개수(getTimerCount)로는 판정할 수 없다 —
      // React 스케줄러의 내부 타이머가 함께 세어져 우리 것과 구분되지 않는다.
      const stray = document.createElement('input');
      stray.id = 'pin-input-0';
      document.body.appendChild(stray);
      const focus = vi.spyOn(stray, 'focus');

      act(() => { vi.advanceTimersByTime(500); });

      expect(focus).not.toHaveBeenCalled();
      stray.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});
