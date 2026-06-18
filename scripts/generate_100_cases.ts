import { SimulationEngine } from '../src/core/usecases/SimulationEngine';
import { SimulationParams, InvestmentAsset, PrivatePension } from '../src/core/entities/types';
import * as fs from 'fs';
import * as path from 'path';

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals: number = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function generateAsset(): InvestmentAsset {
  const isUSD = Math.random() > 0.5;
  const price = isUSD ? randomFloat(50, 500) : randomFloat(10000, 100000);
  const qty = randomInt(10, 1000);
  return {
    id: `asset_${randomInt(1, 10000)}`,
    type: 'etf',
    ticker: isUSD ? 'SPY' : 'TIGER 200',
    name: isUSD ? 'US ETF' : 'KR ETF',
    quantity: qty,
    averagePrice: price,
    annualGrowthRate: randomFloat(3, 12),
    dividendYield: randomFloat(0, 5),
    monthlyContribution: randomInt(0, 1000000),
    reinvestDividend: Math.random() > 0.5,
    currency: isUSD ? 'USD' : 'KRW',
    assetMarket: isUSD ? 'US_ETF' : 'KR_ETF',
  };
}

function generatePension(): PrivatePension {
  return {
    id: `pension_${randomInt(1, 10000)}`,
    type: 'irp',
    investmentType: 'etf',
    balance: randomInt(10000000, 100000000),
    monthlyContribution: randomInt(100000, 1000000),
    annualReturn: randomFloat(3, 8),
    currency: 'KRW'
  };
}

const cases: SimulationParams[] = [];
for (let i = 0; i < 100; i++) {
  const currentAge = randomInt(25, 55);
  const retirementAge = randomInt(currentAge + 1, 65);
  
  cases.push({
    userProfile: {
      currentAge,
      retirementAge,
      expectancy: randomInt(85, 100),
      targetMonthlySpending: randomInt(2000000, 10000000),
    },
    assets: Array.from({ length: randomInt(1, 4) }, generateAsset),
    nationalPension: {
      expectedMonthlyAmount: randomInt(500000, 2000000),
    },
    privatePensions: Array.from({ length: randomInt(0, 2) }, generatePension),
    isaAccounts: [],
    otherIncomes: [],
    inflationRate: randomFloat(1.5, 4.0),
    inflationMode: 'real',
    baseExchangeRate: randomInt(1200, 1450),
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    spendingStrategy: 'target',
    taxSettings: {
      enableComprehensiveTax: true,
      enableHealthInsurance: true,
      usDividendTaxRate: 15,
      domesticDividendTaxRate: 15.4,
      comprehensiveTaxRate: 15,
      healthInsuranceRate: 5,
    }
  });
}

const engine = new SimulationEngine();

let csvContent = 'Case,Current Age,Retire Age,Target Spend,Init Asset(KRW),Assets Count,Pensions Count,Inflation,Exchange Rate,Fire Age,Depletion Age,Ending Asset,Retire Score,Retire Grade,Goal Achieved(%)\n';
let markdownContent = '# Simulation 100 Test Cases Results\n\n';
markdownContent += '| Case | Curr Age | Retire Age | Target Spend | Init Asset(KRW) | Fire Age | Deplete Age | Ending Asset(KRW) | Score | Grade | Goal Ach. |\n';
markdownContent += '|---|---|---|---|---|---|---|---|---|---|---|\n';

cases.forEach((c, index) => {
  const result = engine.run(c);
  
  // Calculate init asset KRW roughly
  let initAsset = 0;
  c.assets.forEach(a => {
    let val = a.quantity * a.averagePrice;
    if (a.currency === 'USD') val *= c.baseExchangeRate;
    initAsset += val;
  });
  c.privatePensions.forEach(p => initAsset += p.balance);

  csvContent += `${index+1},${c.userProfile.currentAge},${c.userProfile.retirementAge},${c.userProfile.targetMonthlySpending},${Math.round(initAsset)},${c.assets.length},${c.privatePensions.length},${c.inflationRate},${c.baseExchangeRate},${result.fireAge ?? 'N/A'},${result.depletionAge ?? 'N/A'},${Math.round(result.endingAssets)},${result.retirementScore},${result.retirementGrade},${result.goalAchievementRate}\n`;

  markdownContent += `| ${index+1} | ${c.userProfile.currentAge} | ${c.userProfile.retirementAge} | ${c.userProfile.targetMonthlySpending.toLocaleString()} | ${Math.round(initAsset).toLocaleString()} | ${result.fireAge ?? '-'} | ${result.depletionAge ?? '-'} | ${Math.round(result.endingAssets).toLocaleString()} | ${result.retirementScore} | ${result.retirementGrade} | ${result.goalAchievementRate}% |\n`;
});

const artifactsDir = 'LOCAL_PATH_REDACTED';
fs.writeFileSync(path.join(artifactsDir, 'simulation_100_results.csv'), csvContent);
fs.writeFileSync(path.join(artifactsDir, 'simulation_100_results.md'), markdownContent);

console.log('Test cases generated and evaluated successfully.');
