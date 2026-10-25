import React, { useState } from 'react';
import { SimulationResult, SimulationParams } from '../../../core/entities/types';
import GlassCard from '../../components/GlassCard';
import styles from './Dashboard.module.css';
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line } from 'recharts';
import { BarChart2 } from 'lucide-react';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import { type LegendPayload } from 'recharts';

interface YearlyChartProps {
  params: SimulationParams;
  result: SimulationResult;
}

export const YearlyChart: React.FC<YearlyChartProps> = ({ params, result }) => {
  const { yearlyResults } = result;
  const currency = params.displayCurrency;
  
  const [hiddenKeys, setHiddenKeys] = useState<Record<string, boolean>>({});

  const handleLegendClick = (e: LegendPayload) => {
    // dataKey는 함수 형태도 허용하는 타입이지만 이 차트는 문자열 키만 쓴다.
    const dataKey = typeof e.dataKey === 'string' ? e.dataKey : undefined;
    if (dataKey) {
      setHiddenKeys((prev) => ({
        ...prev,
        [dataKey]: !prev[dataKey]
      }));
    }
  };

  const formatValue = (val: number): string => {
    if (val === 0) return '0원';
    if (currency === 'KRW') {
      const valueInMan = Math.round(val / 10000);
      if (valueInMan === 0) return '0원';

      const eok = Math.floor(valueInMan / 10000);
      const man = valueInMan % 10000;

      const parts = [];
      if (eok > 0) parts.push(`${eok.toLocaleString()}억`);
      if (man > 0) parts.push(`${man.toLocaleString()}만`);

      return parts.join(' ') + '원';
    } else {
      return `$${Math.round(val).toLocaleString()}`;
    }
  };

  const formatShortValue = (val: number): string => {
    if (val <= 0) return '0원';
    if (currency === 'KRW') {
      if (val >= 100000000) {
        const num = val / 100000000;
        return `${num % 1 === 0 ? num : num.toFixed(1)}억원`;
      }
      return `${Math.round(val / 10000)}만원`;
    } else {
      if (val >= 1000) {
        const num = val / 1000;
        return `$ ${num % 1 === 0 ? num : num.toFixed(0)}K`;
      }
      return `$ ${Math.round(val)}`;
    }
  };

  // recharts가 커스텀 tick 렌더러에 넘기는 값 중 이 컴포넌트가 쓰는 것만 선언한다.
  // 라이브러리 내부 타입(CartesianTickItem 등)은 버전마다 이름이 바뀌어 직접 의존하지 않는다.
  interface YAxisTickProps {
    // recharts는 x/y를 number로 넘기지만 타입상 string도 허용한다. 좌표 계산에 쓰므로
    // 받는 쪽에서 Number()로 좁힌다.
    x?: string | number;
    y?: string | number;
    payload: { value: number };
    textAnchor?: 'inherit' | 'end' | 'start' | 'middle';
    fill?: string;
  }

  const MultilineYAxisTick = (props: YAxisTickProps) => {
    const { payload, textAnchor, fill } = props;
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const formatted = formatShortValue(payload.value);
    
    let numPart = formatted;
    let unitPart = "";
    
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

    const dx = textAnchor === 'end' ? -2 : (textAnchor === 'start' ? 2 : 0);

    return (
      <text x={x + dx} y={y} textAnchor={textAnchor} fill={fill || "var(--foreground-muted)"} fontSize="0.65rem">
        <tspan x={x + dx} dy="-0.2em">{numPart}</tspan>
        {unitPart && <tspan x={x + dx} dy="1.1em">{unitPart}</tspan>}
      </text>
    );
  };

  if (!yearlyResults || yearlyResults.length === 0) return null;

  const chartData = yearlyResults.map((r) => ({
    age: r.age,
    year: r.year,
    '세전 총소득': Math.round(r.preTaxTotalIncome),
    '배당소득세': Math.round(r.dividendTaxPaid),
    '연금소득세': Math.round(r.pensionTaxPaid),
    '국민연금세': Math.round(r.nationalPensionTaxPaid),
    '종합과세 추가': Math.round(r.comprehensiveTaxPaid),
    '건보료 추가': Math.round(r.healthInsurancePaid),
    '세후 총소득': Math.round(r.totalIncome),
    '생활비 지출': Math.round(r.spending),
    // 이 차트는 의료비를 "생활비 지출에 포함된 금액의 내역"으로 보여준다. 자산이 고갈된
    // 해에는 엔진이 실제 인출액을 가능한 만큼으로 깎아 spending < healthcareSpending이
    // 되므로(types.ts의 "예외" 참조), 원값을 그대로 그리면 내역이 총액을 넘는 그림이 된다.
    // types.ts가 표시용으로 권하는 Math.min을 그대로 적용한다.
    '의료비 지출': Math.round(Math.min(r.spending, r.healthcareSpending)),
    '잔여 자산액': Math.round(r.totalAssets),
  }));

  // 의료비는 (인출 가능한 해에는) 이미 '생활비 지출'에 포함된 금액이라 항상 그리면
  // "0에 붙은 줄"이 하나 늘 뿐이다.
  // 의료비 가정을 실제로 켠 시나리오에서만 분해해서 보여준다.
  const hasHealthcare = yearlyResults.some((r) => r.healthcareSpending > 0);

  return (
    <GlassCard className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <span className={styles.chartTitle}>
          <BarChart2 size={20} color="var(--primary)" style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
          연도별 상세 세금 및 소득 내역
        </span>
      </div>
      <div className={styles.chartScrollWrapper}>
        <div className={styles.chartContainer}>
          <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 15, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
            <XAxis 
              dataKey="age" 
              stroke="var(--foreground-muted)"
              style={{ fontSize: '0.75rem' }}
              tickFormatter={(v) => `${v}세`}
              minTickGap={15}
              scale="point"
              padding={{ left: 15, right: 15 }}
            />
            <YAxis 
              yAxisId="left"
              stroke="var(--foreground-muted)"
              width={34}
              tick={(props) => <MultilineYAxisTick {...props} />}
            />
            <YAxis 
              yAxisId="right"
              orientation="right"
              stroke="var(--foreground-muted)"
              width={38}
              tick={(props) => <MultilineYAxisTick {...props} />}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(17, 24, 39, 0.85)',
                border: '1px solid var(--card-border)',
                borderRadius: '12px',
                color: 'white',
                fontFamily: 'var(--font-main)',
                fontSize: '0.8rem',
              }}
              formatter={(value?: ValueType, name?: NameType) => [formatValue(Number(value ?? 0)), name ?? '']}
              labelFormatter={(label, payload) => {
                const year = payload && payload.length > 0 ? payload[0].payload.year : '';
                return `${label}세 (${year}년)`;
              }}
            />
            <Legend 
              verticalAlign="top" 
              height={36} 
              wrapperStyle={{ fontSize: '0.8rem', cursor: 'pointer' }}
              onClick={handleLegendClick}
            />
            
            {/* Taxes (Stacked Bars) */}
            <Bar yAxisId="left" name="배당소득세" dataKey="배당소득세" stackId="tax" fill="#FCA5A5" hide={!!hiddenKeys['배당소득세']} />
            <Bar yAxisId="left" name="연금소득세" dataKey="연금소득세" stackId="tax" fill="#F87171" hide={!!hiddenKeys['연금소득세']} />
            <Bar yAxisId="left" name="국민연금세" dataKey="국민연금세" stackId="tax" fill="#EF4444" hide={!!hiddenKeys['국민연금세']} />
            <Bar yAxisId="left" name="종합과세 추가" dataKey="종합과세 추가" stackId="tax" fill="#F59E0B" hide={!!hiddenKeys['종합과세 추가']} />
            <Bar yAxisId="left" name="건보료 추가" dataKey="건보료 추가" stackId="tax" fill="#D97706" hide={!!hiddenKeys['건보료 추가']} />
            
            {/* Incomes & Spending (Lines) */}
            <Line yAxisId="left" name="세전 총소득" type="monotone" dataKey="세전 총소득" stroke="#60A5FA" strokeWidth={2} dot={false} hide={!!hiddenKeys['세전 총소득']} />
            <Line yAxisId="left" name="세후 총소득" type="monotone" dataKey="세후 총소득" stroke="#10B981" strokeWidth={2} dot={false} hide={!!hiddenKeys['세후 총소득']} />
            <Line yAxisId="left" name="생활비 지출" type="monotone" dataKey="생활비 지출" stroke="#A855F7" strokeWidth={2} dot={false} hide={!!hiddenKeys['생활비 지출']} strokeDasharray="5 5" />
            {hasHealthcare && (
              <Line yAxisId="left" name="의료비 지출 (생활비에 포함)" type="monotone" dataKey="의료비 지출" stroke="#F472B6" strokeWidth={2} dot={false} hide={!!hiddenKeys['의료비 지출']} strokeDasharray="2 4" />
            )}

            {/* Assets (Right Axis Line) */}
            <Line yAxisId="right" name="잔여 자산액" type="monotone" dataKey="잔여 자산액" stroke="var(--primary)" strokeWidth={2} dot={false} hide={!!hiddenKeys['잔여 자산액']} />

          </ComposedChart>
        </ResponsiveContainer>
        </div>
      </div>
    </GlassCard>
  );
};
