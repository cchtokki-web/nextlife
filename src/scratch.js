const endAge = 85;
let balance = 1000;
let target = 50;
let inflation = 0.02;
let returnRate = 0.05;

for (let age = 60; age <= 66; age++) {
  let yearlyRegularDraw = 0;
  let yearlyExtraDraw = 0;
  let yearlyNatPension = age >= 65 ? 20 : 0;
  
  for (let m=0; m<12; m++) {
    // growth
    balance += balance * (returnRate / 12);
    
    // regular draw
    const remainM = (endAge - age) * 12 + (12 - m);
    let regularDraw = balance / remainM;
    balance -= regularDraw;
    yearlyRegularDraw += regularDraw;
    
    // shortfall
    let monthlyTarget = target / 12;
    let monthlyNat = yearlyNatPension / 12;
    let shortfall = monthlyTarget - (regularDraw + monthlyNat);
    if (shortfall > 0) {
      balance -= shortfall;
      yearlyExtraDraw += shortfall;
    }
  }
  console.log(`Age: ${age}, Regular Draw: ${yearlyRegularDraw.toFixed(2)}, Extra Draw: ${yearlyExtraDraw.toFixed(2)}, Balance: ${balance.toFixed(2)}`);
}
