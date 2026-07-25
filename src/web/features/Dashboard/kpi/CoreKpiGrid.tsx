'use client';

import { type ReactNode } from 'react';
import { Wallet, Landmark } from 'lucide-react';
import GlassCard from '../../../components/GlassCard';
import { RetirementLikelihoodStars } from './RetirementLikelihoodStars';

interface CoreKpiGridProps {
  survivalScore: number; // 기대수명까지 생존 가능성 (result.retirementScore)
  expectancy: number;
  endingAssets: number;
  monthlyTarget: number;
  utilityScore?: number; // Lifetime Utility Score. 없으면(계산 실패 등) 카드 자체를 숨긴다.
  formatValue: (val: number) => string;
}

// 결과 화면 최상단 핵심 KPI 4장. 나머지 지표는 SecondaryKpiCollapse로 옮겨 정보 우선순위를 명확히 한다.
export function CoreKpiGrid({
  survivalScore,
  expectancy,
  endingAssets,
  monthlyTarget,
  utilityScore,
  formatValue,
}: CoreKpiGridProps) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiCard label={`기대수명(${expectancy}세)까지 생존 가능성`}>
        <RetirementLikelihoodStars score={survivalScore} />
      </KpiCard>
      <KpiCard label="예상 순자산" icon={<Wallet size={16} aria-hidden="true" />}>
        <span className="font-display text-2xl font-semibold">{formatValue(endingAssets)}</span>
      </KpiCard>
      <KpiCard label="예상 월 생활비" icon={<Landmark size={16} aria-hidden="true" />}>
        <span className="font-display text-2xl font-semibold">{formatValue(monthlyTarget)}</span>
      </KpiCard>
      {utilityScore !== undefined && (
        <KpiCard label="평생 효용">
          <div className="flex items-center gap-2">
            <RetirementLikelihoodStars score={utilityScore} />
            <span className="text-sm text-foreground-muted">{Math.round(utilityScore)}점</span>
          </div>
        </KpiCard>
      )}
    </div>
  );
}

function KpiCard({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <GlassCard className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-sm text-foreground-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div>{children}</div>
    </GlassCard>
  );
}
