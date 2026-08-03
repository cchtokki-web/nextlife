import { SimulationYearlyResult } from '../../entities/types';

// 한 해 결과에서 세금·공과금 합계를 구하는 단일 지점.
//
// **새 세금 항목을 SimulationYearlyResult에 추가하면 반드시 여기만 고친다.**
//
// 예전에는 이 합산이 세 곳에 필드 나열로 복제돼 있었다:
//   - UtilityEngine.computeTaxEfficiencyRaw  (효용 점수의 세금효율 축)
//   - strategy/deltas.totalTaxPaid           (추천 전략의 Before/After 비교)
//   - dashboard/computeExpertAnalytics       (전문가 패널의 평균 세부담)
// 새 필드를 추가할 때 셋 중 하나만 빠뜨리면 아무 테스트도 깨지지 않은 채 그 계층만
// 조용히 틀린 숫자를 보여준다. 실제로 세 곳의 목록은 이미 어긋나 있었다 —
// computeExpertAnalytics만 건강보험료를 제외하고 있었는데, 그게 의도인지 누락인지
// 코드만 봐서는 알 수 없었다(아래 taxes/levies 구분이 그 의도를 이름으로 고정한다).

// 결과 타입에서 "…TaxPaid"로 끝나는 모든 필드. 새 세금 항목이 추가되면 이 유니온이 자동으로
// 넓어지고, 아래 목록에 넣지 않으면 컴파일이 깨진다.
type TaxFieldName = Extract<keyof SimulationYearlyResult, `${string}TaxPaid`>;

// 순수 세금 필드 목록.
//
// 손으로 나열하되 누락은 컴파일러가 막는다(아래 ExhaustivenessCheck). 예전에는 목록만
// 있고 강제 장치가 없어서, 양도소득세를 추가했을 때 이 파일을 고치지 않아도 테스트가
// 전부 통과했다 — 런타임 테스트로는 "빠뜨린 필드"를 알 방법이 없었다.
const TAX_FIELDS = [
  'dividendTaxPaid',
  'pensionTaxPaid',
  'nationalPensionTaxPaid',
  'comprehensiveTaxPaid',
  'capitalGainsTaxPaid',
] as const satisfies readonly TaxFieldName[];

// 목록에서 빠진 세금 필드가 있으면 여기서 컴파일 에러가 난다.
// 에러 메시지에 빠진 필드 이름이 그대로 드러난다.
type MissingTaxFields = Exclude<TaxFieldName, (typeof TAX_FIELDS)[number]>;
type ExhaustivenessCheck = MissingTaxFields extends never
  ? true
  : ['TAX_FIELDS에 빠진 세금 필드가 있습니다', MissingTaxFields];
const _taxFieldsAreExhaustive: ExhaustivenessCheck = true;
void _taxFieldsAreExhaustive;

// 순수 세금. 건강보험료는 포함하지 않는다.
//
// 화면에서 "세금"과 "건강보험료"를 나눠 보여주는 곳(전문가 분석 패널)이 쓴다.
// 건보료는 세법상 조세가 아니라 사회보험료이고, 사용자도 급여명세서에서 둘을 나눠 보므로
// 이 구분 자체는 유지할 값어치가 있다.
export function sumYearTaxes(year: SimulationYearlyResult): number {
  return TAX_FIELDS.reduce((total, field) => total + year[field], 0);
}

// 세금 + 건강보험료. "내 소득에서 실제로 빠져나간 총 공적 부담"이다.
//
// 세부담 비율을 계산하는 곳(효용 점수, 전략 비교)은 반드시 이쪽을 써야 한다 —
// 건보료를 빼면 연금 인출을 늘려 건보료를 키우는 계획이 "세금이 안 늘었다"로 채점된다.
export function sumYearTaxesAndLevies(year: SimulationYearlyResult): number {
  return sumYearTaxes(year) + year.healthInsurancePaid;
}

// 전 기간 합계. 위 두 함수와 같은 이유로 순회 로직도 한 곳에 둔다.
export function sumTotalTaxesAndLevies(yearlyResults: readonly SimulationYearlyResult[]): number {
  return yearlyResults.reduce((total, year) => total + sumYearTaxesAndLevies(year), 0);
}
