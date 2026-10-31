'use client';

import { useEffect, useRef, useState } from 'react';
import type { InvestmentAsset, SimulationParams } from '../../../core/entities/types';
import { baselineReferenceValue } from '../../../core/usecases/investmentTracking/baselineReferenceValue';
import { compareReferenceQuantities } from '../../../core/usecases/investmentTracking/compareReferenceQuantities';
import { applyCurrentQuotes, type ObservedQuote } from '../../../core/usecases/investmentTracking/applyCurrentQuotes';
import { applyHistoricalEtfReturns, type ObservedHistoricalReturn } from '../../../core/usecases/investmentTracking/applyHistoricalEtfReturns';
import { fetchEtfHistoricalReturn } from '../AssetForm/fetchEtfHistoricalReturn';
import type { HistoricalAdjustedReturn } from '../../../core/usecases/returns/historicalAdjustedReturn';

type Baseline = NonNullable<SimulationParams['investmentBaseline']>;
type QuoteResult = { asset: InvestmentAsset; price: number; value: number; marketTime: number; baseline: boolean } | { asset: InvestmentAsset; error: string; baseline: boolean };
interface QuoteBatch {
  results: QuoteResult[];
  automatic: boolean;
  requestedAssets: readonly InvestmentAsset[];
  historicalKey: string;
  historical: Array<{ asset: InvestmentAsset; result: HistoricalAdjustedReturn | null }>;
  asOfDate: string;
}

function historicalStatus(asset: InvestmentAsset, result: HistoricalAdjustedReturn, current: SimulationParams | undefined, asOfDate: string): string {
  if (result.missingPoints > 0) return '자료가 누락되어 자동 반영하지 않았습니다.';
  const ageDays = (Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${result.endDate}T00:00:00Z`)) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 30) return '자료 기준일이 오래되었거나 올바르지 않아 자동 반영하지 않았습니다.';
  const matching = current?.assets.filter((item) => item.id === asset.id) ?? [];
  if (matching.length !== 1 || matching[0].ticker !== asset.ticker || matching[0].autoHistoricalReturn !== true
    || matching[0].dividendYield !== asset.dividendYield) return '조회 중 입력이 변경되어 자동 반영하지 않았습니다.';
  if (matching[0].totalReturn === Number(result.annualizedReturn.toFixed(1))) return '현재 입력과 일치합니다.';
  if (matching[0].totalReturn !== asset.totalReturn) return '조회 중 입력이 변경되어 자동 반영하지 않았습니다.';
  return '자동 반영을 처리 중입니다.';
}

/** 기준 수량에 조회 시세를 곱한 참고값이다. 실제 계좌나 시뮬레이션 입력을 수정하지 않는다. */
export function InvestmentBaselinePreview({ baseline, currentParams, onApply }: {
  baseline?: Baseline;
  currentParams?: SimulationParams;
  onApply?: (quotes: ObservedQuote[], returns?: ObservedHistoricalReturn[]) => void;
}) {
  const [batch, setBatch] = useState<QuoteBatch | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const currentParamsRef = useRef(currentParams);
  const lastAutomaticBatch = useRef<QuoteBatch | null>(null);
  const automatic = currentParams?.autoUpdateEtfPrices === true;
  const historicalKey = JSON.stringify((currentParams?.assets ?? []).filter((asset) => asset.type === 'etf' && asset.autoHistoricalReturn === true)
    .map((asset) => [asset.id, asset.ticker]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

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
    const historyAssets = requestedAssets.filter((asset) => asset.type === 'etf' && asset.autoHistoricalReturn === true && asset.ticker && asset.ticker !== 'NEW');
    const history = historyAssets.map(async (asset) => {
      try { return { asset, result: await fetchEtfHistoricalReturn(asset.ticker, controller.signal) }; }
      catch { return { asset, result: null }; }
    });
    void Promise.all([Promise.all(entries.map(loadQuote)), Promise.all(history)]).then(([results, historical]) => {
      if (!controller.signal.aborted) setBatch({ results, automatic, requestedAssets, historicalKey, historical, asOfDate: new Date().toISOString().slice(0, 10) });
    });
    return () => controller.abort();
  }, [baseline, automatic, historicalKey, refreshCount]);

  useEffect(() => {
    if (!batch || !currentParams || !onApply || lastAutomaticBatch.current === batch) return;
    lastAutomaticBatch.current = batch;
    // 조회 도중 사용자가 단가·종목·통화를 바꾼 항목은 오래된 응답으로 덮지 않는다.
    const safeQuotes: ObservedQuote[] = (!automatic || !batch.automatic ? [] : batch.results).flatMap((quote) => {
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
    const safeReturns: ObservedHistoricalReturn[] = batch.historicalKey !== historicalKey ? [] : batch.historical.flatMap(({ asset, result }) => result ? [{
      assetId: asset.id, ticker: asset.ticker, expectedReturn: asset.totalReturn, expectedDividend: asset.dividendYield,
      annualizedReturn: result.annualizedReturn, missingPoints: result.missingPoints, endDate: result.endDate,
    }] : []);
    const withPrices = applyCurrentQuotes(currentParams, safeQuotes);
    const withReturns = applyHistoricalEtfReturns(withPrices.params, safeReturns, batch.asOfDate);
    if (withPrices.appliedCount > 0 || withReturns.appliedCount > 0) {
      if (safeReturns.length) onApply(safeQuotes, safeReturns);
      else onApply(safeQuotes);
    }
  }, [automatic, batch, currentParams, onApply, historicalKey]);

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
      <h3 className="font-semibold">ETF 시세</h3>
      <p className="mt-1 text-xs text-foreground-muted">
        수량은 자동 갱신되지 않아 실제 잔고와 다를 수 있습니다. 시세는 세금 추정에도 반영됩니다.
      </p>
      <button type="button" className="mt-2 rounded-lg border border-card-border px-3 py-2 text-xs font-semibold" onClick={() => {
        setBatch(null);
        setRefreshCount((count) => count + 1);
      }}>시세·자동 수익률 새로고침</button>
      <p className="mt-1 text-xs text-foreground-muted">자동 반영이 켜진 항목은 새 값이 적용됩니다.</p>
      {quotes === null ? <p role="status">시세를 조회하고 있습니다.</p> : quotes.length === 0 ? (
        <p>{batch?.historical.length ? '현재 단가 자동 조회는 꺼져 있습니다.' : '조회할 ETF가 없습니다.'}</p>
      ) : (
        <ul className="mt-3 divide-y divide-card-border">
          {quotes.map((quote) => {
            const comparison = quote.baseline && !('error' in quote) && baseline && currentParams
              ? compareReferenceQuantities(quote.asset, baseline.params.assets, currentParams.assets, quote.price) : null;
            const showDifference = comparison !== null && comparison.currentQuantity !== quote.asset.quantity;
            const matches = !quote.baseline ? currentParams?.assets.filter((asset) => asset.id === quote.asset.id) ?? [] : [];
            const current = matches.length === 1 && matches[0].type === 'etf' && matches[0].ticker === quote.asset.ticker
              && matches[0].currency === quote.asset.currency ? matches[0] : undefined;
            const currentValue = current && !('error' in quote) ? baselineReferenceValue(current.quantity, current.currency, quote.price, quote.asset.currency) : null;
            const quantity = comparison?.currentQuantity ?? (currentValue !== null ? current?.quantity : undefined) ?? quote.asset.quantity;
            const value = comparison?.currentValue ?? currentValue ?? ('error' in quote ? null : quote.value);
            return (
              <li key={`${quote.asset.id}:${quote.asset.ticker}:${quote.asset.currency}`} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-semibold">{quote.asset.name || quote.asset.ticker}{quote.asset.name && quote.asset.name !== quote.asset.ticker ? ` (${quote.asset.ticker})` : ''}</span>
                  {value !== null && <span className="font-semibold">{value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} {quote.asset.currency}</span>}
                </div>
                {'error' in quote ? <p className="mt-1 text-xs text-foreground-muted">{quote.error}</p> : (
                  <>
                    <p className="mt-1 text-xs text-foreground-muted">{comparison || currentValue !== null ? '현재 입력' : quote.baseline ? '기준 수량' : '조회 당시 수량'} {quantity.toLocaleString('ko-KR', { maximumFractionDigits: 8 })}주 · 시세 {quote.price.toLocaleString('ko-KR')} {quote.asset.currency}</p>
                    <p className="mt-1 text-xs text-foreground-muted">시세 기준: {new Date(quote.marketTime * 1000).toLocaleString('ko-KR')}</p>
                    {showDifference && <p className="mt-1 text-xs text-foreground-muted">기준 {quote.asset.quantity.toLocaleString('ko-KR', { maximumFractionDigits: 8 })}주 · 동일 시세 수량 차이 {comparison.difference > 0 ? '+' : ''}{comparison.difference.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} {quote.asset.currency} (수익률 아님)</p>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {batch?.historicalKey === historicalKey && batch.historical.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-foreground-muted" aria-label="자동 수익률 조회">
          {batch.historical.map(({ asset, result }) => (
            <li key={asset.id}>{asset.name || asset.ticker}: {result
              ? `${result.startDate} ~ ${result.endDate} 연환산 ${result.annualizedReturn.toFixed(1)}%, 누락 ${result.missingPoints}건. ${historicalStatus(asset, result, currentParams, batch.asOfDate)}`
              : '과거 수익률 조회 실패. 기존 값을 유지합니다.'}</li>
          ))}
        </ul>
      )}
      {currentParams && onApply && count > 0 && (
        <div className="mt-3">
          <button type="button" className="mt-2 rounded-lg border border-primary px-3 py-2 text-xs font-semibold text-primary" onClick={() => onApply(applicableQuotes)}>
            시세 {count}개 반영
          </button>
        </div>
      )}
    </section>
  );
}
