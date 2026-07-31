'use client';

import { AssetCurrency, HealthcareAssumptions } from '../../../../core/entities/types';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../../core/usecases/strategy/compileStrategy';
import { isEconomicScenarioGoverning } from '../../../../core/usecases/scenario/economicScenarios';
import InputField from '../../../components/InputField';
import SelectField from '../../../components/SelectField';
import { FieldRow, SwitchField } from '../../../components/form';
import { isFieldVisible } from '../fieldVisibility';
import { DEFAULT_HEALTHCARE, SectionProps } from '../strategyOptions';

export function EconomicAssumptionSection({ params, onChangeParams, mode, changed }: SectionProps) {
  // 경제 시나리오를 명시적으로 고르면 그 프로필이 물가·환율을 지배한다. 그 상태에서
  // 입력을 열어두면 "고쳤는데 결과가 안 바뀐다"가 되므로 비활성화하고 이유를 적는다.
  const scenario =
    params.strategy?.economicScenario ?? DEFAULT_RETIREMENT_STRATEGY.economicScenario;
  const scenarioGoverns = isEconomicScenarioGoverning(scenario);

  const healthcare = params.healthcare;
  const healthcareEnabled = healthcare?.enabled ?? false;

  // healthcare는 optional이라 아직 없을 수 있다. 기본값 → 기존 값 → 이번 변경 순으로
  // 병합해 항상 완전한 객체를 넘긴다(부분 객체를 넣으면 타입이 깨진다).
  const setHealthcare = (patch: Partial<HealthcareAssumptions>) => {
    onChangeParams({
      ...params,
      healthcare: { ...DEFAULT_HEALTHCARE, ...(healthcare ?? {}), ...patch },
    });
  };

  return (
    <>
      {scenarioGoverns && (
        <p className="text-xs text-amber-500">
          ④투자 전략에서 고른 경제 시나리오가 아래 물가상승률과 환율을 결정합니다.
          직접 정하려면 시나리오를 &ldquo;AI 추천&rdquo;으로 두세요.
        </p>
      )}
      {isFieldVisible(mode, 'inflationMode') && (
        <SwitchField
          label="실질 수익률로 계산"
          description="물가상승분을 뺀 오늘 화폐가치로 표시합니다. 표의 생활비가 매년 같은 것은 이 설정 때문입니다."
          checked={params.inflationMode === 'real'}
          onChange={(checked) =>
            onChangeParams({ ...params, inflationMode: checked ? 'real' : 'nominal' })
          }
          changed={changed.has('inflationMode')}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        {isFieldVisible(mode, 'inflationRate') && (
          <FieldRow label="물가상승률" changed={changed.has('inflationRate')}>
            <InputField
              label="" aria-label="물가상승률" type="number" step="0.1" suffixText="%"
              value={params.inflationRate}
              disabled={scenarioGoverns}
              onChange={(e) => onChangeParams({ ...params, inflationRate: Number(e.target.value) })}
            />
          </FieldRow>
        )}

        {isFieldVisible(mode, 'baseExchangeRate') && (
          <FieldRow
            label="적용 환율"
            tooltipText="1달러를 원화로 환산할 때 쓰는 값입니다."
            changed={changed.has('baseExchangeRate')}
          >
            <InputField
              label="" aria-label="적용 환율" type="text" suffixText="원"
              value={params.baseExchangeRate.toLocaleString()}
              onChange={(e) => {
                const raw = e.target.value.replace(/,/g, '');
                if (raw === '' || !isNaN(Number(raw))) {
                  onChangeParams({
                    ...params,
                    baseExchangeRate: raw === '' ? 0 : Number(raw),
                  });
                }
              }}
            />
          </FieldRow>
        )}

        {isFieldVisible(mode, 'displayCurrency') && (
          <FieldRow label="대시보드 기준 통화" changed={changed.has('displayCurrency')}>
            <SelectField
              label="" aria-label="대시보드 기준 통화"
              value={params.displayCurrency}
              onChange={(e) =>
                onChangeParams({ ...params, displayCurrency: e.target.value as AssetCurrency })
              }
              options={[
                { value: 'KRW', label: 'KRW (대한민국 원)' },
                { value: 'USD', label: 'USD (미국 달러)' },
              ]}
            />
          </FieldRow>
        )}
      </div>

      {isFieldVisible(mode, 'healthcare.enabled') && (
        <SwitchField
          label="의료비를 따로 계산"
          description="나이가 들수록 늘어나는 의료비를 생활비와 별도로 반영합니다."
          checked={healthcareEnabled}
          onChange={(checked) => setHealthcare({ enabled: checked })}
          changed={changed.has('healthcare.enabled')}
        />
      )}

      {healthcareEnabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {isFieldVisible(mode, 'healthcare.baseMonthlyCost') && (
              <FieldRow label="은퇴 시점 월 의료비" changed={changed.has('healthcare.baseMonthlyCost')}>
                <InputField
                  label="" aria-label="은퇴 시점 월 의료비" type="text" suffixText="원"
                  value={(healthcare?.baseMonthlyCost ?? 0).toLocaleString()}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, '');
                    if (raw === '' || !isNaN(Number(raw))) {
                      setHealthcare({ baseMonthlyCost: raw === '' ? 0 : Number(raw) });
                    }
                  }}
                />
              </FieldRow>
            )}
            {isFieldVisible(mode, 'healthcare.costGrowthRate') && (
              <FieldRow
                label="의료비 증가율"
                tooltipText="의료비는 보통 일반 물가보다 빠르게 오릅니다. 실질 기준으로 볼 때는 물가상승률을 넘는 부분만 반영됩니다."
                changed={changed.has('healthcare.costGrowthRate')}
              >
                <InputField
                  label="" aria-label="의료비 증가율" type="number" step="0.1" suffixText="%"
                  value={healthcare?.costGrowthRate ?? DEFAULT_HEALTHCARE.costGrowthRate}
                  onChange={(e) => setHealthcare({ costGrowthRate: Number(e.target.value) })}
                />
              </FieldRow>
            )}
          </div>

          {isFieldVisible(mode, 'healthcare.longTermCareEnabled') && (
            <SwitchField
              label="장기요양 발생 가정"
              description="특정 나이부터 요양 비용이 매달 추가로 나간다고 봅니다."
              checked={healthcare?.longTermCareEnabled ?? false}
              onChange={(v) => setHealthcare({ longTermCareEnabled: v })}
              changed={changed.has('healthcare.longTermCareEnabled')}
            />
          )}

          {healthcare?.longTermCareEnabled && (
            <div className="grid grid-cols-2 gap-3">
              {isFieldVisible(mode, 'healthcare.longTermCareStartAge') && (
                <FieldRow label="장기요양 시작 나이" changed={changed.has('healthcare.longTermCareStartAge')}>
                  <InputField
                    label="" aria-label="장기요양 시작 나이" type="number" suffixText="세"
                    value={healthcare.longTermCareStartAge}
                    onChange={(e) => setHealthcare({ longTermCareStartAge: Number(e.target.value) })}
                  />
                </FieldRow>
              )}
              {isFieldVisible(mode, 'healthcare.longTermCareMonthlyCost') && (
                <FieldRow label="월 장기요양비" changed={changed.has('healthcare.longTermCareMonthlyCost')}>
                  <InputField
                    label="" aria-label="월 장기요양비" type="text" suffixText="원"
                    value={healthcare.longTermCareMonthlyCost.toLocaleString()}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/,/g, '');
                      if (raw === '' || !isNaN(Number(raw))) {
                        setHealthcare({ longTermCareMonthlyCost: raw === '' ? 0 : Number(raw) });
                      }
                    }}
                  />
                </FieldRow>
              )}
            </div>
          )}

          {isFieldVisible(mode, 'healthcare.shockEnabled') && (
            <SwitchField
              label="의료비 급증 시나리오"
              description="특정 나이에 큰 목돈이 한 번 나가는 상황을 가정합니다."
              checked={healthcare?.shockEnabled ?? false}
              onChange={(v) => setHealthcare({ shockEnabled: v })}
              changed={changed.has('healthcare.shockEnabled')}
            />
          )}

          {healthcare?.shockEnabled && (
            <div className="grid grid-cols-2 gap-3">
              {isFieldVisible(mode, 'healthcare.shockAge') && (
                <FieldRow label="급증 발생 나이" changed={changed.has('healthcare.shockAge')}>
                  <InputField
                    label="" aria-label="급증 발생 나이" type="number" suffixText="세"
                    value={healthcare.shockAge}
                    onChange={(e) => setHealthcare({ shockAge: Number(e.target.value) })}
                  />
                </FieldRow>
              )}
              {isFieldVisible(mode, 'healthcare.shockAmount') && (
                <FieldRow
                  label="급증 금액"
                  tooltipText="증가율을 곱하지 않고 입력한 금액 그대로 그 해에 한 번 나갑니다."
                  changed={changed.has('healthcare.shockAmount')}
                >
                  <InputField
                    label="" aria-label="급증 금액" type="text" suffixText="원"
                    value={healthcare.shockAmount.toLocaleString()}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/,/g, '');
                      if (raw === '' || !isNaN(Number(raw))) {
                        setHealthcare({ shockAmount: raw === '' ? 0 : Number(raw) });
                      }
                    }}
                  />
                </FieldRow>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
