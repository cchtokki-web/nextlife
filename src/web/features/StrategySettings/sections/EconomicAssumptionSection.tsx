'use client';

import { AssetCurrency } from '../../../../core/entities/types';
import { DEFAULT_RETIREMENT_STRATEGY } from '../../../../core/usecases/strategy/compileStrategy';
import { isEconomicScenarioGoverning } from '../../../../core/usecases/scenario/economicScenarios';
import InputField from '../../../components/InputField';
import SelectField from '../../../components/SelectField';
import { FieldRow, SwitchField } from '../../../components/form';
import { isFieldVisible } from '../fieldVisibility';
import { SectionProps } from '../strategyOptions';

export function EconomicAssumptionSection({ params, onChangeParams, mode, changed }: SectionProps) {
  // 경제 시나리오를 명시적으로 고르면 그 프로필이 물가·환율을 지배한다. 그 상태에서
  // 입력을 열어두면 "고쳤는데 결과가 안 바뀐다"가 되므로 비활성화하고 이유를 적는다.
  const scenario =
    params.strategy?.economicScenario ?? DEFAULT_RETIREMENT_STRATEGY.economicScenario;
  const scenarioGoverns = isEconomicScenarioGoverning(scenario);

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
    </>
  );
}
