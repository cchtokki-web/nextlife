import { describe, test, expect } from 'vitest';
import { normalizeSimulationParamsWithIssues } from '@/infrastructure/storage/normalizeSimulationParams';
import { financialIssues } from '@/infrastructure/storage/normalizationIssues';
import { initialParams } from '@/infrastructure/storage/localStore';
import { DEFAULT_HEALTHCARE } from '@/core/usecases/healthcare/defaultHealthcare';

// **정제는 조용해도 되지만 흔적이 없어서는 안 된다.**
//
// 아래 세 가지는 리뷰가 「사용자가 알아챌 방법이 없다」고 지목한 변환이다. 셋 다 계좌는
// 화면에 그대로 남고 숫자만 달라져, 무엇이 잘못됐는지 물어볼 단서조차 없었다.
//
// 이 파일이 잠그는 것은 «보고된다»는 사실이다. 대체 자체를 막지는 않는다 — 막으면 계산이
// 서지 않고, 사용자는 화면에서 고칠 기회조차 잃는다.

const withIssues = (overrides: Record<string, unknown>) =>
  normalizeSimulationParamsWithIssues({ ...structuredClone(initialParams), ...overrides });

const pathsOf = (issues: readonly { path: string }[]) => issues.map((issue) => issue.path);

describe('정제 보고', () => {
  test('정상 데이터에는 아무것도 보고하지 않는다', () => {
    const { issues } = normalizeSimulationParamsWithIssues(structuredClone(initialParams));

    expect(issues).toEqual([]);
  });

  // 소문자 'usd'는 유니온에 없어 KRW가 된다. 그러면 100주 × $500(약 6,750만원)짜리 계좌가
  // 5만원으로 읽히는데, 종목·수량·단가가 전부 그대로 화면에 남아 아무것도 이상해 보이지 않는다.
  test('통화를 읽지 못해 원화로 바꾼 것을 금액 문제로 보고한다', () => {
    const { params, issues } = withIssues({
      assets: [{
        id: 'a1', type: 'etf', ticker: 'VOO', name: 'VOO',
        quantity: 100, averagePrice: 500, annualGrowthRate: 7, dividendYield: 1.5,
        monthlyContribution: 0, reinvestDividend: false, currency: 'usd',
      }],
    });

    expect(params.assets[0].currency).toBe('KRW');
    const financial = financialIssues(issues);
    expect(pathsOf(financial)).toContain('assets[0].currency');
    expect(financial.find((issue) => issue.path === 'assets[0].currency')).toMatchObject({
      original: 'usd', replacedWith: 'KRW', reason: 'unknown_enum',
    });
  });

  // 문자열 수량은 0이 된다. 이 파일의 정제 규칙상 의도된 동작이지만, 보고하지 않으면
  // 7,000만원짜리 ETF가 사라진 이유를 아무도 설명할 수 없다.
  test('숫자가 아닌 금액을 0으로 바꾼 것을 보고한다', () => {
    const { params, issues } = withIssues({
      assets: [{
        id: 'a1', type: 'etf', ticker: '069500', name: 'KODEX 200',
        quantity: '2000', averagePrice: 35_000, annualGrowthRate: 5, dividendYield: 2,
        monthlyContribution: 0, reinvestDividend: false, currency: 'KRW',
      }],
    });

    expect(params.assets[0].quantity).toBe(0);
    expect(pathsOf(financialIssues(issues))).toContain('assets[0].quantity');
  });

  // 배열이 아닌 컬렉션은 통째로 빈다. 화면은 빈 목록을 「자산이 없음」이라는 정상 상태로
  // 렌더하므로, 보고가 없으면 포트폴리오가 사라진 것을 사고로 인식할 방법이 없다.
  test('목록이 통째로 비워진 것을 보고한다', () => {
    const { params, issues } = withIssues({ assets: { '0': { id: 'a1' } } });

    expect(params.assets).toEqual([]);
    expect(financialIssues(issues).find((issue) => issue.path === 'assets')).toMatchObject({
      reason: 'not_an_array',
    });
  });

  // 원소 일부만 버려지는 경우. 남은 것이 있어 목록은 정상으로 보인다.
  test('버려진 원소 수를 보고한다', () => {
    const { params, issues } = withIssues({
      assets: [
        { id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 1,
          annualGrowthRate: 0, dividendYield: 0, monthlyContribution: 0,
          reinvestDividend: false, currency: 'KRW' },
        'this is not an asset',
      ],
    });

    expect(params.assets).toHaveLength(1);
    expect(financialIssues(issues).find((issue) => issue.path === 'assets')).toMatchObject({
      reason: 'dropped_items', original: '2건', replacedWith: '1건',
    });
  });

  // 최상위가 객체가 아니면 계획 전체가 기본값으로 갈린다. 필드별로 쪼개 보고하면 수백 건이
  // 쏟아져 「계획이 통째로 사라졌다」는 사실이 그 안에 묻힌다.
  test('시나리오 전체가 갈린 경우는 한 건으로 보고한다', () => {
    const { issues } = normalizeSimulationParamsWithIssues('저장이 깨졌다');

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: '', reason: 'not_an_object', severity: 'financial' });
  });

  // 이름은 계산에 닿지 않는다. 금액 문제와 같은 무게로 다루면 정작 중요한 보고가 묻힌다.
  test('표시용 값과 계산용 값을 나눈다', () => {
    const { issues } = withIssues({
      assets: [{
        // name이 문자열이 아니라 ''가 되고(표시), quantity가 0이 된다(계산).
        id: 'a1', type: 'etf', ticker: 'X', name: 42,
        quantity: null, averagePrice: 1, annualGrowthRate: 0, dividendYield: 0,
        monthlyContribution: 0, reinvestDividend: false, currency: 'KRW',
      }],
    });

    expect(pathsOf(financialIssues(issues))).toContain('assets[0].quantity');
    expect(pathsOf(financialIssues(issues))).not.toContain('assets[0].name');
    expect(pathsOf(issues)).toContain('assets[0].name');
  });

  // 원칙 3(모르는 키는 그대로 둔다)과 원칙 4(없던 키는 만들지 않는다)를 지키면, 정상 데이터를
  // 넣었을 때 보고가 «비어» 있어야 한다. 첫 테스트가 그것을 보지만, 선택 구조가 전부 들어
  // 있는 시나리오로도 확인해 둔다 — 그러지 않으면 보고가 소음으로 가득 차 쓸모없어진다.
  test('선택 구조를 모두 갖춘 정상 시나리오도 조용하다', () => {
    const { issues } = normalizeSimulationParamsWithIssues({
      ...structuredClone(initialParams),
      isaAccounts: [],
      taxSettings: { enableComprehensiveTax: true },
      withdrawalPlan: { accountWithdrawalPolicy: 'ISA_FIRST' },
      spendingCurve: { breakpointAges: [70, 80], multipliers: [1, 0.9, 0.8] },
      // 필드를 모두 갖춰 넘긴다. HealthcareAssumptions는 전부 필수라, 부분 객체를 주면
      // 정제가 빠진 필드를 DEFAULT_HEALTHCARE로 채우고 그것을 «지어냈다»고 보고한다
      // — 그 보고 자체는 옳다(아래 별도 테스트).
      healthcare: { ...DEFAULT_HEALTHCARE, enabled: true },
      strategy: { mode: 'standard' },
      taxLawVersion: 'current',
    });

    expect(issues).toEqual([]);
  });

  // 부분 의료비 설정은 정제가 필수 필드를 채운다. 그 값들은 통계에서 온 «가정»이지
  // 사용자가 정한 값이 아니므로, 조용히 계산에 들어가서는 안 된다.
  test('필수 필드를 채워 넣은 것도 보고한다', () => {
    const { issues } = withIssues({ healthcare: { enabled: true } });

    const generated = issues.filter((issue) => issue.reason === 'generated');
    expect(pathsOf(generated)).toContain('healthcare.baseMonthlyCost');
    expect(pathsOf(generated)).toContain('healthcare.longTermCareMonthlyCost');
  });
});
