import { type YAxisTickContentProps } from 'recharts';
import { AssetCurrency } from '../../../../core/entities/types';

// DashboardSection의 자산추이/소득원구성/생활비구성 차트 3종이 공유하는 포맷터.
// YearlyChart.tsx는 억/만 단위만 다루는 별도의 축약 버전을 그대로 유지한다(범위 밖).
export function formatValue(val: number, currency: AssetCurrency): string {
  if (val <= 0) return '0원';
  if (currency === 'KRW') {
    const valueInMan = Math.round(val / 10000);
    if (valueInMan === 0) return '0원';

    const gyeong = Math.floor(valueInMan / 1000000000000);
    const jo = Math.floor((valueInMan % 1000000000000) / 100000000);
    const eok = Math.floor((valueInMan % 100000000) / 10000);
    const man = valueInMan % 10000;

    const parts: string[] = [];
    if (gyeong > 0) parts.push(`${gyeong.toLocaleString()}경`);
    if (jo > 0) parts.push(`${jo.toLocaleString()}조`);
    if (eok > 0) parts.push(`${eok.toLocaleString()}억`);
    if (man > 0) parts.push(`${man.toLocaleString()}만`);

    return parts.join(' ') + '원';
  }
  if (val >= 1000000) return `$ ${(val / 1000000).toFixed(2)}M`;
  if (val >= 1000) return `$ ${(val / 1000).toFixed(1)}K`;
  return `$ ${Math.round(val).toLocaleString()}`;
}

export function formatShortValue(val: number, currency: AssetCurrency): string {
  if (val <= 0) return '0원';
  if (currency === 'KRW') {
    if (val >= 1000000000000) {
      const num = val / 1000000000000;
      return `${num % 1 === 0 ? num : num.toFixed(1)}조원`;
    }
    if (val >= 100000000) {
      const num = val / 100000000;
      return `${num % 1 === 0 ? num : num.toFixed(1)}억원`;
    }
    return `${Math.round(val / 10000)}만원`;
  }
  if (val >= 1000000) {
    const num = val / 1000000;
    return `$ ${num % 1 === 0 ? num : num.toFixed(1)}M`;
  }
  if (val >= 1000) {
    const num = val / 1000;
    return `$ ${num % 1 === 0 ? num : num.toFixed(0)}K`;
  }
  return `$ ${Math.round(val)}`;
}

type MultilineYAxisTickProps = Pick<YAxisTickContentProps, 'x' | 'y' | 'payload' | 'textAnchor' | 'fill'> & {
  currency: AssetCurrency;
};

export function MultilineYAxisTick({ x, y, payload, textAnchor, fill, currency }: MultilineYAxisTickProps) {
  const formatted = formatShortValue(Number(payload.value), currency);

  let numPart = formatted;
  let unitPart = '';

  const krwMatch = formatted.match(/^([\d.]+)([가-힣]+)$/);
  if (krwMatch) {
    numPart = krwMatch[1];
    unitPart = krwMatch[2];
  } else {
    const usdMatch = formatted.match(/^(\$ *[\d.]+)([A-Z]*)$/);
    if (usdMatch) {
      numPart = usdMatch[1];
      unitPart = usdMatch[2];
    }
  }

  const dx = textAnchor === 'end' ? -2 : textAnchor === 'start' ? 2 : 0;
  const numX = Number(x) + dx;

  return (
    <text x={numX} y={y} textAnchor={textAnchor} fill={fill || 'var(--foreground-muted)'} fontSize="0.65rem">
      <tspan x={numX} dy="-0.2em">
        {numPart}
      </tspan>
      {unitPart && (
        <tspan x={numX} dy="1.1em">
          {unitPart}
        </tspan>
      )}
    </text>
  );
}

export const RECHARTS_TOOLTIP_STYLE = {
  background: 'rgba(17, 24, 39, 0.85)',
  border: '1px solid var(--card-border)',
  borderRadius: '12px',
  color: 'white',
  fontFamily: 'var(--font-main)',
  fontSize: '0.8rem',
} as const;
