export interface AdjustedPricePoint {
  date: string;
  adjustedClose: number | null;
}

export interface HistoricalAdjustedReturn {
  startDate: string;
  endDate: string;
  annualizedReturn: number;
  cumulativeReturn: number;
  missingPoints: number;
}

const DAY_MS = 86400000;
const DAYS_PER_YEAR = 365.25;

/** 수정 종가의 관측 기간을 연환산한다. 기본 수익률이나 상한·하한을 임의로 넣지 않는다. */
export function historicalAdjustedReturn(points: readonly AdjustedPricePoint[]): HistoricalAdjustedReturn | null {
  let previousTime = -Infinity;
  const valid: { date: string; time: number; value: number }[] = [];
  let missingPoints = 0;
  for (const point of points) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date)) return null;
    const time = Date.parse(`${point.date}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== point.date || time <= previousTime) return null;
    previousTime = time;
    if (point.adjustedClose === null) { missingPoints += 1; continue; }
    if (!Number.isFinite(point.adjustedClose) || point.adjustedClose <= 0) return null;
    valid.push({ date: point.date, time, value: point.adjustedClose });
  }
  if (valid.length < 2) return null;
  const first = valid[0];
  const last = valid[valid.length - 1];
  const days = (last.time - first.time) / DAY_MS;
  if (days < 365) return null;
  const ratio = last.value / first.value;
  const annualizedReturn = (Math.pow(ratio, DAYS_PER_YEAR / days) - 1) * 100;
  const cumulativeReturn = (ratio - 1) * 100;
  if (!Number.isFinite(annualizedReturn) || !Number.isFinite(cumulativeReturn)) return null;
  return { startDate: first.date, endDate: last.date, annualizedReturn, cumulativeReturn, missingPoints };
}
