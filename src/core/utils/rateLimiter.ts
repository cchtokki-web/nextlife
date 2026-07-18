interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// 프로세스 메모리 기반 슬라이딩 윈도우 레이트 리미터.
// 여러 인스턴스로 스케일아웃되는 배포에서는 인스턴스별로 독립 카운트되어 완전한 전역 제한은 아니지만,
// 별도 인프라(Redis 등) 없이 단일 사용자의 반복 남용을 억제하는 최소한의 방어선 역할을 한다.
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  if (bucket.count >= limit) {
    return true;
  }

  bucket.count += 1;
  return false;
}
