'use client';

import { type ReactNode } from 'react';
import { Wallet, Landmark, ShieldCheck, Award } from 'lucide-react';
import GlassCard from '../../../components/GlassCard';
import { RetirementLikelihoodStars } from './RetirementLikelihoodStars';

interface CoreKpiGridProps {
  survivalScore: number; // 은퇴 준비도 점수 (result.retirementScore) — 자산 충분성/현금흐름/연금 커버율/
  // 고갈 위험/인플레이션 방어력을 종합한 점수. "생존 가능성"이 아니라 준비도 등급으로 표기한다.
  expectancy: number;
  endingAssets: number;
  monthlyTarget: number;
  utilityScore?: number; // Lifetime Utility Score. 없으면(계산 실패 등) 카드 자체를 숨긴다.
  formatValue: (val: number) => string;
  resultBasis?: 'current' | 'recommended';
}

// 결과 화면 최상단 핵심 KPI 4장.
export function CoreKpiGrid({
  survivalScore,
  expectancy,
  endingAssets,
  monthlyTarget,
  utilityScore,
  formatValue,
  resultBasis = 'current',
}: CoreKpiGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiCard label={`${expectancy}세까지 은퇴 준비도`} icon={<ShieldCheck size={16} aria-hidden="true" />}>
        <RetirementLikelihoodStars score={survivalScore} />
      </KpiCard>
      <KpiCard label={`${expectancy}세 예상 순자산 · ${resultBasis === 'recommended' ? '추천 결과' : '현재 계획'}`} icon={<Wallet size={16} aria-hidden="true" />}>
        <span className="font-display text-2xl font-semibold">{formatValue(endingAssets)}</span>
      </KpiCard>
      <KpiCard label="예상 월 생활비" icon={<Landmark size={16} aria-hidden="true" />}>
        <span className="font-display text-2xl font-semibold">{formatValue(monthlyTarget)}</span>
      </KpiCard>
      {utilityScore !== undefined && (
        <KpiCard label="평생 효용" icon={<Award size={16} aria-hidden="true" />}>
          {/* 점수를 별 옆이 아니라 등급 텍스트 옆(별 아래 줄)에 붙인다. 카드 폭이 좁아
              별 5개와 "보통 71점"을 한 줄에 두면 글자가 세로로 쪼개진다. */}
          <RetirementLikelihoodStars
            score={utilityScore}
            suffix={<span>{Math.round(utilityScore)}점</span>}
          />
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
