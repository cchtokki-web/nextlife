'use client';

import { Gauge, Settings2, Wand2 } from 'lucide-react';
import { StrategyMode } from '../../../core/entities/types';
import { RadioCardGroup, RadioCardOption } from '../../components/form';

const MODE_OPTIONS: ReadonlyArray<RadioCardOption<StrategyMode>> = [
  {
    value: 'simple',
    label: '간편 모드',
    description: '꼭 필요한 것만 고르면 나머지는 AI가 추천합니다.',
    icon: <Wand2 size={16} />,
    recommended: true,
  },
  {
    value: 'standard',
    label: '표준 모드',
    description: '투자 전략과 경제 가정까지 직접 조정합니다.',
    icon: <Gauge size={16} />,
  },
  {
    value: 'expert',
    label: '전문가 모드',
    description: '세율·한도 등 모든 변수를 직접 지정합니다.',
    icon: <Settings2 size={16} />,
  },
];

interface StrategyModeSelectorProps {
  mode: StrategyMode;
  onChange: (mode: StrategyMode) => void;
}

export function StrategyModeSelector({ mode, onChange }: StrategyModeSelectorProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs sm:text-[13px] font-semibold text-foreground/85">은퇴 전략 모드</span>
      <RadioCardGroup name="strategy-mode" value={mode} options={MODE_OPTIONS} onChange={onChange} ariaLabel="은퇴 전략 모드" />
    </div>
  );
}
