/** 이메일 소유 확인 뒤 자동으로 정리해도 데이터 손실이 없는 사용자 행의 최소 형태. */
export interface EmailAccountCandidate {
  id: string;
  tier: string;
  simulationData: string | null;
  e2eeEnabledAt: Date | null;
  emailMigrationCompletedAt: Date | null;
  _count: {
    accounts: number;
    scenarios: number;
    sessions: number;
  };
}

/**
 * 이메일 가입을 시작했지만 실제 사용은 하지 않은 빈 계정만 자동 통합한다.
 * 데이터·외부 로그인·활성 세션·유료 등급 중 하나라도 있으면 수동 병합 대상으로 남긴다.
 */
export function isMergeableEmptyEmailAccount(candidate: EmailAccountCandidate): boolean {
  return candidate.tier === 'basic'
    && candidate.simulationData === null
    && candidate.e2eeEnabledAt === null
    && candidate.emailMigrationCompletedAt === null
    && candidate._count.accounts === 0
    && candidate._count.scenarios === 0
    && candidate._count.sessions === 0;
}

export const emailAccountCandidateSelect = {
  id: true,
  tier: true,
  simulationData: true,
  e2eeEnabledAt: true,
  emailMigrationCompletedAt: true,
  _count: {
    select: { accounts: true, scenarios: true, sessions: true },
  },
} as const;

export const occupiedEmailMessage =
  '이 이메일 계정에는 저장된 데이터 또는 로그인 정보가 있어 자동으로 합칠 수 없습니다. 이메일 계정의 데이터 확인 후 별도 병합이 필요합니다.';
