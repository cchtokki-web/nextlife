// 선형보간 분위수.
//
// 오름차순으로 **이미 정렬된** 배열을 받는다 — 같은 표본에서 p10/p50/p90을 연달아 구하는
// 것이 이 함수의 주 용도라, 호출부가 한 번만 정렬하도록 계약을 밖으로 뺐다.
//
// 빈 배열에 던지지 않고 NaN을 주는 이유: 시행이 전부 실패한 경우에도 화면이 죽는 대신
// "값 없음"으로 표현될 수 있어야 한다. 호출부가 Number.isFinite로 거른다.
export function percentileOfSorted(sortedAsc: readonly number[], q: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];

  const clamped = Math.min(1, Math.max(0, q));
  const position = clamped * (sortedAsc.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) return sortedAsc[lowerIndex];

  const weight = position - lowerIndex;
  return sortedAsc[lowerIndex] * (1 - weight) + sortedAsc[upperIndex] * weight;
}

// 비율의 신뢰구간은 여기가 아니라 confidenceInterval.ts에 있다. 이 파일은 표본에서
// 분위수를 뽑는 일만 한다 — 같은 「통계」라는 이유로 두 파일에 나눠 담으면 다음 사람이
// 여기서 못 찾고 하나 더 만든다.
