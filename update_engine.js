const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/core/usecases/SimulationEngine.ts');
let code = fs.readFileSync(filePath, 'utf-8');

// 1. Rename run to runSingle
code = code.replace(/run\(params: SimulationParams\): SimulationResult \{/, 'runSingle(params: SimulationParams): SimulationResult {');

// 2. Insert run method at the top of the class
const runMethod = `
  run(params: SimulationParams): SimulationResult {
    const strategy = params.spendingStrategy || 'target';

    if (strategy === 'max_sustainable') {
      return this.findMaxSustainable(params);
    }

    return this.runSingle(params);
  }

  private findMaxSustainable(params: SimulationParams): SimulationResult {
    let low = 0;
    let high = 50000000; // 5천만원/월
    let bestResult: SimulationResult | null = null;
    let bestTarget = 0;

    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      const trialParams = {
        ...params,
        userProfile: {
          ...params.userProfile,
          targetMonthlySpending: mid,
        },
      };
      
      const result = this.runSingle(trialParams);
      
      // 고갈되지 않으면 (혹은 매우 미미하게 고갈되면)
      if (result.depletionAge === null || result.endingAssets > 0) {
        bestResult = result;
        bestTarget = mid;
        low = mid;
      } else {
        high = mid;
      }
    }

    // 만약 한 번도 성공하지 못했다면 (모든 범위에서 고갈) 가장 작은 값으로
    if (!bestResult) {
      const trialParams = {
        ...params,
        userProfile: {
          ...params.userProfile,
          targetMonthlySpending: 0,
        },
      };
      bestResult = this.runSingle(trialParams);
    }
    
    // bestResult 객체에 최대 가능 생활비 정보가 들어있음을 UI에 전달하기 위해 
    // targetMonthlySpending 값을 업데이트해서 넘길 필요는 없지만, UI에서 알 수 있어야 함.
    // 임시로 userProfile을 변경하진 않으므로 결과는 bestResult를 그대로 반환.
    // 단, SimulationResult에 maxSustainableSpending 필드를 추가하거나 Dashboard에서 spending을 보면 됨.
    return bestResult;
  }
`;

code = code.replace(/export class SimulationEngine \{/, `export class SimulationEngine {${runMethod}`);

// 3. Update monthlyTargetSpending in runSingle for dividend_only
code = code.replace(/let monthlyTargetSpending = 0;\s+if \(isRetired\) \{\s+monthlyTargetSpending = userProfile\.targetMonthlySpending;/, 
`let monthlyTargetSpending = 0;
        if (isRetired) {
          if (params.spendingStrategy === 'dividend_only') {
             // Will be updated later in the month loop to equal total income
             monthlyTargetSpending = 0; 
          } else {
             monthlyTargetSpending = userProfile.targetMonthlySpending;
          }
`);

// 4. Update Pension draw logic to only draw yield if asked
const oldPensionDraw = `          // 은퇴 후 연금 수령
          if (isRetired && pension.currentBalance > 0) {
            // 기대수명까지 남은 개월 수 계산
            const remainingMonths = Math.max(1, (endAge - currentAge) * 12 + (12 - m));
            const drawAmountRaw = pension.currentBalance / remainingMonths;`;

const newPensionDraw = `          // 은퇴 후 연금 수령
          if (isRetired && pension.currentBalance > 0) {
            let drawAmountRaw = 0;
            const isYieldOnly = params.spendingStrategy === 'dividend_only' || params.spendingStrategy === 'max_sustainable';
            if (isYieldOnly) {
              // 배당금(이자)만 꺼내 쓰기
              // 이 달에 발생한 수익(growth)만큼만 인출 (원금 보존)
              // growth는 inflationMode에 따라 실질수익률로 계산된 값이므로,
              // 실제 명목 이자를 모두 쓰고 싶다면 명목 이자율을 적용할 수도 있음.
              // 여기서는 앞서 계산된 'growth'를 그대로 인출액으로 사용
              drawAmountRaw = growth > 0 ? growth : 0;
              // 자산 가치 상승을 상쇄시킴 (성장한 만큼 빼므로 잔액은 원래대로)
              pension.currentBalance -= drawAmountRaw; 
            } else {
              // 기대수명까지 남은 개월 수 계산
              const remainingMonths = Math.max(1, (endAge - currentAge) * 12 + (12 - m));
              drawAmountRaw = pension.currentBalance / remainingMonths;
              pension.currentBalance -= drawAmountRaw;
            }`;

code = code.replace(oldPensionDraw, newPensionDraw);
code = code.replace(/            const drawAmountNet = drawAmountRaw \* \(1 - taxRate\);\s+pension\.currentBalance \-= drawAmountRaw;/, 
`            const drawAmountNet = drawAmountRaw * (1 - taxRate);
            // pension.currentBalance -= drawAmountRaw; is handled above`);

// 5. Update shortfall calculation to handle dividend_only
const oldShortfall = `        // 5) 가처분 소득으로 생활비 충당
        const monthlyTotalIncome = monthlyDividendIncomeNetDisplay + monthlyPensionTotalNetDisplay + monthlyOtherIncomeTotalDisplay;
        const shortfall = monthlyTargetSpending - monthlyTotalIncome;`;

const newShortfall = `        // 5) 가처분 소득으로 생활비 충당
        const monthlyTotalIncome = monthlyDividendIncomeNetDisplay + monthlyPensionTotalNetDisplay + monthlyOtherIncomeTotalDisplay;
        
        if (isRetired && params.spendingStrategy === 'dividend_only') {
          // 배당금 100% 소비 모드: 발생한 모든 소득을 그 달의 생활비로 씀
          monthlyTargetSpending = monthlyTotalIncome;
          annualSpending += monthlyTargetSpending;
        }

        const shortfall = monthlyTargetSpending - monthlyTotalIncome;`;

code = code.replace(oldShortfall, newShortfall);


fs.writeFileSync(filePath, code);
console.log('Successfully updated SimulationEngine.ts');
