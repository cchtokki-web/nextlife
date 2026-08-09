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
  // 탈출구가 있다는 사실은 처음부터 보이되, 데이터를 지우는 동작이므로 3회 실패 전에는 눌리지 않는다.
  test('3회 실패하기 전에는 초기화 버튼이 비활성이다', async () => {
    renderRestore();
    expect(resetButton()).toBeDisabled();

    await failTimes(1);
    expect(resetButton()).toBeDisabled();

    await failTimes(1);
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

    await failTimes(3);
    expect(resetButton()).toBeEnabled();

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
    await failTimes(3);

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

    // 카카오톡에만 남긴다 — 화면에 띄우면 어깨 너머로 새어 나간다.
    expect(screen.queryByText(KEY)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(onAcknowledgeKey).toHaveBeenCalledTimes(1);
  });

  test('전송에 실패하면 키를 보여 주고 재시도와 확인을 제공한다', async () => {
    const onAcknowledgeKey = vi.fn();
    const onRetrySendKey = vi.fn(async () => ({ success: false, error: '실패' }));
    render(
      <E2eeKeyManager
        keyNotice={{ status: 'failed', key: KEY, error: '카카오톡 서버가 응답하지 않습니다.' }}
        onAcknowledgeKey={onAcknowledgeKey}
        onRetrySendKey={onRetrySendKey}
        needsKeyRestore={false}
        handleRestoreKey={vi.fn(async () => true)}
      />
    );

    expect(screen.getByText(KEY)).toBeInTheDocument();
    expect(screen.getByText(/카카오톡 서버가 응답하지 않습니다/)).toBeInTheDocument();

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
});
