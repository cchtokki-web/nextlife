import { YIELD_PRESET_LABELS, YIELD_PRESET_RATES, matchedYieldPreset } from '../scenario/applyYieldPreset';
import { weightedAverageTotalReturn } from './portfolioReturn';
import type { SimulationParams } from '../../entities/types';

/**
 * 자산별 수익률이 «어디서 왔는가».
 *
 * 지금까지 한 자산의 수익률에 관한 사실은 네 곳에 흩어져 있었다.
 *
 *   - input            `params.assets[i].totalReturn`
 *   - custom snapshot  `params.customYieldSnapshot.assets[id]`
 *   - scenario-adjusted 민감도 3행·robustness 사본 «안»에만 존재
 *   - actually-used    엔진이 실제로 굴린 값
 *
 * 넷을 따로 읽으면 「지금 화면에 찍힌 7%가 사용자가 넣은 값인가, 프리셋 버튼이 덮어쓴
 * 값인가」에 아무도 답할 수 없다. 이 파일이 그 답을 한 구조로 모은다.
 *
 * **새로 «기록»하지 않고 이미 있는 값에서 «유도»한다.** 시나리오는 6자리 보안키 기반
 * E2EE 데이터이고 스키마를 바꾸면 마이그레이션이 따라온다. 그리고 기록으로 바꿔도 이미
 * 저장된 시나리오는 전부 「출처 미상」이 된다 — 유도는 저장된 모든 시나리오에 오늘 바로
 * 답을 준다.
 *
 * **`params.yieldPreset`은 읽지 않는다.** 출처를 답하는 것처럼 생겼지만 저장 계층이 키 없는
 * 시나리오에 'base'를 채워 넣어(normalizeSimulationParams), 누른 적 없는 프리셋이 선택된
 * 것처럼 보인다. matchedYieldPreset과 resolveMonteCarloConfig가 각자 같은 이유로 이 필드를
 * 버렸다. 다만 그 «어긋남 자체»는 사실이므로 storedPresetMisleading으로 드러낸다.
 */

export type YieldPresetKey = 'conservative' | 'base' | 'aggressive';
export type ReturnAccountKind = 'asset' | 'privatePension' | 'isaAccount';

/**
 * 지금 값의 출처로 «주장할 수 있는» 것.
 *
 * 프리셋 값(주식 5/7/9, 연금 3/4/6)은 사용자가 직접 타이핑해도 이상하지 않은 둥근 숫자라,
 * 값이 프리셋과 같다는 사실만으로는 프리셋이 채웠다고 말할 수 없다. 그래서 세 단계다.
 */
export type ReturnOrigin =
  /** 보관된 값과 «다르»면서 프리셋 값과 «같다» — 프리셋이 사용자 값을 덮었다는 강한 증거. */
  | 'preset'
  /**
   * 프리셋 값과 같지만 그것이 프리셋 때문인지 알 수 없다.
   *
   * customYieldSnapshot이 직접입력의 증거가 되지 못하는 것이 이유다 — applyYieldPreset은
   * 스냅샷이 아예 없을 때 «지금 값»을 최초 1회 캡처하므로, 프리셋 상태로 시작해 한 번도
   * 직접입력을 거치지 않은 계획에서는 스냅샷이 프리셋 값을 담는다.
   */
  | 'indeterminate'
  /**
   * 어느 프리셋 값과도 다르다 — 사용자가 넣었거나 티커 자동조회가 채웠다.
   *
   * 그 둘은 «구분할 수 없다». AssetFormSection의 티커 조회는 프리셋과 같은 칸에 쓰면서
   * 아무 표시도 남기지 않는다. 구분하려면 기록이 필요하고, 그것은 저장 스키마 변경이다.
   */
  | 'direct_input';

export interface AccountReturnProvenance {
  id: string;
  kind: ReturnAccountKind;
  /**
   * 지금 저장된 연 총수익률(%).
   *
   * **이 값이 곧 actually-used다.** params와 엔진 사이에서 totalReturn을 다시 쓰는 코드는
   * 없다(applyYieldPreset·restoreCustomYieldPreset은 사용자 동작이거나 계산용 사본이다).
   * 그래서 「입력값」과 「실제 사용값」을 따로 들고 다닐 이유가 없고, 둘을 한 필드로 둔다 —
   * 두 필드로 두면 언젠가 한쪽만 갱신되어 조용히 어긋난다.
   */
  effective: number;
  /** 되돌릴 수 있는 보관값(%). customYieldSnapshot에 이 id가 없으면 null. */
  snapshot: number | null;
  /** effective가 어느 프리셋이 «이 종류의 계좌에» 채우는 값과 같은가. */
  matchesPreset: YieldPresetKey | null;
  origin: ReturnOrigin;
  /** 비교용 사본(민감도 행·robustness 변형)에서 이 계좌가 받은 값(%). 사본이 없으면 null. */
  adjusted: number | null;
}

export interface ReturnProvenance {
  accounts: AccountReturnProvenance[];
  /** 잔액가중 평균 총수익률(%). 굴릴 잔액이 없으면 null. */
  weightedAverage: number | null;
  /** 포트폴리오 «전체»가 한 프리셋과 일치하는가(matchedYieldPreset). */
  portfolioPreset: YieldPresetKey | null;
  /** 저장된 params.yieldPreset. 믿을 값이 아니라 «어긋남을 보이기 위해» 싣는다. */
  storedPreset: SimulationParams['yieldPreset'];
  /**
   * 저장된 yieldPreset이 실제 수익률과 어긋나는가.
   *
   * 참이면 화면이 그 필드를 근거로 무엇을 말하고 있지는 않은지 봐야 한다는 신호다.
   */
  storedPresetMisleading: boolean;
}

const PRESET_KEYS = ['conservative', 'base', 'aggressive'] as const;

// 프리셋이 이 종류의 계좌에 «실제로 쓰는» 값. applyYieldPreset과 같은 분업이어야 한다 —
// 일반자산·ISA는 stockGrowth, 사적연금은 pensionReturn이다. 여기서 갈라지면 프리셋을 누른
// 직후에도 「프리셋과 다르다」고 말하게 된다.
function presetRateFor(kind: ReturnAccountKind, preset: YieldPresetKey): number {
  const rates = YIELD_PRESET_RATES[preset];
  return kind === 'privatePension' ? rates.pensionReturn : rates.stockGrowth;
}

function matchingPreset(kind: ReturnAccountKind, rate: number): YieldPresetKey | null {
  return PRESET_KEYS.find((preset) => presetRateFor(kind, preset) === rate) ?? null;
}

function resolveOrigin(
  matchesPreset: YieldPresetKey | null,
  effective: number,
  snapshot: number | null,
): ReturnOrigin {
  if (matchesPreset === null) return 'direct_input';
  if (snapshot !== null && snapshot !== effective) return 'preset';
  return 'indeterminate';
}

interface AccountRow {
  id: string;
  kind: ReturnAccountKind;
  totalReturn: number;
}

function accountRows(params: SimulationParams): AccountRow[] {
  return [
    ...(params.assets ?? []).map((a) => ({ id: a.id, kind: 'asset' as const, totalReturn: a.totalReturn })),
    ...(params.isaAccounts ?? []).map((i) => ({ id: i.id, kind: 'isaAccount' as const, totalReturn: i.totalReturn })),
    ...(params.privatePensions ?? []).map((p) => ({ id: p.id, kind: 'privatePension' as const, totalReturn: p.totalReturn })),
  ];
}

function snapshotFor(params: SimulationParams, kind: ReturnAccountKind, id: string): number | null {
  const snapshot = params.customYieldSnapshot;
  if (snapshot === undefined) return null;
  const table = kind === 'asset' ? snapshot.assets
    : kind === 'privatePension' ? snapshot.privatePensions
    // ISA가 프리셋 대상에 들어오기 전에 저장된 스냅샷에는 이 키가 없다(CustomYieldSnapshot).
    : snapshot.isaAccounts;
  const value = table?.[id];
  return value === undefined ? null : value;
}

export function resolveReturnProvenance(
  params: SimulationParams,
  options: { adjusted?: SimulationParams } = {},
): ReturnProvenance {
  const adjustedRates = new Map(
    options.adjusted === undefined ? [] : accountRows(options.adjusted).map((r) => [r.id, r.totalReturn]),
  );

  const accounts = accountRows(params).map<AccountReturnProvenance>((row) => {
    const snapshot = snapshotFor(params, row.kind, row.id);
    const matchesPreset = matchingPreset(row.kind, row.totalReturn);
    const adjusted = adjustedRates.get(row.id);
    return {
      id: row.id,
      kind: row.kind,
      effective: row.totalReturn,
      snapshot,
      matchesPreset,
      origin: resolveOrigin(matchesPreset, row.totalReturn, snapshot),
      adjusted: adjusted === undefined ? null : adjusted,
    };
  });

  const portfolioPreset = matchedYieldPreset(params) ?? null;

  return {
    accounts,
    weightedAverage: weightedAverageTotalReturn(params),
    portfolioPreset,
    storedPreset: params.yieldPreset,
    // 저장된 키가 있는데 실제 값이 그 프리셋과 다르면 어긋난 것이다. 실제 값이 어느 프리셋과도
    // 같지 않은 경우(portfolioPreset === null)도 포함한다 — 그때 'base'가 저장돼 있으면
    // 화면은 여전히 「기본값 프리셋」이라고 말할 수 있다.
    storedPresetMisleading:
      params.yieldPreset !== undefined
      && params.yieldPreset !== 'custom'
      && params.yieldPreset !== portfolioPreset,
  };
}

/**
 * 한 계좌의 수익률 출처를 사람이 읽는 한 문장으로. 말할 것이 없으면 null이다.
 *
 * 문구를 core가 소유하는 이유는 formatConfidenceInterval과 같다 — 화면과 리포트가 같은
 * 사실을 각자 다른 말로 하면 사용자는 둘 중 어느 쪽을 믿을지 알 수 없다.
 *
 * **「프리셋 값과 같다」는 사실만으로는 대체로 인쇄하지 않는다.** 프리셋 수익률(5/7/9,
 * 3/4/6)은 사용자가 손으로 넣어도 이상하지 않은 둥근 숫자라, 계좌마다 그 사실을 적으면
 * 프리셋을 한 번도 누른 적 없는 계획의 거의 모든 줄에 주석이 붙는다. 실제로 골든 픽스처
 * (연금 4%, 자산 5%·8%, ISA 5%)에서 네 줄 중 세 줄이 서로 «다른» 프리셋 이름을 달았다 —
 * 포트폴리오 전체는 어느 프리셋과도 맞지 않는데도. 그것은 출처 정보가 아니라 소음이다.
 *
 * 그래서 두 경우에만 말한다.
 *   - origin이 'preset'일 때: 보관된 값과 다르면서 프리셋 값과 같다는 «증거»가 있고,
 *     되돌릴 수 있는 값이 얼마인지가 사용자에게 실제로 쓸모 있다.
 *   - 포트폴리오 «전체»가 같은 프리셋과 일치할 때: 그때는 한 계좌의 우연이 아니라 계획
 *     전체에 대한 진술이라 읽을 값어치가 있다.
 *
 * direct_input에는 아무것도 붙이지 않는다. 「직접 입력한 값입니다」는 티커 자동조회가 채운
 * 경우까지 그렇게 말하게 되고(둘은 구분되지 않는다, ReturnOrigin 주석), 대부분의 계좌가
 * 여기 해당해 모든 줄에 같은 문장이 붙는다.
 */
export function describeReturnOrigin(
  account: AccountReturnProvenance,
  provenance: ReturnProvenance,
): string | null {
  if (account.matchesPreset === null) return null;
  const label = YIELD_PRESET_LABELS[account.matchesPreset];

  if (account.origin === 'preset') {
    return account.snapshot === null
      ? `${label} 프리셋 값입니다.`
      : `${label} 프리셋으로 채워진 값이며, 직접 입력했던 ${account.snapshot}%는 되돌릴 수 있게 보관되어 있습니다.`;
  }

  // indeterminate. 「프리셋으로 설정됨」이라고 «단정하지 않는다» — 사용자가 그 숫자를 직접
  // 넣었을 수도 있고, 그 둘은 저장된 값만으로 구분되지 않는다.
  return provenance.portfolioPreset === account.matchesPreset
    ? `${label} 프리셋과 같은 값입니다.`
    : null;
}
