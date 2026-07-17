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



      {/* 2. Tax Comparison Card (Retirement Period Average) */}
      {isPro && (
        <GlassCard className={styles.chartCard} style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
            <Calculator size={20} color="var(--primary)" style={{ marginRight: '0.5rem' }} />
            <span className={styles.chartTitle} style={{ margin: 0 }}>은퇴기(은퇴 연령 ~ 기대 수명) 평균 세금 및 건강보험료 분석</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', textAlign: 'center' }}>
            <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--foreground-muted)', marginBottom: '0.5rem' }}>연 평균 세전 소득</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'white' }}>{formatValue(avgPreTaxIncome)}</div>
            </div>
            <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '12px' }}>
              <div style={{ fontSize: '0.85rem', color: '#FCA5A5', marginBottom: '0.5rem' }}>연 평균 세금 차감</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#EF4444' }}>- {formatValue(avgTotalTax)}</div>
            </div>
            <div style={{ padding: '1rem', background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '12px' }}>
              <div style={{ fontSize: '0.85rem', color: '#FCD34D', marginBottom: '0.5rem' }}>건보료 추가 차감</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#F59E0B' }}>- {formatValue(avgHealthInsurance)}</div>
            </div>
            <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '12px' }}>
              <div style={{ fontSize: '0.85rem', color: '#6EE7B7', marginBottom: '0.5rem' }}>연 평균 세후 실수령액</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#10B981' }}>{formatValue(avgNetIncome)}</div>
            </div>
          </div>
        </GlassCard>
      )}


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

      {/* 5. AI 절세 및 자산 인출 가이드 (AI Tax & Decumulation Guide) */}
      <GlassCard className={styles.chartCard} style={{ padding: '2rem', marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
          <Zap size={22} color="var(--primary)" style={{ marginRight: '0.6rem' }} />
          <h3 className={styles.taxSectionTitle} style={{ margin: 0 }}>AI 절세 및 자산 인출 가이드</h3>
        </div>
        <p className={styles.taxSectionDesc}>
          은퇴 후 자산 가치를 극대화하고 불필요한 세금을 최소화하는 최적의 인출 전략과 절세 팁입니다.
        </p>

        <div className={styles.decumulationGrid}>
          {/* Left: Withdrawal Order Flowchart */}
          <div className={styles.flowContainer}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--foreground-muted)', marginBottom: '0.25rem' }}>
              💡 추천하는 은퇴 자산 인출 순서 (세금 최소화 로드맵)
            </span>
            
            <div className={styles.flowItem}>
              <div className={styles.flowStepBadge}>1</div>
              <div className={styles.flowItemContent}>
                <span className={styles.flowItemTitle}>일반 금융 계좌 & 주식 자산 우선 인출</span>
                <span className={styles.flowItemDesc}>
                  일반 과세 계좌의 예적금이나 국내 상장 주식을 먼저 꺼내어 소비합니다. 세금 이연 혜택이 있는 연금 계좌의 인출을 최대한 늦춰 복리 효과를 오래 누립니다.
                </span>
              </div>
            </div>

            <div className={styles.arrowIcon}>
              <span style={{ fontSize: '1.2rem' }}>↓</span>
            </div>

            <div className={styles.flowItem}>
              <div className={styles.flowStepBadge}>2</div>
              <div className={styles.flowItemContent}>
                <span className={styles.flowItemTitle}>사적연금(연금저축/IRP) 한도 내 인출</span>
                <span className={styles.flowItemDesc}>
                  연간 사적연금 수령액 합계액을 <strong>1,500만 원 이하</strong>로 유지하며 인출합니다. 이 한도 내에서는 종합과세되지 않고 3.3% ~ 5.5%의 저율 연금소득세만 부과됩니다.
                </span>
              </div>
            </div>

            <div className={styles.arrowIcon}>
              <span style={{ fontSize: '1.2rem' }}>↓</span>
            </div>

            <div className={styles.flowItem}>
              <div className={styles.flowStepBadge}>3</div>
              <div className={styles.flowItemContent}>
                <span className={styles.flowItemTitle}>ISA(개인자산관리계좌) 만기 자금 및 비과세 자산</span>
                <span className={styles.flowItemDesc}>
                  ISA 만기 시 연금저축/IRP로 추가 납입하여 세액공제 한도를 늘리거나, 비과세 분리과세 혜택이 있는 저축성 보험 및 국채를 통해 실질 가치를 보전하며 인출합니다.
                </span>
              </div>
            </div>
          </div>

          {/* Right: Tax Alerts and Rebalancing Tips */}
          <div className={styles.tipList}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--foreground-muted)', marginBottom: '0.25rem' }}>
              ⚠️ 주의해야 할 은퇴 소득 과세 임계점
            </span>

            <div className={`${styles.tipCard} ${styles.tipCardOrange}`}>
              <AlertTriangle size={18} color="#F59E0B" style={{ marginTop: '0.1rem', flexShrink: 0 }} />
              <div>
                <span className={styles.tipTitle}>사적연금 연 1,500만 원 초과 과세</span>
                <p className={styles.tipDesc}>
                  연금저축과 IRP 수령액이 연간 1,500만 원을 초과할 경우, 수령액 전체에 대해 종합과세 대상이 되거나 16.5%의 분리과세율을 적용받으므로 인출 연도와 금액을 고르게 분산해야 합니다.
                </p>
              </div>
            </div>

            <div className={`${styles.tipCard} ${styles.tipCardBlue}`}>
              <Calculator size={18} color="#3B82F6" style={{ marginTop: '0.1rem', flexShrink: 0 }} />
              <div>
                <span className={styles.tipTitle}>금융소득종합과세 한도 연 2,000만 원</span>
                <p className={styles.tipDesc}>
                  이자 및 배당소득의 연간 합계액이 2,000만 원을 넘으면 초과분이 종합과세(최대 45% 누진세율)에 반영됩니다. 배당이 많이 나오는 자산은 가능한 연금 계좌 내부에서 운용하세요.
                </p>
              </div>
            </div>

            <div className={`${styles.tipCard} ${styles.tipCardGreen}`}>
              <Zap size={18} color="#10B981" style={{ marginTop: '0.1rem', flexShrink: 0 }} />
              <div>
                <span className={styles.tipTitle}>건강보험료 지역가입자 피부양자 자격</span>
                <p className={styles.tipDesc}>
                  연간 합산 소득(국민연금, 배당 등)이 2,000만 원을 초과하면 피부양자 자격이 박탈되어 지역건강보험료 부담이 크게 발생할 수 있습니다. 비과세/분리과세 자산 중심의 재배치가 필요합니다.
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
