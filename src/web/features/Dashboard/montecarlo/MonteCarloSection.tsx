'use client';

import { Dices, TrendingDown } from 'lucide-react';
import GlassCard from '../../../components/GlassCard';
import { MonteCarloResult } from '../../../../core/entities/montecarlo';
import { SequenceRiskResult } from '../../../../core/usecases/montecarlo/sequenceRisk';
import { MonteCarloStatus } from '../../../hooks/useMonteCarlo';
import { describeMonteCarloAssumptions } from '../../../../core/usecases/montecarlo/describeAssumptions';

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

  const assetPercent = Math.round(monteCarlo.successRate * 100);
  const spendingPercent = Math.round(monteCarlo.spendingSuccessRate * 100);
  // 「평생 소비 최적화」에서 판정 기준은 사용자가 입력한 목표가 아니라 엔진이 역산한
  // 지속가능액이다. 밝히지 않으면 사용자는 자기 목표(예: 월 350만원) 기준으로 읽는다.
  const plannedMonthly = formatValue(monteCarlo.plannedMonthlySpending);
  // 문구는 core가 만든다. PDF와 «같은 문장»이어야 하고, 그 판정 규칙(어느 축이 사용자 입력을
  // 덮었는지)은 엔진의 것이기 때문이다(describeMonteCarloAssumptions 주석).
  const assumptionCopy = describeMonteCarloAssumptions(monteCarlo);

  return (
    <GlassCard>
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="mb-2 flex items-center gap-2 font-display text-base font-semibold">
            <Dices size={18} aria-hidden="true" />
            시장이 흔들려도 계획이 버틸 확률
          </h3>
          <p className="text-xs text-foreground-muted">
            수익률이 해마다 오르내리는 상황을 {monteCarlo.trials.toLocaleString()}회 시뮬레이션한 결과입니다.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
            계산 가정: {assumptionCopy.calculation}
          </p>
          {/* 미정으로 둔 축이 있을 때만 나온다. 설정 화면이 「네 가지 경기 국면 모두에서 견디는
              인출 계획을 고릅니다」라고 약속하기 때문에, 그 비교가 «이 확률»에는 들어가지 않았다는
              사실을 여기서 밝히지 않으면 사용자는 위 숫자를 4국면 검증의 산물로 읽는다. */}
          {assumptionCopy.robustness && (
            <p className="mt-1 text-xs leading-relaxed text-foreground-muted">
              {assumptionCopy.robustness}
            </p>
          )}
          {/* 두 확률을 나란히 놓는다. 예전에는 자산 유지 확률이 큰 글씨로 먼저 나오고 생활비
              쪽이 작은 글씨 부연이었는데, 사용자가 실제로 두려워하는 것은 "죽을 때 잔액이
              0원인가"가 아니라 "살아 있는 동안 쓸 돈이 모자라는가"다. 그리고 옛 정의는 생활비
              확률을 자산 생존 시행 안에서만 세어, 연금이 생활비를 메우는 경로를 실패로 셌다. */}
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-semibold">생활 유지 성공률</dt>
              <dd className="font-display text-2xl font-semibold">{spendingPercent}%</dd>
              <p className="mt-0.5 text-xs text-foreground-muted">
                계획 생활비(월 {plannedMonthly})를 한 해도 줄이지 않은 경우입니다.
              </p>
            </div>
            <div>
              <dt className="text-sm font-semibold text-foreground-muted">자산 보존 성공률</dt>
              <dd className="font-display text-2xl font-semibold text-foreground-muted">{assetPercent}%</dd>
              <p className="mt-0.5 text-xs text-foreground-muted">
                {monteCarlo.successAge}세까지 자산이 남은 경우입니다. 두 확률은 서로 다른 실패를 셉니다 —
                연금이 생활비를 덮으면 자산이 바닥나도 생활은 유지됩니다.
              </p>
            </div>
          </dl>
        </section>

        {/* **변동성 손실은 무료로 보여준다.**
            충격의 기대값이 0이어도 복리로 굴리면 기하평균 < 산술평균이라 중앙값이 결정론
            결과보다 낮게 나온다. 이건 버그가 아니라 "연 7%가 30년 내리 유지되는 경우는 거의
            없다"의 정량적 실체다.

            예전에는 이 설명이 아래 Pro 분포 안에 있었다. 그 사이 자산 추이 차트에서 중앙값
            선을 걷어냈고(계열이 일곱 개라 점선끼리 겹쳤다), 그래서 무료 사용자는 낙관적인
            결정론 곡선만 보고 그것을 기대값으로 읽게 됐다.

            방향만 말하지 않고 «두 값을 나란히» 놓는다 — 얼마나 낮은지를 모르면 사용자가 할
            수 있는 일이 없다.

            지금은 차트도 진단 카드도 중앙값을 말하므로 이 블록이 남은 이유가 바뀌었다:
            **두 기준의 격차 자체**가 여기서만 보인다. 화면의 다른 자리는 어느 한쪽만 쓴다. */}
        <section data-testid="volatility-drag">
          <h4 className="mb-2 text-sm font-semibold">시장이 흔들리면 얼마나 줄어드나</h4>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-foreground-muted">변동 없음 가정</dt>
              <dd className="font-semibold">{formatValue(monteCarlo.deterministicEndingAssets)}</dd>
            </div>
            <div>
              <dt className="text-foreground-muted">흔들릴 때 중앙값</dt>
              <dd className="font-semibold">{formatValue(monteCarlo.endingAssets.p50)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-foreground-muted">
            같은 평균 수익률이라도 해마다 오르내리면 결과는 이만큼 낮아집니다. 자산 추이 차트의
            총 자산액 곡선과 진단 카드의 「예상자산」은 오른쪽 값을 기준으로 합니다.
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
            {/* 이 표에 「변동 없음 가정」을 나란히 놓지 않는다. 그 비교는 무료 사용자에게 가장
                필요한 설명이라 volatility-drag 섹션이 맡고 있고, 여기서 되풀이하면 같은 문장이
                한 화면에 두 번 나온다. 중앙값이 두 섹션에 함께 나오는 것은 의도다 — 저쪽은
                「변동 없음 대비 얼마나 줄었나」의 한쪽 항이고, 이 표는 분포의 가운데다. */}
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
            {/* 순열이므로 평균이 실제로 같다. 그 사실만 말하면 사용자는 "그냥 운이 나쁜 경우"로
                읽는다. **왜** 순서가 결과를 가르는지 — 인출 중에는 하락이 원금을 영구히 줄인다는
                메커니즘 — 을 함께 말해야 은퇴 직후 구간을 왜 따로 지켜야 하는지 이해된다. */}
            <p className="mt-1 text-xs text-foreground-muted">
              아래 경우들은 <strong>연평균 수익률이 완전히 같습니다.</strong> 다른 것은 순서뿐입니다.
              <strong> 은퇴 직후 5~10년의 수익률이 특히 중요합니다</strong> — 평균이 같더라도 은퇴 초기에
              큰 하락이 오면 생활비를 마련하려고 자산을 싼값에 팔게 되고, 그렇게 줄어든 원금은 이후
              시장이 회복해도 함께 회복되지 않기 때문입니다.
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
