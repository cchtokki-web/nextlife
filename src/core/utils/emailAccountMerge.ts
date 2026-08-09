/** 이메일 소유 확인 뒤 병합할 사용자 행의 최소 형태. */
export interface EmailAccountCandidate {
  id: string;
  simulationData: string | null;
  e2eeEnabledAt: Date | null;
  scenarios: Array<{ id: string }>;
  _count: {
    scenarios: number;
  };
}

export const emailAccountCandidateSelect = {
  id: true,
  simulationData: true,
  e2eeEnabledAt: true,
  scenarios: {
    where: { isDefault: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take: 1,
  },
  _count: {
    select: { scenarios: true },
  },
} as const;
