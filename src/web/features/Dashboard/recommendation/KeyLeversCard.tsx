'use client';

import { ListOrdered } from 'lucide-react';
import GlassCard from '../../../components/GlassCard';
import { KeyLever } from '../../../../core/usecases/dashboard/computeKeyLevers';

interface KeyLeversCardProps {
  levers: KeyLever[];
}

// 「무엇부터 손대야 하는가」. 아래 실행 로드맵보다 위에 둔다.
//
// 예전에는 실행 계획 그룹의 첫 카드가 곧 AI 추천 체크리스트였고, 그 체크리스트가 탐색하는
// 범위는 인출 계획 축뿐이라 화면이 "배당수익률 낮은 자산부터 매도"를 이 계획의 1순위 과제로
// 제시했다. 순서를 정하는 근거는 computeKeyLevers 주석에 있다.
export function KeyLeversCard({ levers }: KeyLeversCardProps) {
  if (levers.length === 0) return null;

  return (
    <GlassCard>
      <h3 className="mb-1 flex items-center gap-2 text-base font-semibold">
        <ListOrdered size={18} aria-hidden="true" />
        무엇부터 바꿔야 하나
      </h3>
      <p className="mb-3 text-xs text-foreground-muted">
        이미 계산된 결과에서 영향이 큰 순서로 정리했습니다. 아래로 갈수록 효과가 작습니다.
      </p>
      <ol className="flex flex-col gap-3">
        {levers.map((lever, index) => (
          <li key={lever.key} className="flex gap-3 border-b border-card-border pb-3 last:border-none last:pb-0">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold">
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-semibold">{lever.title}</p>
              <p className="mt-0.5 text-xs text-foreground-muted">{lever.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </GlassCard>
  );
}
