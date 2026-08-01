'use client';

import { SimulationParams, SpouseProfile } from '../../../../core/entities/types';
import {
  NATIONAL_PENSION_DEFERRED_MAX_AGE, NATIONAL_PENSION_EARLY_MIN_AGE,
} from '../../../../core/usecases/pension/nationalPensionRules';
import InputField from '../../../components/InputField';
import { FieldRow, SwitchField } from '../../../components/form';
import { AGE_MAX, AGE_MIN, EXPECTANCY_MAX, parseAge } from '../ageInput';
import { isFieldVisible } from '../fieldVisibility';
import { createDefaultSpouse, SectionProps } from '../strategyOptions';

export function BasicInfoSection({ params, onChangeParams, mode, changed }: SectionProps) {
  const { userProfile } = params;
  const spouse = params.spouse;
  const spouseEnabled = spouse?.enabled ?? false;

  const setProfile = (key: 'currentAge' | 'retirementAge' | 'expectancy', value: number) => {
    onChangeParams({ ...params, userProfile: { ...userProfile, [key]: value } });
  };

  // 기본값은 본인 값에서 유도한다(createDefaultSpouse). 고정 나이를 쓰면 스위치 한 번으로
  // 가구 종료 나이가 엉뚱하게 늘어난다.
  const spouseDefaults = createDefaultSpouse(userProfile);

  const setSpouse = (patch: Partial<SpouseProfile>) => {
    const next: SimulationParams = {
      ...params,
      spouse: { ...spouseDefaults, ...(spouse ?? {}), ...patch },
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
                value={spouse?.currentAge ?? spouseDefaults.currentAge}
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
                value={spouse?.expectancy ?? spouseDefaults.expectancy}
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
                value={spouse?.nationalPensionStartAge ?? spouseDefaults.nationalPensionStartAge}
                // 하한을 조기수령 개시 나이(55)로 잡지 않는 이유: 타이핑 중간 상태("6")가
                // 곧바로 55로 튀어 "65"를 입력할 수 없게 된다. 여기서는 저장하면 안 되는
                // 값(빈 문자열 = 0)만 막고, 계산 시점의 범위 강제는 resolveSpouse가 한다.
                onChange={(e) => {
                  const age = parseAge(e.target.value, NATIONAL_PENSION_DEFERRED_MAX_AGE);
                  if (age !== null) setSpouse({ nationalPensionStartAge: age });
                }}
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
