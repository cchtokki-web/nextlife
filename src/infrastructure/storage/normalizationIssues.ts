/**
 * 정제가 «무엇을 바꿨는지» 알아내는 통로.
 *
 * normalizeSimulationParams는 깨진 값을 조용히 대체한다. 그 자체는 옳다 — 시나리오를 통째로
 * 버리는 것보다 낫고, 사용자는 화면에서 고칠 수 있다. 문제는 «조용히»다. 통화를 읽지 못해
 * USD 자산이 KRW로 읽히면 평가액이 1/1350이 되고, 수량이 문자열이면 0이 된다. 두 경우 모두
 * 계좌는 화면에 그대로 남아 있어 아무것도 사라진 것처럼 보이지 않는다. 달라지는 것은 은퇴
 * 시점, 고갈 나이, 추천 전략 — 사용자가 그대로 믿는 숫자뿐이다.
 *
 * **수집 방식이 정제기에 붙어 있지 않은 것이 핵심이다.** 검증 함수마다 수집기를 넘기는 방식은
 * 새 필드를 추가하면서 보고를 빠뜨리기 쉽고, 그러면 「문제 없음」이 거짓말이 된다. 대신 정제
 * 전후를 구조적으로 비교한다 — 값이 달라졌다는 사실은 정제기의 협조 없이도 관측되므로,
 * 필드가 늘어도 따라올 것이 없다.
 *
 * 다만 이 방식은 «왜» 바뀌었는지 모른다. 그래서 reason은 두 값의 «모양»에서 추론한다.
 */
export type NormalizationReason =
  | 'not_a_number'   // 숫자여야 하는데 문자열·NaN·null이었다
  | 'unknown_enum'   // 유니온에 없는 문자열이었다(통화·계좌 종류 등)
  | 'not_an_array'   // 배열이어야 하는데 아니었다 — 목록 전체가 비워진다
  | 'dropped_items'  // 배열의 일부 원소가 객체가 아니라 버려졌다
  | 'not_an_object'  // 객체여야 하는데 아니었다
  | 'generated'      // 없던 값을 만들어 냈다(id 등)
  | 'replaced';      // 그 밖의 대체

/**
 * financial은 «계산 결과를 바꾸는» 값이다 — 금액, 수량, 통화, 나이, 비율.
 * cosmetic은 이름·id처럼 숫자에 닿지 않는 값이다.
 */
export type NormalizationSeverity = 'financial' | 'cosmetic';

export interface NormalizationIssue {
  /** `assets[1].currency` 꼴. 사용자에게 어디를 고쳐야 하는지 말할 수 있어야 한다. */
  path: string;
  reason: NormalizationReason;
  original: unknown;
  replacedWith: unknown;
  severity: NormalizationSeverity;
}

/** 이 이름으로 끝나는 경로는 금액·수량·통화·나이·비율이다. 하나라도 틀리면 숫자가 달라진다. */
const FINANCIAL_LEAVES = new Set([
  'quantity', 'averagePrice', 'balance', 'monthlyContribution', 'contributionAmount',
  'acquisitionCostBasis', 'totalReturn', 'dividendYield',
  'monthlyAmount', 'expectedMonthlyAmount', 'targetMonthlySpending', 'targetBequest',
  'currency', 'displayCurrency', 'baseExchangeRate', 'inflationRate', 'inflationMode',
  'currentAge', 'retirementAge', 'expectancy', 'maturityYears',
  'assetFloor', 'cashYieldRate', 'targetValue', 'priority',
  'type', 'spendingStrategy', 'exchangeScenario', 'yieldPreset',
]);

function leafName(path: string): string {
  const afterDot = path.slice(path.lastIndexOf('.') + 1);
  // `assets[1]`처럼 인덱스로 끝나면 그 앞의 이름이 필드다.
  return afterDot.replace(/\[\d+\]$/, '');
}

function severityOf(path: string): NormalizationSeverity {
  return FINANCIAL_LEAVES.has(leafName(path)) ? 'financial' : 'cosmetic';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reasonFor(original: unknown, replacedWith: unknown): NormalizationReason {
  if (original === undefined) return 'generated';
  if (typeof replacedWith === 'number') return 'not_a_number';
  if (typeof replacedWith === 'string' || replacedWith === undefined) return 'unknown_enum';
  return 'replaced';
}

/**
 * 정제 전(raw)과 후(normalized)를 비교해 달라진 지점을 모은다.
 *
 * 정제 결과의 «모양»을 따라 걷는다. raw에만 있고 결과에 없는 키는 보지 않는데, 그것이 곧
 * 원칙 3(모르는 키는 그대로 실어 보낸다)이라 애초에 사라지지 않기 때문이다.
 */
export function collectNormalizationIssues(raw: unknown, normalized: unknown): NormalizationIssue[] {
  const issues: NormalizationIssue[] = [];

  // 최상위가 객체가 아니면 시나리오 전체가 기본값으로 갈린다. 필드별로 쪼개 보고하면
  // 수백 건이 쏟아져 정작 「계획이 통째로 사라졌다」는 사실이 묻힌다.
  if (!isRecord(raw)) {
    return [{
      path: '', reason: 'not_an_object', original: raw,
      replacedWith: '기본 시나리오', severity: 'financial',
    }];
  }

  walk(raw, normalized, '', issues);
  return issues;
}

function walk(raw: unknown, normalized: unknown, path: string, out: NormalizationIssue[]): void {
  if (Array.isArray(normalized)) {
    if (!Array.isArray(raw)) {
      out.push({
        path, reason: 'not_an_array', original: raw, replacedWith: [],
        // 목록이 통째로 비는 것은 언제나 금액 문제다 — 자산·연금·소득이 사라진다.
        severity: 'financial',
      });
      return;
    }
    if (raw.length !== normalized.length) {
      out.push({
        path, reason: 'dropped_items', original: `${raw.length}건`,
        replacedWith: `${normalized.length}건`, severity: 'financial',
      });
    }
    normalized.forEach((item, index) => walk(raw[index], item, `${path}[${index}]`, out));
    return;
  }

  if (isRecord(normalized)) {
    if (!isRecord(raw)) {
      // raw가 없을 뿐인 경우(선택 구조를 새로 만든 것)는 보고하지 않는다 — 원칙 4 이후로
      // 없던 키는 만들지 않으므로, 여기 걸리는 것은 «모양이 틀렸다»는 뜻이다.
      if (raw !== undefined) {
        out.push({ path, reason: 'not_an_object', original: raw, replacedWith: normalized, severity: severityOf(path) });
      }
      return;
    }
    for (const [key, value] of Object.entries(normalized)) {
      walk(raw[key], value, path ? `${path}.${key}` : key, out);
    }
    return;
  }

  if (raw === normalized) return;
  // NaN은 자기 자신과 같지 않다. 「NaN → 0」은 실제 변경이지만 「NaN → NaN」은 아니다.
  if (typeof raw === 'number' && typeof normalized === 'number'
    && Number.isNaN(raw) && Number.isNaN(normalized)) return;
  if (raw === undefined && normalized === undefined) return;

  out.push({
    path, reason: reasonFor(raw, normalized), original: raw,
    replacedWith: normalized, severity: severityOf(path),
  });
}

/** 계산 결과를 바꾸는 문제만 추린다. 로드 경계가 사용자에게 알릴지 판단하는 기준이다. */
export function financialIssues(issues: readonly NormalizationIssue[]): NormalizationIssue[] {
  return issues.filter((issue) => issue.severity === 'financial');
}

/** 콘솔 한 줄로 읽히는 요약. 사용자 화면이 아니라 «진단»을 위한 것이다. */
export function describeIssue(issue: NormalizationIssue): string {
  const where = issue.path || '(시나리오 전체)';
  return `${where}: ${JSON.stringify(issue.original)} → ${JSON.stringify(issue.replacedWith)} [${issue.reason}]`;
}
