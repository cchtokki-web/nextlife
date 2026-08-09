import { describe, expect, test } from 'vitest';
import {
  type EmailAccountCandidate,
  isMergeableEmptyEmailAccount,
} from '@/core/utils/emailAccountMerge';

const emptyCandidate = (): EmailAccountCandidate => ({
  id: 'email-user',
  tier: 'basic',
  simulationData: null,
  e2eeEnabledAt: null,
  emailMigrationCompletedAt: null,
  _count: { accounts: 0, scenarios: 0, sessions: 0 },
});

describe('isMergeableEmptyEmailAccount', () => {
  test('가입만 시작하고 사용하지 않은 빈 계정만 자동 통합한다', () => {
    expect(isMergeableEmptyEmailAccount(emptyCandidate())).toBe(true);
  });

  test.each([
    ['카카오 등 연결 계정', { _count: { accounts: 1, scenarios: 0, sessions: 0 } }],
    ['시나리오', { _count: { accounts: 0, scenarios: 1, sessions: 0 } }],
    ['활성 세션', { _count: { accounts: 0, scenarios: 0, sessions: 1 } }],
    ['레거시 데이터', { simulationData: '{}' }],
    ['E2EE 사용 기록', { e2eeEnabledAt: new Date() }],
    ['이메일 전환 기록', { emailMigrationCompletedAt: new Date() }],
    ['유료 등급', { tier: 'premium' }],
  ])('%s가 있으면 자동 통합하지 않는다', (_label, patch) => {
    const candidate = {
      ...emptyCandidate(),
      ...patch,
    } as EmailAccountCandidate;
    expect(isMergeableEmptyEmailAccount(candidate)).toBe(false);
  });
});
