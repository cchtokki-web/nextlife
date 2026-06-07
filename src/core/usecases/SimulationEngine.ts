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
    const {
      userProfile,
      assets,
      nationalPension,
      privatePensions,
      otherIncomes,
      inflationRate,
      inflationMode,
      baseExchangeRate,
      exchangeScenario,
      displayCurrency,
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
    const activeAssets: ActiveAsset[] = assets.map((asset) => ({
      ...asset,
      currentValue: asset.quantity * asset.averagePrice,
    }));

    // 사적 연금
    interface ActivePension extends PrivatePension {
      currentBalance: number; // 자체 통화 기준 연금 잔액
    }
    const activePensions: ActivePension[] = privatePensions.map((p) => ({
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
          monthlyTargetSpending = userProfile.targetMonthlySpending;
          if (inflationMode === 'nominal') {
            monthlyTargetSpending = userProfile.targetMonthlySpending * Math.pow(1 + infRateAnnual, y);
          }
          annualSpending += monthlyTargetSpending;
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

          // 연간 수익률 설정 (실질 모드일 경우 인플레이션 차감)
          const returnRateAnnual = inflationMode === 'real'
            ? (pension.annualReturn - inflationRate) / 100
            : pension.annualReturn / 100;
          const returnRateMonthly = Math.pow(Math.max(0, 1 + returnRateAnnual), 1 / 12) - 1;

          // 연금 잔액 성장
          const growth = pension.currentBalance * returnRateMonthly;
          // 월 적립금 적용 (은퇴 전일 때만)
          const contribution = isRetired ? 0 : pension.monthlyContribution;

          pension.currentBalance = pension.currentBalance + growth + contribution;

          // 은퇴 후 연금 수령
          if (isRetired && pension.currentBalance > 0) {
            // 기대수명까지 남은 개월 수 계산
            const remainingMonths = Math.max(1, (endAge - currentAge) * 12 + (12 - m));
            const drawAmountRaw = pension.currentBalance / remainingMonths;

            // 연령대별 슬라이딩 연금소득세율 적용
            let taxRate = 0.055; // 55~69세: 5.5%
            if (currentAge >= 70 && currentAge < 80) {
              taxRate = 0.044; // 70~79세: 4.4%
            } else if (currentAge >= 80) {
              taxRate = 0.033; // 80세 이상: 3.3%
            }

            const drawAmountNet = drawAmountRaw * (1 - taxRate);
            pension.currentBalance -= drawAmountRaw;

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
        otherIncomes.forEach((income) => {
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
        const shortfall = monthlyTargetSpending - monthlyTotalIncome;

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
        }
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

    // 은퇴 점수 (Retirement Score) 계산 (0~100)
    // 공식: (기대 수명 시 잔여 자산이 존재하면 100점, 고갈 시 은퇴 나이부터 고갈 나이까지의 생존 비율로 산출)
    let retirementScore = 100;
    if (depletionAge !== null) {
      if (depletionAge <= userProfile.retirementAge) {
        retirementScore = 0;
      } else {
        const retirementSpan = endAge - userProfile.retirementAge;
        const survivalSpan = depletionAge - userProfile.retirementAge;
        retirementScore = Math.min(100, Math.max(0, Math.round((survivalSpan / retirementSpan) * 100)));
      }
    }

    // 목표 달성률 (Goal Achievement Rate) (%)
    // 공식: 은퇴기 평균 예상 월소득 / 은퇴기 목표 월소득
    const retirementYearsResults = yearlyResults.filter((r) => r.age >= userProfile.retirementAge);
    let avgRetirementMonthlyIncome = 0;
    let avgRetirementMonthlySpending = 0;
    if (retirementYearsResults.length > 0) {
      const totalIncomeSum = retirementYearsResults.reduce((sum, r) => sum + r.totalIncome, 0);
      const totalSpendingSum = retirementYearsResults.reduce((sum, r) => sum + r.spending, 0);
      avgRetirementMonthlyIncome = totalIncomeSum / retirementYearsResults.length / 12;
      avgRetirementMonthlySpending = totalSpendingSum / retirementYearsResults.length / 12;
    }

    const goalAchievementRate = avgRetirementMonthlySpending > 0
      ? Math.min(200, Math.max(0, Math.round((avgRetirementMonthlyIncome / avgRetirementMonthlySpending) * 100)))
      : 0;

    const endingAssets = yearlyResults.length > 0 ? yearlyResults[yearlyResults.length - 1].totalAssets : 0;

    return {
      yearlyResults,
      fireAge: fireAge === null || fireAge >= userProfile.expectancy ? null : fireAge,
      depletionAge,
      endingAssets,
      retirementScore,
      goalAchievementRate,
    };
  }
}
