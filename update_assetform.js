/* eslint-disable @typescript-eslint/no-require-imports -- Legacy CommonJS migration helper. */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/web/features/AssetForm/AssetFormSection.tsx');
let code = fs.readFileSync(filePath, 'utf-8');

const oldProfileBlock = `<InputField
              label="은퇴 후 목표 월 생활비"
              labelSecondary="(선택 통화 기준)"
              type="text"
              value={params.userProfile.targetMonthlySpending === 0 ? '0' : params.userProfile.targetMonthlySpending.toLocaleString()}
              onChange={(e) => {
                const rawValue = e.target.value.replace(/,/g, '');
                const numValue = rawValue === '' ? 0 : Number(rawValue);
                if (!isNaN(numValue)) {
                  handleProfileChange('targetMonthlySpending', numValue);
                }
              }}
              suffixText={params.displayCurrency === 'KRW' ? '원' : params.displayCurrency}
            />`;

const newProfileBlock = `<SelectField
              label="은퇴 생활비 전략"
              value={params.spendingStrategy || 'target'}
              onChange={(e) => onChangeParams({ ...params, spendingStrategy: e.target.value as any })}
              options={[
                { value: 'target', label: '고정 목표 생활비 직접 입력' },
                { value: 'dividend_only', label: '배당금 100% 소비 모드 (원금 보존)' },
                { value: 'max_sustainable', label: '최대 고정 생활비 자동 역산 (자산 전액 사용)' },
              ]}
            />
            {(!params.spendingStrategy || params.spendingStrategy === 'target') && (
              <InputField
                label="은퇴 후 목표 월 생활비"
                labelSecondary="(선택 통화 기준)"
                type="text"
                value={params.userProfile.targetMonthlySpending === 0 ? '0' : params.userProfile.targetMonthlySpending.toLocaleString()}
                onChange={(e) => {
                  const rawValue = e.target.value.replace(/,/g, '');
                  const numValue = rawValue === '' ? 0 : Number(rawValue);
                  if (!isNaN(numValue)) {
                    handleProfileChange('targetMonthlySpending', numValue);
                  }
                }}
                suffixText={params.displayCurrency === 'KRW' ? '원' : params.displayCurrency}
              />
            )}`;

code = code.replace(oldProfileBlock, newProfileBlock);

fs.writeFileSync(filePath, code);
console.log('Successfully updated AssetFormSection.tsx');
