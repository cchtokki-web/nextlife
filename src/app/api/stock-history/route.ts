import { type NextRequest } from 'next/server';

const DAY_SECONDS = 86400;
const MAX_DAYS = 366 * 10;

function dateSeconds(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp / 1000 : null;
}

/** 시세 원문 조회만 제공한다. 보유 수량, 투자 계획과 계산 결과는 서버로 보내지 않는다. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = params.get('ticker')?.trim().toUpperCase() ?? '';
  const start = dateSeconds(params.get('start'));
  const end = dateSeconds(params.get('end'));
  if (!/^[A-Z0-9][A-Z0-9.\-^=]{0,24}$/.test(symbol) || start === null || end === null
    || end < start || end - start > MAX_DAYS * DAY_SECONDS) {
    return Response.json({ error: 'Invalid ticker or date range' }, { status: 400 });
  }
  const ticker = /^\d{6}$/.test(symbol) ? `${symbol}.KS` : symbol;
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  // 거래소 시간대에서 시작일·종료일을 빠뜨리지 않도록 양쪽에 여유를 둔 후 현지 날짜로 필터한다.
  url.searchParams.set('period1', String(start - DAY_SECONDS));
  url.searchParams.set('period2', String(end + 2 * DAY_SECONDS));
  url.searchParams.set('interval', '1d');
  url.searchParams.set('events', 'div,splits');

  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
    if (!response.ok) return Response.json({ error: 'Historical data unavailable' }, { status: 502 });
    const data: unknown = await response.json();
    const result = extractResult(data);
    if (!result) return Response.json({ error: 'Historical data unavailable' }, { status: 502 });
    const { timestamps, closes, timezone, currency, dividends, splits } = result;
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const localDate = (timestamp: number) => {
      const parts = formatter.formatToParts(timestamp * 1000);
      const part = (type: string) => parts.find((item) => item.type === type)?.value;
      return `${part('year')}-${part('month')}-${part('day')}`;
    };
    const from = params.get('start')!;
    const to = params.get('end')!;
    const prices = timestamps.flatMap((timestamp, index) => {
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) throw new Error('Invalid timestamp');
      const date = localDate(timestamp);
      if (date < from || date > to) return [];
      const close = closes[index];
      return [{ date, close: typeof close === 'number' && Number.isFinite(close) && close > 0 ? close : null }];
    });
    const eventInRange = (event: unknown): boolean => {
      if (!isRecord(event) || typeof event.date !== 'number' || !Number.isFinite(event.date)) {
        throw new Error('Invalid corporate action');
      }
      const date = localDate(event.date);
      return date >= from && date <= to;
    };
    return Response.json({
      ticker, currency, timezone, start: from, end: to, prices,
      // 원천의 사건 부재는 해당 기간에 사건이 없다는 증거가 아니다.
      dividends: dividends.filter(eventInRange), splits: splits.filter(eventInRange),
      source: 'Yahoo Finance', completeness: 'unverified',
      // 종가의 분할 조정 기준과 사건의 누락 여부를 확인하기 전에는 수량 계산에 쓰지 않는다.
      closeAdjustment: 'unverified', investmentTrackingReady: false,
    });
  } catch {
    return Response.json({ error: 'Historical data unavailable' }, { status: 502 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractResult(data: unknown) {
  if (!isRecord(data) || !isRecord(data.chart) || !Array.isArray(data.chart.result)) return null;
  const result: unknown = data.chart.result[0];
  if (!isRecord(result) || !isRecord(result.meta) || !isRecord(result.indicators)
    || !Array.isArray(result.timestamp) || !Array.isArray(result.indicators.quote)
    || !isRecord(result.indicators.quote[0]) || !Array.isArray(result.indicators.quote[0].close)
    || result.timestamp.length !== result.indicators.quote[0].close.length
    || typeof result.meta.exchangeTimezoneName !== 'string' || typeof result.meta.currency !== 'string') return null;
  const events = isRecord(result.events) ? result.events : {};
  return {
    timestamps: result.timestamp as unknown[], closes: result.indicators.quote[0].close as unknown[],
    timezone: result.meta.exchangeTimezoneName, currency: result.meta.currency,
    dividends: isRecord(events.dividends) ? Object.values(events.dividends) : [],
    splits: isRecord(events.splits) ? Object.values(events.splits) : [],
  };
}
