import { describe, test, expect } from 'vitest';
import { describeIsaAccountLabel } from '@/web/features/Pdf/describeIsaAccount';
import type { IsaAccount } from '@/core/entities/types';

// 세 번째이자 마지막 라벨 자리. 사적연금·투자자산과 같은 규칙을 쓴다.
//
// 예전에는 page.tsx 안에 인라인 삼항이었다 — `isa.type === 'general' ? '일반형' : '서민형'`.
// IsaAccountType이 두 값이라 지금은 망라적이지만, 값이 늘면 새 종류가 «조용히» 「서민형」으로
// 떨어진다. 사적연금에서 퇴직연금이 「기타」로 인쇄되던 것과 정확히 같은 함정이다.

function isa(overrides: Partial<IsaAccount> = {}): IsaAccount {
  return {
    id: 'isa1',
    type: 'general',
    balance: 30_000_000,
    monthlyContribution: 0,
    annualReturn: 5,
    dividendYield: 2,
    currency: 'KRW',
    maturityYears: 3,
    ...overrides,
  };
}

describe('describeIsaAccountLabel', () => {
  test('이름이 있으면 이름과 계좌 종류를 함께 보여준다', () => {
    expect(describeIsaAccountLabel(isa({ name: '미래에셋 ISA' }))).toBe('미래에셋 ISA (일반형)');
  });

  test('두 종류를 모두 제 이름으로 부른다', () => {
    expect(describeIsaAccountLabel(isa({ name: 'A', type: 'general' }))).toBe('A (일반형)');
    expect(describeIsaAccountLabel(isa({ name: 'A', type: 'low_income' }))).toBe('A (서민형)');
  });

  // 종전 인라인 삼항은 이름이 없으면 「ISA 계좌 (일반형)」이었다. 다른 두 자리와 맞춰
  // 종류만 남긴다 — 「ISA 계좌」라는 군말이 괄호 안 종류와 겹쳤다.
  test('이름이 없으면 계좌 종류만 보여준다', () => {
    expect(describeIsaAccountLabel(isa())).toBe('일반형');
    expect(describeIsaAccountLabel(isa({ name: '' }))).toBe('일반형');
    expect(describeIsaAccountLabel(isa({ name: '   ' }))).toBe('일반형');
  });

  test('알 수 없는 종류는 기타로 부른다', () => {
    expect(describeIsaAccountLabel(isa({ type: 'unknown' as IsaAccount['type'] }))).toBe('기타');
  });
});
