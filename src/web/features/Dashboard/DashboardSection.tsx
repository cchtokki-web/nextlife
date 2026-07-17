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

      <GlassCard className={styles.chartCard} style={{ padding: '2rem', marginTop: '1.5rem' }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 className={styles.taxSectionTitle} style={{ margin: 0 }}>AI 시뮬레이션 기반 연령별 자산 인출 가이드</h3>
        </div>
        <div className={styles.decumulationGrid}>
          {/* Left: Withdrawal Order Flowchart (Restructured to Age-based dynamic flow) */}
          <div className={styles.flowContainer}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--foreground-muted)', marginBottom: '0.5rem', display: 'block' }}>
              🗓️ 시뮬레이션 결과로 짜여진 나이대별 은퇴 자산 운용 로드맵
            </span>
            
            {/* 50s Card */}
            <div className={styles.flowItem}>
              <div className={styles.flowStepBadge} style={{ backgroundColor: 'var(--accent)', color: '#fff', fontWeight: 700 }}>50대</div>
              <div className={styles.flowItemContent}>
                <span className={styles.flowItemTitle}>은퇴 준비 및 세제 혜택 극대화 시기</span>
                <span className={styles.flowItemDesc}>
                  {isDepleted ? (
                    <span style={{ display: 'block', paddingLeft: '4px' }}>
                      • 현재 시뮬레이션 결과 <strong style={{ color: '#F87171' }}>{depletionAgeVal}세 자산 고갈</strong> 우려가 감지되었습니다.<br />
                      • 은퇴 전까지 연금저축/IRP(최대 연 900만원 세액공제) 납입액 및 주식 투자 적립금을 증액하여 기초 자산을 추가 확보하세요.
                    </span>
                  ) : (
                    <span style={{ display: 'block', paddingLeft: '4px' }}>
                      • 기대 수명({params.userProfile.expectancy}세)까지 자산 고갈 위험이 발생하지 않는 양호한 궤도입니다.<br />
                      • 은퇴 연령({retirementAgeVal}세) 시점까지 ISA 만기 자금의 연금 계좌 전환(이전액의 10%, 최대 300만원 추가 세액공제)을 통해 복리 혜택을 극대화하세요.
                    </span>
                  )}
                </span>
              </div>
            </div>

            <div className={styles.arrowIcon}>
              <span style={{ fontSize: '1.2rem' }}>↓</span>
            </div>

            {/* 60s Card */}
            <div className={styles.flowItem}>
              <div className={styles.flowStepBadge} style={{ backgroundColor: 'var(--primary)', color: '#fff', fontWeight: 700 }}>60대</div>
              <div className={styles.flowItemContent}>
                <span className={styles.flowItemTitle}>소득 공백기 대응 및 분리과세 한도 인출 시기</span>
                <span className={styles.flowItemDesc}>
                  {pensionGapYears > 0 ? (
                    <span style={{ display: 'block', paddingLeft: '4px' }}>
                      • 은퇴({retirementAgeVal}세)부터 국민연금 개시({firstAgeWithNationalPension}세)까지 약 <strong>{pensionGapYears}년의 소득 공백기</strong>가 감지되었습니다.<br />
                      • 이 시기에는 사적연금을 종합과세(16.5%~) 부담이 없는 연간 <strong>1,500만 원 이하</strong> 한도 내에서 수령하세요.<br />
                      • 부족한 생활비는 일반 금융 계좌의 주식/예금을 매도하여 충당해 종합 세율의 급상승을 예방하세요.
                    </span>
                  ) : (
                    <span style={{ display: 'block', paddingLeft: '4px' }}>
                      • 은퇴와 동시에 즉시 연금 소득이 개시되어 소득 공백 위험은 낮습니다.<br />
                      • 단, 사적연금(연금저축/IRP)의 총 수령액이 연간 1,500만 원 한도를 넘지 않도록 다년도 분산 인출 계획을 세워 종합과세 편입을 예방하세요.
                    </span>
                  )}
                </span>
              </div>
            </div>

            <div className={styles.arrowIcon}>
              <span style={{ fontSize: '1.2rem' }}>↓</span>
            </div>

            {/* 70s+ Card */}
            <div className={styles.flowItem}>
              <div className={styles.flowStepBadge} style={{ backgroundColor: 'var(--secondary)', color: '#fff', fontWeight: 700 }}>70대+</div>
              <div className={styles.flowItemContent}>
                <span className={styles.flowItemTitle}>종합소득세 & 건강보험료 자격 방어 시기</span>
                <span className={styles.flowItemDesc}>
                  {everComprehensiveTax ? (
                    <span style={{ display: 'block', paddingLeft: '4px' }}>
                      • 현재 배당소득이나 연금 규모가 커 금융소득종합과세(연 2,000만원) 또는 건강보험료 피부양자 자격 박탈 리스크가 높습니다.<br />
                      • 세후 실수령액 증대를 위해 배당 자산을 연금 계좌 내부로 이전하거나 비과세/분리과세 상품 위주로 자산 포트폴리오를 다변화해야 합니다.
                    </span>
                  ) : (
                    <span style={{ display: 'block', paddingLeft: '4px' }}>
                      • 예상 금융 및 연금소득의 합산액이 건강보험료 피부양자 자격 유지선(연 2,000만 원 이하) 내에서 안전하게 관리되고 있습니다.<br />
                      • 절세 최적화를 위해 매월 필요한 생활비 만큼만 연금 계좌 및 배당주에서 꺼내어 인출 순서 로드맵대로 지출을 관리하세요.
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Tax Alerts and Rebalancing Tips */}
          <div className={styles.tipList}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--foreground-muted)', marginBottom: '0.25rem' }}>
              ⚠️ 귀하의 시뮬레이션 결과에서 감지된 경고 임계점
            </span>

            <div className={`${styles.tipCard} ${hasHighPrivatePensionRisk ? styles.tipCardRed : styles.tipCardOrange}`}>
              <AlertTriangle size={18} color={hasHighPrivatePensionRisk ? '#EF4444' : '#F59E0B'} style={{ marginTop: '0.1rem', flexShrink: 0 }} />
              <div>
                <span className={styles.tipTitle} style={{ color: hasHighPrivatePensionRisk ? '#F87171' : 'inherit' }}>
                  사적연금 연 {formatShortValue(pensionLimit)} 초과 위험 {hasHighPrivatePensionRisk ? '(발생 위험 높음)' : '(안정 범위)'}
                </span>
                <p className={styles.tipDesc}>
                  {hasHighPrivatePensionRisk ? (
                    <>
                      시뮬레이션 분석 결과, 연금 수령 중 연간 {formatShortValue(pensionLimit)} 초과 연금 소득을 수령하는 연도가 다수 관측됩니다. 초과 수령액 전체에 고세율 종합과세가 적용되거나 {params.taxSettings?.privatePensionExcessTaxRate ?? 16.5}% 분리과세율이 붙어 실수령액이 깎이므로 수령 기간 연장을 검토해야 합니다.
                    </>
                  ) : (
                    <>
                      연간 사적연금 소득이 {formatShortValue(pensionLimit)} 이하의 저율 연금소득세(3.3%~5.5%) 안전 범위 내에 안착해 있습니다. 현재의 분산 인출 계획을 유지하시면 절세 효과가 극대화됩니다.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className={`${styles.tipCard} ${everComprehensiveTax ? styles.tipCardRed : styles.tipCardBlue}`}>
              <Calculator size={18} color={everComprehensiveTax ? '#EF4444' : '#3B82F6'} style={{ marginTop: '0.1rem', flexShrink: 0 }} />
              <div>
                <span className={styles.tipTitle} style={{ color: everComprehensiveTax ? '#F87171' : 'inherit' }}>
                  금융소득종합과세 한도 연 2,000만 원 {everComprehensiveTax ? '(세금 경고 대상)' : '(안정적 분리과세)'}
                </span>
                <p className={styles.tipDesc}>
                  {hasSignificantDividends ? (
                    <>
                      투자 중 발생하는 배당이 고배당 포트폴리오를 유지하게 하여, 배당 금액이 세제 임계점인 연 2,000만 원 한도를 넘어서면 다른 근로/연금소득과 함께 최고 45% 누진 세율로 부과될 수 있습니다. 고배당 자산은 사적 연금 계좌 내부에서 운용하세요.
                    </>
                  ) : (
                    <>
                      매년 발생하는 이자 및 배당소득이 2,000만 원 미만으로 예상되어 15.4% 원천징수 분리과세로 세무 의무가 깔끔히 완결됩니다.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className={`${styles.tipCard} ${everComprehensiveTax ? styles.tipCardOrange : styles.tipCardGreen}`}>
              <Zap size={18} color={everComprehensiveTax ? '#F59E0B' : '#10B981'} style={{ marginTop: '0.1rem', flexShrink: 0 }} />
              <div>
                <span className={styles.tipTitle}>건강보험료 지역가입자 피부양자 자격 자가점검</span>
                <p className={styles.tipDesc}>
                  {everComprehensiveTax ? (
                    <>
                      소득 합산액이 연 2,000만 원을 초과할 가능성이 있어 피부양자 지위가 상실되고 직장 건강보험에서 지역가입자로의 예상치 못한 연 건보료 부담이 발생할 우려가 큽니다. 자산 분할 및 재배치가 권장됩니다.
                    </>
                  ) : (
                    <>
                      합산 소득액이 기준 금액선 내에서 관리되고 있으므로 피부양자 지위 유지 가능성이 높으며 직장 자녀 가계 하의 피부양 혜택 유지가 수월합니다.
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* 6. Yearly Detailed Chart */}
      {isPro && <YearlyChart params={params} result={result} />}

    </div>
  );
};
export default DashboardSection;
