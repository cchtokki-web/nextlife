const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/core/usecases/SimulationEngine.ts');
let code = fs.readFileSync(filePath, 'utf-8');

// Add bestTarget to the return in findMaxSustainable
code = code.replace(/return bestResult;/, 'return { ...bestResult, calculatedTargetSpending: bestTarget };');

fs.writeFileSync(filePath, code);
console.log('Successfully updated SimulationEngine.ts again');
