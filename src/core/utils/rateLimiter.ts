interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// 재방문하지 않는 key의 버킷은 resetAt이 지나도 스스로 정리되지 않아 프로세스 수명 동안
// 서서히 쌓인다. 매 호출마다 정리하면 비용이 크므로, 일정 호출 수마다 한 번씩만 만료된
// 버킷을 정리한다.
let callsSinceSweep = 0;
const SWEEP_INTERVAL_CALLS = 100;

function sweepExpiredBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) {
      buckets.delete(key);
    }
  }
}

// 프로세스 메모리 기반 고정 윈도우(fixed window) 레이트 리미터 (엄밀한 슬라이딩 윈도우가
// 아니다 — 윈도우 경계에서 순간적으로 limit의 최대 2배까지 허용될 수 있는 알려진 한계가 있다).
// 여러 인스턴스로 스케일아웃되는 배포에서는 인스턴스별로 독립 카운트되어 완전한 전역 제한은 아니지만,
// 별도 인프라(Redis 등) 없이 단일 사용자의 반복 남용을 억제하는 최소한의 방어선 역할을 한다.
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  callsSinceSweep += 1;
  if (callsSinceSweep >= SWEEP_INTERVAL_CALLS) {
    callsSinceSweep = 0;
    sweepExpiredBuckets(now);
  }

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
