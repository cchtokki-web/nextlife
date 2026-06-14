const endAge = 85;
const retAge = 60;
let balance = 34548180;
let inflation = 0.0;
let returnRateAnnual = 0.132;
let targetMonthly = 3000000; // Guessing target monthly is around 3M KRW? Wait, in the chart, the total income reaches ~45M per year. So 3.75M per month. Let's say 4000000.
let natPensionMonthly = 1770060; // from previous conversation summaries

let returnRateMonthly = Math.pow(1 + returnRateAnnual, 1/12) - 1;

for (let age = 51; age <= 85; age++) {
  let isRetired = age >= retAge;
  let yearlyRegularDraw = 0;
  let yearlyExtraDraw = 0;
  let yearlyNatPension = age >= 65 ? natPensionMonthly * 12 : 0;
  let yearlyTotalIncome = 0;
  
  for (let m=0; m<12; m++) {
    // growth
    balance += balance * returnRateMonthly;
    
    // contribution
    if (!isRetired) {
      balance += 175000;
    }
    
    let regularDraw = 0;
    // regular draw
    if (isRetired && balance > 0) {
      const remainM = Math.max(1, (endAge - age) * 12 + (12 - m));
      regularDraw = balance / remainM;
      balance -= regularDraw;
      yearlyRegularDraw += regularDraw;
    }
    
    // shortfall
    let monthlyTarget = isRetired ? 4000000 : 0;
    let monthlyNat = age >= 65 ? natPensionMonthly : 0;
    let shortfall = monthlyTarget - (regularDraw + monthlyNat);
    if (shortfall > 0 && isRetired) {
      if (balance >= shortfall) {
        balance -= shortfall;
        yearlyExtraDraw += shortfall;
      } else {
        yearlyExtraDraw += balance;
        balance = 0;
      }
    }
  }
  if (isRetired) {
    console.log(`Age: ${age}, Regular: ${Math.round(yearlyRegularDraw/10000)}만, Extra: ${Math.round(yearlyExtraDraw/10000)}만, Nat: ${Math.round(yearlyNatPension/10000)}만, Balance: ${Math.round(balance/10000)}만`);
  }
}
