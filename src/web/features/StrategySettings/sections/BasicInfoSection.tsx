'use client';

import { SimulationParams, SpouseProfile } from '../../../../core/entities/types';
import {
  NATIONAL_PENSION_DEFERRED_MAX_AGE, NATIONAL_PENSION_EARLY_MIN_AGE,
} from '../../../../core/usecases/pension/nationalPensionRules';
import InputField from '../../../components/InputField';
import { FieldRow, SwitchField } from '../../../components/form';
import { isFieldVisible } from '../fieldVisibility';
import { DEFAULT_SPOUSE, SectionProps } from '../strategyOptions';

// 나이 입력의 허용 범위. 값들 사이의 상호 관계(은퇴 나이 > 현재 나이 등)는 여기서 강제하지
// 않는다 — 타이핑 중간 상태(예: 85 → 8 → 82)를 되돌리면 입력이 튀기 때문이며, 이 파일은
// 이미 그런 모순을 되돌리는 대신 경고로 알리는 정책을 쓴다(아래 spouseAgeInvalid).
const AGE_MIN = 0;
const AGE_MAX = 120;
const EXPECTANCY_MAX = 130;

// 나이 입력 파싱. 저장하지 말아야 할 입력이면 null을 돌려준다.
//
// 빈 문자열을 그냥 Number()에 넣으면 0이 된다. 나이 입력은 디바운스 자동저장(useScenarios)과
// 겹치므로, 사용자가 값을 지우고 다음 숫자를 치기 전에 저장이 걸리면 그 0이 암호화 저장소에
// 영구히 남는다. 특히 currentAge 0은 엔진의 totalYears 가드도 통과해(0~90세 = 91년)
// 전혀 다른 시뮬레이션이 조용히 계산된다.
function parseAge(raw: string, max: number): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(AGE_MIN, value));
}

export function BasicInfoSection({ params, onChangeParams, mode, changed }: SectionProps) {
  const { userProfile } = params;
  const spouse = params.spouse;
  const spouseEnabled = spouse?.enabled ?? false;

  const setProfile = (key: 'currentAge' | 'retirementAge' | 'expectancy', value: number) => {
    onChangeParams({ ...params, userProfile: { ...userProfile, [key]: value } });
  };

  const setSpouse = (patch: Partial<SpouseProfile>) => {
    const next: SimulationParams = {
      ...params,
      spouse: { ...DEFAULT_SPOUSE, ...(spouse ?? {}), ...patch },
    };
    onChangeParams(next);
  };

  // 배우자 나이가 모순이면 경고만 띄우고 값은 그대로 둔다.
  // 시뮬레이션 쪽은 spouseRules가 클램프해 처리하므로 여기서 입력을 되돌리지 않는다.
  const spouseAgeInvalid =
    spouseEnabled && spouse !== undefined && spouse.expectancy < spouse.currentAge;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {isFieldVisible(mode, 'userProfile.currentAge') && (
          <FieldRow label="현재 나이" changed={changed.has('userProfile.currentAge')}>
            <InputField
              label="" aria-label="현재 나이" type="number" suffixText="세"
              min={AGE_MIN} max={AGE_MAX}
              value={userProfile.currentAge}
              onChange={(e) => {
                const age = parseAge(e.target.value, AGE_MAX);
                if (age !== null) setProfile('currentAge', age);
              }}
            />
          </FieldRow>
        )}
        {isFieldVisible(mode, 'userProfile.retirementAge') && (
          <FieldRow
            label="목표 은퇴 나이"
            tooltipText="근로소득이 끝나고 자산 인출을 시작하는 나이입니다."
            changed={changed.has('userProfile.retirementAge')}
          >
            <InputField
              label="" aria-label="목표 은퇴 나이" type="number" suffixText="세"
              min={AGE_MIN} max={AGE_MAX}
              value={userProfile.retirementAge}
              onChange={(e) => {
                const age = parseAge(e.target.value, AGE_MAX);
                if (age !== null) setProfile('retirementAge', age);
              }}
            />
          </FieldRow>
        )}
        {isFieldVisible(mode, 'userProfile.expectancy') && (
          <FieldRow
            label="기대수명"
            tooltipText="이 나이까지 자금이 버티는지를 기준으로 계산합니다."
            changed={changed.has('userProfile.expectancy')}
          >
            <InputField
              label="" aria-label="기대수명" type="number" suffixText="세"
              min={AGE_MIN} max={EXPECTANCY_MAX}
              value={userProfile.expectancy}
              onChange={(e) => {
                const age = parseAge(e.target.value, EXPECTANCY_MAX);
                if (age !== null) setProfile('expectancy', age);
              }}
            />
          </FieldRow>
        )}
      </div>

      {isFieldVisible(mode, 'spouse.enabled') && (
        <SwitchField
          label="배우자 포함 (부부 기준 계산)"
          description="두 사람의 국민연금을 합산하고, 한 명만 남으면 생활비가 줄어드는 것까지 반영합니다."
          checked={spouseEnabled}
          onChange={(checked) => setSpouse({ enabled: checked })}
          changed={changed.has('spouse.enabled')}
        />
      )}

      {spouseEnabled && (
        <div className="grid grid-cols-2 gap-3">
          {isFieldVisible(mode, 'spouse.currentAge') && (
            <FieldRow label="배우자 나이" changed={changed.has('spouse.currentAge')}>
              <InputField
                label="" aria-label="배우자 나이" type="number" suffixText="세"
                min={AGE_MIN} max={AGE_MAX}
                value={spouse?.currentAge ?? DEFAULT_SPOUSE.currentAge}
                onChange={(e) => {
                  const age = parseAge(e.target.value, AGE_MAX);
                  if (age !== null) setSpouse({ currentAge: age });
                }}
              />
            </FieldRow>
          )}
          {isFieldVisible(mode, 'spouse.expectancy') && (
            <FieldRow label="배우자 기대수명" changed={changed.has('spouse.expectancy')}>
              <InputField
                label="" aria-label="배우자 기대수명" type="number" suffixText="세"
                min={AGE_MIN} max={EXPECTANCY_MAX}
                value={spouse?.expectancy ?? DEFAULT_SPOUSE.expectancy}
                onChange={(e) => {
                  const age = parseAge(e.target.value, EXPECTANCY_MAX);
                  if (age !== null) setSpouse({ expectancy: age });
                }}
              />
            </FieldRow>
          )}
          {isFieldVisible(mode, 'spouse.nationalPensionMonthlyAmount') && (
            <FieldRow
              label="배우자 국민연금 예상 월 수령액"
              tooltipText="65세에 받기 시작할 때의 금액입니다. 연기하면 자동으로 가산됩니다."
              changed={changed.has('spouse.nationalPensionMonthlyAmount')}
            >
              <InputField
                label="" aria-label="배우자 국민연금 예상 월 수령액" type="text" suffixText="원"
                value={(spouse?.nationalPensionMonthlyAmount ?? 0).toLocaleString()}
                onChange={(e) => {
                  const raw = e.target.value.replace(/,/g, '');
                  if (raw === '' || !isNaN(Number(raw))) {
                    setSpouse({ nationalPensionMonthlyAmount: raw === '' ? 0 : Number(raw) });
                  }
                }}
              />
            </FieldRow>
          )}
          {isFieldVisible(mode, 'spouse.nationalPensionStartAge') && (
            <FieldRow
              label="배우자 수령 개시 나이"
              changed={changed.has('spouse.nationalPensionStartAge')}
            >
              <InputField
                label="" aria-label="배우자 수령 개시 나이" type="number" suffixText="세"
                min={NATIONAL_PENSION_EARLY_MIN_AGE} max={NATIONAL_PENSION_DEFERRED_MAX_AGE}
                value={spouse?.nationalPensionStartAge ?? DEFAULT_SPOUSE.nationalPensionStartAge}
                onChange={(e) => setSpouse({ nationalPensionStartAge: Number(e.target.value) })}
              />
            </FieldRow>
          )}
        </div>
      )}

      {spouseAgeInvalid && (
        <p className="text-xs text-amber-500">
          배우자 기대수명이 현재 나이보다 작습니다. 계산에는 현재 나이를 사용합니다.
        </p>
      )}
    </>
  );
}
