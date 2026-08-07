'use client';

import { Dices, TrendingDown } from 'lucide-react';
import GlassCard from '../../../components/GlassCard';
import { MonteCarloResult } from '../../../../core/entities/montecarlo';
import { SequenceRiskResult } from '../../../../core/usecases/montecarlo/sequenceRisk';
import { MonteCarloStatus } from '../../../hooks/useMonteCarlo';

interface MonteCarloSectionProps {
  status: MonteCarloStatus;
  monteCarlo?: MonteCarloResult;
  sequenceRisk?: SequenceRiskResult;
  formatValue: (value: number) => string;
  isPro: boolean;
}

// 결정론 단일 경로가 답하지 못하는 두 질문을 다룬다.
//   1. "기대수명까지 자산이 남을 확률은?"          → 몬테카를로 성공률
//   2. "평균은 같은데 순서가 나쁘면 얼마나 달라지나?" → 시퀀스 리스크 격차
//
// 게이팅: 헤드라인 두 줄(성공률·순서 격차)은 무료로 둔다. 이것이 이 기능의 핵심 메시지이고,
// 숫자 하나 보여주지 않으면 무엇을 위한 기능인지 알 수 없다. 상세 분포와 경우별 비교는
// Pro 전용이다(ExpertDetailsPanel의 YearlyChart 게이팅과 같은 선례).
export function MonteCarloSection({
  status,
  monteCarlo,
  sequenceRisk,
  formatValue,
  isPro,
}: MonteCarloSectionProps) {
  if (status === 'idle') return null;

  if (status === 'running') {
    return (
      <GlassCard>
        <div className="flex items-center gap-3 py-2">
          <Dices size={20} className="shrink-0 animate-pulse text-foreground-muted" aria-hidden="true" />
          <span className="text-sm text-foreground-muted">
            여러 시장 상황을 계산 중입니다…
          </span>
        </div>
      </GlassCard>
    );
  }

  if (status === 'error') {
    return (
      <GlassCard>
        <p className="py-2 text-sm text-foreground-muted">
          시장 변동성 분석을 계산하지 못했습니다. 나머지 결과는 정상입니다.
        </p>
      </GlassCard>
    );
  }

  // Worker가 없는 환경에서도 나머지 화면은 정상이어야 한다. 조용히 사라지는 대신 왜 없는지
  // 밝힌다 — 사용자가 "내 화면에만 없는 기능"을 의심하지 않도록.
  if (status === 'unsupported') {
    return (
      <GlassCard>
        <p className="py-2 text-sm text-foreground-muted">
          이 브라우저가 백그라운드 계산을 지원하지 않아 시장 변동성 분석을 건너뛰었습니다.
        </p>
      </GlassCard>
    );
  }

  if (!monteCarlo) return null;

  const successPercent = Math.round(monteCarlo.successRate * 100);
  const fullSpendingPercent = Math.round(monteCarlo.fullSpendingRate * 100);

  return (
    <GlassCard>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="mb-2 flex items-center gap-2 font-display text-base font-semibold">
            <Dices size={18} aria-hidden="true" />
            시장이 흔들려도 계획이 버틸 확률
          </h3>
          <p className="text-sm">
            수익률이 해마다 오르내리는 상황을 {monteCarlo.trials.toLocaleString()}회 시뮬레이션한 결과,{' '}
            <strong className="text-lg">{successPercent}%</strong>의 경우에{' '}
            {monteCarlo.successAge}세까지 자산이 남았습니다.
          </p>
          <p className="mt-1 text-xs text-foreground-muted">
            목표 생활비를 한 해도 줄이지 않고 유지한 경우는 {fullSpendingPercent}%입니다.
          </p>
        </section>

        {isPro && (
          <section data-testid="monte-carlo-distribution">
            <h4 className="mb-2 text-sm font-semibold">기대수명 시점 잔여자산 분포</h4>
            <dl className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <dt className="text-foreground-muted">하위 10%</dt>
                <dd className="font-semibold">{formatValue(monteCarlo.endingAssets.p10)}</dd>
              </div>
              <div>
                <dt className="text-foreground-muted">중앙값</dt>
                <dd className="font-semibold">{formatValue(monteCarlo.endingAssets.p50)}</dd>
              </div>
              <div>
                <dt className="text-foreground-muted">상위 10%</dt>
                <dd className="font-semibold">{formatValue(monteCarlo.endingAssets.p90)}</dd>
              </div>
            </dl>
            {/* **변동성 손실을 숨기지 않는다.** 충격의 기대값이 0이어도 복리로 굴리면
                기하평균 < 산술평균이라 중앙값이 결정론 결과보다 낮게 나온다. 이건 버그가
                아니라 "연 7%가 30년 내리 유지되는 경우는 거의 없다"의 정량적 실체다. */}
            <p className="mt-2 text-xs text-foreground-muted">
              변동 없음 가정: {formatValue(monteCarlo.deterministicEndingAssets)} — 수익률이 매년 흔들리면
              같은 평균 수익률이라도 결과 중앙값은 이보다 낮아집니다.
            </p>
            {monteCarlo.depletion.count > 0 && (
              <p className="mt-1 text-xs text-danger">
                자산이 먼저 바닥난 경우가 {monteCarlo.depletion.count.toLocaleString()}회 있었고,
                가장 이른 시점은 {monteCarlo.depletion.earliestAge}세였습니다.
              </p>
            )}
          </section>
        )}

        {sequenceRisk && (
          <section>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <TrendingDown size={16} aria-hidden="true" />
              같은 평균, 다른 순서
            </h4>
            <p className="text-sm">
              좋은 해가 먼저 오느냐 나쁜 해가 먼저 오느냐만으로 기대수명 시점 자산이{' '}
              <strong>{formatValue(sequenceRisk.orderingSpread)}</strong> 갈립니다.
            </p>
            {/* 순열이므로 평균이 실제로 같다. 이 문장을 빼면 사용자는 "그냥 운이 나쁜 경우"로
                읽고, 은퇴 직후 하락이 왜 특별히 위험한지 이해하지 못한다. */}
            <p className="mt-1 text-xs text-foreground-muted">
              아래 경우들은 <strong>연평균 수익률이 완전히 같습니다.</strong> 다른 것은 순서뿐입니다 —
              은퇴 직후에 하락이 오면 회복할 원금이 이미 인출로 줄어 있기 때문입니다.
            </p>

            {isPro && (
              <ul className="mt-3 flex flex-col gap-1.5 text-xs">
                {sequenceRisk.cases.map((c) => (
                  <li key={c.key} className="flex items-center justify-between gap-3">
                    <span className="text-foreground-muted">{c.label}</span>
                    <span className="font-semibold">
                      {formatValue(c.endingAssets)}
                      {c.depletionAge !== null && (
                        <span className="ml-1 font-normal text-danger">({c.depletionAge}세 고갈)</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </GlassCard>
  );
}
