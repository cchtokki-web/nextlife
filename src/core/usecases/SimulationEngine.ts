import {
  SimulationParams,
  SimulationResult,
  SimulationYearlyResult,
  InvestmentAsset,
  PrivatePension,
  AssetCurrency,
} from '../entities/types';

export class SimulationEngine {
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
    return { ...bestResult, calculatedTargetSpending: bestTarget };
  }

  runSingle(params: SimulationParams): SimulationResult {
    if (!params || !params.userProfile) {
      return {
        yearlyResults: [],
        fireAge: null,
        depletionAge: null,
        endingAssets: 0,
        retirementScore: 0,
        retirementGrade: '위험',
        goalAchievementRate: 0,
      };
    }

    const {
      userProfile,
      assets = [],
      nationalPension = { expectedMonthlyAmount: 0 },
      privatePensions = [],
      otherIncomes = [],
      inflationRate = 2,
      inflationMode = 'real',
      baseExchangeRate = 1350,
      exchangeScenario = 'base',
      displayCurrency = 'KRW',
    } = params;

    // 1. 환율 설정
    let exchangeRate = baseExchangeRate;
    if (exchangeScenario === 'usd_up') {
      exchangeRate = baseExchangeRate * 1.1;
    } else if (exchangeScenario === 'usd_down') {
      exchangeRate = baseExchangeRate * 0.9;
    }

    const convertValue = (amount: number, from: AssetCurrency, to: AssetCurrency): number => {
      if (from === to) return amount;
      if (from === 'USD' && to === 'KRW') return amount * exchangeRate;
      if (from === 'KRW' && to === 'USD') return amount / exchangeRate;
      return amount;
    };

    // 2. 자산 상태 복제 및 초기 가치(자체 통화 기준) 설정
    // 투자 자산: quantity * averagePrice로 초기 가치 구성
    interface ActiveAsset extends InvestmentAsset {
      currentValue: number; // 자체 통화 기준 자산 가치
    }
    const activeAssets: ActiveAsset[] = (assets || []).map((asset) => ({
      ...asset,
      currentValue: asset.quantity * asset.averagePrice,
    }));

    // 사적 연금
    interface ActivePension extends PrivatePension {
      currentBalance: number; // 자체 통화 기준 연금 잔액
    }
    const activePensions: ActivePension[] = (privatePensions || []).map((p) => ({
      ...p,
      currentBalance: p.balance,
    }));

    const startAge = userProfile.currentAge;
    const endAge = userProfile.expectancy;
    const totalYears = endAge - startAge + 1;

    if (isNaN(totalYears) || totalYears <= 0) {
      return {
        yearlyResults: [],
        fireAge: null,
        depletionAge: null,
        endingAssets: 0,
        retirementScore: 0,
        retirementGrade: '위험',
        goalAchievementRate: 0,
      };
    }

    const yearlyResults: SimulationYearlyResult[] = [];
    let fireAge: number | null = null;
    let depletionAge: number | null = null;

    // 연도별 루프
    for (let y = 0; y < totalYears; y++) {
      const currentAge = startAge + y;
      const currentYear = new Date().getFullYear() + y;
      const isRetired = currentAge >= userProfile.retirementAge;

      // 연간 누적 변수 (표기 통화 기준)
      let annualDividendIncome = 0;
      let annualNationalPensionIncome = 0;
      let annualPrivatePensionIncome = 0;
      let annualOtherIncome = 0;
      let annualSpending = 0;

      // 금융소득종합과세 판정용 세전 금융소득 (KRW 기준)
      let annualRawFinancialIncomeKRW = 0;

      // 월 단위 시뮬레이션 (12개월)
      for (let m = 0; m < 12; m++) {
        // 인플레이션 월 복리 및 연도별 인플레이션 배율
        const infRateAnnual = inflationRate / 100;
        const infRateMonthly = Math.pow(1 + infRateAnnual, 1 / 12) - 1;

        // 월 목표 생활비 (표기 통화 기준) - 은퇴 후에만 발생
        let monthlyTargetSpending = 0;
        if (isRetired) {
          if (params.spendingStrategy === 'dividend_only') {
             // Will be updated later in the month loop to equal total income
             monthlyTargetSpending = 0; 
          } else {
             monthlyTargetSpending = userProfile.targetMonthlySpending;
             if (inflationMode === 'nominal') {
               monthlyTargetSpending = userProfile.targetMonthlySpending * Math.pow(1 + infRateAnnual, y);
             }
          }
        }

        // 1) 투자자산 월 복리 성장 및 배당금 계산
        let monthlyDividendIncomeNetDisplay = 0;

        activeAssets.forEach((asset) => {
          if (asset.currentValue < 0) asset.currentValue = 0;

          // 연간 성장률 설정 (실질 모드일 경우 인플레이션 차감)
          const growthRateAnnual = inflationMode === 'real'
            ? (asset.annualGrowthRate - inflationRate) / 100
            : asset.annualGrowthRate / 100;
          const growthRateMonthly = Math.pow(Math.max(0, 1 + growthRateAnnual), 1 / 12) - 1;

          // 자산 가치 상승
          const growth = asset.currentValue * growthRateMonthly;
          
          // 월간 배당 계산
          const divRateMonthly = (asset.dividendYield / 100) / 12;
          const dividendRaw = asset.currentValue * divRateMonthly;
          const dividendNet = dividendRaw * (1 - 0.154); // 배당세 15.4% 차감

          // 종합과세용 세전 배당 누적 (KRW 환산)
          const divRawKRW = convertValue(dividendRaw, asset.currency, 'KRW');
          annualRawFinancialIncomeKRW += divRawKRW;

          // 월 적립금 적용 (은퇴 전일 때만)
          const contribution = isRetired ? 0 : asset.monthlyContribution;

          // 신규 가치 업데이트
          asset.currentValue = asset.currentValue + growth + contribution;

          // 배당금 처리
          if (!isRetired && asset.reinvestDividend) {
            // 은퇴 전이고 배당 재투자 켜진 경우 자산 가치에 추가
            asset.currentValue += dividendNet;
          } else {
            // 은퇴 후이거나 배당 재투자 꺼진 경우 현금 소득으로 수령
            const divNetDisplay = convertValue(dividendNet, asset.currency, displayCurrency);
            monthlyDividendIncomeNetDisplay += divNetDisplay;
          }
        });

        annualDividendIncome += monthlyDividendIncomeNetDisplay;

        // 2) 사적연금 월 복리 성장 및 월 인출 계산
        let monthlyPensionIncomeNetDisplay = 0;

        activePensions.forEach((pension) => {
          if (pension.currentBalance < 0) pension.currentBalance = 0;

          let totalReturnAnnual = pension.annualReturn;
          if (pension.investmentType === 'etf' && pension.dividendYield) {
            totalReturnAnnual += pension.dividendYield;
          }

          // 연간 수익률 설정 (실질 모드일 경우 인플레이션 차감)
          const returnRateAnnual = inflationMode === 'real'
            ? (totalReturnAnnual - inflationRate) / 100
            : totalReturnAnnual / 100;
          const returnRateMonthly = Math.pow(Math.max(0, 1 + returnRateAnnual), 1 / 12) - 1;

          // 연금 잔액 성장
          const growth = pension.currentBalance * returnRateMonthly;
          // 월 적립금 적용 (은퇴 전일 때만)
          const contribution = isRetired ? 0 : pension.monthlyContribution;

          pension.currentBalance = pension.currentBalance + growth + contribution;

          // 은퇴 후 연금 수령
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
            }

            // 연령대별 슬라이딩 연금소득세율 적용
            let taxRate = 0.055; // 55~69세: 5.5%
            if (currentAge >= 70 && currentAge < 80) {
              taxRate = 0.044; // 70~79세: 4.4%
            } else if (currentAge >= 80) {
              taxRate = 0.033; // 80세 이상: 3.3%
            }

            const drawAmountNet = drawAmountRaw * (1 - taxRate);
            // pension.currentBalance -= drawAmountRaw; is handled above

            // 종합과세용 세전 사적연금 인출액 누적 (KRW 환산)
            const drawRawKRW = convertValue(drawAmountRaw, pension.currency, 'KRW');
            annualRawFinancialIncomeKRW += drawRawKRW;

            const drawNetDisplay = convertValue(drawAmountNet, pension.currency, displayCurrency);
            monthlyPensionIncomeNetDisplay += drawNetDisplay;
          }
        });

        annualPrivatePensionIncome += monthlyPensionIncomeNetDisplay;

        // 3) 국민연금 수령 (나이 65세 이상)
        let monthlyNationalPensionDisplay = 0;
        if (currentAge >= 65) {
          let natAmount = nationalPension.expectedMonthlyAmount;
          if (inflationMode === 'nominal') {
            natAmount = nationalPension.expectedMonthlyAmount * Math.pow(1 + infRateAnnual, y);
          }
          monthlyNationalPensionDisplay = convertValue(natAmount, 'KRW', displayCurrency);
        }

        annualNationalPensionIncome += monthlyNationalPensionDisplay;

        const monthlyPensionTotalNetDisplay = monthlyPensionIncomeNetDisplay + monthlyNationalPensionDisplay;

        // 4) 기타 소득 수취
        let monthlyOtherIncomeTotalDisplay = 0;
        (otherIncomes || []).forEach((income) => {
          let amount = income.monthlyAmount;
          if (inflationMode === 'nominal') {
            amount = income.monthlyAmount * Math.pow(1 + infRateAnnual, y);
          }
          const amountDisplay = convertValue(amount, income.currency, displayCurrency);
          monthlyOtherIncomeTotalDisplay += amountDisplay;
        });

        annualOtherIncome += monthlyOtherIncomeTotalDisplay;

        // 5) 가처분 소득으로 생활비 충당
        const monthlyTotalIncome = monthlyDividendIncomeNetDisplay + monthlyPensionTotalNetDisplay + monthlyOtherIncomeTotalDisplay;
        
        let actualMonthlySpending = monthlyTargetSpending;

        if (isRetired && params.spendingStrategy === 'dividend_only') {
          // 배당금 100% 소비 모드: 발생한 모든 소득을 그 달의 생활비로 씀
          actualMonthlySpending = monthlyTotalIncome;
        }

        const shortfall = actualMonthlySpending - monthlyTotalIncome;

        if (shortfall < 0) {
          // 소득이 넘치는 경우 첫 번째 투자자산에 적립 재투자
          if (activeAssets.length > 0) {
            const extraContributionDisplay = -shortfall;
            const extraContributionAsset = convertValue(extraContributionDisplay, displayCurrency, activeAssets[0].currency);
            activeAssets[0].currentValue += extraContributionAsset;
          }
        } else if (shortfall > 0) {
          // 소득이 부족한 경우 투자자산 매도하여 충당
          let remainingShortfall = shortfall;

          // 일반 투자 자산 매도
          for (const asset of activeAssets) {
            const assetValueDisplay = convertValue(asset.currentValue, asset.currency, displayCurrency);
            if (assetValueDisplay >= remainingShortfall) {
              const shortfallInAssetCurrency = convertValue(remainingShortfall, displayCurrency, asset.currency);
              asset.currentValue -= shortfallInAssetCurrency;
              remainingShortfall = 0;
              break;
            } else {
              remainingShortfall -= assetValueDisplay;
              asset.currentValue = 0;
            }
          }

          // 투자 자산으로 부족하면 사적연금 계좌에서 임의 중도 인출 (세율 적용하여 차감)
          if (remainingShortfall > 0) {
            let taxRate = 0.055;
            if (currentAge >= 70 && currentAge < 80) taxRate = 0.044;
            else if (currentAge >= 80) taxRate = 0.033;

            for (const pension of activePensions) {
              const pensionValueDisplay = convertValue(pension.currentBalance, pension.currency, displayCurrency);
              // 세후로 환산한 연금 잔액 가치
              const pensionValueDisplayNet = pensionValueDisplay * (1 - taxRate);

              if (pensionValueDisplayNet >= remainingShortfall) {
                // 필요한 세전 인출액
                const requiredDrawDisplayRaw = remainingShortfall / (1 - taxRate);
                const requiredDrawPensionRaw = convertValue(requiredDrawDisplayRaw, displayCurrency, pension.currency);
                pension.currentBalance -= requiredDrawPensionRaw;
                remainingShortfall = 0;
                break;
              } else {
                remainingShortfall -= pensionValueDisplayNet;
                pension.currentBalance = 0;
              }
            }
          }
          
          if (remainingShortfall > 0) {
            actualMonthlySpending -= remainingShortfall;
          }
        }
        
        annualSpending += actualMonthlySpending;
      } // 월 루프 종료

      // 6) 기말 자산 합산 (표기 통화 기준)
      let stockAssetsDisplay = 0;
      activeAssets.forEach((asset) => {
        stockAssetsDisplay += convertValue(asset.currentValue, asset.currency, displayCurrency);
      });

      let pensionAssetsDisplay = 0;
      activePensions.forEach((pension) => {
        pensionAssetsDisplay += convertValue(pension.currentBalance, pension.currency, displayCurrency);
      });

      const totalAssetsDisplay = stockAssetsDisplay + pensionAssetsDisplay;

      // 금융소득종합과세 여부 (KRW 기준 세전 연간 금융소득 2,000만 원 초과)
      const hasTaxWarning = annualRawFinancialIncomeKRW > 20000000;

      yearlyResults.push({
        age: currentAge,
        year: currentYear,
        totalAssets: totalAssetsDisplay,
        stockAssets: stockAssetsDisplay,
        pensionAssets: pensionAssetsDisplay,
        dividendIncome: annualDividendIncome,
        nationalPensionIncome: annualNationalPensionIncome,
        privatePensionIncome: annualPrivatePensionIncome,
        pensionIncome: annualNationalPensionIncome + annualPrivatePensionIncome,
        otherIncome: annualOtherIncome,
        totalIncome: annualDividendIncome + (annualNationalPensionIncome + annualPrivatePensionIncome) + annualOtherIncome,
        spending: annualSpending,
        hasTaxWarning,
      });

      // 자산 고갈 여부 확인 (최초로 0 이하가 된 나이 기록)
      if (totalAssetsDisplay <= 0 && depletionAge === null) {
        depletionAge = currentAge;
      }

      // FIRE 달성 가능 연령 계산
      // 은퇴 연령 전후를 통틀어 '연간 총 가처분 소득 >= 연간 목표 생활비'를 충족하는 최초 시점
      // (은퇴 전이더라도 실제 은퇴했다고 가정했을 때의 목표 생활비를 감당 가능한지 판단하기 위함)
      const targetSpendingForFIRE = inflationMode === 'nominal'
        ? userProfile.targetMonthlySpending * 12 * Math.pow(1 + inflationRate / 100, y)
        : userProfile.targetMonthlySpending * 12;

      const totalIncome = annualDividendIncome + (annualNationalPensionIncome + annualPrivatePensionIncome) + annualOtherIncome;
      if (totalIncome >= targetSpendingForFIRE && fireAge === null) {
        fireAge = currentAge;
      }
    } // 연도 루프 종료

    // 목표 달성률 (Goal Achievement Rate) (%)
    // 공식: 은퇴기 평균 예상 월소득 / 은퇴기 목표 월소득
    const retirementYearsResults = yearlyResults.filter((r) => r.age >= userProfile.retirementAge);
    let avgRetirementMonthlyIncome = 0;
    let avgRetirementMonthlySpending = 0;
    let avgTargetMonthlySpending = 0;
    let avgPensionIncome = 0;
    
    if (retirementYearsResults.length > 0) {
      const totalIncomeSum = retirementYearsResults.reduce((sum, r) => sum + r.totalIncome, 0);
      const totalSpendingSum = retirementYearsResults.reduce((sum, r) => sum + r.spending, 0);
      const totalPensionSum = retirementYearsResults.reduce((sum, r) => sum + r.pensionIncome, 0);
      
      let totalTargetSum = 0;
      retirementYearsResults.forEach(r => {
          const y = r.age - startAge;
          let annualTarget = userProfile.targetMonthlySpending * 12;
          if (inflationMode === 'nominal') {
              annualTarget = annualTarget * Math.pow(1 + inflationRate / 100, y);
          }
          totalTargetSum += annualTarget;
      });

      avgRetirementMonthlyIncome = totalIncomeSum / retirementYearsResults.length / 12;
      avgRetirementMonthlySpending = totalSpendingSum / retirementYearsResults.length / 12;
      avgTargetMonthlySpending = totalTargetSum / retirementYearsResults.length / 12;
      avgPensionIncome = totalPensionSum / retirementYearsResults.length / 12;
    }

    const goalAchievementRate = avgTargetMonthlySpending > 0
      ? Math.min(200, Math.max(0, Math.round((avgRetirementMonthlyIncome / avgTargetMonthlySpending) * 100)))
      : 0;

    const endingAssets = yearlyResults.length > 0 ? yearlyResults[yearlyResults.length - 1].totalAssets : 0;

    // 은퇴 준비도 점수 산출
    // 1. 자산 규모 (25%): 은퇴 시점 자산이 파이어족 목표 자산(연 생활비 25배) 대비 어느 정도인지
    const retirementStartResult = yearlyResults.find(r => r.age === userProfile.retirementAge);
    const retirementAssets = retirementStartResult ? retirementStartResult.totalAssets : 0;
    
    const yearsToRetirement = Math.max(0, userProfile.retirementAge - userProfile.currentAge);
    const targetMonthlyAtRetirement = params.inflationMode === 'nominal' 
      ? userProfile.targetMonthlySpending * Math.pow(1 + params.inflationRate / 100, yearsToRetirement)
      : userProfile.targetMonthlySpending;
    const targetAssets = targetMonthlyAtRetirement * 12 * 25;
    
    const assetScoreRaw = targetAssets > 0 ? (retirementAssets / targetAssets) * 100 : 100;
    const assetScore = Math.min(25, (assetScoreRaw * 0.25));

    // 2. 현금흐름 (25%): 은퇴 후 목표 생활비 달성률
    const cashFlowScore = Math.min(25, (goalAchievementRate * 0.25));

    // 3. 연금 (20%): 은퇴 후 평균 생활비 중 연금 소득이 차지하는 비중
    const pensionRatio = avgRetirementMonthlySpending > 0 ? (avgPensionIncome / avgRetirementMonthlySpending) * 100 : 100;
    const pensionScore = Math.min(20, (pensionRatio * 0.20));

    // 4. 장수 리스크 (15%): 자산 고갈 연령과 기대수명 비교
    let longevityScoreRaw = 100;
    if (depletionAge !== null) {
      if (depletionAge <= userProfile.retirementAge) {
        longevityScoreRaw = 0;
      } else {
        const retirementSpan = endAge - userProfile.retirementAge;
        const survivalSpan = depletionAge - userProfile.retirementAge;
        longevityScoreRaw = Math.min(100, Math.max(0, (survivalSpan / retirementSpan) * 100));
      }
    }
    const longevityScore = longevityScoreRaw * 0.15;

    // 5. 인플레이션 대응 (15%): 은퇴 시점 자산 중 주식/ETF 등 투자 자산의 비중 (40% 이상이면 만점)
    const retirementStockAssets = retirementStartResult ? retirementStartResult.stockAssets : 0;
    const stockRatio = retirementAssets > 0 ? (retirementStockAssets / retirementAssets) * 100 : 0;
    const inflationScoreRaw = Math.min(100, (stockRatio / 40) * 100);
    const inflationScore = inflationScoreRaw * 0.15;

    // 최종 점수 및 등급 산출
    const retirementScore = Math.round(assetScore + cashFlowScore + pensionScore + longevityScore + inflationScore);
    
    let retirementGrade = '위험';
    if (retirementScore >= 90) retirementGrade = '매우 안정';
    else if (retirementScore >= 80) retirementGrade = '안정';
    else if (retirementScore >= 70) retirementGrade = '보통';
    else if (retirementScore >= 60) retirementGrade = '주의';

    return {
      yearlyResults,
      fireAge: fireAge === null || fireAge >= userProfile.expectancy ? null : fireAge,
      depletionAge,
      endingAssets,
      retirementScore,
      retirementGrade,
      goalAchievementRate,
    };
  }
}
