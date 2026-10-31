import { historicalAdjustedReturn, type AdjustedPricePoint, type HistoricalAdjustedReturn } from '../../../core/usecases/returns/historicalAdjustedReturn';

/** 시나리오를 서버에 보내지 않고 종목의 수정 종가만 가져온다. */
export async function fetchEtfHistoricalReturn(ticker: string, signal: AbortSignal): Promise<HistoricalAdjustedReturn> {
  const end = new Date();
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 5);
  const query = new URLSearchParams({ ticker, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
  const response = await fetch(`/api/stock-history?${query}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('조회 실패');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('prices' in data) || !Array.isArray(data.prices)) throw new Error('자료 누락');
  const points: AdjustedPricePoint[] = data.prices.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('date' in item) || typeof item.date !== 'string'
      || !('adjustedClose' in item) || (item.adjustedClose !== null && typeof item.adjustedClose !== 'number')) throw new Error('자료 오류');
    return { date: item.date, adjustedClose: item.adjustedClose };
  });
  const result = historicalAdjustedReturn(points);
  if (!result) throw new Error('1년 이상의 유효한 수정 종가가 없습니다.');
  return result;
}
