'use client';

import { useEffect, useRef, useState } from 'react';
import type { InvestmentAsset, SimulationParams } from '../../../core/entities/types';
import { baselineReferenceValue } from '../../../core/usecases/investmentTracking/baselineReferenceValue';
import { applyCurrentQuotes, type ObservedQuote } from '../../../core/usecases/investmentTracking/applyCurrentQuotes';

type Baseline = NonNullable<SimulationParams['investmentBaseline']>;
type QuoteResult = { asset: InvestmentAsset; price: number; value: number; marketTime: number; baseline: boolean } | { asset: InvestmentAsset; error: string; baseline: boolean };
interface QuoteBatch {
  results: QuoteResult[];
  automatic: boolean;
  requestedAssets: readonly InvestmentAsset[];
}

/** 기준 수량에 조회 시세를 곱한 참고값이다. 실제 계좌나 시뮬레이션 입력을 수정하지 않는다. */
export function InvestmentBaselinePreview({ baseline, currentParams, onApply }: {
  baseline?: Baseline;
  currentParams?: SimulationParams;
  onApply?: (quotes: ObservedQuote[]) => void;
}) {
  const [batch, setBatch] = useState<QuoteBatch | null>(null);
  const currentParamsRef = useRef(currentParams);
  const lastAutomaticBatch = useRef<QuoteBatch | null>(null);
  const automatic = currentParams?.autoUpdateEtfPrices === true;

  useEffect(() => { currentParamsRef.current = currentParams; }, [currentParams]);

  useEffect(() => {
    const controller = new AbortController();
    const requestedAssets = currentParamsRef.current?.assets.map((asset) => ({ ...asset })) ?? [];
    const entries: { asset: InvestmentAsset; baseline: boolean }[] = [];
    const add = (asset: InvestmentAsset, isBaseline: boolean) => {
      if (asset.type !== 'etf') return;
      if (!entries.some((entry) => entry.asset.id === asset.id && entry.asset.ticker === asset.ticker && entry.asset.currency === asset.currency)) {
        entries.push({ asset, baseline: isBaseline });
      }
    };
    baseline?.params.assets.forEach((asset) => add(asset, true));
    if (automatic) requestedAssets.forEach((asset) => add(asset, false));
    async function loadQuote({ asset, baseline: isBaseline }: { asset: InvestmentAsset; baseline: boolean }): Promise<QuoteResult> {
      if (!asset.ticker || asset.ticker === 'NEW' || !Number.isFinite(asset.quantity) || asset.quantity < 0) {
        return { asset, baseline: isBaseline, error: '종목 또는 수량을 확인해 주세요.' };
      }
      try {
        const response = await fetch(`/api/stock-price?ticker=${encodeURIComponent(asset.ticker)}`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('시세 조회 실패');
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object') throw new Error('시세 조회 실패');
        const quote = data as { price?: unknown; currency?: unknown; marketTime?: unknown };
        if (quote.currency !== asset.currency) return { asset, baseline: isBaseline, error: '시세 통화가 기준 통화와 달라 계산할 수 없습니다.' };
        if (typeof quote.price !== 'number' || !Number.isFinite(quote.price) || quote.price <= 0
          || typeof quote.marketTime !== 'number' || !Number.isFinite(quote.marketTime) || quote.marketTime <= 0
          || !Number.isFinite(new Date(quote.marketTime * 1000).getTime())) throw new Error('시세 또는 기준 시각 없음');
        const value = baselineReferenceValue(asset.quantity, asset.currency, quote.price, quote.currency);
        if (value === null) throw new Error('평가할 수 없는 수량 또는 가격');
        return { asset, baseline: isBaseline, price: quote.price, value, marketTime: quote.marketTime };
      } catch {
        return { asset, baseline: isBaseline, error: '시세 또는 기준 시각을 확인할 수 없습니다.' };
      }
    }
    void Promise.all(entries.map(loadQuote)).then((results) => {
      if (!controller.signal.aborted) setBatch({ results, automatic, requestedAssets });
    });
    return () => controller.abort();
  }, [baseline, automatic]);

  useEffect(() => {
    if (!automatic || !batch?.automatic || !currentParams || !onApply || lastAutomaticBatch.current === batch) return;
    lastAutomaticBatch.current = batch;
    // 조회 도중 사용자가 단가·종목·통화를 바꾼 항목은 오래된 응답으로 덮지 않는다.
    const safeQuotes: ObservedQuote[] = batch.results.flatMap((quote) => {
      if ('error' in quote) return [];
      const requested = batch.requestedAssets.filter((asset) => asset.id === quote.asset.id);
      const current = currentParams.assets.filter((asset) => asset.id === quote.asset.id);
      if (requested.length !== 1 || current.length !== 1
        || requested[0].ticker !== current[0].ticker || requested[0].currency !== current[0].currency
        || quote.asset.ticker !== current[0].ticker || quote.asset.currency !== current[0].currency
        || requested[0].averagePrice !== current[0].averagePrice) return [];
      return [{ assetId: quote.asset.id, ticker: quote.asset.ticker, currency: quote.asset.currency,
        price: quote.price, marketTime: quote.marketTime }];
    });
    if (applyCurrentQuotes(currentParams, safeQuotes).appliedCount > 0) onApply(safeQuotes);
  }, [automatic, batch, currentParams, onApply]);

  const quotes = batch?.results ?? null;
  const applicableQuotes: ObservedQuote[] = (quotes ?? []).flatMap((quote) => {
    if ('error' in quote) return [];
    if (currentParams && !currentParams.assets.some((asset) => asset.id === quote.asset.id
      && asset.ticker === quote.asset.ticker && asset.currency === quote.asset.currency)) return [];
    return [{ assetId: quote.asset.id, ticker: quote.asset.ticker, currency: quote.asset.currency,
      price: quote.price, marketTime: quote.marketTime }];
  });
  const count = currentParams ? applyCurrentQuotes(currentParams, applicableQuotes).appliedCount : 0;
  return (
    <section aria-label="ETF 시세 참고" className="mt-3 rounded-lg border border-card-border p-3 text-sm">
      <h3 className="font-semibold">ETF 수량의 현재 시세 참고</h3>
      <p className="mt-1 text-xs text-foreground-muted">
        저장된 기준 수량 또는 현재 입력 수량에 조회 시세를 곱한 참고값입니다. 이후 적립·매매·배당·분할은 반영하지 않아 실제 잔고나 현재 평가금과 다를 수 있습니다.
      </p>
      {quotes === null ? <p role="status">시세를 조회하고 있습니다.</p> : quotes.length === 0 ? (
        <p>조회할 ETF가 없습니다.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {quotes.map((quote) => (
            <li key={`${quote.asset.id}:${quote.asset.ticker}:${quote.asset.currency}`}>
              <span className="font-medium">{quote.asset.name || quote.asset.ticker} ({quote.asset.ticker})</span>
              {'error' in quote ? <p>{quote.error}</p> : (
                <p>
                  {quote.baseline ? '기준' : '현재 입력'} {quote.asset.quantity.toLocaleString('ko-KR')}주 × {quote.price.toLocaleString('ko-KR')} {quote.asset.currency}
                  {' = '}{quote.value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} {quote.asset.currency}
                  <br />시세 기준: {new Date(quote.marketTime * 1000).toLocaleString('ko-KR')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {currentParams && onApply && quotes !== null && quotes.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-foreground-muted">시세를 현재 계획에 반영하면 같은 종목의 현재 단가만 바뀝니다. 수량은 갱신되지 않으며 취득원가 미입력 시 세금 추정에도 영향을 줄 수 있습니다. 현재 입력에 대한 분석이 있으면 다시 실행합니다.</p>
          <button type="button" disabled={count === 0} className="mt-2 rounded-lg border border-primary px-3 py-2 text-xs font-semibold text-primary disabled:opacity-50" onClick={() => onApply(applicableQuotes)}>
            조회 시세 {count}개를 현재 계획에 반영
          </button>
        </div>
      )}
    </section>
  );
}
