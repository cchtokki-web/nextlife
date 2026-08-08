// 페르소나 하니스. `npm run harness:personas`로만 돈다(vitest.harness.config.ts).
//
// **회귀 테스트가 아니다.** 단언하지 않고 지표를 뽑아 CSV/MD로 남긴다. 추천 엔진이나 효용
// 산식을 건드릴 때 "여러 사람에게 실제로 무슨 일이 일어나는가"를 숫자로 보기 위한 것이고,
// 그 숫자에는 옳고 그름의 경계선이 아직 없는 것들(예: 목표 우선순위 축 승자 변화)이 섞여
// 있어 단언으로 굳히면 정상적인 개선까지 막는다. `npm test`의 include 밖에 두는 이유다.
//
// 시드가 고정되어 있어(DEFAULT_MONTE_CARLO_SEED) 출력은 결정론적이다 — 변경 전후 CSV를
// 그대로 diff할 수 있다.
import { test } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SimulationParams, SimulationResult } from '@/core/entities/types';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { recommendStrategy } from '@/core/usecases/strategy/RecommendationEngine';
import { runMonteCarlo } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '@/core/usecases/montecarlo/volatilityPresets';
import { PERSONAS } from './personas';

const OUT_DIR = process.env.HARNESS_OUT ?? path.join(process.cwd(), 'scripts/harness/out');

const 만 = 10_000;
const 억 = 100_000_000;

const sumBy = (r: SimulationResult, pick: (y: SimulationResult['yearlyResults'][number]) => number) =>
  r.yearlyResults.reduce((s, y) => s + pick(y), 0);

const totalTax = (r: SimulationResult) => sumBy(r, (y) =>
  y.dividendTaxPaid + y.pensionTaxPaid + y.nationalPensionTaxPaid +
  y.comprehensiveTaxPaid + y.capitalGainsTaxPaid);

function initialAssetKRW(p: SimulationParams): number {
  let v = 0;
  for (const a of p.assets) v += a.quantity * a.averagePrice * (a.currency === 'USD' ? p.baseExchangeRate : 1);
  for (const q of p.privatePensions) v += q.balance;
  for (const i of p.isaAccounts ?? []) v += i.balance;
  return v;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n === 0) return 0;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  const cov = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0);
  const va = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0));
  const vb = Math.sqrt(b.reduce((s, x) => s + (x - mb) ** 2, 0));
  return va === 0 || vb === 0 ? 0 : cov / (va * vb);
}

test('페르소나 하니스', { timeout: 3_600_000 }, () => {
  const engine = new SimulationEngine();
  const rows: Record<string, string | number>[] = [];
  const details: string[] = [];

  for (const persona of PERSONAS) {
    const compiled = compileStrategy(persona.params);
    const baseParams = compiled.params;
    const baseResult = engine.run(baseParams, compiled.utilityConfig);

    let rec;
    // 실패를 삼키면 안 되는 이유: 이 하니스의 출력이 곧 SPENDING_INCREASE_GATE 임계값의
    // 근거다. 몇 명이 조용히 실패해도 "악화 N명"과 applicableRows.length는 그냥 줄어들 뿐,
    // 분모가 오염된 사실이 드러나지 않아 튜닝 근거가 편향된다. 그래서 CSV 컬럼과 요약
    // 양쪽에 남긴다(0명이어도 출력한다 — 없다는 사실 자체가 정보다).
    let recFailure: string | undefined;
    try {
      rec = recommendStrategy(baseParams, engine, compiled.utilityConfig);
    } catch (err) {
      rec = undefined;
      recFailure = String(err);
      details.push(`### ${persona.no}. ${persona.name}\n추천 실패: ${recFailure}\n`);
    }

    const mcCfg = resolveMonteCarloConfig(baseParams);
    const mcBase = runMonteCarlo(baseParams, engine, mcCfg);

    // 사용자가 **실제로 적용할 수 있는** 추천인지. useBeforeAfterToggle의 canApply와 같은
    // 규칙이다 — improved만 보면 센티널 자동 채움이 이미 개선분을 반영한 뒤에도 true로
    // 남는다. 이 조건을 빼면 화면에 제시되지도 않는 계획을 적용해 놓고 "추천이 계획을
    // 악화시켰다"고 집계하게 된다(강건성 승격은 효용이 낮은 후보를 고를 수 있다).
    const applicable =
      rec?.improved === true &&
      (baseResult.utility === undefined || rec.recommendedUtility.score > baseResult.utility.score);

    // 추천안을 실제로 반영한 params. monthlySpendingMultiplier는 withdrawalPlan에 넣어도
    // 엔진이 보지 않는다 — userProfile.targetMonthlySpending을 스케일링해야 한다
    // (RecommendationEngine.paramsForCandidate). 이걸 놓치면 추천 효과가 0으로 측정된다.
    let recParams = baseParams;
    if (applicable && rec?.recommendedPlan) {
      const plan = rec.recommendedPlan;
      const mult = plan.monthlySpendingMultiplier ?? 1;
      recParams = {
        ...baseParams,
        withdrawalPlan: { ...baseParams.withdrawalPlan, ...plan },
        userProfile: mult === 1
          ? baseParams.userProfile
          : {
              ...baseParams.userProfile,
              targetMonthlySpending: Math.round(baseParams.userProfile.targetMonthlySpending * mult),
            },
      };
      if (rec.recommendedAssetReinvestment) {
        const map = rec.recommendedAssetReinvestment;
        recParams = {
          ...recParams,
          assets: recParams.assets.map((a) => (a.id in map ? { ...a, reinvestDividend: map[a.id] } : a)),
        };
      }
    }
    const mcRec = recParams === baseParams ? mcBase : runMonteCarlo(recParams, engine, mcCfg);
    const recResult = rec?.recommendedResult ?? baseResult;

    rows.push({
      no: persona.no,
      name: persona.name,
      currentAge: persona.params.userProfile.currentAge,
      retirementAge: persona.params.userProfile.retirementAge,
      expectancy: persona.params.userProfile.expectancy,
      monthlySpending: persona.params.userProfile.targetMonthlySpending,
      initialAssets: Math.round(initialAssetKRW(persona.params)),
      npMonthly: persona.params.nationalPension.expectedMonthlyAmount,
      healthcare: persona.params.healthcare?.enabled ? 1 : 0,
      score: baseResult.retirementScore,
      grade: baseResult.retirementGrade,
      goalRate: baseResult.goalAchievementRate,
      fireAge: baseResult.fireAge ?? '',
      depletionAge: baseResult.depletionAge ?? '',
      endingAssets: Math.round(baseResult.endingAssets),
      sustainableSpending: Math.round(baseResult.calculatedTargetSpending ?? 0),
      spendingShape: persona.params.strategy?.spendingShape ?? '',
      unmetTotal: Math.round(sumBy(baseResult, (y) => y.unmetSpending)),
      totalTax: Math.round(totalTax(baseResult)),
      totalHealthIns: Math.round(sumBy(baseResult, (y) => y.healthInsurancePaid)),
      utility: baseResult.utility?.score ?? '',
      u_consumption: baseResult.utility?.components.consumption ?? '',
      u_depletion: baseResult.utility?.components.depletionSafety ?? '',
      u_pension: baseResult.utility?.components.pensionUtilization ?? '',
      u_taxEff: baseResult.utility?.components.taxEfficiency ?? '',
      u_taxRisk: baseResult.utility?.components.taxationRisk ?? '',
      u_bequest: baseResult.utility?.components.bequestAdequacy ?? '',
      recImproved: rec?.improved ? 1 : 0,
      recApplicable: applicable ? 1 : 0,
      recFailed: recFailure ? 1 : 0,
      recUtility: rec?.recommendedUtility.score ?? '',
      recUtilityDelta: rec ? +(rec.recommendedUtility.score - rec.currentUtility.score).toFixed(2) : '',
      recDepletionAge: recResult.depletionAge ?? '',
      recEndingAssets: Math.round(recResult.endingAssets),
      recScore: recResult.retirementScore,
      candidates: rec?.totalCandidateCount ?? 0,
      failedCandidates: rec?.failedCandidateCount ?? 0,
      npStartAge: rec?.recommendedPlan?.nationalPensionStartAge ?? '',
      sellOrder: rec?.recommendedPlan?.assetSellOrderStrategy ?? '',
      isaDest: rec?.recommendedPlan?.isaMaturityDestination ?? '',
      genAssetStartAge: rec?.recommendedPlan?.generalAssetWithdrawalStartAge ?? '',
      spendMultiplier: rec?.recommendedPlan?.monthlySpendingMultiplier ?? '',
      channeling: rec?.recommendedPrivatePensionChanneling ? 1 : 0,
      newPensionContrib: rec?.recommendedNewPensionContribution ? 1 : 0,
      mcSuccess: +(mcBase.successRate * 100).toFixed(1),
      mcFullSpend: +(mcBase.fullSpendingRate * 100).toFixed(1),
      mcP10: Math.round(mcBase.endingAssets.p10),
      mcP50: Math.round(mcBase.endingAssets.p50),
      mcDeterministic: Math.round(mcBase.deterministicEndingAssets),
      mcDepletionMedian: mcBase.depletion.medianAge ?? '',
      mcRecSuccess: +(mcRec.successRate * 100).toFixed(1),
      mcRecFullSpend: +(mcRec.fullSpendingRate * 100).toFixed(1),
      mcRecP10: Math.round(mcRec.endingAssets.p10),
    });

    details.push(
      `### ${persona.no}. ${persona.name}\n` +
      `- 질문: ${persona.note}\n` +
      `- ${persona.params.userProfile.currentAge}세 → 은퇴 ${persona.params.userProfile.retirementAge} → 기대수명 ${persona.params.userProfile.expectancy}, ` +
      `월 목표 ${(persona.params.userProfile.targetMonthlySpending / 만).toFixed(0)}만, 초기자산 ${(initialAssetKRW(persona.params) / 억).toFixed(2)}억\n` +
      `- 결정론: 점수 ${baseResult.retirementScore}(${baseResult.retirementGrade}), 고갈 ${baseResult.depletionAge ?? '없음'}, ` +
      `기말 ${(baseResult.endingAssets / 억).toFixed(2)}억, 효용 ${baseResult.utility?.score}\n` +
      `- MC(σ=${mcCfg.annualStdDev}): 성공률 ${(mcBase.successRate * 100).toFixed(1)}%, 완전소비율 ${(mcBase.fullSpendingRate * 100).toFixed(1)}%, ` +
      `p10 ${(mcBase.endingAssets.p10 / 억).toFixed(2)}억 / p50 ${(mcBase.endingAssets.p50 / 억).toFixed(2)}억 / 결정론 ${(mcBase.deterministicEndingAssets / 억).toFixed(2)}억\n` +
      `- AI추천: improved=${rec?.improved}, 후보 ${rec?.totalCandidateCount}(실패 ${rec?.failedCandidateCount}), 효용 ${rec?.currentUtility.score} → ${rec?.recommendedUtility.score}\n` +
      `- recommendedPlan: ${JSON.stringify(rec?.recommendedPlan)}\n` +
      `- 추천 적용 후 MC 성공률: ${(mcRec.successRate * 100).toFixed(1)}%\n` +
      `- reasons:\n${(rec?.reasons ?? []).map((r) => `    - ${r}`).join('\n') || '    (없음)'}\n` +
      `- itemized:\n${(rec?.itemizedContributions ?? []).map((c) => `    - [${c.field}] ${c.label} (Δu=${c.utilityDelta.toFixed(2)})`).join('\n') || '    (없음)'}\n`
    );

    console.log(`[${persona.no}/${PERSONAS.length}] ${persona.name} — 점수 ${baseResult.retirementScore}, MC ${(mcBase.successRate * 100).toFixed(0)}% → ${(mcRec.successRate * 100).toFixed(0)}%`);
  }

  // ── 요약 지표 ─────────────────────────────────────────────────────────────
  // 이 목록이 곧 "추천 엔진을 고칠 때 무엇이 좋아졌는지 재는 자"다.
  const num = (r: Record<string, string | number>, k: string) => Number(r[k]);
  const worsened = rows.filter((r) => num(r, 'mcRecSuccess') < num(r, 'mcSuccess') - 0.05);
  const improved = rows.filter((r) => num(r, 'mcRecSuccess') > num(r, 'mcSuccess') + 0.05);
  const applicableRows = rows.filter((r) => num(r, 'recApplicable') === 1);
  const failedRows = rows.filter((r) => num(r, 'recFailed') === 1);
  const increased = applicableRows.filter((r) => Number(r.spendMultiplier || 1) > 1);
  const consumptions = rows.map((r) => num(r, 'u_consumption')).filter((v) => !Number.isNaN(v));

  const summary = [
    '## 요약',
    '',
    `- 페르소나: ${rows.length}명 (그중 사용자에게 실제로 제시되는 추천: ${applicableRows.length}명)`,
    `- **추천 계산 실패: ${failedRows.length}명**` +
      (failedRows.length > 0 ? ` (${failedRows.map((r) => r.no).join(', ')}번 — 아래 수치의 분모가 오염됐다)` : ''),
    `- **추천 적용 후 MC 성공률 하락: ${worsened.length}명** / 상승 ${improved.length}명 / 무변화 ${rows.length - worsened.length - improved.length}명`,
    `- 생활비 증액 추천: ${increased.length}명` +
      (increased.length > 0
        ? ` (적용 후 성공률 최저 ${Math.min(...increased.map((r) => num(r, 'mcRecSuccess'))).toFixed(1)}%)`
        : ''),
    `- corr(utilityScore, mcSuccess) = ${pearson(rows.map((r) => num(r, 'utility')), rows.map((r) => num(r, 'mcSuccess'))).toFixed(3)}`,
    `- corr(retirementScore, mcSuccess) = ${pearson(rows.map((r) => num(r, 'score')), rows.map((r) => num(r, 'mcSuccess'))).toFixed(3)}`,
    `- 소비축 점수: min ${Math.min(...consumptions)} / max ${Math.max(...consumptions)} / 서로 다른 값 ${new Set(consumptions).size}종`,
    `- MC p10 기말자산이 0원인 페르소나: ${rows.filter((r) => num(r, 'mcP10') <= 0).length}명`,
    `- 사적연금 채널링 발동: ${rows.filter((r) => num(r, 'channeling') === 1).length}명`,
    '',
    // 「평생 소비 최적화」는 점수가 아니라 "얼마를 쓸 수 있고 그 계획이 얼마나 버티는가"를
    // 재는 모드라 따로 뽑는다. 소비 성향별로 그 트레이드오프가 드러난다.
    ...(rows.some((r) => r.spendingShape)
      ? ['### 평생 소비 최적화 (소비 성향별)', '',
         // 성공률(고갈 안 함)이 아니라 완전소비율을 함께 본다. 목표 상속자산을 정하면
         // 엔진이 그 선 아래 인출을 막아 고갈이 구조적으로 일어나지 않아 성공률이 거의
         // 항상 100%가 된다 — 실제로 갈리는 것은 "그 금액을 다 쓰는가"다.
         '| 페르소나 | 성향 | 역산 기준액 | 자산유지율 | 완전소비율 | 기말자산 |',
         '|---|---|---|---|---|---|',
         ...rows.filter((r) => r.spendingShape).map((r) =>
           `| ${r.name} | ${r.spendingShape} | ${Math.round(num(r, 'sustainableSpending') / 만).toLocaleString()}만원/월 `
           + `| ${r.mcSuccess}% | ${r.mcFullSpend}% | ${(num(r, 'endingAssets') / 억).toFixed(2)}억 |`),
         '']
      : []),
    ...(worsened.length > 0
      ? ['### 추천 적용 후 악화한 페르소나', '',
         ...worsened.map((r) => `- ${r.no} ${r.name}: ${r.mcSuccess}% → ${r.mcRecSuccess}% (배수 ${r.spendMultiplier || '-'})`), '']
      : ['### 추천 적용 후 악화한 페르소나: 없음', '']),
  ].join('\n');

  const headers = Object.keys(rows[0]);
  const csv = [headers.join(',')]
    .concat(rows.map((r) => headers.map((h) => {
      const v = r[h];
      return typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v);
    }).join(',')))
    .join('\n');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'personas.csv'), csv, 'utf-8');
  fs.writeFileSync(
    path.join(OUT_DIR, 'personas.md'),
    `# 페르소나 하니스 결과\n\n${summary}\n---\n\n${details.join('\n')}`,
    'utf-8'
  );

  console.log(`\n${summary}\n출력: ${OUT_DIR}`);
});
