import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SimpleSimulator } from '@/web/features/Landing/SimpleSimulator';

describe('SimpleSimulator 금액 입력', () => {
  // 저장값(원)을 곧바로 되돌려 그리면 지우는 순간 0이 다시 찍혀 «0»을 지울 수 없다.
  test('금액을 지우면 화면은 빈 칸으로 남고 이어서 새 금액을 칠 수 있다', () => {
    render(<SimpleSimulator />);
    const input = document.querySelector('input[name="currentAssets"]') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '' } });

    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: '3000' } });

    expect(input).toHaveValue('3,000');
  });

  test('포커스를 잃으면 저장된 금액을 만원 단위 콤마 표기로 되돌린다', () => {
    render(<SimpleSimulator />);
    const input = document.querySelector('input[name="monthlyInvestment"]') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(input).toHaveValue('0');
  });
});
