'use client';

import { useEffect, useRef, useState } from 'react';
import { historicalAdjustedReturn, type AdjustedPricePoint, type HistoricalAdjustedReturn } from '../../../core/usecases/returns/historicalAdjustedReturn';
import styles from './AssetForm.module.css';

interface Result { ticker: string; result: HistoricalAdjustedReturn; }

export function EtfHistoricalReturn({ ticker, onApply }: { ticker: string; onApply: (ticker: string, value: number) => void }) {
  const [result, setResult] = useState<Result | null>(null);
  const [loadingTicker, setLoadingTicker] = useState<string | null>(null);
  const [error, setError] = useState<{ ticker: string; message: string } | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => { controller.current?.abort(); }, [ticker]);

  const load = async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoadingTicker(ticker);
    setError(null);
    setResult(null);
    const end = new Date();
    const start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 5);
    const query = new URLSearchParams({ ticker, start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) });
    try {
      const response = await fetch(`/api/stock-history?${query}`, { signal: request.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('조회 실패');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('prices' in data) || !Array.isArray(data.prices)) throw new Error('자료 누락');
      const points: AdjustedPricePoint[] = data.prices.map((item: unknown) => {
        if (!item || typeof item !== 'object' || !('date' in item) || typeof item.date !== 'string'
          || !('adjustedClose' in item) || (item.adjustedClose !== null && typeof item.adjustedClose !== 'number')) throw new Error('자료 오류');
        return { date: item.date, adjustedClose: item.adjustedClose };
      });
      const computed = historicalAdjustedReturn(points);
      if (!computed) throw new Error('1년 이상의 유효한 수정 종가가 없습니다.');
      if (!request.signal.aborted) setResult({ ticker, result: computed });
    } catch {
      if (!request.signal.aborted) setError({ ticker, message: '1년 이상의 유효한 수정 종가를 조회하지 못했습니다. 기존 입력값을 유지합니다.' });
    } finally {
      if (!request.signal.aborted) setLoadingTicker(null);
    }
  };

  const visible = result?.ticker === ticker ? result.result : null;
  return (
    <div className="basis-full">
      <button type="button" className={styles.yieldPresetButton} disabled={!ticker || ticker === 'NEW' || loadingTicker === ticker} onClick={load}>
        수정 종가로 과거 수익률 보기
      </button>
      {error?.ticker === ticker && <p role="alert">{error.message}</p>}
      {visible && (
        <div className="mt-2 text-xs text-foreground-muted" role="status">
          <p>Yahoo Finance 수정 종가 기준 {visible.startDate} ~ {visible.endDate}: 연환산 {visible.annualizedReturn.toFixed(1)}%, 누적 {visible.cumulativeReturn.toFixed(1)}%</p>
          <p>분배금·분할 조정 자료를 사용한 과거 추정치입니다. 원천 자료의 완전성은 확인되지 않았고, 개인 세금·거래비용은 반영하지 않아 운용사 공시와 다를 수 있습니다. 마지막 값은 장중 시세일 수 있고 미래 수익률을 보장하지 않습니다.</p>
          {visible.missingPoints > 0 && <p>기간 중 수정 종가 {visible.missingPoints}건이 누락되어 자료의 완전성을 확인할 수 없습니다.</p>}
          <button type="button" className={styles.yieldPresetButton}
            onClick={() => onApply(ticker, Number(visible.annualizedReturn.toFixed(1)))}>
            이 값을 연 총수익률에 적용
          </button>
          <p>연 배당률은 바뀌지 않습니다. 기존 배당률이 이 가정에 적합한지 확인해 주세요.</p>
        </div>
      )}
    </div>
  );
}
