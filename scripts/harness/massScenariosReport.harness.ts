// 대량 시나리오 집계·보고서. massScenarios.harness.ts가 남긴 샤드 JSONL을 읽어 CSV 하나와
// 마크다운 보고서 하나로 만든다.
//
// **실행과 집계를 분리한 이유**: 1,000건은 한 프로세스로 45분이라 샤딩해야 하는데, 그러면
// 어느 샤드도 전체를 보지 못한다. 집계를 실행 안에 두면 샤드 수를 바꿀 때마다 요약이
// 달라진다 — 그것은 측정이 아니라 우연이다.
//
// 여기 있는 「관찰」은 판정이 아니라 «세어 본 것»이다. 각 절의 물음은 제품 계약
// (AGENTS.md의 현행 제품 계약)에서 왔고, 답이 계약과 어긋나는 자리만 보고서가 이름을 붙인다.
import { test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const IN_DIR = process.env.HARNESS_OUT ?? path.join(process.cwd(), 'scripts/harness/out/mass');
const 만 = 10_000;
const 억 = 100_000_000;

// meta의 boolean(사적연금 보유 등)이 그대로 실려 오므로 셋을 다 받는다.
type Row = Record<string, string | number | boolean>;

const num = (row: Row, key: string): number => {
  const value = row[key];
  return typeof value === 'number' ? value : Number(value);
};
const str = (row: Row, key: string): string => String(row[key] ?? '');
const has = (row: Row, key: string): boolean => row[key] !== '' && row[key] !== undefined;

function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function mean(values: number[]): number {
  return values.length === 0 ? NaN : values.reduce((s, v) => s + v, 0) / values.length;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let cov = 0; let va = 0; let vb = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va === 0 || vb === 0 ? 0 : cov / Math.sqrt(va * vb);
}

/** 빈도표. 많이 나온 순으로 정렬한다. */
function tally(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const pct = (part: number, total: number) => total === 0 ? '0.0%' : `${((part / total) * 100).toFixed(1)}%`;
const 억원 = (v: number) => `${(v / 억).toFixed(2)}억`;
const 만원 = (v: number) => `${Math.round(v / 만).toLocaleString()}만원`;

function mdTable(headers: string[], rows: Array<Array<string | number>>): string[] {
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ];
}

/** 분위수 한 줄. 분포를 평균 하나로 접지 않기 위해 어디서나 이 형태로 낸다. */
function distRow(label: string, values: number[], format: (v: number) => string): Array<string | number> {
  return [
    label, values.length,
    format(quantile(values, 0.1)), format(quantile(values, 0.25)), format(quantile(values, 0.5)),
    format(quantile(values, 0.75)), format(quantile(values, 0.9)),
  ];
}

test('대량 시나리오 집계', { timeout: 600_000 }, () => {
  // shard-*.jsonl «만» 읽는다. 같은 디렉터리에 goal-evaluations.jsonl(다른 행 모양)이
  // 함께 놓이므로, 확장자로 고르면 목표 행이 시나리오 행으로 섞여 분모가 오염된다.
  const files = fs.readdirSync(IN_DIR).filter((f) => /^shard-\d+\.jsonl$/.test(f)).sort();
  if (files.length === 0) throw new Error(`샤드 JSONL이 없다: ${IN_DIR}`);

  const rows: Row[] = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(IN_DIR, file), 'utf-8');
    for (const line of text.split('\n')) {
      if (line.trim() !== '') rows.push(JSON.parse(line) as Row);
    }
  }
  rows.sort((a, b) => num(a, 'no') - num(b, 'no'));

  const total = rows.length;
  const ok = rows.filter((r) => num(r, 'ok') === 1);
  const failed = rows.filter((r) => num(r, 'ok') !== 1);

  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);

  push(
    '# 대량 시나리오 시뮬레이션 보고서',
    '',
    `- 시나리오: **${total}건** (계산 성공 ${ok.length}건 / 실패 ${failed.length}건)`,
    `- 생성 시드: massScenarios.ts의 MASS_SCENARIO_SEED (고정 — 같은 코드는 같은 표본을 만든다)`,
    '- 실행 경로: `compileStrategy → LegacyRecommendationEngine → applyAiSentinels → simulateLegacyConfig / runMonteCarlo / StrategyOptimizer`',
    '  (화면 파이프라인 `useStrategyPipeline` + `strategyOptimization.worker.ts`와 같은 순서)',
    '',
  );

  // ── 1. 입력 분포 ─────────────────────────────────────────────────────────
  push('## 1. 입력 설정 분포', '');

  push('### 1.1 인구 축', '');
  push(...mdTable(
    ['축', 'n', 'p10', 'p25', '중앙값', 'p75', 'p90'],
    [
      distRow('현재 나이', rows.map((r) => num(r, 'currentAge')), (v) => `${v.toFixed(0)}세`),
      distRow('기대수명', rows.map((r) => num(r, 'expectancy')), (v) => `${v.toFixed(0)}세`),
      distRow('희망 은퇴 나이(입력)', rows.map((r) => num(r, 'desiredRetirementAge')), (v) => `${v.toFixed(0)}세`),
      distRow('계획 은퇴 나이(목표 반영 후)', rows.map((r) => num(r, 'planRetirementAge')), (v) => `${v.toFixed(0)}세`),
      distRow('희망 월 생활비(입력)', rows.map((r) => num(r, 'desiredMonthlySpending')), 만원),
      distRow('계획 월 생활비(목표 반영 후)', rows.map((r) => num(r, 'planMonthlySpending')), 만원),
      distRow('초기 금융·연금 자산', rows.map((r) => num(r, 'initialAssets')), 억원),
      distRow('국민연금 예상 월액', rows.map((r) => num(r, 'npMonthly')), 만원),
      distRow('은퇴 전 월 적립액', rows.map((r) => num(r, 'monthlyContribution')), 만원),
    ],
  ));
  push('');

  push('### 1.2 보유·선택 비율', '');
  push(...mdTable(['항목', '건수', '비율'], [
    ...tally(rows.map((r) => String(r.cohort))).map(([k, v]) => [`연령대 ${k}`, v, pct(v, total)]),
    ...tally(rows.map((r) => String(r.yieldPreset))).map(([k, v]) => [`수익률 프리셋 ${k}`, v, pct(v, total)]),
    ['사적연금 보유', rows.filter((r) => r.hasPrivatePension === true).length,
      pct(rows.filter((r) => r.hasPrivatePension === true).length, total)],
    ['ISA 보유', rows.filter((r) => r.hasIsa === true).length,
      pct(rows.filter((r) => r.hasIsa === true).length, total)],
    ['기타소득 있음', rows.filter((r) => num(r, 'otherIncomeMonthly') > 0).length,
      pct(rows.filter((r) => num(r, 'otherIncomeMonthly') > 0).length, total)],
    ['의료비 가정 켬', rows.filter((r) => r.healthcareEnabled === true).length,
      pct(rows.filter((r) => r.healthcareEnabled === true).length, total)],
  ]));
  push('');

  push('### 1.3 목표 선택', '');
  const goalCounts = tally(rows.flatMap((r) => String(r.goalTypes).split('|').filter(Boolean)));
  const hardCounts = new Map(tally(rows.flatMap((r) => String(r.hardGoalTypes).split('|').filter(Boolean))));
  const confirmedCounts = new Map(tally(rows.flatMap((r) => String(r.confirmedGoalTypes).split('|').filter(Boolean))));
  push(...mdTable(['목표', '선택', '선택률', 'HARD', '금액 확정'],
    goalCounts.map(([type, count]) => [
      type, count, pct(count, total), hardCounts.get(type) ?? 0, confirmedCounts.get(type) ?? 0,
    ])));
  push('');
  push(...mdTable(['고른 목표 수', '건수', '비율'],
    tally(rows.map((r) => String(num(r, 'goalCount'))))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([k, v]) => [`${k}개`, v, pct(v, total)])));
  push('');

  // ── 2. 현재 계획 결과 ─────────────────────────────────────────────────────
  push('## 2. 현재 계획 시뮬레이션 결과', '');

  push('### 2.1 결정론 + Monte Carlo 분포', '');
  push(...mdTable(
    ['지표', 'n', 'p10', 'p25', '중앙값', 'p75', 'p90'],
    [
      distRow('은퇴 점수', ok.map((r) => num(r, 'score')), (v) => v.toFixed(0)),
      distRow('목표 달성률(결정론, %)', ok.map((r) => num(r, 'goalRate')), (v) => v.toFixed(0)),
      distRow('효용 점수', ok.filter((r) => has(r, 'utility')).map((r) => num(r, 'utility')), (v) => v.toFixed(0)),
      distRow('기말자산(결정론)', ok.map((r) => num(r, 'endingAssets')), 억원),
      distRow('MC 목표 달성 확률(%)', ok.map((r) => num(r, 'mcGoalProbability')), (v) => v.toFixed(1)),
      distRow('MC 자산 보존 확률(%)', ok.map((r) => num(r, 'mcAssetSurvival')), (v) => v.toFixed(1)),
      distRow('MC 생활비 충족도(%)', ok.filter((r) => has(r, 'mcSpendFulfillment')).map((r) => num(r, 'mcSpendFulfillment')), (v) => v.toFixed(1)),
      distRow('MC 기말자산 p10', ok.map((r) => num(r, 'mcP10')), 억원),
      distRow('연 변동성 가정(%)', ok.map((r) => num(r, 'mcStdDev')), (v) => v.toFixed(1)),
    ],
  ));
  push('');

  const depleted = ok.filter((r) => has(r, 'depletionAge'));
  push('### 2.2 고갈·미달', '');
  push(...mdTable(['항목', '건수', '비율'], [
    ['결정론에서 자산 고갈', depleted.length, pct(depleted.length, ok.length)],
    ['MC 기말자산 p10 = 0', ok.filter((r) => num(r, 'mcP10') <= 0).length, pct(ok.filter((r) => num(r, 'mcP10') <= 0).length, ok.length)],
    ['결정론 생활비 미달 발생', ok.filter((r) => num(r, 'unmetTotal') > 0).length, pct(ok.filter((r) => num(r, 'unmetTotal') > 0).length, ok.length)],
    ['MC 목표 달성 확률 < 50%', ok.filter((r) => num(r, 'mcGoalProbability') < 50).length, pct(ok.filter((r) => num(r, 'mcGoalProbability') < 50).length, ok.length)],
    ['MC 목표 달성 확률 ≥ 90%', ok.filter((r) => num(r, 'mcGoalProbability') >= 90).length, pct(ok.filter((r) => num(r, 'mcGoalProbability') >= 90).length, ok.length)],
  ]));
  if (depleted.length > 0) {
    push('', `- 고갈 나이 중앙값: ${quantile(depleted.map((r) => num(r, 'depletionAge')), 0.5).toFixed(0)}세`);
  }
  push('');

  push('### 2.3 연령대별', '');
  push(...mdTable(['연령대', 'n', '점수 중앙값', 'MC 확률 중앙값', '고갈률', '기말자산 중앙값'],
    ['30대', '40대', '50대', '60대'].map((cohort) => {
      const group = ok.filter((r) => r.cohort === cohort);
      return [
        cohort, group.length,
        group.length ? quantile(group.map((r) => num(r, 'score')), 0.5).toFixed(0) : '-',
        group.length ? `${quantile(group.map((r) => num(r, 'mcGoalProbability')), 0.5).toFixed(1)}%` : '-',
        pct(group.filter((r) => has(r, 'depletionAge')).length, group.length),
        group.length ? 억원(quantile(group.map((r) => num(r, 'endingAssets')), 0.5)) : '-',
      ];
    })));
  push('');

  push('### 2.4 지표 간 상관 (Pearson)', '');
  const corr = (a: string, b: string) => pearson(ok.map((r) => num(r, a)), ok.map((r) => num(r, b))).toFixed(3);
  push(...mdTable(['쌍', 'r'], [
    ['은퇴 점수 ↔ MC 목표 달성 확률', corr('score', 'mcGoalProbability')],
    ['효용 점수 ↔ MC 목표 달성 확률', corr('utility', 'mcGoalProbability')],
    ['목표 달성률(결정론) ↔ MC 목표 달성 확률', corr('goalRate', 'mcGoalProbability')],
    ['은퇴 점수 ↔ 목표 달성률(결정론)', corr('score', 'goalRate')],
    ['초기자산 ↔ MC 목표 달성 확률', corr('initialAssets', 'mcGoalProbability')],
    ['목표 생활비 ↔ MC 목표 달성 확률', corr('planMonthlySpending', 'mcGoalProbability')],
  ]));
  push('');

  // ── 3. 추천 ──────────────────────────────────────────────────────────────
  push('## 3. 전략 후보 생성과 추천', '');

  push('### 3.1 최적화 결과 종류', '');
  push(...mdTable(['outcome', '건수', '비율'],
    tally(ok.map((r) => String(r.outcome))).map(([k, v]) => [k, v, pct(v, ok.length)])));
  push('');

  push('### 3.2 후보 깔때기 (중앙값)', '');
  push(...mdTable(['단계', '중앙값', 'p10', 'p90'],
    ['generated', 'hardRejected', 'simulated', 'accepted', 'shortlisted', 'mcValidated', 'mcConfirmed', 'rankedCount', 'recCount']
      .map((key) => {
        const values = ok.map((r) => num(r, key));
        return [key, quantile(values, 0.5).toFixed(0), quantile(values, 0.1).toFixed(0), quantile(values, 0.9).toFixed(0)];
      })));
  push('');

  push('### 3.3 추천 카드 수', '');
  push(...mdTable(['카드 수', '건수', '비율'],
    tally(ok.map((r) => String(num(r, 'recCount'))))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([k, v]) => [`${k}장`, v, pct(v, ok.length)])));
  push('');
  push(...mdTable(['페르소나 조합', '건수', '비율'],
    tally(ok.map((r) => String(r.recPersonas) || '(없음)')).slice(0, 8)
      .map(([k, v]) => [k || '(없음)', v, pct(v, ok.length)])));
  push('');

  push('### 3.4 추천이 현재 계획을 개선하는가', '');
  const withRec = ok.filter((r) => num(r, 'recCount') > 0);
  const noneImproves = withRec.filter((r) => num(r, 'recImprovingCount') === 0);
  const primaryShown = withRec.filter((r) => r.primaryLabel !== '' && num(r, 'primaryImproves') === 1);
  push(...mdTable(['항목', '건수', '비율(추천이 나온 건 기준)'], [
    ['추천 카드가 1장 이상', withRec.length, pct(withRec.length, ok.length)],
    ['세 카드 모두 현재 계획보다 나쁨(= 「현재 계획 유지」 안내)', noneImproves.length, pct(noneImproves.length, withRec.length)],
    ['☆추천 배지가 실제로 붙음', primaryShown.length, pct(primaryShown.length, withRec.length)],
    ['primary가 선정되었으나 개선이 아니어서 ☆이 사라짐',
      withRec.filter((r) => r.primaryLabel !== '' && num(r, 'primaryImproves') === 0).length,
      pct(withRec.filter((r) => r.primaryLabel !== '' && num(r, 'primaryImproves') === 0).length, withRec.length)],
  ]));
  const improvement = withRec
    .filter((r) => has(r, 'primaryGoalProbability'))
    .map((r) => num(r, 'primaryGoalProbability') - num(r, 'mcGoalProbability'));
  push('', `- ☆후보 확률 − 현재 계획 확률: 중앙값 ${quantile(improvement, 0.5).toFixed(1)}%p, `
    + `p10 ${quantile(improvement, 0.1).toFixed(1)}%p, p90 ${quantile(improvement, 0.9).toFixed(1)}%p`, '');

  push('### 3.5 ☆추천이 고른 축', '');
  push(...mdTable(['축', '값', '건수'], [
    ...tally(withRec.map((r) => String(r.primarySpendingPattern)).filter(Boolean))
      .map(([k, v]) => ['소비 패턴', k, v]),
    ...tally(withRec.map((r) => String(r.primaryPolicy) || '(미지정)'))
      .map(([k, v]) => ['인출 정책', k || '(미지정)', v]),
  ]));
  push('');

  // ── 4. 목표 판정 ─────────────────────────────────────────────────────────
  push('## 4. 목표가 계산에 닿았는가', '');

  const seedLostRetirement = rows.filter((r) =>
    num(r, 'desiredRetirementAge') !== num(r, 'planRetirementAge'));
  const noEarlyGoal = rows.filter((r) => !String(r.goalTypes).includes('EARLY_RETIREMENT'));
  const spendingSeedLost = rows.filter((r) =>
    num(r, 'desiredMonthlySpending') !== num(r, 'planMonthlySpending'));

  push('### 4.1 씨앗과 계획의 어긋남', '');
  push(...mdTable(['항목', '건수', '비율'], [
    ['「빠른 은퇴」를 고르지 않음', noEarlyGoal.length, pct(noEarlyGoal.length, total)],
    ['희망 은퇴 나이가 계획에 반영되지 않음', seedLostRetirement.length, pct(seedLostRetirement.length, total)],
    ['그중 계획이 «더 늦은» 은퇴가 됨',
      seedLostRetirement.filter((r) => num(r, 'planRetirementAge') > num(r, 'desiredRetirementAge')).length,
      pct(seedLostRetirement.filter((r) => num(r, 'planRetirementAge') > num(r, 'desiredRetirementAge')).length, total)],
    ['그중 계획이 «더 이른» 은퇴가 됨',
      seedLostRetirement.filter((r) => num(r, 'planRetirementAge') < num(r, 'desiredRetirementAge')).length,
      pct(seedLostRetirement.filter((r) => num(r, 'planRetirementAge') < num(r, 'desiredRetirementAge')).length, total)],
    ['희망 월 생활비가 계획과 다름', spendingSeedLost.length, pct(spendingSeedLost.length, total)],
  ]));
  if (seedLostRetirement.length > 0) {
    const gaps = seedLostRetirement.map((r) => num(r, 'planRetirementAge') - num(r, 'desiredRetirementAge'));
    push('', `- 은퇴 나이 차이(계획 − 희망): 중앙값 ${quantile(gaps, 0.5).toFixed(0)}세, `
      + `최대 +${Math.max(...gaps)}세 / 최소 ${Math.min(...gaps)}세`);
  }
  push('');

  push('### 4.2 목표 달성 확률이 실제로 판정한 조건', '');
  push(...mdTable(['판정 기준(basis)', '건수', '비율'],
    tally(ok.map((r) => String(r.condBasis))).map(([k, v]) => [k, v, pct(v, ok.length)])));
  push('');
  push(...mdTable(['조건', '켜진 건수', '비율'], [
    ['목표 생활비 완전 충족', ok.filter((r) => num(r, 'condSpending') === 1).length, pct(ok.filter((r) => num(r, 'condSpending') === 1).length, ok.length)],
    ['기대수명까지 자산 유지', ok.filter((r) => num(r, 'condSurvival') === 1).length, pct(ok.filter((r) => num(r, 'condSurvival') === 1).length, ok.length)],
    ['기말자산 하한 > 0', ok.filter((r) => num(r, 'condTerminal') > 0).length, pct(ok.filter((r) => num(r, 'condTerminal') > 0).length, ok.length)],
  ]));
  push('');

  const unmeasured = tally(ok.flatMap((r) => String(r.unmeasuredGoals).split('|').filter(Boolean)));
  const anyUnmeasured = ok.filter((r) => String(r.unmeasuredGoals) !== '');
  const allUnmeasured = ok.filter((r) => {
    const goals = String(r.goalTypes).split('|').filter(Boolean);
    const un = String(r.unmeasuredGoals).split('|').filter(Boolean);
    return goals.length > 0 && un.length === goals.length;
  });
  push('### 4.3 확률에 반영되지 않은 목표', '');
  push(`- 고른 목표 중 «하나라도» 확률에 반영되지 않은 시나리오: **${anyUnmeasured.length}건 (${pct(anyUnmeasured.length, ok.length)})**`);
  push(`- 고른 목표가 «전부» 반영되지 않은 시나리오: **${allUnmeasured.length}건 (${pct(allUnmeasured.length, ok.length)})**`);
  push('');
  push(...mdTable(['목표', '미반영 건수'], unmeasured.map(([k, v]) => [k, v])));
  push('');

  const unsupportedHard = ok.filter((r) => String(r.unsupportedHardGoals) !== '');
  push('### 4.4 검증할 수 없는 HARD 목표', '');
  push(`- 발생 시나리오: ${unsupportedHard.length}건 (${pct(unsupportedHard.length, ok.length)})`);
  if (unsupportedHard.length > 0) {
    push('', ...mdTable(['목표', '건수'],
      tally(unsupportedHard.flatMap((r) => String(r.unsupportedHardGoals).split('|').filter(Boolean)))
        .map(([k, v]) => [k, v])));
  }
  push('');

  // ── 5. 실패·거절 ─────────────────────────────────────────────────────────
  push('## 5. 실패와 거절', '');
  push(...mdTable(['항목', '건수', '비율'], [
    ['시나리오 전체 실패(예외)', failed.length, pct(failed.length, total)],
    ['구 추천(개선 카드) 계산 실패', ok.filter((r) => num(r, 'legacyRecFailed') === 1).length, pct(ok.filter((r) => num(r, 'legacyRecFailed') === 1).length, ok.length)],
    ['후보 시뮬레이션 실패 발생', ok.filter((r) => num(r, 'simFailures') > 0).length, pct(ok.filter((r) => num(r, 'simFailures') > 0).length, ok.length)],
    ['후보 MC 검증 실패 발생', ok.filter((r) => num(r, 'mcFailures') > 0).length, pct(ok.filter((r) => num(r, 'mcFailures') > 0).length, ok.length)],
    ['HARD 제약으로 거절된 후보가 있음', ok.filter((r) => num(r, 'hardRejected') > 0).length, pct(ok.filter((r) => num(r, 'hardRejected') > 0).length, ok.length)],
    ['시뮬레이션 후 거절된 후보가 있음', ok.filter((r) => num(r, 'postRejected') > 0).length, pct(ok.filter((r) => num(r, 'postRejected') > 0).length, ok.length)],
  ]));
  push('');

  const reasonTotals = new Map<string, number>();
  for (const row of ok) {
    const parsed = JSON.parse(String(row.rejectionReasons || '{}')) as Record<string, number>;
    for (const [code, count] of Object.entries(parsed)) {
      reasonTotals.set(code, (reasonTotals.get(code) ?? 0) + count);
    }
  }
  if (reasonTotals.size > 0) {
    push('### 5.1 후보 거절 사유 (후보 건수 합계)', '');
    push(...mdTable(['사유 코드', '후보 수', '해당 시나리오 수'],
      [...reasonTotals.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => [
        code, count,
        ok.filter((r) => code in JSON.parse(String(r.rejectionReasons || '{}'))).length,
      ])));
    push('');
  }

  if (failed.length > 0) {
    push('### 5.2 실패한 시나리오', '');
    push(...mdTable(['no', '메시지'], failed.slice(0, 20)
      .map((r) => [num(r, 'no'), str(r, 'errorMessage').slice(0, 120)])));
    push('');
  }

  // ── 6. 센티널 ────────────────────────────────────────────────────────────
  push('## 6. 자동 채움(센티널)', '');
  push(...mdTable(['채운 축', '건수', '비율'],
    tally(ok.flatMap((r) => String(r.sentinelFields).split('|').filter(Boolean)))
      .map(([k, v]) => [k, v, pct(v, ok.length)])));
  push('', `- 아무 축도 채우지 않은 시나리오: ${ok.filter((r) => num(r, 'sentinelCount') === 0).length}건 `
    + `(${pct(ok.filter((r) => num(r, 'sentinelCount') === 0).length, ok.length)})`, '');

  // ── CSV ──────────────────────────────────────────────────────────────────
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const csv = [headers.join(',')].concat(rows.map((r) => headers.map((h) => {
    const v = r[h];
    if (v === undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(','))).join('\n');

  fs.writeFileSync(path.join(IN_DIR, 'mass-scenarios.csv'), csv, 'utf-8');
  fs.writeFileSync(path.join(IN_DIR, 'mass-scenarios.md'), out.join('\n'), 'utf-8');
  fs.writeFileSync(path.join(IN_DIR, 'summary.txt'), out.join('\n'), 'utf-8');
});
