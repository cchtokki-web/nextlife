'use client';

import InputField from '../../../components/InputField';
import { FieldRow } from '../../../components/form';
import { AGE_MAX, AGE_MIN, EXPECTANCY_MAX, parseAge } from '../ageInput';
import { isFieldVisible } from '../fieldVisibility';
import { SectionProps } from '../strategyOptions';

export function BasicInfoSection({ params, onChangeParams, mode, changed }: SectionProps) {
  const { userProfile } = params;

  const setProfile = (key: 'currentAge' | 'retirementAge' | 'expectancy', value: number) => {
    onChangeParams({ ...params, userProfile: { ...userProfile, [key]: value } });
  };

  return (
    <div className="grid grid-cols-2 items-end gap-3.5 sm:gap-4">
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
  );
}
