import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import EmailMigrationForm from '@/web/features/auth/EmailMigrationForm';

const signOutMock = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: { user: { id: 'kakao-user', provider: 'kakao' } },
  }),
  signOut: (...args: unknown[]) => signOutMock(...args),
}));
vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));

describe('EmailMigrationForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/user/email-migration/status') {
        return new Response(JSON.stringify({ required: true, email: null }), { status: 200 });
      }
      if (url === '/api/user/email-migration/request') {
        return new Response(JSON.stringify({ message: '인증번호를 보냈습니다.' }), { status: 200 });
      }
      if (url === '/api/scenarios') {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url === '/api/user/email-migration/confirm') {
        return new Response(JSON.stringify({ success: true, keyEmailSent: true }), { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
  });

  test('키 입력란 없이 브라우저의 기존 키로 전환하고 이메일 재전송을 요청한다', async () => {
    localStorage.setItem('nextlife_e2ee_key_kakao-user', 'ABC234');
    render(<EmailMigrationForm />);
    const emailInput = await screen.findByLabelText('연결할 이메일 주소');
    fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '인증번호 받기' })); });

    fireEvent.change(await screen.findByLabelText('이메일 인증번호'), { target: { value: '123456' } });
    expect(screen.queryByLabelText(/현재 보안키/)).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '이메일 로그인 연결' })); });

    expect(await screen.findByText(/이메일 로그인 전환이 완료됐고/)).toBeInTheDocument();
    expect(localStorage.getItem('nextlife_e2ee_key_kakao-user')).toBe('ABC234');
    expect(fetch).toHaveBeenCalledWith('/api/user/email-migration/confirm', expect.objectContaining({ method: 'POST' }));
    const confirmCall = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/user/email-migration/confirm');
    expect(JSON.parse(String(confirmCall?.[1]?.body))).toMatchObject({ securityKey: 'ABC234' });
  });

  test('브라우저에 기존 키가 없으면 입력란 대신 초기화 경로를 안내한다', async () => {
    render(<EmailMigrationForm />);
    fireEvent.change(await screen.findByLabelText('연결할 이메일 주소'), { target: { value: 'user@example.com' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '인증번호 받기' })); });
    fireEvent.change(await screen.findByLabelText('이메일 인증번호'), { target: { value: '123456' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '이메일 로그인 연결' })); });

    expect(await screen.findByText(/이 브라우저에 현재 보안키가 없어/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '데이터 초기화 및 새 보안키 발급' })).toBeInTheDocument();
  });

  test('전환 완료 후 카카오 세션을 종료하고 이메일 로그인으로 이동한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/user/email-migration/status') {
        return new Response(JSON.stringify({ required: false, email: 'user@example.com' }), { status: 200 });
      }
      throw new Error('Unexpected request');
    }));
    render(<EmailMigrationForm />);
    fireEvent.click(await screen.findByRole('button', { name: '카카오 로그아웃 후 이메일 로그인' }));
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login?migrated=1' });
  });
});
