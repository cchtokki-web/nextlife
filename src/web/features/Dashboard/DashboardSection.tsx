"use client";

import React from 'react';
import { SimulationParams, SimulationResult } from '../../../core/entities/types';
import GlassCard from '../../components/GlassCard';
import { YearlyChart } from './YearlyChart';
import { HeroSummaryCard } from './HeroSummaryCard';
import { CoreMetricsCards } from './CoreMetricsCards';
import { AiAdvisorCard } from './AiAdvisorCard';
import styles from './Dashboard.module.css';
import { AlertTriangle, TrendingDown, Target, Zap, Award, Calculator } from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Legend,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

interface DashboardSectionProps {
  params: SimulationParams;
  result: SimulationResult;
  compareResults?: { id: string, name: string, result: SimulationResult }[];
  isPro?: boolean;
}

export const DashboardSection: React.FC<DashboardSectionProps> = ({ params: rawParams, result, compareResults = [], isPro = false }) => {
  const [hiddenKeys, setHiddenKeys] = React.useState<Record<string, boolean>>({});

  const handleLegendClick = (e: any) => {
    const dataKey = e.dataKey;
    if (dataKey) {
      setHiddenKeys((prev) => ({
        ...prev,
        [dataKey]: !prev[dataKey]
      }));
    }
  };

  const params: SimulationParams = {
    ...rawParams,
    userProfile: rawParams?.userProfile || { currentAge: 35, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
    assets: rawParams?.assets || [],
    nationalPension: rawParams?.nationalPension || { expectedMonthlyAmount: 0 },
    privatePensions: rawParams?.privatePensions || [],
    otherIncomes: rawParams?.otherIncomes || [],
    inflationRate: rawParams?.inflationRate ?? 2,
    inflationMode: rawParams?.inflationMode || 'real',
    baseExchangeRate: rawParams?.baseExchangeRate ?? 1350,
    displayCurrency: rawParams?.displayCurrency || 'KRW',
    spendingStrategy: rawParams?.spendingStrategy || 'target',
  };
  const { yearlyResults, fireAge, depletionAge, endingAssets, retirementScore, goalAchievementRate } = result;
  const currency = params.displayCurrency;

  // Currency Formatter
  const formatValue = (val: number): string => {
    if (val <= 0) return '0원';
    if (currency === 'KRW') {
      const valueInMan = Math.round(val / 10000);
      if (valueInMan === 0) return '0원';

      const gyeong = Math.floor(valueInMan / 1000000000000);
      const jo = Math.floor((valueInMan % 1000000000000) / 100000000);
      const eok = Math.floor((valueInMan % 100000000) / 10000);
      const man = valueInMan % 10000;

      const parts = [];
      if (gyeong > 0) parts.push(`${gyeong.toLocaleString()}경`);
      if (jo > 0) parts.push(`${jo.toLocaleString()}조`);
      if (eok > 0) parts.push(`${eok.toLocaleString()}억`);
      if (man > 0) parts.push(`${man.toLocaleString()}만`);

      return parts.join(' ') + '원';
    } else {
      if (val >= 1000000) {
        return `$ ${(val / 1000000).toFixed(2)}M`;
      }
      if (val >= 1000) {
        return `$ ${(val / 1000).toFixed(1)}K`;
      }
      return `$ ${Math.round(val).toLocaleString()}`;
    }
  };

  const formatShortValue = (val: number): string => {
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
    } else {
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
  };

  const MultilineYAxisTick = (props: any) => {
    const { x, y, payload, textAnchor, fill } = props;
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

  // Retirement averages for Tax Comparison
  const retirementYearsResults = yearlyResults.filter(r => r.age >= params.userProfile.retirementAge);
  let avgPreTaxIncome = 0;
  let avgTotalTax = 0;
  let avgHealthInsurance = 0;
  let avgNetIncome = 0;
  
  if (retirementYearsResults.length > 0) {
    avgPreTaxIncome = retirementYearsResults.reduce((sum, r) => sum + r.preTaxTotalIncome, 0) / retirementYearsResults.length;
    avgTotalTax = retirementYearsResults.reduce((sum, r) => sum + (r.dividendTaxPaid + r.pensionTaxPaid + r.nationalPensionTaxPaid + r.comprehensiveTaxPaid), 0) / retirementYearsResults.length;
    avgHealthInsurance = retirementYearsResults.reduce((sum, r) => sum + r.healthInsurancePaid, 0) / retirementYearsResults.length;
    avgNetIncome = retirementYearsResults.reduce((sum, r) => sum + r.totalIncome, 0) / retirementYearsResults.length;
  }

  // Income breakdown (cover the entire period to align with Asset Projection chart)
  const pensionChartData = yearlyResults
    .map((r) => {
      return {
        age: r.age,
        국민연금: Math.round(r.nationalPensionIncome),
        사적연금: Math.round(r.privatePensionIncome),
        배당소득: Math.round(r.dividendIncome),
        기타소득: Math.round(r.otherIncome),
      };
    });

  // 월 생활비 구성 그래프 데이터 (은퇴 나이 이후 대상)
  const spendingChartData = retirementYearsResults.map((r) => {
    const age = r.age;
    const y = age - params.userProfile.currentAge;
    const infRateAnnual = params.inflationRate / 100;
    
    let targetMonthly = 0;
    if (params.spendingStrategy === 'max_sustainable' && result.calculatedTargetSpending !== undefined) {
      targetMonthly = result.calculatedTargetSpending;
    } else {
      targetMonthly = params.userProfile.targetMonthlySpending;
    }
    
    if (params.inflationMode === 'nominal') {
      targetMonthly = targetMonthly * Math.pow(1 + infRateAnnual, y);
    }

    const national = Math.round(r.nationalPensionIncome / 12);
    const privatePen = Math.round(r.privatePensionIncome / 12);
    const dividend = Math.round(r.dividendIncome / 12);
    const other = Math.round(r.otherIncome / 12);
    
    const totalIncomeMonthly = national + privatePen + dividend + other;
    const actualSpendingMonthly = Math.round(r.spending / 12);
    
    let nationalUsed = national;
    let privatePenUsed = privatePen;
    let dividendUsed = dividend;
    let otherUsed = other;
    let assetWithdrawal = 0;
    let shortfall = 0;

    if (totalIncomeMonthly > targetMonthly) {
      const ratio = targetMonthly / totalIncomeMonthly;
      nationalUsed = Math.round(national * ratio);
      privatePenUsed = Math.round(privatePen * ratio);
      dividendUsed = Math.round(dividend * ratio);
      otherUsed = Math.round(other * ratio);
      
      const sumUsed = nationalUsed + privatePenUsed + dividendUsed + otherUsed;
      const diff = targetMonthly - sumUsed;
      if (diff !== 0) {
        if (nationalUsed >= privatePenUsed && nationalUsed >= dividendUsed && nationalUsed >= otherUsed) {
          nationalUsed += diff;
        } else if (privatePenUsed >= dividendUsed && privatePenUsed >= otherUsed) {
          privatePenUsed += diff;
        } else if (dividendUsed >= otherUsed) {
          dividendUsed += diff;
        } else {
          otherUsed += diff;
        }
      }
    } else {
      assetWithdrawal = Math.max(0, actualSpendingMonthly - totalIncomeMonthly);
      shortfall = Math.max(0, targetMonthly - actualSpendingMonthly);
      
      const sumUsed = nationalUsed + privatePenUsed + dividendUsed + otherUsed + assetWithdrawal + shortfall;
      const diff = targetMonthly - sumUsed;
      if (diff !== 0) {
        if (shortfall > 0) {
          shortfall += diff;
        } else if (assetWithdrawal > 0) {
          assetWithdrawal += diff;
        } else if (nationalUsed > 0) {
          nationalUsed += diff;
        } else {
          dividendUsed += diff;
        }
      }
    }

    return {
      age,
      국민연금: nationalUsed,
      사적연금: privatePenUsed,
      배당소득: dividendUsed,
      기타소득: otherUsed,
      ...({ 자산인출: assetWithdrawal, 자산부족: shortfall } as any)
    };
  });

  const rawPensionLimit = params.taxSettings?.privatePensionLimit ?? 15000000;
  const monthlyPensionLimit = params.displayCurrency === 'USD'
    ? (rawPensionLimit / 12) / params.baseExchangeRate
    : rawPensionLimit / 12;

  // Assets Line chart data formatting (Merge base with compare scenarios)
  const assetChartData = yearlyResults.map((r) => {
    const dataPoint: any = {
      age: r.age,
      ageLabel: `${r.age}세`,
      자산총액: Math.max(0, Math.round(r.totalAssets)),
      주식자산: Math.max(0, Math.round(r.stockAssets)),
      연금자산: Math.max(0, Math.round(r.pensionAssets)),
      월생활비: Math.max(0, Math.round(r.spending / 12)),
    };

    compareResults.forEach((comp) => {
      const compYear = comp.result.yearlyResults.find(yr => yr.age === r.age);
      if (compYear) {
        dataPoint[`compare_${comp.id}`] = Math.max(0, Math.round(compYear.totalAssets));
      }
    });

    return dataPoint;
  });

  // Colors for comparison lines
  const compareColors = ['#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

  // Score Circle coordinates
  const radius = 50;
  const strokeWidth = 8;
  const normalizedRadius = radius - strokeWidth * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (result.retirementScore / 100) * circumference;

  // Goal circle Dash offset
  const minGoalRate = Math.min(100, result.goalAchievementRate);
  const goalDashoffset = circumference - (minGoalRate / 100) * circumference;

  // New Data Extractions
  const assetAt60 = yearlyResults.find(r => r.age === 60)?.totalAssets || 0;
  const isMonthlyTargetPossible = result.depletionAge === null || result.depletionAge >= params.userProfile.expectancy;

  // --- Dynamic Simulation-Responsive Tax & Decumulation Analytics ---
  
  // 1. Check if and when assets get depleted
  const isDepleted = result.depletionAge !== null && result.depletionAge < params.userProfile.expectancy;
  const depletionAgeVal = result.depletionAge;

  // 2. Identify the age where national pension starts being received
  const firstAgeWithNationalPension = yearlyResults.find(r => r.nationalPensionIncome > 0)?.age || 65;
  const retirementAgeVal = params.userProfile.retirementAge;
  const pensionGapYears = Math.max(0, firstAgeWithNationalPension - retirementAgeVal);

  // 3. Find if the user ever pays comprehensive tax or has warning
  const everComprehensiveTax = yearlyResults.some(r => r.comprehensiveTaxPaid > 0 || r.hasTaxWarning);
  
  // 4. Calculate high-tax pension ages (where private pension exceeds configured limit)
  const pensionLimit = params.taxSettings?.privatePensionLimit ?? 15000000;
  const highPrivatePensionAges = yearlyResults
    .filter(r => (r.privatePensionIncome + r.pensionTaxPaid) > pensionLimit)
    .map(r => r.age);
  const hasHighPrivatePensionRisk = highPrivatePensionAges.length > 0;

  // 5. Total dividend income proportion
  const avgYearlyDividend = retirementYearsResults.length > 0
    ? retirementYearsResults.reduce((sum, r) => sum + r.dividendIncome, 0) / retirementYearsResults.length
    : 0;
  const hasSignificantDividends = avgYearlyDividend > 5000000; // Over 5 million KRW annually



  return (
    <div className={styles.container}>
      {/* Strategy Indicator Banner */}
      {params.spendingStrategy === 'max_sustainable' && result.calculatedTargetSpending !== undefined && (
        <div className={styles.warningCard} style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)', marginBottom: '1.5rem' }}>
          <Award size={22} className={styles.warningIcon} color="var(--success)" />
          <div className={styles.warningContent}>
            <span className={styles.warningTitle} style={{ color: 'var(--success)' }}>최대 고정 생활비 산출 완료</span>
            <span className={styles.warningText}>
              시뮬레이션 결과, 고갈 없이 유지 가능한 <strong>최대 월 생활비는 {formatValue(result.calculatedTargetSpending)}</strong>입니다. 모든 차트는 이 금액을 목표로 다시 그려졌습니다.
            </span>
          </div>
        </div>
      )}
      {params.spendingStrategy === 'dividend_only' && (
        <div className={styles.warningCard} style={{ background: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)', marginBottom: '1.5rem' }}>
          <Zap size={22} className={styles.warningIcon} color="#3B82F6" />
          <div className={styles.warningContent}>
            <span className={styles.warningTitle} style={{ color: '#3B82F6' }}>배당금 100% 소비 모드 적용 중</span>
            <span className={styles.warningText}>
              은퇴 후 매월 발생하는 배당금 및 연금(이자)만 100% 소비하며, 원금은 전혀 매도하지 않도록 시뮬레이션 되었습니다.
            </span>
          </div>
        </div>
      )}

      <HeroSummaryCard 
        score={result.retirementScore} 
        expectancyAge={params.userProfile.expectancy} 
        depletionAge={result.depletionAge} 
        monthlyTarget={params.spendingStrategy === 'max_sustainable' && result.calculatedTargetSpending ? result.calculatedTargetSpending : params.userProfile.targetMonthlySpending}
        isPro={isPro}
        userProfile={params.userProfile}
      />

      <CoreMetricsCards 
        depletionAge={result.depletionAge}
        expectancyAge={params.userProfile.expectancy}
        assetAt60={assetAt60}
        monthlyTarget={params.spendingStrategy === 'max_sustainable' && result.calculatedTargetSpending ? result.calculatedTargetSpending : params.userProfile.targetMonthlySpending}
        isMonthlyTargetPossible={isMonthlyTargetPossible}
        formatValue={formatValue}
        calculatedTargetSpending={result.calculatedTargetSpending}
      />






      {/* 3. Asset Projection Line Chart */}
      <GlassCard className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <span className={styles.chartTitle}>
            자산 추이 시뮬레이션 (현재 ~ {params.userProfile.expectancy}세)
            <span style={{ fontSize: '0.85em', color: 'var(--foreground-muted)', marginLeft: '8px', fontWeight: 'normal' }}>
              ({params.inflationMode === 'nominal' ? '명목가치' : '실질가치'} 기준)
            </span>
          </span>
          {depletionAge ? (
            <span className={styles.depletionAlertBadge}>
              <TrendingDown size={12} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} />
              {depletionAge}세 자산 고갈 발생
            </span>
          ) : (
            <span className={styles.successBadge}>안정적인 노후 자산 유지됨</span>
          )}
        </div>
        <div className={styles.chartScrollWrapper}>
          <div className={styles.chartContainer}>
            <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={assetChartData} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="totalAssetColor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.0} />
                </linearGradient>
              </defs>
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
                stroke="#F59E0B"
                width={38}
                tick={(props) => <MultilineYAxisTick {...props} fill="#F59E0B" />}
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
                formatter={(value: any) => [formatValue(Number(value)), '']}
                labelFormatter={(label) => `${label}세`}
              />
              <Legend 
                verticalAlign="top" 
                height={36} 
                wrapperStyle={{ fontSize: '0.8rem', color: 'var(--foreground-muted)', cursor: 'pointer' }} 
                onClick={handleLegendClick}
              />
              
              <Area
                yAxisId="left"
                name="총 자산액 (현재)"
                type="monotone"
                dataKey="자산총액"
                stroke="var(--primary)"
                fillOpacity={1}
                fill="url(#totalAssetColor)"
                strokeWidth={3}
                hide={!!hiddenKeys['자산총액']}
              />
              
              {/* Compare Scenarios Lines */}
              {compareResults.map((comp, idx) => (
                <Line
                  key={comp.id}
                  yAxisId="left"
                  name={`${comp.name} (비교)`}
                  type="monotone"
                  dataKey={`compare_${comp.id}`}
                  stroke={compareColors[idx % compareColors.length]}
                  strokeWidth={2}
                  dot={false}
                  hide={!!hiddenKeys[`compare_${comp.id}`]}
                />
              ))}

              <Area
                yAxisId="left"
                name="주식/ETF 자산"
                type="monotone"
                dataKey="주식자산"
                stroke="var(--accent)"
                fill="transparent"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                hide={!!hiddenKeys['주식자산']}
              />
              <Area
                yAxisId="left"
                name="연금 자산"
                type="monotone"
                dataKey="연금자산"
                stroke="var(--secondary)"
                fill="transparent"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                hide={!!hiddenKeys['연금자산']}
              />
              <Line
                yAxisId="right"
                name="월 생활비"
                type="monotone"
                dataKey="월생활비"
                stroke="#F59E0B"
                strokeWidth={2}
                dot={false}
                hide={!!hiddenKeys['월생활비']}
              />
            </ComposedChart>
          </ResponsiveContainer>
          </div>
        </div>
      </GlassCard>

      {/* 4. Income Breakdown Stacked Bar Chart */}
      <GlassCard className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <span className={styles.chartTitle}>
            연령별 소득원 구성 (현재 ~ {params.userProfile.expectancy}세)
            <span style={{ fontSize: '0.85em', color: 'var(--foreground-muted)', marginLeft: '8px', fontWeight: 'normal' }}>
              ({params.inflationMode === 'nominal' ? '명목가치' : '실질가치'} 기준)
            </span>
          </span>
        </div>
        <div className={styles.chartScrollWrapper}>
          <div className={styles.chartContainer}>
            <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pensionChartData} margin={{ top: 10, right: 43, left: 0, bottom: 0 }}>
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
                stroke="var(--foreground-muted)"
                width={34}
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
                formatter={(value: any) => [formatValue(Number(value)), '']}
                labelFormatter={(label) => label.toString().includes('세') ? label : `${label}세`}
              />
              <Legend 
                verticalAlign="top" 
                height={36} 
                wrapperStyle={{ fontSize: '0.8rem', cursor: 'pointer' }} 
                onClick={handleLegendClick}
              />
              <Bar name="국민연금" dataKey="국민연금" stackId="a" fill="#10B981" hide={!!hiddenKeys['국민연금']} />
              <Bar name="사적연금" dataKey="사적연금" stackId="a" fill="#A855F7" hide={!!hiddenKeys['사적연금']} />
              <Bar name="배당소득" dataKey="배당소득" stackId="a" fill="#3B82F6" hide={!!hiddenKeys['배당소득']} />
              <Bar name="기타소득" dataKey="기타소득" stackId="a" fill="#F59E0B" hide={!!hiddenKeys['기타소득']} />
            </BarChart>
          </ResponsiveContainer>
          </div>
        </div>
      </GlassCard>

      {/* 5. 은퇴 후 연령별 월 생활비 재원 구성 그래프 */}
      <GlassCard className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <span className={styles.chartTitle}>
            은퇴 후 연령별 월 생활비 재원 구성 ({params.userProfile.retirementAge}세 ~ {params.userProfile.expectancy}세)
            <span style={{ fontSize: '0.85em', color: 'var(--foreground-muted)', marginLeft: '8px', fontWeight: 'normal' }}>
              ({params.inflationMode === 'nominal' ? '명목가치' : '실질가치'} 기준, 월별 환산)
            </span>
          </span>
        </div>
        <div className={styles.chartScrollWrapper}>
          <div className={styles.chartContainer}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spendingChartData} margin={{ top: 10, right: 43, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                <XAxis
                  dataKey="age"
                  stroke="var(--foreground-muted)"
                  style={{ fontSize: '0.75rem' }}
                  tickFormatter={(v) => `${v}세`}
                  minTickGap={10}
                  scale="point"
                  padding={{ left: 15, right: 15 }}
                />
                <YAxis
                  stroke="var(--foreground-muted)"
                  width={34}
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
                  formatter={(value: any) => [formatValue(Number(value)), '']}
                  labelFormatter={(label) => label.toString().includes('세') ? label : `${label}세 (월 생활비 구성)`}
                />
                <Legend 
                  verticalAlign="top" 
                  height={36} 
                  wrapperStyle={{ fontSize: '0.8rem', cursor: 'pointer' }} 
                  onClick={handleLegendClick}
                />
                <Bar name="국민연금" dataKey="국민연금" stackId="a" fill="#10B981" hide={!!hiddenKeys['국민연금']} />
                <Bar name="사적연금" dataKey="사적연금" stackId="a" fill="#A855F7" hide={!!hiddenKeys['사적연금']} />
                <Bar name="배당소득" dataKey="배당소득" stackId="a" fill="#3B82F6" hide={!!hiddenKeys['배당소득']} />
                <Bar name="기타소득" dataKey="기타소득" stackId="a" fill="#F59E0B" hide={!!hiddenKeys['기타소득']} />
                <Bar name="자산인출" dataKey="자산인출" stackId="a" fill="#EC4899" hide={!!hiddenKeys['자산인출']} />
                <Bar name="자산부족" dataKey="자산부족" stackId="a" fill="#EF4444" hide={!!hiddenKeys['자산부족']} />
                <ReferenceLine 
                  y={monthlyPensionLimit} 
                  stroke="#F59E0B" 
                  strokeDasharray="4 4" 
                  strokeWidth={1.5}
                  label={{ 
                    value: `사적연금 저율과세 한도 (${formatValue(monthlyPensionLimit)}/월)`, 
                    fill: '#F59E0B', 
                    position: 'insideBottomLeft', 
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    offset: 10
                  }} 
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </GlassCard>



      {/* 6. Yearly Detailed Chart */}
      {isPro && <YearlyChart params={params} result={result} />}

    </div>
  );
};
export default DashboardSection;
