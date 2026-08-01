'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AssetCurrency, HealthcareAssumptions, SimulationParams,
} from '../../../../core/entities/types';
import { resolveStrategy } from '../../../../core/usecases/strategy/compileStrategy';
import { isEconomicScenarioGoverning } from '../../../../core/usecases/scenario/economicScenarios';
import InputField from '../../../components/InputField';
import SelectField from '../../../components/SelectField';
import { FieldRow, SwitchField } from '../../../components/form';
import { AGE_MAX, AGE_MIN, parseAge } from '../ageInput';
import { currencySuffix } from '../currencySuffix';
import { isFieldVisible } from '../fieldVisibility';
import { DEFAULT_HEALTHCARE, SectionProps } from '../strategyOptions';

// 무료·무인증 환율 API. 실패해도 시뮬레이션은 기존 환율로 계속 돌아간다.
const EXCHANGE_RATE_API_URL = 'https://open.er-api.com/v6/latest/USD';

export function EconomicAssumptionSection({ params, onChangeParams, mode, changed }: SectionProps) {
  // 경제 시나리오를 명시적으로 고르면 그 프로필이 물가·환율을 지배한다. 그 상태에서
  // 입력을 열어두면 "고쳤는데 결과가 안 바뀐다"가 되므로 비활성화하고 이유를 적는다.
  const scenario = resolveStrategy(params).economicScenario;
  const scenarioGoverns = isEconomicScenarioGoverning(scenario);

  // 미지정은 "켜짐"이다 — 구 시뮬레이션 설정 UI의 동작을 그대로 유지한다.
  const autoExchangeRate = params.useLatestExchangeRate !== false;
  const [rateError, setRateError] = useState<string | null>(null);
  const [isFetchingRate, setIsFetchingRate] = useState(false);

  // 응답이 도착하는 시점의 최신 params/콜백에 얹는다. 이펙트가 캡처한 params를 그대로
  // 되쓰면 조회가 끝나기 전에 사용자가 바꾼 다른 값이 조용히 되돌아간다.
  const latest = useRef<{
    params: SimulationParams;
    onChangeParams: (p: SimulationParams) => void;
  }>({ params, onChangeParams });
  useEffect(() => {
    latest.current = { params, onChangeParams };
  }, [params, onChangeParams]);

  // 자동 조회 스위치가 켜져 있을 때 한 번만 조회한다. params/onChangeParams는 매 렌더
  // 새로 만들어지므로 의존성에 넣으면 조회가 무한히 반복된다 — 그래서 ref로 우회한다.
  useEffect(() => {
    if (!autoExchangeRate) return;

    let cancelled = false;

    (async () => {
      // setState는 이펙트 본문이 아니라 비동기 작업 안에서만 호출한다
      // (이펙트 본문의 동기 setState는 렌더를 한 번 더 연쇄시킨다).
      setIsFetchingRate(true);
      setRateError(null);
      try {
        const res = await fetch(EXCHANGE_RATE_API_URL);
        if (!res.ok) throw new Error('실시간 환율 데이터를 가져오지 못했습니다.');
        const data: unknown = await res.json();
        const krw = (data as { rates?: { KRW?: unknown } } | null)?.rates?.KRW;
        if (typeof krw !== 'number') throw new Error('환율 데이터 형식이 유효하지 않습니다.');
        if (cancelled) return;

        const rate = Math.round(krw * 10) / 10;
        latest.current.onChangeParams({
          ...latest.current.params,
          baseExchangeRate: rate,
          exchangeScenario: 'base',
        });
      } catch (err: unknown) {
        if (cancelled) return;
        setRateError(err instanceof Error ? err.message : '환율 정보를 가져오지 못했습니다.');
      } finally {
        if (!cancelled) setIsFetchingRate(false);
      }
    })();

    return () => { cancelled = true; };
  }, [autoExchangeRate]);

  // 스위치와 조회 상태 문구는 함께 보이거나 함께 숨는다.
  const showExchangeRateAuto = isFieldVisible(mode, 'useLatestExchangeRate');

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
      {/* 배너가 가리키는 필드가 하나도 안 보이는 모드(간편)에서는 배너만 홀로 남으므로
          렌더하지 않는다. 모드를 낮춰도 값은 보존되어 scenarioGoverns는 참으로 남는다. */}
      {scenarioGoverns
        && (isFieldVisible(mode, 'inflationRate') || isFieldVisible(mode, 'baseExchangeRate')) && (
        <p className="text-xs leading-relaxed text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 my-1">
          「투자 전략」에서 고른 경제 시나리오가 아래 물가상승률과 환율은 물론,
          보유 자산과 사적연금의 수익률까지 일괄 대체합니다.
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

      <div className="grid grid-cols-2 items-end gap-3.5 sm:gap-4">
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
              disabled={autoExchangeRate}
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

      {showExchangeRateAuto && (
        <>
          <SwitchField
            label="최신 환율 자동 적용"
            description="화면을 열 때마다 실시간 환율을 받아 적용합니다. 끄면 위 값을 직접 정할 수 있습니다."
            checked={autoExchangeRate}
            onChange={(checked) => onChangeParams({ ...params, useLatestExchangeRate: checked })}
            changed={changed.has('useLatestExchangeRate')}
          />
          {isFetchingRate && (
            <p className="text-xs text-foreground-muted">최신 환율을 불러오는 중입니다…</p>
          )}
          {rateError && (
            <p className="text-xs text-amber-500">{rateError} 기존 환율을 그대로 사용합니다.</p>
          )}
        </>
      )}

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
          <div className="grid grid-cols-2 items-end gap-3.5 sm:gap-4">
            {isFieldVisible(mode, 'healthcare.baseMonthlyCost') && (
              // 금액 입력은 한 줄을 다 쓴다 — 격자 반 칸(126px)에서는 백만 단위가 잘린다.
              <FieldRow
                className="col-span-2"
                label="은퇴 시점 월 의료비"
                changed={changed.has('healthcare.baseMonthlyCost')}
              >
                <InputField
                  label="" aria-label="은퇴 시점 월 의료비" type="text"
                  suffixText={currencySuffix(params.displayCurrency)}
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
            <div className="grid grid-cols-2 items-end gap-3.5 sm:gap-4">
              {isFieldVisible(mode, 'healthcare.longTermCareStartAge') && (
                <FieldRow label="장기요양 시작 나이" changed={changed.has('healthcare.longTermCareStartAge')}>
                  <InputField
                    label="" aria-label="장기요양 시작 나이" type="number" suffixText="세"
                    min={AGE_MIN} max={AGE_MAX}
                    value={healthcare.longTermCareStartAge}
                    // BasicInfoSection과 같은 규약(ageInput.parseAge)을 쓴다. 맨 Number()는
                    // 빈 입력을 0으로 저장해 "0세부터 장기요양"이 되고, 디바운스 자동저장이
                    // 그 값을 암호화 저장소에 영구화한다.
                    onChange={(e) => {
                      const age = parseAge(e.target.value, AGE_MAX);
                      if (age !== null) setHealthcare({ longTermCareStartAge: age });
                    }}
                  />
                </FieldRow>
              )}
              {isFieldVisible(mode, 'healthcare.longTermCareMonthlyCost') && (
                // 기준 시점을 라벨에 적는다. 옆의 "은퇴 시점 월 의료비"와 시점이 다르므로
                // 시점 표기가 없으면 두 값이 같은 기준인 줄 오해한다(healthcareCosts.ts 참조).
                <FieldRow
                  className="col-span-2"
                  label="장기요양 시작 시점 월 비용"
                  tooltipText="요양이 시작되는 나이 기준 금액입니다. 그 이후에는 의료비 증가율만큼 오릅니다."
                  changed={changed.has('healthcare.longTermCareMonthlyCost')}
                >
                  <InputField
                    label="" aria-label="장기요양 시작 시점 월 비용" type="text"
                    suffixText={currencySuffix(params.displayCurrency)}
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
            <div className="grid grid-cols-2 items-end gap-3.5 sm:gap-4">
              {isFieldVisible(mode, 'healthcare.shockAge') && (
                <FieldRow label="급증 발생 나이" changed={changed.has('healthcare.shockAge')}>
                  <InputField
                    label="" aria-label="급증 발생 나이" type="number" suffixText="세"
                    min={AGE_MIN} max={AGE_MAX}
                    value={healthcare.shockAge}
                    onChange={(e) => {
                      const age = parseAge(e.target.value, AGE_MAX);
                      if (age !== null) setHealthcare({ shockAge: age });
                    }}
                  />
                </FieldRow>
              )}
              {isFieldVisible(mode, 'healthcare.shockAmount') && (
                // 옆의 두 금액 필드가 "월" 기준임을 라벨에 밝히고 있다. 이 값만 1회성인데
                // 라벨에 시점 표기가 없으면 같은 격자 안에서 월 금액으로 오해된다.
                <FieldRow
                  className="col-span-2"
                  label="급증 시 1회 금액"
                  tooltipText="증가율을 곱하지 않고 입력한 금액 그대로 그 해에 한 번 나갑니다."
                  changed={changed.has('healthcare.shockAmount')}
                >
                  <InputField
                    label="" aria-label="급증 시 1회 금액" type="text"
                    suffixText={currencySuffix(params.displayCurrency)}
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
