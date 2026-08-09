import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EmailMigrationGate } from '@/web/components/providers/EmailMigrationGate';

const replaceMock = vi.fn();
const sessionState = {
  status: 'authenticated',
  data: { user: { id: 'user-1', provider: 'kakao' } },
};

vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: replaceMock }),
}));
vi.mock('@/core/utils/isDevMode', () => ({ isDevMode: () => false }));

describe('EmailMigrationGate', () => {
  beforeEach(() => vi.clearAllMocks());

  test('전환하지 않은 카카오 세션을 이메일 전환 화면으로 보낸다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ required: true }), { status: 200 })));
    render(<EmailMigrationGate><div>앱 화면</div></EmailMigrationGate>);
    expect(screen.getByText('앱 화면')).toBeInTheDocument();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/migrate-email'));
  });

  test('전환을 마친 카카오 세션은 기존 화면을 유지한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ required: false }), { status: 200 })));
    render(<EmailMigrationGate><div>앱 화면</div></EmailMigrationGate>);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
