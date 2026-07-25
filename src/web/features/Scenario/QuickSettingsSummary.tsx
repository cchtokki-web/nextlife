'use client';

import GlassCard from '../../components/GlassCard';
import InputField from '../../components/InputField';
import { SimulationParams } from '../../../core/entities/types';
import { applyYieldPreset, restoreCustomYieldPreset } from '../../../core/usecases/scenario/applyYieldPreset';

interface QuickSettingsSummaryProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
}

const DEFAULT_USER_PROFILE = { currentAge: 35, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 };

const PRESETS: Array<{ key: 'conservative' | 'base' | 'aggressive'; label: string }> = [
  { key: 'conservative', label: '보수적 (주식 5%, 연금 3%)' },
  { key: 'base', label: '기본값 ⭐ (주식 7%, 연금 4%)' },
  { key: 'aggressive', label: '공격적 (주식 9%, 연금 6%)' },
];

// 좌측 입력 패널 최상단에 항상 노출되는 핵심 요약 카드. 현재나이/은퇴나이/목표월생활비/시장 수익률
// 프리셋 4개 필드만 직접 수정 가능하게 보여주고, 나머지 상세 설정은 그 아래 Collapse("설정 자세히
// 보기")에 남겨둔다. AssetFormSection.tsx의 profile 탭과 같은 값을 다루지만 별도 컴포넌트로
// 분리했다 — AssetFormSection(1637줄)의 내부 구조는 이번 재설계에서 건드리지 않기로 했기 때문이다.
export function QuickSettingsSummary({ params, onChangeParams }: QuickSettingsSummaryProps) {
  // AssetFormSection.tsx/DashboardSection.tsx와 동일한 방어적 기본값 처리.
  const userProfile = params.userProfile || DEFAULT_USER_PROFILE;

  const handleProfileChange = (key: keyof SimulationParams['userProfile'], value: number) => {
    onChangeParams({ ...params, userProfile: { ...userProfile, [key]: value } });
  };

  const handlePresetClick = (preset: 'conservative' | 'base' | 'aggressive') => {
    onChangeParams(applyYieldPreset(params, preset));
  };

  const handleCustomPresetClick = () => {
    onChangeParams(restoreCustomYieldPreset(params));
  };

  const activePreset = params.yieldPreset ?? null;
  // 직접입력 중이거나(현재 custom) 과거 직접입력 값을 복원할 스냅샷이 있을 때만 "사용자 프리셋"
  // 버튼을 노출한다 — 되돌릴 값이 아예 없는 상태에서는 버튼을 보여줘도 의미가 없다.
  const showCustomPreset = activePreset === 'custom' || !!params.customYieldSnapshot;

  return (
    <GlassCard>
      <div className="flex flex-col gap-4">
        <span className="text-sm font-semibold text-foreground-muted">핵심 설정</span>
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="현재 나이"
            type="number"
            value={userProfile.currentAge}
            onChange={(e) => handleProfileChange('currentAge', Number(e.target.value))}
            suffixText="세"
          />
          <InputField
            label="은퇴 나이"
            type="number"
            value={userProfile.retirementAge}
            onChange={(e) => handleProfileChange('retirementAge', Number(e.target.value))}
            suffixText="세"
          />
          <InputField
            label="목표 월 생활비"
            type="text"
            value={userProfile.targetMonthlySpending === 0 ? '0' : userProfile.targetMonthlySpending.toLocaleString()}
            onChange={(e) => {
              const rawValue = e.target.value.replace(/,/g, '');
              const numValue = rawValue === '' ? 0 : Number(rawValue);
              if (!isNaN(numValue)) {
                handleProfileChange('targetMonthlySpending', numValue);
              }
            }}
            suffixText={params.displayCurrency === 'KRW' ? '원' : params.displayCurrency}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs text-foreground-muted">시장 수익률 프리셋</span>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => handlePresetClick(key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  activePreset === key ? 'border-primary bg-primary/10 text-primary' : 'border-card-border text-foreground-muted'
                }`}
              >
                {label}
              </button>
            ))}
            {showCustomPreset && (
              <button
                type="button"
                onClick={handleCustomPresetClick}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  activePreset === 'custom' ? 'border-primary bg-primary/10 text-primary' : 'border-card-border text-foreground-muted'
                }`}
              >
                사용자 프리셋
              </button>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
