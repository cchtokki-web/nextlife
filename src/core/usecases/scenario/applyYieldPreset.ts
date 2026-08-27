import { CustomYieldSnapshot, SimulationParams } from '../../entities/types';

// 리스크 성향별 연 기대수익률. **단위는 %** (0.05가 아니라 5), 자산의 totalReturn와
// 사적연금 expectedReturn에 그대로 대입된다.
//
// **출처(git 이력 추적 결과)**: 근거 문서는 이 저장소에 없다. 확인된 것은 변경 이력뿐이다.
//   - 최초 커밋 5eaff3e: ScenarioSelector.tsx에 conservative 5/3, base 8/5, aggressive 12/8.
//   - 8a08aff "투자성향 프리셋 적용 로직을 순수 함수(applyYieldPreset)로 추출"(2026-07-25):
//     순수 추출을 표방했으나 실제로는 base 8/5 → 7/4, aggressive 12/8 → 9/6으로 **값을 함께
//     낮췄다.** 커밋 메시지에 근거 설명이 없다. conservative(5/3)만 최초값 그대로다.
// 즉 현재 base·aggressive 값의 근거는 기록된 적이 없다. 임의로 다시 바꾸지 말고, 근거를 아는
// 사람이 여기에 출처를 남길 것. 바꿔야 한다면 그때는 반드시 근거를 함께 적는다.
//
// **명목/실질**: 명목 수익률이다. inflationMode가 'real'이면 엔진이 inflationRate를 별도로
// 차감하므로, 이 값 자체를 실질로 바꾸면 물가가 두 번 반영된다.
//
// 프리셋을 적용하면 배당률도 «같은 비율로» 함께 옮겨진다(applyToMarketAccount 주석).
// 총수익률만 덮으면 배당률이 총수익률을 넘겨 가격상승률이 음수가 되는 조합을 프리셋이
// 지어내게 되고, 그것은 이 표의 세 값이 약속하는 세계가 아니다.
//
// 이 상수는 applyYieldPreset 외에 volatilityPresets의 volatilityForStockReturn도 소비한다 —
// 프리셋 수익률과 프리셋 변동성을 잇는 직선의 양 끝 앵커다. 값을 바꾸면 몬테카를로 σ도 함께
// 움직인다. (2026-08-22부터 StrategyGenerator는 이 표를 쓰지 않는다 — 추천 후보는 사용자가
// 입력한 수익률 가정을 그대로 물려받는다.) computeSensitivityAnalysis의 수익률 축(안정형/
// 중립형/공격형 3행)도 이 표를 소비한다 — 계획을 바꾸지 않고 결과만 비교하는 렌즈다.
export const YIELD_PRESET_RATES = {
  conservative: { stockGrowth: 5, pensionReturn: 3 },
  base: { stockGrowth: 7, pensionReturn: 4 },
  aggressive: { stockGrowth: 9, pensionReturn: 6 },
} as const;

// 구 설정 UI(시뮬레이션 설정/핵심 설정 카드)에 있던 "시장 수익률 프리셋 적용" 로직을 순수
// 함수로 추출한 것. 그 UI들은 제거되었다. compileStrategy가 계산 시점에 이 함수를 부르던
// 경로도 이후 제거되었다 — 프리셋이 계산을 지배하지 않도록 하기 위해서다. 지금 이 함수를
// 부르는 곳은 셋이다.
//   - YieldPresetHelper.tsx: 입력 도우미. 사용자가 프리셋 버튼을 누르면 이 함수가 반환한
//     값을 그대로 저장값(SimulationParams)에 써서, 입력칸에 값이 찍히고 보이고 고칠 수 있다.
//   - computeSensitivityAnalysis의 수익률 축 3행(안정형/중립형/공격형): 계획은 그대로 두고
//     결과만 비교하는 렌즈이므로 계산용 사본에만 적용한다.
//   - robustness.ts의 가정 변형(assumption variants): 몬테카를로 강건성 점검에 쓰는 사본.
//
// restoreCustomYieldPreset은 프리셋 버튼과 함께 사라졌던 "사용자 프리셋 복원" 동작을 위한
// 것이다. YieldPresetHelper의 「사용자 입력값」 버튼이 그 되돌릴 UI다 — 스냅샷이
// 있을 때만 나타나 이 함수를 부른다.
//
// assets/privatePensions를 ?? []로 방어하는 이유: 이 함수를 호출하는 쪽(page.tsx가 넘기는
// activeParams)이 과거 시나리오 데이터라서 최신 필드를 다 갖추지 못했을 가능성이 있다 —
// AssetFormSection.tsx/DashboardSection.tsx가 이미 쓰고 있는 방어적 기본값 관례와 동일하다.
//
// yieldPreset이 'custom'인 상태(자산별 직접입력)에서 다른 프리셋을 적용하면 직접입력 값이
// 사라지므로, 덮어쓰기 직전의 값을 customYieldSnapshot에 보관해 둔다 — restoreCustomYieldPreset이
// 이 스냅샷으로 되돌린다. customYieldSnapshot이 아직 없는 경우(저장된 기본값 'base' 등 프리셋
// 상태로 시작해 한 번도 직접입력을 거치지 않은 params 포함)에도 지금 값이 사용자가 마지막으로
// 본 값이므로 최초 1회는 반드시 캡처한다 — 그래야 되돌리기 버튼이 나타난다. 이미 스냅샷이 있는
// 상태에서 다른 프리셋으로 바꾸는 경우(프리셋→프리셋)는 되돌릴 직접입력 값이 새로 생기지 않으므로
// 기존 스냅샷(더 이전의 직접입력 값)을 덮어쓰지 않고 그대로 유지한다. 즉 "첫 캡처가 이긴다."
export function applyYieldPreset(
  params: SimulationParams,
  preset: 'conservative' | 'base' | 'aggressive'
): SimulationParams {
  const { stockGrowth, pensionReturn } = YIELD_PRESET_RATES[preset];

  const customYieldSnapshot =
    params.yieldPreset === 'custom' || params.customYieldSnapshot === undefined
      ? captureCustomYieldSnapshot(params)
      : params.customYieldSnapshot;

  // ISA도 totalReturn을 가진 시장 연동 계좌이므로 주식과 같은 값으로 맞춘다 —
  // 여기서만 빼두면 "보수적"을 골라도 ISA 홀로 높은 수익률을 유지해 계좌 간 서열이
  // 프리셋이 아니라 사용자 입력값으로 결정된다(economicScenarios.ts의 같은 판단 참조).
  // 키가 없는 옛 시나리오 데이터에 빈 배열을 새로 심지 않도록 있을 때만 교체한다.
  const isaAccounts = params.isaAccounts?.map((i) => applyToMarketAccount(i, stockGrowth));

  return {
    ...params,
    assets: (params.assets ?? []).map((a) => applyToMarketAccount(a, stockGrowth)),
    // **사적연금은 분해하지 않는다.** 연금 계좌 안에서는 배당세도 재투자 선택지도 없어
    // 총수익률만이 결과를 결정한다(decomposeReturn.ts의 명시적 규약). 그래서 배당률을
    // 함께 옮길 대상이 아니다.
    privatePensions: (params.privatePensions ?? []).map((p) => ({ ...p, totalReturn: pensionReturn })),
    ...(isaAccounts ? { isaAccounts } : {}),
    yieldPreset: preset,
    customYieldSnapshot,
  };
}

/**
 * 지금 저장된 수익률이 «어느 프리셋의 값과 같은가». 어느 것과도 같지 않으면 undefined다.
 *
 * **params.yieldPreset을 읽지 «않는다».** 그 필드는 「마지막으로 프리셋을 적용한 뒤 수익률
 * 관련 입력이 건드려지지 않았는가」에 가깝지, 「지금 값이 무엇인가」가 아니다. 둘은 양쪽으로
 * 어긋난다 — 자산·연금을 «삭제»하거나 티커 자동조회가 값을 채우기만 해도 'custom'으로
 * 떨어지고(AssetFormSection), 반대로 배당률만 고치면 프리셋 키가 그대로 남는다. 무엇보다
 * 저장 계층이 키 없는 시나리오에 'base'를 채워 넣으므로(normalizeSimulationParams →
 * optionalOneOf(initialParams.yieldPreset)), 그 필드를 그대로 믿으면 «누른 적 없는» 프리셋이
 * 선택된 것처럼 보인다. resolveMonteCarloConfig가 같은 이유로 이미 실제 수익률에서 유도하는
 * 쪽을 택했다(volatilityPresets.ts) — 여기서도 같은 판단을 따른다.
 *
 * 비교 대상은 applyYieldPreset이 «쓰는» 것과 정확히 같다 — 일반자산·ISA의 totalReturn은
 * stockGrowth, 사적연금의 totalReturn은 pensionReturn. 배당률은 보지 않는다. 프리셋이
 * 약속하는 것(버튼 title)은 총수익률뿐이고, 배당률은 계좌마다 «비율»로 옮겨져 원래 값에
 * 의존하므로 되짚을 수 있는 값이 아니다.
 *
 * 비교할 계좌가 하나도 없으면 undefined다. 그 경우 모든 프리셋이 공허하게 참이 되어
 * 「어느 것이든 맞다」가 되는데, 그것은 「무엇이 선택됐는지」에 대한 답이 아니다.
 */
export function matchedYieldPreset(
  params: SimulationParams
): 'conservative' | 'base' | 'aggressive' | undefined {
  const marketReturns = [
    ...(params.assets ?? []),
    ...(params.isaAccounts ?? []),
  ].map((account) => account.totalReturn);
  const pensionReturns = (params.privatePensions ?? []).map((pension) => pension.totalReturn);

  if (marketReturns.length === 0 && pensionReturns.length === 0) return undefined;

  return (Object.keys(YIELD_PRESET_RATES) as (keyof typeof YIELD_PRESET_RATES)[]).find((preset) => {
    const { stockGrowth, pensionReturn } = YIELD_PRESET_RATES[preset];
    return marketReturns.every((rate) => rate === stockGrowth)
      && pensionReturns.every((rate) => rate === pensionReturn);
  });
}

/**
 * 시장 연동 계좌(일반자산·ISA) 하나에 프리셋 수익률을 적용한다.
 *
 * **배당률을 «같은 비율로» 함께 옮긴다.** 예전에는 totalReturn만 덮고 dividendYield는 그대로
 * 두었는데, 그러면 프리셋이 «존재하지 않는 상품»을 만들어 낸다. 총수익률 13% / 배당률 10%인
 * 커버드콜에 중립형(7%)을 얹으면 가격상승률이 `7 − 10 = −3%`가 되어(decomposeReturn.ts)
 * 원금이 해마다 녹는다. 그것은 「시장이 7% 수익률이라면」이 아니라 「이 상품이 평생 버는 것보다
 * 많이 분배한다면」이고, 프리셋 라벨이 약속한 것과 다른 세계다.
 *
 * 실제로 민감도 분석에서 이 절벽이 드러났다 — 기준 기말자산이 14.58억인 계획에서 중립형(7%)이
 * 851만원으로 무너졌다. 수익률을 낮췄으니 결과가 나빠지는 것은 맞지만, 그 폭은 배분 변화가
 * 아니라 배당률이 총수익률을 넘긴 데서 나온 비선형 붕괴였다.
 *
 * **decomposeReturn.priceGrowthRate는 바꾸지 않는다.** 그 함수가 음수를 그대로 돌려주는 것은
 * 의도된 동작이다 — 분배금이 총수익을 넘어 NAV가 줄어드는 상품이 실제로 존재하고, 사용자가
 * 그렇게 «입력했다면» 그대로 계산해야 한다. 고치는 것은 그런 조합을 «프리셋이 지어내는» 것뿐이다.
 *
 * 비례 배분이라 배당 비중(dividendYield / totalReturn)이 보존되고, 따라서 가격상승률의 부호도
 * 보존된다. 원래 음수였던 계좌는 프리셋 적용 후에도 음수로 남는다 — 사용자가 입력한 상품의
 * 성격을 프리셋이 바꾸지 않는다는 뜻이다.
 *
 * totalReturn이 0 이하이면 비율을 낼 수 없다(0으로 나누거나 부호가 뒤집힌다). 그때는 배당률을
 * 새 총수익률로 잘라 «최소한» 가격상승률이 음수가 되지 않게만 한다.
 */
function applyToMarketAccount<T extends { totalReturn: number; dividendYield: number }>(
  account: T,
  totalReturn: number
): T {
  return {
    ...account,
    totalReturn,
    dividendYield: account.totalReturn > 0
      ? account.dividendYield * (totalReturn / account.totalReturn)
      : Math.min(account.dividendYield, totalReturn),
  };
}

function captureCustomYieldSnapshot(params: SimulationParams): CustomYieldSnapshot {
  return {
    assets: Object.fromEntries((params.assets ?? []).map((a) => [a.id, a.totalReturn])),
    privatePensions: Object.fromEntries((params.privatePensions ?? []).map((p) => [p.id, p.totalReturn])),
    isaAccounts: Object.fromEntries((params.isaAccounts ?? []).map((i) => [i.id, i.totalReturn])),
  };
}

// "사용자 프리셋" 재선택 시 마지막으로 저장된 직접입력 값(customYieldSnapshot)으로 복원한다.
// 스냅샷이 아직 없으면(직접입력 후 프리셋으로 전환한 적이 없는 경우) 되돌릴 값이 없으므로
// yieldPreset만 'custom'으로 맞추고 현재 값은 그대로 둔다.
export function restoreCustomYieldPreset(params: SimulationParams): SimulationParams {
  const snapshot = params.customYieldSnapshot;
  if (!snapshot) {
    return { ...params, yieldPreset: 'custom' };
  }

  // isaAccounts는 이 필드가 추가되기 전에 저장된 스냅샷에는 없다. 그런 스냅샷으로도
  // 복원이 터지지 않도록 빈 맵으로 방어한다(그 경우 ISA는 현재 값을 유지한다).
  const isaSnapshot = snapshot.isaAccounts ?? {};
  const isaAccounts = params.isaAccounts?.map((i) =>
    i.id in isaSnapshot ? { ...i, totalReturn: isaSnapshot[i.id] } : i
  );

  return {
    ...params,
    assets: (params.assets ?? []).map((a) => (a.id in snapshot.assets ? { ...a, totalReturn: snapshot.assets[a.id] } : a)),
    privatePensions: (params.privatePensions ?? []).map((p) =>
      p.id in snapshot.privatePensions ? { ...p, totalReturn: snapshot.privatePensions[p.id] } : p
    ),
    ...(isaAccounts ? { isaAccounts } : {}),
    yieldPreset: 'custom',
  };
}

/**
 * 지금 저장된 수익률이 «마지막으로 직접 입력한 값»(customYieldSnapshot)과 같은가.
 *
 * 프리셋 셋과 «같은 규칙»이다(matchedYieldPreset) — params.yieldPreset 필드가 아니라 실제
 * 값에서 유도한다. 「사용자 입력값」 버튼이 켜져 있으면 입력칸의 총수익률이 정말 스냅샷의
 * 값이고, 사용자가 하나라도 고치면 그 순간 꺼진다.
 *
 * 비교 대상은 restoreCustomYieldPreset이 «되돌리는» 것과 정확히 같다 — 스냅샷에 id가 있는
 * 계좌의 totalReturn뿐이다. 스냅샷이 만들어진 뒤에 «추가된» 계좌는 되돌리기가 건드리지
 * 않으므로 여기서도 보지 않는다. 배당률도 보지 않는다(되돌리기가 복원하지 않는다).
 *
 * 되돌릴 수 있는 계좌가 하나도 없으면 false다 — 눌러도 아무것도 바뀌지 않는 상태에서
 * 「이 값이 지금 적용돼 있다」고 말하면 공허하게 참이 되어 답이 되지 못한다(matchedYieldPreset의
 * 빈 목록 판단과 같다).
 */
export function matchesCustomYieldSnapshot(params: SimulationParams): boolean {
  const snapshot = params.customYieldSnapshot;
  if (!snapshot) return false;

  const pairs: [Record<string, number>, { id: string; totalReturn: number }[]][] = [
    [snapshot.assets ?? {}, params.assets ?? []],
    [snapshot.privatePensions ?? {}, params.privatePensions ?? []],
    // isaAccounts는 이 필드가 추가되기 전 스냅샷에는 없다(restoreCustomYieldPreset과 같은 방어).
    [snapshot.isaAccounts ?? {}, params.isaAccounts ?? []],
  ];

  let compared = 0;
  for (const [saved, accounts] of pairs) {
    for (const account of accounts) {
      if (!(account.id in saved)) continue;
      if (account.totalReturn !== saved[account.id]) return false;
      compared += 1;
    }
  }

  return compared > 0;
}
