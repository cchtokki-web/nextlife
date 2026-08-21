import { MonteCarloResult } from '../../entities/montecarlo';
import { ECONOMIC_SCENARIO_LABELS, isEconomicScenarioGoverning } from '../scenario/economicScenarios';
import { RISK_PROFILE_LABELS, resolveRiskProfileYieldPreset } from '../strategy/compileStrategy';

// **몬테카를로 결과의 가정 공시 문구를 만드는 단일 출처.**
//
// 화면(MonteCarloSection)과 PDF(pdfReportSections)가 같은 문장을 인쇄해야 한다. 두 벌로
// 두었던 대가를 이미 치렀다: 사적연금 충격 배율이 생겼을 때 두 곳이 «동시에» 「모든
// 위험자산이 같은 시장 충격을 공유」라고 말하는 거짓이 됐고, 어느 쪽도 오류를 내지 않았다.
// 배율이 계좌별로 유도되면서 그 문장은 두 번째로 거짓이 됐다 — 같은 자리가 두 번 썩었다.
//
// 문구를 core에 두는 것이 UI/계산 분리 원칙과 어긋나 보일 수 있지만, 여기서 만드는 것은
// 레이아웃이 아니라 **결과가 무엇을 전제했는가에 대한 서술**이다. 그 서술의 근거(지배
// 여부 판정, 배율)는 전부 core에 있고, 표시 계층으로 옮기면 그 판정 규칙이 화면마다
// 복제된다 — resolveRiskProfileYieldPreset 주석이 경고하는 바로 그 복제다.

// 화면에 이 필드들이 없던 시절의 직렬화된 결과가 남아 있다. 그때 화면이 인쇄하던 값이
// 15%p였으므로 같은 값으로 되돌린다(숫자를 새로 만들지 않는다).
const LEGACY_DISPLAY_STD_DEV = 15;

export interface MonteCarloAssumptionCopy {
  // 「계산 가정: …」으로 인쇄되는 한 줄.
  calculation: string;
  // 미정으로 남긴 가정 축이 있을 때만 있는 한 줄. 없으면 null.
  robustness: string | null;
}

export function describeMonteCarloAssumptions(
  monteCarlo: Pick<MonteCarloResult, 'annualStdDev' | 'seed' | 'assumptions'>
): MonteCarloAssumptionCopy {
  const stdDev = monteCarlo.annualStdDev ?? LEGACY_DISPLAY_STD_DEV;
  const { assumptions } = monteCarlo;

  const parts = [`연 변동성 ${stdDev}%p`];

  parts.push('정규분포');
  // 「모든 위험자산이 같은 시장 충격을 공유」→「주식·ISA는 같은 시장 충격을 공유」였던
  // 자리다. 두 문장 모두 배율이 바뀔 때마다 거짓이 됐다
  // (describeAssumptions.test.ts가 회귀를 막는다).
  //
  // 이제는 계좌마다 배율이 다르고 그 값이 포트폴리오 구성에 따라 달라지므로, 숫자 하나를
  // 인쇄하는 대신 «규칙»을 적는다. 규칙은 결과가 아니라 엔진의 속성이라 assumptions가
  // 없을 때도 참이다.
  parts.push('계좌별 충격은 기대수익률에 비례');

  if (assumptions) parts.push(describeWorld(assumptions));
  parts.push(`고정 시드 ${monteCarlo.seed}`);

  return {
    calculation: parts.join(' · '),
    robustness: describeRobustness(assumptions),
  };
}

// 0.5714285714… → '0.57'. 배율은 유도값이라 자릿수를 늘려도 사용자가 쓸 수 있는 정보가
// 늘지 않는다.

// 이 확률이 «어떤 세계»에서 나왔는지. 두 축 각각이 사용자 입력을 덮었는지로 판정하며,
// 그 판정은 엔진이 쓰는 함수를 그대로 쓴다 — 규칙을 여기서 다시 쓰면 화면과 엔진이
// 어긋난다(compileStrategy가 실제로 그 어긋남을 겪었다).
function describeWorld(assumptions: NonNullable<MonteCarloResult['assumptions']>): string {
  const governing: string[] = [];

  if (isEconomicScenarioGoverning(assumptions.economicScenario)) {
    governing.push(`「${ECONOMIC_SCENARIO_LABELS[assumptions.economicScenario]}」 국면의 물가·환율`);
  }
  if (resolveRiskProfileYieldPreset(assumptions.riskProfile) !== null) {
    governing.push(`「${RISK_PROFILE_LABELS[assumptions.riskProfile]}」 수익률`);
  }

  // 덮은 축이 하나도 없으면 사용자가 넣은 값 그대로 계산한 것이다. 'custom'(자산별 직접
  // 입력)도 여기에 해당한다 — 프리셋이 아니라 사용자의 값이므로.
  return governing.length > 0 ? governing.join(' · ') : '입력하신 물가·수익률 가정 그대로';
}

// 미정으로 남긴 축이 있으면 강건성 비교가 돈다(robustness.ts). 그 비교는 **어느 인출
// 계획을 추천할지** 고르는 데만 쓰이고, 위에 인쇄된 확률은 사용자 가정 하나로 계산한
// 값이다. 밝히지 않으면 설정 화면의 「네 가지 경기 국면 모두에서 견디는 인출 계획을
// 고릅니다」를 읽은 사용자가 그 확률을 4국면 검증의 산물로 읽는다.
function describeRobustness(
  assumptions: MonteCarloResult['assumptions']
): string | null {
  if (!assumptions) return null;

  const undecided = assumptions.economicScenario === 'ai_recommended'
    || assumptions.riskProfile === 'ai_recommended';
  if (!undecided) return null;

  return '미정으로 두신 가정은 여러 경기 국면·수익률에서 비교했지만, 그 비교는 어느 인출 계획을 '
    + '추천할지 고르는 데만 쓰였습니다. 위 확률은 입력하신 가정 하나로 계산한 값입니다.';
}
