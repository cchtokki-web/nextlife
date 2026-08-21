import type { YearlyLedger } from '../../entities/types';
import { SimulationConsistencyError } from '../../entities/errors';

/** buildYearLedger의 입력. 엔진이 한 해 동안 누적한 원시 값들을 그대로 받는다. */
export interface YearLedgerInput {
  age: number;
  beginningAssets: number;
  endingAssets: number;
  /** 가격수익 + 현금 이자 + 사적연금 총수익(배당 제외). */
  priceGain: number;
  /** 일반계좌·ISA의 세전 배당 총액. */
  grossDividend: number;
  /** 계좌 밖으로 나온 세후 배당(생활비 재원). */
  dividendPaidOutNet: number;
  /** 계좌 안에 남은 세후 배당(재투자분 + ISA 내부 배당). */
  dividendRetainedNet: number;
  /** 국민연금 세전 수령액. */
  nationalPensionPreTax: number;
  /** 기타 외부소득(세전). */
  otherIncome: number;
  /** 그 해 실제로 납입된 금액(한도 적용 후). */
  contributions: number;
  privatePensionWithdrawal: number;
  taxableAccountWithdrawal: number;
  isaWithdrawal: number;
  living: number;
  /** 건강보험료를 «제외한» 모든 세금의 합. */
  tax: number;
  healthInsurance: number;
}

export function buildYearLedger(input: YearLedgerInput): YearlyLedger {
  const investmentTotal = input.priceGain + input.grossDividend;
  const externalTotal = input.nationalPensionPreTax + input.otherIncome + input.contributions;

  // 항등식이 예측하는 기말자산. 내부 이동(사적연금 인출·ETF 매도·ISA 인출)은 «일부러»
  // 빠져 있다 — 넣으면 인출과 소비가 모두 자산 감소로 계산되어 이중차감이 된다.
  const expected = input.beginningAssets
    + investmentTotal
    + externalTotal
    - input.living
    - input.tax
    - input.healthInsurance;

  return {
    age: input.age,
    beginningAssets: input.beginningAssets,
    investmentReturn: {
      total: investmentTotal,
      priceGain: input.priceGain,
      dividend: input.grossDividend,
      dividendPaidOutNet: input.dividendPaidOutNet,
      dividendRetainedNet: input.dividendRetainedNet,
    },
    externalIncome: {
      total: externalTotal,
      nationalPension: input.nationalPensionPreTax,
      other: input.otherIncome,
      contributions: input.contributions,
    },
    internalWithdrawals: {
      privatePension: input.privatePensionWithdrawal,
      taxableAccount: input.taxableAccountWithdrawal,
      isa: input.isaWithdrawal,
    },
    expenses: {
      living: input.living,
      tax: input.tax,
      healthInsurance: input.healthInsurance,
    },
    endingAssets: input.endingAssets,
    residual: input.endingAssets - expected,
  };
}

// 허용 오차. 절대 오차만 두면 자산이 수십억인 계획에서 정상적인 부동소수점 누적이
// 위반으로 잡히고, 상대 오차만 두면 자산이 0인 해(고갈 후)에서 어떤 오차도 잡을 수 없다.
// 그래서 둘 중 큰 쪽을 쓴다.
//
// 1e-9는 배정밀도 실수의 유효자릿수(약 1e-16)에 비해 7자리의 여유가 있어, 한 해 안에서
// 일어나는 수천 번의 덧셈이 누적돼도 닿지 않는다. 절대 하한 1원은 «표시 단위»이기도 하다 —
// 원 미만의 차이는 화면에서 보이지 않으므로 사용자에게 설명할 수 없는 결함이 아니다.
const ABSOLUTE_TOLERANCE_KRW = 1;
const RELATIVE_TOLERANCE = 1e-9;

export function ledgerTolerance(ledger: YearlyLedger): number {
  const scale = Math.max(
    Math.abs(ledger.beginningAssets),
    Math.abs(ledger.endingAssets),
    Math.abs(ledger.investmentReturn.total),
    Math.abs(ledger.expenses.living),
  );
  return Math.max(ABSOLUTE_TOLERANCE_KRW, scale * RELATIVE_TOLERANCE);
}

/**
 * 항등식 위반을 던진다. 정상 계산에서는 절대 발생하지 않으므로 호출부에 폴백을 두지 않는다.
 *
 * **조용히 보정하지 않는 이유**: 여기서 보정하면 그 결함이 그대로 화면의 자산 곡선과
 * 성공률이 된다. 원인은 언제나 현금흐름 엔진에 있고, 거기서만 고칠 수 있다.
 */
export function assertLedgerConsistent(ledger: YearlyLedger): void {
  const tolerance = ledgerTolerance(ledger);
  if (Math.abs(ledger.residual) <= tolerance) return;

  throw new SimulationConsistencyError(
    `${ledger.age}세 총자산 흐름이 회계식으로 설명되지 않습니다. `
    + `설명되지 않는 차이 ${Math.round(ledger.residual).toLocaleString()}원 `
    + `(허용 ${Math.round(tolerance).toLocaleString()}원). `
    + `기초 ${Math.round(ledger.beginningAssets).toLocaleString()} `
    + `+ 투자수익 ${Math.round(ledger.investmentReturn.total).toLocaleString()} `
    + `+ 외부유입 ${Math.round(ledger.externalIncome.total).toLocaleString()} `
    + `− 생활비 ${Math.round(ledger.expenses.living).toLocaleString()} `
    + `− 세금 ${Math.round(ledger.expenses.tax).toLocaleString()} `
    + `− 건보료 ${Math.round(ledger.expenses.healthInsurance).toLocaleString()} `
    + `≠ 기말 ${Math.round(ledger.endingAssets).toLocaleString()}`
  );
}

const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
// 0에는 부호를 붙이지 않는다 — `+0`/`−0`은 방향이 있는 것처럼 읽힌다.
const signed = (n: number) => (Math.round(n) === 0 ? '0' : `${n < 0 ? '−' : '+'}${won(Math.abs(n))}`);

/**
 * 한 해를 사람이 읽을 수 있게 펼친다. 전체 시뮬레이션을 돌리기 전에 한 해만 확인하는
 * 디버그 모드의 출력 형식이며, 모든 항목의 원천 계좌와 목적을 추적할 수 있게 적는다.
 */
export function formatYearLedger(ledger: YearlyLedger): string {
  const lines = [
    `[AGE ${ledger.age}]`,
    '',
    '기초 총자산',
    won(ledger.beginningAssets),
    '',
    '투자 수익',
    signed(ledger.investmentReturn.total),
    '',
    `  가격수익·이자·연금운용  ${signed(ledger.investmentReturn.priceGain)}`,
    `  일반계좌·ISA 배당(세전) ${signed(ledger.investmentReturn.dividend)}`,
    '',
    '외부 현금소득',
    signed(ledger.externalIncome.total),
    '',
    `  국민연금(세전)  ${won(ledger.externalIncome.nationalPension)}`,
    `  기타소득        ${won(ledger.externalIncome.other)}`,
    `  신규 납입       ${won(ledger.externalIncome.contributions)}`,
    '',
    '계좌 간 이동 (총자산 감소가 아님)',
    `  사적연금 인출   ${won(ledger.internalWithdrawals.privatePension)}`,
    `  일반계좌 인출   ${won(ledger.internalWithdrawals.taxableAccount)}`,
    `  ISA 인출        ${won(ledger.internalWithdrawals.isa)}`,
    '',
    '생활비',
    signed(-ledger.expenses.living),
    '',
    '세금',
    signed(-ledger.expenses.tax),
    '',
    '건강보험료',
    signed(-ledger.expenses.healthInsurance),
    '',
    '기말 총자산',
    won(ledger.endingAssets),
    '',
    `설명되지 않는 차이 ${won(ledger.residual)}`,
  ];
  return lines.join('\n');
}
