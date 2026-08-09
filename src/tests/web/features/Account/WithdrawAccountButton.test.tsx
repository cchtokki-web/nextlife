import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WithdrawAccountButton } from '@/web/features/Account/WithdrawAccountButton';

function renderWithdraw(overrides: Partial<React.ComponentProps<typeof WithdrawAccountButton>> = {}) {
  const onWithdraw = vi.fn(async () => ({ ok: true as const }));
  const utils = render(
    <WithdrawAccountButton onWithdraw={onWithdraw} scenarioCount={3} {...overrides} />
  );
  return { ...utils, onWithdraw };
}

const openButton = () => screen.getByRole('button', { name: '회원 탈퇴' });
const confirmButton = () => screen.getByRole('button', { name: '영구 삭제하고 탈퇴하기' });
const phraseInput = () => screen.getByLabelText('탈퇴 확인 문구');

async function type(value: string) {
  await act(async () => {
    fireEvent.change(phraseInput(), { target: { value } });
  });
}

async function openAndArm() {
  const utils = renderWithdraw();
  fireEvent.click(openButton());
  await type('탈퇴');
  return utils;
}

describe('WithdrawAccountButton — 확인 절차', () => {
  // 헤더에서 로그아웃 바로 옆이라 오클릭 위험이 있다. 버튼 자체는 아무것도 지우면 안 된다.
  test('헤더 버튼은 아무것도 지우지 않고 확인 모달만 연다', () => {
    const { onWithdraw } = renderWithdraw();

    fireEvent.click(openButton());

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onWithdraw).not.toHaveBeenCalled();
  });

  test('확인 문구를 입력하기 전에는 삭제 버튼이 비활성이다', () => {
    renderWithdraw();
    fireEvent.click(openButton());

    expect(confirmButton()).toBeDisabled();
  });

  // includes 비교였다면 '탈퇴합니다'가 통과하고, IME 조합 중간 상태('ㅌ', '타', '탈')가
  // 버튼을 무장시킨다.
  test('확인 문구가 정확히 일치할 때만 삭제 버튼이 열린다', async () => {
    renderWithdraw();
    fireEvent.click(openButton());

    await type('탈');
    expect(confirmButton()).toBeDisabled();

    await type('탈퇴합니다');
    expect(confirmButton()).toBeDisabled();

    await type('탈퇴');
    expect(confirmButton()).toBeEnabled();
  });

  test('취소하면 아무것도 호출하지 않고 입력한 문구도 사라진다', async () => {
    const { onWithdraw } = await openAndArm();

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onWithdraw).not.toHaveBeenCalled();

    // 다시 열었을 때 이미 무장돼 있으면 안 된다.
    fireEvent.click(openButton());
    expect(phraseInput()).toHaveValue('');
    expect(confirmButton()).toBeDisabled();
  });

  // 이 기능의 요점은 "지우면 진짜 끝"이라는 사실을 사용자가 알고 누르는 것이다. 문구가
  // 나중에 "정말 삭제하시겠습니까?"로 뭉개지면 여기서 걸린다.
  test('무엇이 지워지는지와 운영자도 복구할 수 없다는 사실을 구체적으로 알린다', () => {
    renderWithdraw({ scenarioCount: 3 });
    fireEvent.click(openButton());

    expect(screen.getByText(/시나리오 전부 \(3개\)/)).toBeInTheDocument();
    expect(screen.getByText(/되살려 드릴 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/결과 다운로드/)).toBeInTheDocument();
  });

  test('시나리오 개수를 모르면 개수 없이 안내한다', () => {
    renderWithdraw({ scenarioCount: undefined });
    fireEvent.click(openButton());

    expect(screen.getByText('저장된 시나리오 전부')).toBeInTheDocument();
  });
});

describe('WithdrawAccountButton — 삭제 진행과 결과', () => {
  test('삭제 중에는 확인 버튼이 사라져 두 번 호출될 수 없다', async () => {
    let resolve!: (v: { ok: true }) => void;
    const pending = new Promise<{ ok: true }>((r) => { resolve = r; });
    const onWithdraw = vi.fn(() => pending);
    render(<WithdrawAccountButton onWithdraw={onWithdraw} scenarioCount={1} />);

    fireEvent.click(openButton());
    await type('탈퇴');
    await act(async () => { fireEvent.click(confirmButton()); });

    expect(screen.queryByRole('button', { name: '영구 삭제하고 탈퇴하기' })).not.toBeInTheDocument();
    expect(screen.getByText('계정을 삭제하는 중...')).toBeInTheDocument();
    expect(onWithdraw).toHaveBeenCalledTimes(1);

    await act(async () => { resolve({ ok: true }); await pending; });
  });

  test('서버가 실패를 돌려주면 사유를 보여 주고 다시 시도할 수 있게 남는다', async () => {
    const onWithdraw = vi.fn(async () => ({ ok: false as const, message: '계정은 삭제되지 않았습니다.' }));
    render(<WithdrawAccountButton onWithdraw={onWithdraw} scenarioCount={1} />);

    fireEvent.click(openButton());
    await type('탈퇴');
    await act(async () => { fireEvent.click(confirmButton()); });

    expect(screen.getByRole('alert')).toHaveTextContent('계정은 삭제되지 않았습니다.');
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });

  // 일시적인 네트워크 오류에 재입력을 요구할 이유가 없다. 게이트는 이미 제 역할을 했다.
  test('실패해도 입력한 확인 문구는 남는다', async () => {
    const onWithdraw = vi.fn(async () => ({ ok: false as const, message: '오류' }));
    render(<WithdrawAccountButton onWithdraw={onWithdraw} scenarioCount={1} />);

    fireEvent.click(openButton());
    await type('탈퇴');
    await act(async () => { fireEvent.click(confirmButton()); });

    expect(phraseInput()).toHaveValue('탈퇴');
  });

  // 삭제에 성공한 페이지는 내비게이션을 기다리는 시체다. 쿠키는 아직 살아 있으므로
  // 상호작용 가능한 상태로 돌아가면 그 요청 하나가 계정을 부활시킬 수 있다.
  test('성공하면 진행 중 상태로 남고 버튼이 돌아오지 않는다', async () => {
    const { onWithdraw } = renderWithdraw();

    fireEvent.click(openButton());
    await type('탈퇴');
    await act(async () => { fireEvent.click(confirmButton()); });

    expect(onWithdraw).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '영구 삭제하고 탈퇴하기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
    expect(screen.getByText(/탈퇴 처리가 끝났습니다/)).toBeInTheDocument();
  });

  test('확인 단계에서는 Escape로 닫히지만 삭제 중에는 닫히지 않는다', async () => {
    let resolve!: (v: { ok: true }) => void;
    const pending = new Promise<{ ok: true }>((r) => { resolve = r; });
    const onWithdraw = vi.fn(() => pending);
    render(<WithdrawAccountButton onWithdraw={onWithdraw} scenarioCount={1} />);

    fireEvent.click(openButton());
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(openButton());
    await type('탈퇴');
    await act(async () => { fireEvent.click(confirmButton()); });
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(screen.getByText('계정을 삭제하는 중...')).toBeInTheDocument();

    await act(async () => { resolve({ ok: true }); await pending; });
  });
});
