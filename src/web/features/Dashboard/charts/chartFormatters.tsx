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

// Y축이 눈금 라벨에 내주는 폭(px).
//
// **34px이던 것을 넓혔다.** recharts는 눈금 텍스트를 축선에서 tickMargin만큼 왼쪽에
// 오른쪽 정렬로 그리므로, 실제로 글자가 쓸 수 있는 폭은 이 값에서 약 10px을 뺀 만큼이다.
// 모바일 390px에서 실측하면 "2000"(29px)이 컨테이너 왼쪽 경계보다 5px 바깥에서 시작해
// 앞자리가 잘렸다 — 화면에는 ",000 만원"으로 보였다. 아래 MultilineYAxisTick이 숫자와
// 단위를 두 줄로 나누므로 필요한 폭은 숫자 부분("9999" ≈ 31px)이 결정한다.
export const Y_AXIS_WIDTH = 46;

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

// 기준선(ReferenceLine) 라벨의 공통 타이포그래피. 10px대 굵은 한글은 받침이 뭉개져
// 「시작」이 「시삭」처럼 읽혔다 — 라틴 글자에서는 문제가 되지 않던 크기다. 두 차트가
// 같은 요소를 그리므로 값은 여기 한 곳에만 둔다. 숫자로 두면 recharts가 SVG font-size
// 속성에 px로 그대로 넘긴다(rem은 차트 바깥 폰트 크기에 따라 더 작아질 수 있다).
export const REFERENCE_LABEL_FONT_SIZE = 12;

export const RECHARTS_TOOLTIP_STYLE = {
  background: 'rgba(17, 24, 39, 0.85)',
  border: '1px solid var(--card-border)',
  borderRadius: '12px',
  color: 'white',
  fontFamily: 'var(--font-main)',
  fontSize: '0.8rem',
} as const;
