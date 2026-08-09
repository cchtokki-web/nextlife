import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import LoginForm from '@/web/features/auth/LoginForm';

const signInMock = vi.fn();
const getSessionMock = vi.fn();
vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

function fetchMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/dev-mode') {
      return new Response(JSON.stringify({ isDevMode: false }), { status: 200 });
    }
    if (url === '/api/auth/register') {
      return new Response(JSON.stringify({ message: '입력하신 이메일로 보안키를 보냈습니다.' }), { status: 201 });
    }
    if (url === '/api/auth/security-key/reset') {
      return new Response(JSON.stringify({ message: '발송했습니다.' }), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

async function openLoginForm() {
  render(<LoginForm />);
  await screen.findByRole('button', { name: '이메일로 회원가입' });
}

async function enterSixDigitKey(key = 'ABC234') {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('보안키 1번째 자리'), { target: { value: key } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));
  });
}

describe('LoginForm — 이메일 보안키 흐름', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock());
    signInMock.mockResolvedValue({ ok: false, error: 'CredentialsSignin' });
  });

  test('회원가입 버튼을 누르면 이메일 입력과 보안키 보관 안내를 보여 준다', async () => {
    await openLoginForm();
    fireEvent.click(screen.getByRole('button', { name: '이메일로 회원가입' }));
    expect(screen.getByLabelText('이메일 주소')).toBeInTheDocument();
    expect(screen.getByText(/분실하면 저장된 데이터를 복구할 수 없으므로/)).toBeInTheDocument();
  });

  test('기존 카카오 사용자는 전환 화면을 목적지로 로그인할 수 있다', async () => {
    await openLoginForm();
    fireEvent.click(screen.getByRole('button', { name: '기존 카카오 사용자 로그인 및 전환' }));
    expect(signInMock).toHaveBeenCalledWith('kakao', { callbackUrl: '/migrate-email' });
  });

  test('가입 요청이 성공하면 이메일 보안키 입력 단계로 바뀐다', async () => {
    await openLoginForm();
    fireEvent.click(screen.getByRole('button', { name: '이메일로 회원가입' }));
    fireEvent.change(screen.getByLabelText('이메일 주소'), { target: { value: 'user@example.com' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '가입하고 보안키 받기' })); });
    expect(await screen.findByRole('heading', { name: '보안키 입력' })).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '가입 및 로그인' })).toBeInTheDocument();
  });

  test('기존 사용자는 5회 실패 후 초기화·재전송 경고에서 취소하거나 수락할 수 있다', async () => {
    await openLoginForm();
    fireEvent.click(screen.getByRole('button', { name: '이미 가입했다면 이메일로 로그인' }));
    fireEvent.change(screen.getByLabelText('이메일 주소'), { target: { value: 'user@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '보안키 입력하기' }));

    for (let attempt = 0; attempt < 5; attempt += 1) await enterSixDigitKey();
    const resetButton = screen.getByRole('button', { name: '데이터 초기화 및 보안키 재전송' });
    fireEvent.click(resetButton);
    expect(screen.getByText(/기존 자산 데이터가 모두 삭제되며/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByText(/정말 초기화하시겠습니까/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '데이터 초기화 및 보안키 재전송' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '수락하고 재전송' })); });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/auth/security-key/reset', expect.any(Object)));
    expect(screen.getByText(/새 키를 입력하면 기존 데이터가 초기화되고 로그인됩니다/)).toBeInTheDocument();
  });
});
