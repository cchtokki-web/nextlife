import React, { useState } from 'react';
import { SimulationParams, TaxSettings } from '../../../core/entities/types';
import { InputField } from '../../components/InputField';
import { SelectField } from '../../components/SelectField';
import styles from './AssetForm.module.css';
import compStyles from '../../styles/components.module.css';
import { Calculator, ChevronDown, ChevronUp } from 'lucide-react';

interface TaxSettingsSectionProps {
  params: SimulationParams;
  onChangeParams: (newParams: SimulationParams) => void;
}

export const TaxSettingsSection: React.FC<TaxSettingsSectionProps> = ({ params, onChangeParams }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const currentTaxSettings: TaxSettings = params.taxSettings || {
    enableComprehensiveTax: true,
    enableHealthInsurance: true,
    usDividendTaxRate: 15,
    domesticDividendTaxRate: 15.4,
    comprehensiveTaxRate: 15,
    healthInsuranceRate: 5,
  };

  const handleUpdate = (updates: Partial<TaxSettings>) => {
    onChangeParams({
      ...params,
      taxSettings: { ...currentTaxSettings, ...updates },
    });
  };

  return (
    <div className={styles.formContainer}>
      <div 
        className={styles.header}
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isExpanded ? '1rem' : '0' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Calculator size={18} className={styles.icon} />
          <span className={styles.title}>고급 세금 설정</span>
        </div>
        {isExpanded ? <ChevronUp size={18} className={styles.icon} /> : <ChevronDown size={18} className={styles.icon} />}
      </div>

      {isExpanded && (
        <div className={compStyles.grid}>
        <SelectField
          label="금융소득종합과세 반영"
          value={currentTaxSettings.enableComprehensiveTax ? 'true' : 'false'}
          onChange={(e) => handleUpdate({ enableComprehensiveTax: e.target.value === 'true' })}
          options={[
            { value: 'true', label: '반영 - 2천만원 초과 시 부과' },
            { value: 'false', label: '미반영' },
          ]}
        />

        <SelectField
          label="추가 건강보험료 반영"
          value={currentTaxSettings.enableHealthInsurance ? 'true' : 'false'}
          onChange={(e) => handleUpdate({ enableHealthInsurance: e.target.value === 'true' })}
          options={[
            { value: 'true', label: '반영' },
            { value: 'false', label: '미반영' },
          ]}
        />

        <InputField
          label="해외 주식/ETF 배당소득세율"
          type="number"
          step="0.1"
          value={currentTaxSettings.usDividendTaxRate}
          onChange={(e) => handleUpdate({ usDividendTaxRate: Number(e.target.value) })}
          suffixText="%"
        />

        <InputField
          label="국내 주식/ETF 배당소득세율"
          type="number"
          step="0.1"
          value={currentTaxSettings.domesticDividendTaxRate}
          onChange={(e) => handleUpdate({ domesticDividendTaxRate: Number(e.target.value) })}
          suffixText="%"
        />

        <InputField
          label="금융소득종합과세 단순화 추가 세율"
          labelSecondary="(초과분에 대해 적용)"
          type="number"
          step="0.1"
          value={currentTaxSettings.comprehensiveTaxRate}
          onChange={(e) => handleUpdate({ comprehensiveTaxRate: Number(e.target.value) })}
          suffixText="%"
        />

        <InputField
          label="건강보험료 단순화 추가 비율"
          labelSecondary="(초과분에 대해 적용)"
          type="number"
          step="0.1"
          value={currentTaxSettings.healthInsuranceRate}
          onChange={(e) => handleUpdate({ healthInsuranceRate: Number(e.target.value) })}
          suffixText="%"
        />
      </div>
      )}
    </div>
  );
};
