import { describe, test, expect } from 'vitest';
import { migrateLegacyReturnKeys } from '@/infrastructure/storage/migrateLegacyReturnKeys';

describe('migrateLegacyReturnKeys', () => {
  test('자산의 annualGrowthRate를 값 변환 없이 totalReturn으로 옮긴다', () => {
    const raw = { assets: [{ id: 'a', annualGrowthRate: 7, dividendYield: 3 }] };
    const out = migrateLegacyReturnKeys(raw) as {
      assets: { totalReturn: number; dividendYield: number; annualGrowthRate?: number }[];
    };
    expect(out.assets[0].totalReturn).toBe(7);
    expect('annualGrowthRate' in out.assets[0]).toBe(false);
    expect(out.assets[0].dividendYield).toBe(3);
  });

  test('사적연금과 ISA의 annualReturn도 옮긴다', () => {
    const raw = {
      privatePensions: [{ id: 'p', annualReturn: 4 }],
      isaAccounts: [{ id: 'i', annualReturn: 5, dividendYield: 1.5 }],
    };
    const out = migrateLegacyReturnKeys(raw) as {
      privatePensions: { totalReturn: number }[];
      isaAccounts: { totalReturn: number }[];
    };
    expect(out.privatePensions[0].totalReturn).toBe(4);
    expect(out.isaAccounts[0].totalReturn).toBe(5);
  });

  // 값을 더하지 않으므로 몇 번을 돌려도 같다. 버전 마커가 필요 없는 근거다.
  test('두 번 적용해도 결과가 같다', () => {
    const raw = { assets: [{ id: 'a', annualGrowthRate: 7, dividendYield: 3 }] };
    const once = migrateLegacyReturnKeys(raw);
    const twice = migrateLegacyReturnKeys(once);
    expect(twice).toEqual(once);
  });

  // 원칙: 새 키가 이미 있으면 옛 키는 낡은 잔재다. 새 키를 이긴다.
  test('totalReturn이 이미 있으면 옛 키가 덮어쓰지 않는다', () => {
    const raw = { assets: [{ id: 'a', totalReturn: 10, annualGrowthRate: 7 }] };
    const out = migrateLegacyReturnKeys(raw) as { assets: { totalReturn: number }[] };
    expect(out.assets[0].totalReturn).toBe(10);
  });

  test('입력 객체를 변형하지 않는다', () => {
    const raw = { assets: [{ id: 'a', annualGrowthRate: 7 }] };
    migrateLegacyReturnKeys(raw);
    expect(raw.assets[0]).toEqual({ id: 'a', annualGrowthRate: 7 });
  });

  test('객체가 아니거나 목록이 없으면 그대로 돌려준다', () => {
    expect(migrateLegacyReturnKeys(null)).toBe(null);
    expect(migrateLegacyReturnKeys('x')).toBe('x');
    expect(migrateLegacyReturnKeys({ userProfile: {} })).toEqual({ userProfile: {} });
  });

  test('customYieldSnapshot은 값이 숫자 맵이라 손대지 않는다', () => {
    const raw = { customYieldSnapshot: { assets: { a: 7 }, privatePensions: {}, isaAccounts: {} } };
    expect(migrateLegacyReturnKeys(raw)).toEqual(raw);
  });
});
