// 51인 페르소나 정의.
//
// 무작위 생성이 아니라 축(연령대 × 자산규모 × 은퇴시점 × 연금보유 × 자산성격 × 지출수준 ×
// 기대수명)을 교차해 의도적으로 설계했다. 각 페르소나는 하나의 질문에 답한다(note 필드).
// 무작위로 뽑으면 편향은 적어도 중요한 엣지케이스(연금 전무, 100세 장수, 고배당 편중,
// 명퇴, 의료비 충격)가 통째로 빠진다.
//
// 고자산층(15억+)은 제외했다. 초기자산 범위는 0.25억 ~ 5.8억이다.
import {
  SimulationParams, InvestmentAsset, PrivatePension, IsaAccount, HealthcareAssumptions,
} from '@/core/entities/types';
import { resolveTaxSettings } from '@/core/usecases/tax/taxRates';

const 만 = 10_000;
const 억 = 100_000_000;

// 페르소나 간 비교 가능성을 위해 환율·물가·모드를 고정한다(엣지케이스 일부만 예외).
const FX = 1400;

// averagePrice × quantity = 현재 평가액. acquisitionCostBasis 미지정이므로 기존 평가차익은
// 과세되지 않는다(InvestmentAsset.acquisitionCostBasis 주석의 기본 동작).
function krEtf(valueKRW: number, opts: Partial<InvestmentAsset> = {}): InvestmentAsset {
  return {
    id: `kr-${Math.round(valueKRW)}-${opts.ticker ?? 'KODEX200'}`,
    type: 'etf', ticker: 'KODEX200', name: 'KODEX 200',
    quantity: 1, averagePrice: valueKRW,
    annualGrowthRate: 5, dividendYield: 2,
    monthlyContribution: 0, reinvestDividend: true,
    currency: 'KRW', assetMarket: 'KR_ETF',
    ...opts,
  };
}

function usEtf(valueKRW: number, opts: Partial<InvestmentAsset> = {}): InvestmentAsset {
  return {
    id: `us-${Math.round(valueKRW)}-${opts.ticker ?? 'VOO'}`,
    type: 'etf', ticker: 'VOO', name: 'S&P500 ETF',
    quantity: 1, averagePrice: valueKRW / FX, // USD 표시 평가액
    annualGrowthRate: 8, dividendYield: 1.3,
    monthlyContribution: 0, reinvestDividend: true,
    currency: 'USD', assetMarket: 'US_ETF',
    ...opts,
  };
}

function irp(balance: number, monthly: number, ret = 4): PrivatePension {
  return {
    id: `irp-${balance}-${monthly}`, type: 'irp', investmentType: 'etf', name: 'IRP',
    balance, monthlyContribution: monthly, annualReturn: ret, currency: 'KRW',
  };
}

function savingsPension(balance: number, monthly: number, ret = 4): PrivatePension {
  return {
    id: `sv-${balance}-${monthly}`, type: 'savings', investmentType: 'etf', name: '연금저축',
    balance, monthlyContribution: monthly, annualReturn: ret, currency: 'KRW',
  };
}

function isa(balance: number, monthly: number, type: IsaAccount['type'] = 'general'): IsaAccount {
  return {
    id: `isa-${balance}-${monthly}`, type, investmentType: 'etf', name: 'ISA',
    balance, monthlyContribution: monthly, annualReturn: 6, dividendYield: 2,
    currency: 'KRW', maturityYears: 3,
  };
}

const HEALTHCARE_ON: HealthcareAssumptions = {
  enabled: true,
  costGrowthRate: 5,
  baseMonthlyCost: 300_000,
  longTermCareEnabled: true,
  longTermCareStartAge: 80,
  longTermCareMonthlyCost: 1_500_000,
  shockEnabled: true,
  shockAge: 75,
  shockAmount: 30_000_000,
};

export interface Persona {
  no: number;
  name: string;
  note: string; // 이 페르소나가 던지는 질문
  params: SimulationParams;
}

function base(p: {
  currentAge: number;
  retirementAge: number;
  expectancy: number;
  monthlySpending: number;
  assets: InvestmentAsset[];
  pensions?: PrivatePension[];
  isaAccounts?: IsaAccount[];
  npMonthly: number;
  otherMonthly?: number;
  yieldPreset?: 'conservative' | 'base' | 'aggressive';
  healthcare?: HealthcareAssumptions;
  targetBequest?: number;
  inflationRate?: number;
}): SimulationParams {
  return {
    userProfile: {
      currentAge: p.currentAge,
      retirementAge: p.retirementAge,
      expectancy: p.expectancy,
      targetMonthlySpending: p.monthlySpending,
      ...(p.targetBequest !== undefined ? { targetBequest: p.targetBequest } : {}),
    },
    assets: p.assets,
    nationalPension: { expectedMonthlyAmount: p.npMonthly },
    privatePensions: p.pensions ?? [],
    isaAccounts: p.isaAccounts ?? [],
    otherIncomes: p.otherMonthly
      ? [{ id: 'oi-1', label: '임대/부업 소득', monthlyAmount: p.otherMonthly, currency: 'KRW' }]
      : [],
    inflationRate: p.inflationRate ?? 2.5,
    inflationMode: 'real',
    baseExchangeRate: FX,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    useLatestExchangeRate: false,
    yieldPreset: p.yieldPreset ?? 'base',
    spendingStrategy: 'target',
    taxSettings: resolveTaxSettings(),
    ...(p.healthcare ? { healthcare: p.healthcare } : {}),
  };
}

const personas: Persona[] = [];
let n = 0;
const P = (name: string, note: string, params: SimulationParams) =>
  personas.push({ no: ++n, name, note, params });

// ── A. 30대: 축적기 ──
P('30대 초 사회초년생', '자산 거의 없는 상태에서 60세 은퇴가 가능한가',
  base({ currentAge: 31, retirementAge: 60, expectancy: 88, monthlySpending: 2_500_000,
    assets: [krEtf(2_000 * 만, { monthlyContribution: 400_000 })], pensions: [irp(500 * 만, 300_000)],
    npMonthly: 1_100_000 }));
P('30대 초 적극투자', '미국 ETF 몰빵 + 고적립. 성장률 가정이 결과를 얼마나 지배하나',
  base({ currentAge: 32, retirementAge: 58, expectancy: 90, monthlySpending: 3_000_000,
    assets: [usEtf(3_000 * 만, { monthlyContribution: 500 })], pensions: [irp(1_000 * 만, 500_000)],
    npMonthly: 1_200_000, yieldPreset: 'aggressive' }));
P('30대 초 보수형', '예금 성향으로 30년을 굴리면 어디까지 가나',
  base({ currentAge: 33, retirementAge: 62, expectancy: 88, monthlySpending: 2_500_000,
    assets: [krEtf(3_000 * 만, { monthlyContribution: 500_000 })], pensions: [savingsPension(1_500 * 만, 400_000)],
    npMonthly: 1_150_000, yieldPreset: 'conservative' }));
P('30대 중 FIRE 도전', '45세 조기은퇴 목표. 연금 개시 전 공백 15년을 견디나',
  base({ currentAge: 35, retirementAge: 45, expectancy: 90, monthlySpending: 2_800_000,
    assets: [usEtf(1.5 * 억, { monthlyContribution: 1_500 }), krEtf(5_000 * 만, { monthlyContribution: 500_000 })],
    pensions: [irp(2_000 * 만, 300_000)], isaAccounts: [isa(2_000 * 만, 500_000)], npMonthly: 900_000 }));
P('30대 중 프리랜서', '국민연금 최소가입 + 사적연금 전무',
  base({ currentAge: 36, retirementAge: 65, expectancy: 88, monthlySpending: 2_800_000,
    assets: [krEtf(8_000 * 만, { monthlyContribution: 600_000 })], npMonthly: 600_000 }));
P('30대 중 맞벌이 1인분', '표준 케이스. 연금 3층 균형',
  base({ currentAge: 37, retirementAge: 60, expectancy: 90, monthlySpending: 3_200_000,
    assets: [krEtf(6_000 * 만, { monthlyContribution: 400_000 }), usEtf(6_000 * 만, { monthlyContribution: 400 })],
    pensions: [irp(3_000 * 만, 400_000), savingsPension(2_000 * 만, 300_000)], isaAccounts: [isa(1_000 * 만, 300_000)],
    npMonthly: 1_300_000 }));
P('30대 후 늦은 시작', '자산 5천만, 40세 직전. 아직 만회 가능한가',
  base({ currentAge: 38, retirementAge: 63, expectancy: 88, monthlySpending: 3_000_000,
    assets: [krEtf(5_000 * 만, { monthlyContribution: 700_000 })], pensions: [irp(1_000 * 만, 500_000)],
    npMonthly: 1_200_000 }));
P('30대 후 장수 가정', '기대수명 100세. 장수 리스크가 점수에 반영되나',
  base({ currentAge: 39, retirementAge: 60, expectancy: 100, monthlySpending: 3_000_000,
    assets: [krEtf(1 * 억, { monthlyContribution: 500_000 }), usEtf(8_000 * 만, { monthlyContribution: 400 })],
    pensions: [irp(4_000 * 만, 400_000)], npMonthly: 1_300_000 }));
P('30대 후 저지출형', '월 200만으로 산다면 필요 자산은 얼마나 줄어드나',
  base({ currentAge: 39, retirementAge: 58, expectancy: 90, monthlySpending: 2_000_000,
    assets: [krEtf(1.2 * 억, { monthlyContribution: 500_000 })], pensions: [irp(3_000 * 만, 400_000)],
    npMonthly: 1_100_000 }));

// ── B. 40대: 중간점검 ──
P('40대 초 표준 직장인', '가장 흔한 케이스',
  base({ currentAge: 41, retirementAge: 60, expectancy: 88, monthlySpending: 3_500_000,
    assets: [krEtf(1.5 * 억, { monthlyContribution: 500_000 }), usEtf(1 * 억, { monthlyContribution: 400 })],
    pensions: [irp(5_000 * 만, 400_000), savingsPension(3_000 * 만, 300_000)], npMonthly: 1_400_000 }));
P('40대 초 저자산', '자산 8천만. 20년 남았을 때의 현실',
  base({ currentAge: 42, retirementAge: 62, expectancy: 88, monthlySpending: 3_000_000,
    assets: [krEtf(8_000 * 만, { monthlyContribution: 400_000 })], pensions: [irp(2_000 * 만, 300_000)],
    npMonthly: 1_100_000 }));
P('40대 초 고지출', '월 800만 지출. 중간자산으로 감당되나',
  base({ currentAge: 43, retirementAge: 60, expectancy: 88, monthlySpending: 8_000_000,
    assets: [krEtf(2 * 억, { monthlyContribution: 800_000 }), usEtf(2 * 억, { monthlyContribution: 800 })],
    pensions: [irp(8_000 * 만, 500_000), savingsPension(5_000 * 만, 400_000)], npMonthly: 1_800_000 }));
P('40대 초 자영업', '연금 전무 + 사업소득. 사업 종료 후 절벽',
  base({ currentAge: 43, retirementAge: 65, expectancy: 88, monthlySpending: 4_000_000,
    assets: [krEtf(2.5 * 억, { monthlyContribution: 1_000_000 })], npMonthly: 700_000, otherMonthly: 1_000_000 }));
P('40대 중 달러 편중', 'USD 100% 노출. 환율 시나리오가 결과를 흔드나',
  base({ currentAge: 45, retirementAge: 60, expectancy: 90, monthlySpending: 3_500_000,
    assets: [usEtf(3 * 억, { monthlyContribution: 700 })], pensions: [irp(5_000 * 만, 400_000)],
    npMonthly: 1_400_000 }));
P('40대 중 고배당 편중', '배당 4.5% 편중. 금융소득종합과세 절벽에 걸리나',
  base({ currentAge: 45, retirementAge: 58, expectancy: 88, monthlySpending: 3_500_000,
    assets: [krEtf(4 * 억, { dividendYield: 4.5, annualGrowthRate: 3, reinvestDividend: false, monthlyContribution: 300_000 })],
    pensions: [irp(4_000 * 만, 300_000)], npMonthly: 1_300_000 }));
P('40대 중 ISA 적극', 'ISA 만기 행선지 선택이 실제로 차이를 만드나',
  base({ currentAge: 46, retirementAge: 60, expectancy: 90, monthlySpending: 3_500_000,
    assets: [krEtf(1.5 * 억, { monthlyContribution: 300_000 })],
    pensions: [irp(6_000 * 만, 400_000)], isaAccounts: [isa(1 * 억, 1_600_000)], npMonthly: 1_400_000 }));
P('40대 중 조기은퇴 50', '50세 은퇴. 국민연금까지 15년 공백',
  base({ currentAge: 46, retirementAge: 50, expectancy: 90, monthlySpending: 3_000_000,
    assets: [krEtf(2 * 억, { monthlyContribution: 500_000 }), usEtf(2.5 * 억, { monthlyContribution: 600 })],
    pensions: [irp(7_000 * 만, 300_000)], isaAccounts: [isa(3_000 * 만, 500_000)], npMonthly: 1_100_000 }));
P('40대 후 의료비 반영', '의료비+장기요양+75세 충격을 켰을 때의 타격',
  base({ currentAge: 47, retirementAge: 60, expectancy: 92, monthlySpending: 3_200_000,
    assets: [krEtf(2 * 억, { monthlyContribution: 400_000 }), usEtf(1.5 * 억, { monthlyContribution: 300 })],
    pensions: [irp(6_000 * 만, 400_000), savingsPension(4_000 * 만, 300_000)], npMonthly: 1_400_000,
    healthcare: HEALTHCARE_ON }));
P('40대 후 상속 목표', '자녀에게 3억 남기고 싶다. 소비와 상충하나',
  base({ currentAge: 48, retirementAge: 62, expectancy: 88, monthlySpending: 3_000_000,
    assets: [krEtf(2.5 * 억, { monthlyContribution: 500_000 }), usEtf(2 * 억, { monthlyContribution: 400 })],
    pensions: [irp(7_000 * 만, 400_000)], npMonthly: 1_500_000, targetBequest: 3 * 억 }));
P('40대 후 다쓰고간다', 'targetBequest=0. 상속 0 목표가 소비를 늘려주나',
  base({ currentAge: 48, retirementAge: 62, expectancy: 88, monthlySpending: 3_000_000,
    assets: [krEtf(2.5 * 억, { monthlyContribution: 500_000 }), usEtf(2 * 억, { monthlyContribution: 400 })],
    pensions: [irp(7_000 * 만, 400_000)], npMonthly: 1_500_000, targetBequest: 0 }));
P('40대 후 연금 미가입', '자산만 있고 3층 연금이 없다',
  base({ currentAge: 49, retirementAge: 63, expectancy: 88, monthlySpending: 3_200_000,
    assets: [krEtf(3 * 억, { monthlyContribution: 800_000 })], npMonthly: 850_000 }));

// ── C. 50대: 은퇴 임박 ──
P('50대 초 표준', '가장 조언이 절실한 구간',
  base({ currentAge: 51, retirementAge: 60, expectancy: 88, monthlySpending: 3_500_000,
    assets: [krEtf(2 * 억, { monthlyContribution: 400_000 }), usEtf(1.5 * 억, { monthlyContribution: 300 })],
    pensions: [irp(8_000 * 만, 400_000), savingsPension(6_000 * 만, 500_000)], npMonthly: 1_500_000 }));
P('50대 초 저자산', '자산 1.2억, 9년 남음. 도구가 뭐라고 답하나',
  base({ currentAge: 51, retirementAge: 60, expectancy: 88, monthlySpending: 2_800_000,
    assets: [krEtf(1.2 * 억, { monthlyContribution: 300_000 })], pensions: [irp(3_000 * 만, 200_000)],
    npMonthly: 1_200_000 }));
P('50대 초 연금 편중', '자산의 대부분이 연금계좌. 저율과세 한도가 걸림돌인가',
  base({ currentAge: 52, retirementAge: 60, expectancy: 90, monthlySpending: 3_500_000,
    assets: [krEtf(5_000 * 만, { monthlyContribution: 200_000 })],
    pensions: [irp(3 * 억, 600_000), savingsPension(2 * 억, 400_000)], npMonthly: 1_500_000 }));
P('50대 초 일반자산 편중', '반대 케이스. 연금이 거의 없다',
  base({ currentAge: 52, retirementAge: 60, expectancy: 90, monthlySpending: 3_500_000,
    assets: [krEtf(3 * 억, { monthlyContribution: 500_000 }), usEtf(2.5 * 억, { monthlyContribution: 500 })],
    pensions: [irp(2_000 * 만, 200_000)], npMonthly: 1_400_000 }));
P('50대 초 고배당 은퇴', '배당만으로 살겠다는 계획의 실체',
  base({ currentAge: 53, retirementAge: 57, expectancy: 88, monthlySpending: 3_000_000,
    assets: [krEtf(5 * 억, { dividendYield: 5, annualGrowthRate: 2, reinvestDividend: false, monthlyContribution: 0 })],
    pensions: [irp(5_000 * 만, 300_000)], npMonthly: 1_400_000 }));
P('50대 초 장수 100세', '50대에서 100세 가정이면 얼마나 달라지나',
  base({ currentAge: 53, retirementAge: 62, expectancy: 100, monthlySpending: 3_000_000,
    assets: [krEtf(2.5 * 억, { monthlyContribution: 400_000 }), usEtf(2 * 억, { monthlyContribution: 400 })],
    pensions: [irp(1 * 억, 400_000)], npMonthly: 1_500_000 }));
P('50대 중 명퇴', '55세 비자발 은퇴. 국민연금까지 10년',
  base({ currentAge: 54, retirementAge: 55, expectancy: 88, monthlySpending: 3_200_000,
    assets: [krEtf(2 * 억), usEtf(1.8 * 억)],
    pensions: [irp(1.2 * 억, 0), savingsPension(8_000 * 만, 0)], npMonthly: 1_500_000 }));
P('50대 중 명퇴+저자산', '같은 상황인데 자산이 절반이면',
  base({ currentAge: 54, retirementAge: 55, expectancy: 88, monthlySpending: 3_000_000,
    assets: [krEtf(1 * 억)], pensions: [irp(6_000 * 만, 0)], npMonthly: 1_400_000 }));
P('50대 중 임대소득', '월 120만 임대소득이 있는 경우',
  base({ currentAge: 55, retirementAge: 60, expectancy: 90, monthlySpending: 3_500_000,
    assets: [krEtf(1.5 * 억, { monthlyContribution: 300_000 })], pensions: [irp(7_000 * 만, 300_000)],
    npMonthly: 1_300_000, otherMonthly: 1_200_000 }));
P('50대 중 표준+ISA', 'ISA를 늦게 시작한 경우 만기 3년이 은퇴와 겹친다',
  base({ currentAge: 55, retirementAge: 60, expectancy: 88, monthlySpending: 3_500_000,
    assets: [krEtf(2 * 억, { monthlyContribution: 300_000 })],
    pensions: [irp(1 * 억, 400_000)], isaAccounts: [isa(6_000 * 만, 1_600_000)], npMonthly: 1_500_000 }));
P('50대 중 65세 은퇴', '5년 더 일하면 얼마나 좋아지나 (앞 케이스와 대조)',
  base({ currentAge: 55, retirementAge: 65, expectancy: 88, monthlySpending: 3_500_000,
    assets: [krEtf(2 * 억, { monthlyContribution: 500_000 }), usEtf(1.5 * 억, { monthlyContribution: 400 })],
    pensions: [irp(1 * 억, 500_000), savingsPension(7_000 * 만, 400_000)], npMonthly: 1_600_000 }));
P('50대 중 확실 고갈', '누가 봐도 부족한 케이스. 도구가 솔직하게 경고하나',
  base({ currentAge: 56, retirementAge: 60, expectancy: 92, monthlySpending: 4_500_000,
    assets: [krEtf(8_000 * 만)], pensions: [irp(2_000 * 만, 0)], npMonthly: 900_000 }));
P('50대 후 표준', '은퇴 3년 전. 조정 여지가 거의 없는 시점',
  base({ currentAge: 57, retirementAge: 60, expectancy: 88, monthlySpending: 3_500_000,
    assets: [krEtf(2.2 * 억, { monthlyContribution: 400_000 }), usEtf(1.3 * 억, { monthlyContribution: 300 })],
    pensions: [irp(1.3 * 억, 400_000), savingsPension(7_000 * 만, 300_000)], npMonthly: 1_600_000 }));
P('50대 후 보수 전환', '은퇴 직전 보수적 프리셋. 변동성 축소의 대가',
  base({ currentAge: 57, retirementAge: 60, expectancy: 90, monthlySpending: 3_500_000,
    assets: [krEtf(2.2 * 억, { monthlyContribution: 400_000 }), usEtf(1.3 * 억, { monthlyContribution: 300 })],
    pensions: [irp(1.3 * 억, 400_000), savingsPension(7_000 * 만, 300_000)], npMonthly: 1_600_000,
    yieldPreset: 'conservative' }));
P('50대 후 검소', '월 220만. 저지출이 얼마나 강력한 방어인가',
  base({ currentAge: 58, retirementAge: 60, expectancy: 92, monthlySpending: 2_200_000,
    assets: [krEtf(1.5 * 억, { monthlyContribution: 300_000 })], pensions: [irp(8_000 * 만, 300_000)],
    npMonthly: 1_300_000 }));
P('50대 후 의료비+장수', '92세 + 의료비 전면 반영',
  base({ currentAge: 58, retirementAge: 62, expectancy: 95, monthlySpending: 3_000_000,
    assets: [krEtf(2 * 억, { monthlyContribution: 300_000 }), usEtf(1.5 * 억, { monthlyContribution: 300 })],
    pensions: [irp(1.2 * 억, 400_000)], npMonthly: 1_500_000, healthcare: HEALTHCARE_ON }));
P('50대 후 연금만', '자산 없이 국민+사적연금만으로',
  base({ currentAge: 59, retirementAge: 60, expectancy: 88, monthlySpending: 2_500_000,
    assets: [], pensions: [irp(2 * 억, 0), savingsPension(1.5 * 억, 0)], npMonthly: 1_600_000 }));
P('50대 후 국민연금 소액', '가입기간이 짧아 월 60만. 3층 부재의 대가',
  base({ currentAge: 59, retirementAge: 62, expectancy: 88, monthlySpending: 2_800_000,
    assets: [krEtf(2.5 * 억, { monthlyContribution: 300_000 })], npMonthly: 600_000 }));

// ── D. 60대: 인출기 ──
P('60대 초 은퇴 직후', '이미 은퇴. 인출 순서 최적화 여지',
  base({ currentAge: 61, retirementAge: 61, expectancy: 88, monthlySpending: 3_200_000,
    assets: [krEtf(2 * 억), usEtf(1.5 * 억)],
    pensions: [irp(1.5 * 억, 0), savingsPension(8_000 * 만, 0)], npMonthly: 1_600_000 }));
P('60대 초 연금 개시 고민', '국민연금 조기 vs 연기. 도구가 답을 주나',
  base({ currentAge: 61, retirementAge: 61, expectancy: 92, monthlySpending: 3_000_000,
    assets: [krEtf(1.8 * 억)], pensions: [irp(2 * 억, 0)], npMonthly: 1_700_000 }));
P('60대 초 조기수령 필요', '자산이 얇아 60세부터 당겨 받아야 하는 경우',
  base({ currentAge: 62, retirementAge: 62, expectancy: 88, monthlySpending: 2_800_000,
    assets: [krEtf(7_000 * 만)], pensions: [irp(5_000 * 만, 0)], npMonthly: 1_400_000 }));
P('60대 초 사적연금 과다', '연금계좌 4억. 저율과세 한도 초과가 불가피한가',
  base({ currentAge: 62, retirementAge: 62, expectancy: 90, monthlySpending: 4_000_000,
    assets: [krEtf(5_000 * 만)],
    pensions: [irp(2.5 * 억, 0), savingsPension(1.5 * 억, 0)], npMonthly: 1_600_000 }));
P('60대 초 고배당 인출', '배당 4.5% 3.5억. 종합과세 문턱 근처',
  base({ currentAge: 62, retirementAge: 62, expectancy: 90, monthlySpending: 3_200_000,
    assets: [krEtf(3.5 * 억, { dividendYield: 4.5, annualGrowthRate: 2.5, reinvestDividend: false })],
    pensions: [irp(6_000 * 만, 0)], npMonthly: 1_500_000 }));
P('60대 초 달러 인출', 'USD 자산 인출 시 양도세+환율',
  base({ currentAge: 63, retirementAge: 63, expectancy: 90, monthlySpending: 3_000_000,
    assets: [usEtf(3 * 억)], pensions: [irp(8_000 * 만, 0)], npMonthly: 1_500_000 }));
P('60대 중 검소 인출', '월 200만. 자산 1.5억으로 버티나',
  base({ currentAge: 64, retirementAge: 64, expectancy: 90, monthlySpending: 2_000_000,
    assets: [krEtf(1.5 * 억)], pensions: [irp(5_000 * 만, 0)], npMonthly: 1_400_000 }));
P('60대 중 100세 대비', '64세에서 36년을 더 살아야 한다면',
  base({ currentAge: 64, retirementAge: 64, expectancy: 100, monthlySpending: 3_000_000,
    assets: [krEtf(2.5 * 억)], pensions: [irp(1.5 * 억, 0)], npMonthly: 1_600_000 }));
P('60대 중 의료비 직면', '65세 + 의료비 전면. 인출 압력 급증',
  base({ currentAge: 65, retirementAge: 65, expectancy: 92, monthlySpending: 2_800_000,
    assets: [krEtf(2 * 억)], pensions: [irp(1.2 * 억, 0)], npMonthly: 1_600_000,
    healthcare: HEALTHCARE_ON }));
P('60대 중 상속 우선', '2억은 반드시 남긴다는 제약',
  base({ currentAge: 65, retirementAge: 65, expectancy: 90, monthlySpending: 2_800_000,
    assets: [krEtf(2.5 * 억)], pensions: [irp(1 * 억, 0)], npMonthly: 1_600_000,
    targetBequest: 2 * 억 }));
P('60대 후 인출 후반', '68세. 남은 기간이 짧을 때의 조언',
  base({ currentAge: 68, retirementAge: 68, expectancy: 90, monthlySpending: 2_800_000,
    assets: [krEtf(1.5 * 억)], pensions: [irp(8_000 * 만, 0)], npMonthly: 1_700_000 }));
P('60대 후 고물가 가정', '물가 4%. 실질 기준에서 자산이 녹는 속도',
  base({ currentAge: 66, retirementAge: 66, expectancy: 90, monthlySpending: 3_000_000,
    assets: [krEtf(2 * 억)], pensions: [irp(1.2 * 억, 0)], npMonthly: 1_600_000,
    inflationRate: 4.0 }));

export const PERSONAS: readonly Persona[] = personas;
