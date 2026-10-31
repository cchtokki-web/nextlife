'use client';

import { useEffect, useRef, useState } from 'react';
import type { InvestmentAsset, SimulationParams } from '../../../core/entities/types';
import { baselineReferenceValue } from '../../../core/usecases/investmentTracking/baselineReferenceValue';
import { applyCurrentQuotes, type ObservedQuote } from '../../../core/usecases/investmentTracking/applyCurrentQuotes';
import { applyHistoricalEtfReturns, type ObservedHistoricalReturn } from '../../../core/usecases/investmentTracking/applyHistoricalEtfReturns';
import { applyObservedEtfDividends, type ObservedEtfDividend } from '../../../core/usecases/investmentTracking/applyObservedEtfDividends';
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
  dividends: Array<{ asset: InvestmentAsset; dividendYield: number | null }>;
  asOfDate: string;
}

function historicalStatus(asset: InvestmentAsset, result: HistoricalAdjustedReturn, current: SimulationParams | undefined, asOfDate: string): string {
  if (result.missingPoints > 0) return '자료가 누락되어 자동 반영하지 않았습니다.';
  const ageDays = (Date.parse(`${asOfDate}T00:00:00Z`) - Date.parse(`${result.endDate}T00:00:00Z`)) / 86400000;
  if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 30) return '자료 기준일이 오래되었거나 올바르지 않아 자동 반영하지 않았습니다.';
  const matching = current?.assets.filter((item) => item.id === asset.id) ?? [];
  if (matching.length !== 1 || matching[0].ticker !== asset.ticker) return '조회 중 입력이 변경되어 자동 반영하지 않았습니다.';
  if (matching[0].totalReturn === Number(result.annualizedReturn.toFixed(1))) return '현재 입력과 일치합니다.';
  if (matching[0].totalReturn !== asset.totalReturn) return '조회 중 입력이 변경되어 자동 반영하지 않았습니다.';
  return '자동 반영을 처리 중입니다.';
}

/** 화면 표시 없이 ETF 자료를 조회하고 유효한 변경을 현재 계획에 반영한다. */
export function InvestmentBaselinePreview({ baseline, currentParams, onApply }: {
  baseline?: Baseline;
  currentParams?: SimulationParams;
  onApply?: (quotes: ObservedQuote[], returns?: ObservedHistoricalReturn[], dividends?: ObservedEtfDividend[]) => void;
}) {
  const [batch, setBatch] = useState<QuoteBatch | null>(null);
  const currentParamsRef = useRef(currentParams);
  const lastAutomaticBatch = useRef<QuoteBatch | null>(null);
  const automatic = true;
  const historicalKey = JSON.stringify((currentParams?.assets ?? []).filter((asset) => asset.type === 'etf')
    .map((asset) => [asset.id, asset.ticker, asset.autoHistoricalReturn === true]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

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
    const etfAssets = requestedAssets.filter((asset) => asset.type === 'etf' && asset.ticker && asset.ticker !== 'NEW');
    const historyAssets = etfAssets.filter((asset) => asset.autoHistoricalReturn === true);
    const history = historyAssets.map(async (asset) => {
      try { return { asset, result: await fetchEtfHistoricalReturn(asset.ticker, controller.signal) }; }
      catch { return { asset, result: null }; }
    });
    const dividendRequests = etfAssets.map(async (asset) => {
      try {
        const response = await fetch(`/api/stock-info?ticker=${encodeURIComponent(asset.ticker)}`, { signal: controller.signal, cache: 'no-store' });
        const data: unknown = response.ok ? await response.json() : null;
        const value = data && typeof data === 'object' && 'observedDividendYield' in data ? data.observedDividendYield : null;
        return { asset, dividendYield: typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null };
      } catch { return { asset, dividendYield: null }; }
    });
    void Promise.all([Promise.all(entries.map(loadQuote)), Promise.all(history), Promise.all(dividendRequests)]).then(([results, historical, dividends]) => {
      if (!controller.signal.aborted) setBatch({ results, automatic, requestedAssets, historicalKey, historical, dividends, asOfDate: new Date().toISOString().slice(0, 10) });
    });
    return () => controller.abort();
  }, [baseline, automatic, historicalKey, currentParams?.yieldPreset]);

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
    const safeDividends: ObservedEtfDividend[] = batch.historicalKey !== historicalKey ? [] : batch.dividends.flatMap(({ asset, dividendYield }) => dividendYield === null ? [] : [{
      assetId: asset.id, ticker: asset.ticker, expectedDividend: asset.dividendYield, dividendYield,
    }]);
    const withReturns = applyHistoricalEtfReturns(withPrices.params, safeReturns, batch.asOfDate);
    const withDividends = applyObservedEtfDividends(withReturns.params, safeDividends);
    if (withPrices.appliedCount > 0 || withReturns.appliedCount > 0 || withDividends.appliedCount > 0) {
      if (safeDividends.length) onApply(safeQuotes, safeReturns, safeDividends);
      else if (safeReturns.length) onApply(safeQuotes, safeReturns);
      else onApply(safeQuotes);
    }
  }, [automatic, batch, currentParams, onApply, historicalKey]);

  return (
    <>
      {batch?.results.some((quote) => 'error' in quote && currentParams?.assets.some((asset) =>
        asset.id === quote.asset.id && asset.ticker === quote.asset.ticker && asset.currency === quote.asset.currency)) && (
        <p role="alert" className="mt-2 text-xs text-foreground-muted">일부 ETF 시세를 조회하지 못해 기존 값을 유지합니다.</p>
      )}
      {batch?.historicalKey === historicalKey && batch.historical.some(({ asset, result }) => !result
        || historicalStatus(asset, result, currentParams, batch.asOfDate).includes('자동 반영하지 않았습니다')) && (
        <p role="alert" className="mt-2 text-xs text-foreground-muted">일부 ETF 수익률을 갱신하지 못해 기존 값을 유지합니다.</p>
      )}
      {batch?.historicalKey === historicalKey && batch.dividends.some(({ dividendYield }) => dividendYield === null) && (
        <p role="alert" className="mt-2 text-xs text-foreground-muted">일부 ETF 배당률을 조회하지 못해 기존 값을 유지합니다.</p>
      )}
    </>
  );
}
