/* eslint-disable @typescript-eslint/no-require-imports -- Legacy CommonJS maintenance script. */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const initialParams = {
  userProfile: {
    currentAge: 45,
    retirementAge: 60,
    expectancy: 85,
    targetMonthlySpending: 3000000, 
  },
  assets: [
    {
      id: 'asset-kodex200',
      type: 'etf',
      ticker: '069500',
      name: 'KODEX 200',
      quantity: 1000,
      averagePrice: 35000,
      annualGrowthRate: 5,
      dividendYield: 2.0,
      monthlyContribution: 300000,
      reinvestDividend: true,
      currency: 'KRW',
    },
    {
      id: 'asset-tiger-sp500',
      type: 'etf',
      ticker: '360750',
      name: 'TIGER 미국S&P500',
      quantity: 2000,
      averagePrice: 15000,
      annualGrowthRate: 8,
      dividendYield: 1.5,
      monthlyContribution: 200000,
      reinvestDividend: true,
      currency: 'KRW',
    },
  ],
  nationalPension: {
    expectedMonthlyAmount: 1000000,
  },
  privatePensions: [
    {
      id: 'pension-irp',
      type: 'irp',
      balance: 30000000,
      monthlyContribution: 300000,
      annualReturn: 4,
      currency: 'KRW',
    },
    {
      id: 'pension-savings',
      type: 'savings',
      balance: 40000000,
      monthlyContribution: 340000,
      annualReturn: 4,
      currency: 'KRW',
    },
  ],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
  yieldPreset: 'base',
};

async function main() {
  const users = await prisma.user.findMany();
  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: { simulationData: JSON.stringify(initialParams) }
    });
    console.log(`Updated user ${user.email} with new 45yo defaults`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
