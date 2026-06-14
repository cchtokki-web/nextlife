"use client";

import React from 'react';
import { SimulationParams, SimulationResult } from '../../../core/entities/types';
import GlassCard from '../../components/GlassCard';
import styles from './Dashboard.module.css';
import { AlertTriangle, TrendingDown, Target, Zap, ShieldAlert, Award } from 'lucide-react';
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
}

export const DashboardSection: React.FC<DashboardSectionProps> = ({ params: rawParams, result, compareResults = [] }) => {
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

  // Check if any year has tax warning
  const taxWarningYears = yearlyResults.filter((r) => r.hasTaxWarning);
  const hasGlobalTaxWarning = taxWarningYears.length > 0;
  let taxWarningPeriodText: React.ReactNode = null;
  if (hasGlobalTaxWarning) {
    const first = taxWarningYears[0];
    const last = taxWarningYears[taxWarningYears.length - 1];
    if (first.year === last.year) {
      taxWarningPeriodText = <span><strong>{first.year}년({first.age}세)</strong>에</span>;
    } else {
      taxWarningPeriodText = <span><strong>{first.year}년({first.age}세) ~ {last.year}년({last.age}세)</strong> 동안</span>;
    }
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

      {/* 1. Top Metrics Row */}
      <div className={styles.metricsGrid}>
        
        {/* Score Card */}
        <GlassCard className={styles.metricCard} glowColor="primary">
          <span className={styles.scoreTitle}>은퇴 준비도 점수</span>
          <div style={{ position: 'relative', width: radius * 2, height: radius * 2 }}>
            <svg height={radius * 2} width={radius * 2} className={styles.circleSvg}>
              <circle
                className={styles.circleBg}
                r={normalizedRadius}
                cx={radius}
                cy={radius}
                strokeWidth={strokeWidth}
              />
              <circle
                className={styles.circleBar}
                r={normalizedRadius}
                cx={radius}
                cy={radius}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference + ' ' + circumference}
                style={{ strokeDashoffset }}
                stroke="url(#neonIndigoPurple)"
              />
              <defs>
                <linearGradient id="neonIndigoPurple" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--primary)" />
                  <stop offset="100%" stopColor="var(--secondary)" />
                </linearGradient>
              </defs>
            </svg>
            <div className={styles.scoreValue}>
              {result.retirementScore}
              <span className={styles.scoreValueUnit}>점</span>
            </div>
          </div>
          <span className={styles.metricSubText} style={{ marginTop: '0.75rem', fontWeight: 600 }}>
            {result.retirementGrade} 등급
          </span>
          <span className={styles.metricSubText} style={{ marginTop: '0.25rem' }}>
            {result.depletionAge ? `${result.depletionAge}세 자산 고갈 예상` : '기대수명 내 고갈 위험 없음'}
          </span>
        </GlassCard>

        {/* Goal Achievement Card */}
        <GlassCard className={styles.metricCard} glowColor="secondary">
          <span className={styles.scoreTitle}>은퇴 소득 달성률</span>
          <div style={{ position: 'relative', width: radius * 2, height: radius * 2 }}>
            <svg height={radius * 2} width={radius * 2} className={styles.circleSvg}>
              <circle
                className={styles.circleBg}
                r={normalizedRadius}
                cx={radius}
                cy={radius}
                strokeWidth={strokeWidth}
              />
              <circle
                className={styles.circleBar}
                r={normalizedRadius}
                cx={radius}
                cy={radius}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference + ' ' + circumference}
                style={{ strokeDashoffset: goalDashoffset }}
                stroke="url(#neonPurpleCyan)"
              />
              <defs>
                <linearGradient id="neonPurpleCyan" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--secondary)" />
                  <stop offset="100%" stopColor="var(--accent)" />
                </linearGradient>
              </defs>
            </svg>
            <div className={styles.scoreValue}>
              {goalAchievementRate}
              <span className={styles.scoreValueUnit}>%</span>
            </div>
          </div>
          <span className={styles.metricSubText} style={{ marginTop: '0.75rem' }}>
            목표 월 생활비 대비 확보액 비율
          </span>
        </GlassCard>

        {/* FIRE Age Card */}
        <GlassCard className={styles.metricCard} interactive glowColor="accent">
          <div style={{ background: 'rgba(6, 182, 212, 0.15)', padding: '0.5rem', borderRadius: '50%' }}>
            <Zap size={20} color="var(--accent)" />
          </div>
          <span className={styles.scoreTitle} style={{ marginTop: '0.5rem' }}>FIRE 조기은퇴 가능 나이</span>
          <span className={styles.metricValueText}>
            {fireAge ? `${fireAge} 세` : '달성 불가능'}
          </span>
          <span className={styles.metricSubText}>
            소득이 연간 생활비를 추월하는 시점
          </span>
        </GlassCard>

        {/* Ending Assets Card */}
        <GlassCard className={styles.metricCard}>
          <div style={{ background: 'rgba(16, 185, 129, 0.15)', padding: '0.5rem', borderRadius: '50%' }}>
            <Award size={20} color="var(--success)" />
          </div>
          <span className={styles.scoreTitle} style={{ marginTop: '0.5rem' }}>사망 시 잔여 자산</span>
          <span className={styles.metricValueText} style={{ color: endingAssets > 0 ? 'var(--success)' : '#EF4444' }}>
            {formatValue(endingAssets)}
          </span>
          <span className={styles.metricSubText}>
            만 {params.userProfile.expectancy}세 시점 예상 잔액
          </span>
        </GlassCard>

      </div>

      {/* 2. Global Tax Warning Alert */}
      {hasGlobalTaxWarning && (
        <div className={styles.warningCard}>
          <ShieldAlert size={22} className={styles.warningIcon} />
          <div className={styles.warningContent}>
            <span className={styles.warningTitle}>금융소득종합과세 위험 노출</span>
            <span className={styles.warningText}>
              {taxWarningPeriodText} <strong>연간 금융소득 2,000만 원을 초과</strong>하여 종합소득세 과세 대상이 될 수 있습니다. 세액공제 한도 확인 및 인출 전략 점검을 권장합니다.
            </span>
          </div>
        </div>
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
        <div className={styles.chartContainer}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={assetChartData} margin={{ top: 10, right: 15, left: 10, bottom: 10 }}>
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
              />
              <YAxis
                yAxisId="left"
                stroke="var(--foreground-muted)"
                style={{ fontSize: '0.75rem' }}
                width={65}
                tickFormatter={(v) => formatShortValue(v)}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#F59E0B"
                style={{ fontSize: '0.75rem' }}
                width={60}
                tickFormatter={(v) => formatShortValue(v)}
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
        <div className={styles.chartContainer}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pensionChartData} margin={{ top: 10, right: 75, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
              <XAxis
                dataKey="age"
                stroke="var(--foreground-muted)"
                style={{ fontSize: '0.75rem' }}
                tickFormatter={(v) => `${v}세`}
                minTickGap={15}
              />
              <YAxis
                stroke="var(--foreground-muted)"
                style={{ fontSize: '0.75rem' }}
                width={65}
                tickFormatter={(v) => formatShortValue(v)}
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
      </GlassCard>

    </div>
  );
};
export default DashboardSection;
