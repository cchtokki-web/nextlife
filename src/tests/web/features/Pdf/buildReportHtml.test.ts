import { describe, test, expect } from 'vitest';
import { buildReportHtml, type ReportHtmlInput } from '@/web/features/Pdf/buildReportHtml';
import capture from '@/tests/fixtures/pdfReport/reportCapture.json';
import captureNoAccounts from '@/tests/fixtures/pdfReport/reportCaptureNoAccounts.json';
import type { YearlyLedger } from '@/core/entities/types';

// **골든 스냅샷.** 이 테스트가 리팩터링의 안전장치다.
//
// 픽스처는 리팩터링 «전»의 실행 중인 앱에서 입력과 출력을 함께 캡처한 것이다
// (page.tsx에 임시 훅을 넣고 Playwright로 받아 낸 뒤 훅은 제거했다). 그래서 이 단언이
// 통과한다는 것은 조립 로직이 옮겨지면서 한 글자도 변하지 않았다는 뜻이다.
//
// 캡처한 시나리오는 사적연금 2개·투자자산 2개·ISA 1개·기타소득 0개다. 네 리스트의
// "있음"과 "없음" 분기를 모두 지나가고, 시장 변동 검증 페이지와 생활비 구성 표까지
// 포함한 7페이지 리포트다.
//
// **이 테스트가 깨지면 먼저 의심할 것은 코드이지 픽스처가 아니다.** 픽스처를 새로 뜨려면
// 임시 훅을 다시 넣고 앱을 돌려야 하는데, 그 순간 "무엇이 달라졌는지"를 확인할 기준이
// 사라진다. 출력이 의도적으로 바뀌었다고 판단되면 바뀐 부분을 diff로 확인한 뒤에 갱신한다.

interface ReportFixture {
  params: ReportHtmlInput['params'];
  result: ReportHtmlInput['result'];
  taxSettings: ReportHtmlInput['taxSettings'];
  displayCurrencyUnit: string;
  generatedAtText: string;
  copyrightYear: number;
  sections: ReportHtmlInput['sections'];
  html: string;
}

const fixture = capture as unknown as ReportFixture;

// 두 번째 시나리오. 첫 픽스처가 «한 번도 실행하지 않은» 분기를 덮는다 —
// 사적연금·투자자산·ISA가 모두 «없음»이고 기타소득이 «있음»이라, 네 계좌 목록이 전부
// 반대 갈래를 탄다(renderAccountList).
//
// 이쪽은 앱에서 캡처하지 않았다. 그럴 필요가 없다 — buildReportHtml은 이미 순수 함수로
// 잠겨 있으므로, 새 시나리오는 «리팩터링 전 출력»을 재현할 대상이 아니라 앞으로의 변경을
// 잡는 기준선이다. 입력은 코드로 만들고(엔진 실제 실행), 출력은 실물 PDF 7장을 렌더해
// 눈으로 확인한 뒤 고정했다. 확인한 것: 5페이지의 「등록된 사적연금 없음」·「등록된 투자
// 자산 없음」·「등록된 ISA 계좌 없음」과 기타소득 2건, 6페이지 연도별 표 27행.
const noAccounts = captureNoAccounts as unknown as ReportFixture;

// page.tsx의 formatValue와 같은 규칙(원화). 픽스처가 KRW 시나리오라 이 분기만 필요하다.
function formatKrw(value: number): string {
  if (value <= 0) return '0원';
  const valueInMan = Math.round(value / 10000);
  if (valueInMan === 0) return '0원';
  const eok = Math.floor(valueInMan / 10000);
  const man = valueInMan % 10000;
  if (eok > 0) return man > 0 ? `${eok}억 ${man.toLocaleString()}만원` : `${eok}억원`;
  return `${man.toLocaleString()}만원`;
}

function inputOf(source: ReportFixture): ReportHtmlInput {
  return {
    params: source.params,
    result: source.result,
    taxSettings: source.taxSettings,
    displayCurrencyUnit: source.displayCurrencyUnit,
    formatValue: formatKrw,
    generatedAtText: source.generatedAtText,
    copyrightYear: source.copyrightYear,
    sections: source.sections,
  };
}

function input(): ReportHtmlInput {
  return inputOf(fixture);
}

describe('buildReportHtml', () => {
  test('리팩터링 전 출력과 한 글자도 다르지 않다', () => {
    expect(buildReportHtml(input())).toBe(fixture.html);
  });

  // 순수 함수라는 주장을 직접 고정한다. 시계·로케일·DOM에 닿으면 두 번 부른 결과가 갈린다.
  test('같은 입력이면 항상 같은 문자열을 준다', () => {
    expect(buildReportHtml(input())).toBe(buildReportHtml(input()));
  });

  test('현금 배당과 계좌 안에 남은 재투자 배당을 다른 열로 표시한다', () => {
    const base = input();
    const first = base.result.yearlyResults[0];
    const retainedDividend = 12_340_000;
    const withRetainedDividend: ReportHtmlInput = {
      ...base,
      result: {
        ...base.result,
        yearlyResults: [
          {
            ...first,
            dividendIncome: 5_670_000,
            ledger: {
              investmentReturn: { dividendRetainedNet: retainedDividend },
            } as YearlyLedger,
          },
          ...base.result.yearlyResults.slice(1),
        ],
      },
    };

    const html = buildReportHtml(withRetainedDividend);
    const firstRowStart = html.indexOf(`>${first.age}세</td>`);
    const firstRow = html.slice(firstRowStart, html.indexOf('</tr>', firstRowStart));

    expect(html).toContain('현금<br/>배당');
    expect(html).toContain('재투자<br/>배당');
    expect(firstRow).toContain(formatKrw(5_670_000));
    expect(firstRow).toContain(formatKrw(retainedDividend));
    expect(html).toContain('현금 배당만 생활비 재원에 포함');
  });

  test('Monte Carlo 전 연령 밴드가 있으면 화면처럼 연령별 총 자산에 중앙값을 쓴다', () => {
    const base = input();
    const medianAtLastAge = 314_110_000;
    const lastResult = base.result.yearlyResults.at(-1)!;
    const html = buildReportHtml({
      ...base,
      monteCarlo: {
        assetBands: base.result.yearlyResults.map((row) => ({
          age: row.age,
          p10: 0,
          p50: row.age === lastResult.age ? medianAtLastAge : row.totalAssets / 2,
        })),
      },
    });

    expect(html).toContain('총 자산<br/>(중앙값)');
    expect(html).toContain('화면 차트와 같은 시장 변동 시행의 연도별 중앙값');
    const lastAgeRowStart = html.indexOf(`>${lastResult.age}세</td>`);
    const lastAgeRow = html.slice(lastAgeRowStart, html.indexOf('</tr>', lastAgeRowStart));
    expect(lastAgeRow).toContain(formatKrw(medianAtLastAge));
    expect(lastAgeRow).not.toContain(formatKrw(lastResult.totalAssets));
  });

  // 워커가 아직 끝나지 않은 상태. 시장 변동 검증 페이지가 통째로 빠지고, 그만큼
  // 페이지 카운터가 줄어 문서 전체의 번호가 하나씩 당겨진다.
  test('몬테카를로 결과가 없으면 그 페이지를 만들지 않는다', () => {
    const withMc = buildReportHtml(input());
    const withoutMc = buildReportHtml({
      ...input(),
      sections: { ...fixture.sections, monteCarlo: '' },
    });

    expect(withMc).toContain('시장 변동 검증');
    expect(withoutMc).not.toContain('시장 변동 검증');
    expect(withoutMc.length).toBeLessThan(withMc.length);
  });

  // 목표 충돌 고지가 «어디에» 놓이는가. 문장은 renderGoalConflictSection이 소유하므로
  // 여기서 시험하는 것은 자리뿐이다 — 추천보다 «뒤»에 놓이면 사용자는 추천이 왜 그런
  // 모양인지 모른 채 먼저 읽게 된다.
  describe('목표 충돌 고지', () => {
    const conflictHtml = '<div id="goal-conflict-probe">동시에 달성하기 어려운 목표가 있습니다</div>';

    test('「현재 계획 진단」 뒤, 「NextLife 추천」 앞에 놓인다', () => {
      const html = buildReportHtml({
        ...input(),
        sections: { ...fixture.sections, goalConflict: conflictHtml },
      });

      expect(html).toContain(conflictHtml);
      expect(html.indexOf('현재 계획 진단')).toBeLessThan(html.indexOf(conflictHtml));
      expect(html.indexOf(conflictHtml)).toBeLessThan(html.indexOf('. NextLife 추천'));
    });

    test('충돌이 없으면 빈 줄 하나도 만들지 않는다', () => {
      // 「없는 것은 자리도 만들지 않는다」. 골든 출력이 한 글자도 변하지 않아야 한다.
      expect(buildReportHtml({
        ...input(),
        sections: { ...fixture.sections, goalConflict: '' },
      })).toBe(fixture.html);
    });
  });

  // 「이 금액은 권장액이 아니라 한계값」 고지가 «어디에» 놓이는가. 문장은
  // renderSustainableSpendingLimitSection이 소유하므로 여기서 시험하는 것은 자리뿐이다.
  //
  // 판정 블록이 기말자산과 고갈 나이를 말한 «직후»여야 한다. 그 뒤로 밀리면 사용자는
  // 「85세 잔여자산 0원」을 먼저 읽고, 그것이 계획이 고장난 것인지 「반드시 지키기」를
  // 지킨 결과인지 모른 채 다음 장으로 넘어간다.
  describe('한계 계획 고지', () => {
    const limitHtml = '<div id="sustainable-limit-probe">이 금액은 권장 생활비가 아니라 자산을 거의 소진하는 한계 수준입니다.</div>';

    test('「현재 계획 진단」 안, 판정 블록 바로 뒤에 놓인다', () => {
      const html = buildReportHtml({
        ...input(),
        sections: { ...fixture.sections, sustainableSpendingLimit: limitHtml },
      });

      expect(html).toContain(limitHtml);
      expect(html.indexOf('현재 계획 진단')).toBeLessThan(html.indexOf(limitHtml));
      // 부족 요약보다 앞이다 — 부족 요약은 「얼마가 모자랐나」이고, 이 고지는 그 계획이
      // 애초에 무엇인가를 말한다.
      expect(html.indexOf(limitHtml)).toBeLessThan(html.indexOf('. 시뮬레이션 설정 상태'));
    });

    test('바닥이 구속하지 않으면 빈 줄 하나도 만들지 않는다', () => {
      // 「없는 것은 자리도 만들지 않는다」. 골든 출력이 한 글자도 변하지 않아야 한다.
      expect(buildReportHtml({
        ...input(),
        sections: { ...fixture.sections, sustainableSpendingLimit: '' },
      })).toBe(fixture.html);
    });
  });

  // 세 계좌 목록이 «연 총수익률»을 같은 형식으로 말하는지 고정한다.
  //
  // 이 문서가 오래 거짓말을 했던 자리다. 예전에는 "예상 연 수익률 7%"라고 적힌 자산이
  // 엔진에서 10%로 굴렀고, 사적연금은 배당률이 아예 출력되지 않아 4%로 표시된 계좌가
  // 실제로는 7~14%였다 — 사용자가 그것을 확인할 방법이 문서 어디에도 없었다.
  describe('수익률 표기', () => {
    test('투자 자산과 ISA는 배당을 «포함»한다고 밝힌다', () => {
      const html = buildReportHtml(input());

      expect(html).toContain('연 총수익률 5% (배당 2% 포함), 배당 재투자');
      expect(html).toContain('연 총수익률 5% (배당 1.5% 포함), 만기');
      expect(html).not.toContain('예상 연 수익률');
    });

    // 골든 픽스처의 사적연금에는 dividendYield가 없어 이 갈래를 지나지 않는다.
    test('사적연금은 배당률이 있을 때만 괄호를 붙인다', () => {
      const base = input();
      const withDividend: ReportHtmlInput = {
        ...base,
        params: {
          ...base.params,
          privatePensions: base.params.privatePensions.map((pension, index) => index === 0
            ? { ...pension, investmentType: 'etf' as const, dividendYield: 3.3 }
            : pension),
        },
      };

      const html = buildReportHtml(withDividend);

      expect(html).toContain('연 총수익률 4% (배당 3.3% 포함)');
      // 배당률이 없는 두 번째 연금은 괄호 없이 남는다 — 없는 정보를 0%라고 지어내지 않는다.
      expect(html).toContain('연 총수익률 4%</li>');
    });
  });

  describe('계좌가 하나도 없고 기타소득만 있는 계획', () => {
    test('고정한 출력과 한 글자도 다르지 않다', () => {
      expect(buildReportHtml(inputOf(noAccounts))).toBe(noAccounts.html);
    });

    // 위 골든이 «무엇을» 지키는지 밝혀 둔다. 골든만 있으면 깨졌을 때 어느 계약이
    // 무너졌는지 알 수 없고, 픽스처를 갱신해 통과시키고 싶은 유혹이 생긴다.
    test('네 계좌 목록이 모두 첫 픽스처와 반대 갈래를 탄다', () => {
      const html = buildReportHtml(inputOf(noAccounts));

      expect(html).toContain('등록된 사적연금 없음');
      expect(html).toContain('등록된 투자 자산 없음');
      expect(html).toContain('등록된 ISA 계좌 없음');
      // 기타소득은 반대로 «있음» 갈래다. 첫 픽스처가 0개라 이 경로는 그동안 한 번도
      // 실행되지 않았다.
      expect(html).toContain('상가 임대료');
      expect(html).toContain('주 3일 근무 급여');
      expect(html).not.toContain('등록된 기타 소득 없음');
    });

    // 두 픽스처가 같은 sections를 공유하므로, 문서가 갈리는 지점은 params·result뿐이다.
    // 그런데도 출력이 같다면 이 픽스처는 아무것도 새로 덮지 못한 것이다.
    test('첫 픽스처와 다른 문서를 만든다', () => {
      expect(buildReportHtml(inputOf(noAccounts))).not.toBe(buildReportHtml(input()));
    });
  });

  // 조립 결과는 generateReportPdf에서 `innerHTML`로 실제 DOM이 된다. 사용자가 자유롭게
  // 적는 이름이 그대로 실리면 `<img src=x onerror=...>`가 붙는 즉시 실행되고, 공격이 아닌
  // 평범한 `&`나 `<`도 <li>를 무너뜨린다 — 넘침 검사는 «높이»만 보므로 그 붕괴를 못 잡는다.
  describe('사용자가 적은 이름', () => {
    const withHostileNames = (): ReportHtmlInput => {
      const base = input();
      return {
        ...base,
        params: {
          ...base.params,
          assets: base.params.assets.map((asset, index) => index === 0
            ? { ...asset, name: '<img src=x onerror="alert(1)">' }
            : asset),
          otherIncomes: [{
            id: 'income-evil', label: 'A & B <script>alert(1)</script>',
            monthlyAmount: 1_000_000, currency: 'KRW' as const,
          }],
        },
      };
    };

    test('마크업을 실행 가능한 형태로 싣지 않는다', () => {
      const html = buildReportHtml(withHostileNames());

      expect(html).not.toContain('<img src=x');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
      expect(html).toContain('A &amp; B &lt;script&gt;');
    });

    // 이스케이프는 «표시»만 바꾼다. 이름이 사라지면 사용자는 자기 자산을 못 알아본다.
    test('이름 자체는 지우지 않는다', () => {
      const html = buildReportHtml(withHostileNames());

      expect(html).toContain('A &amp; B');
      expect(html).toContain('onerror=');
    });
  });

  // **구조 계약.** 골든은 «이 입력»의 출력만 지킨다. 아래는 입력이 달라져도 유지돼야 하는
  // 성질이라, 골든이 통과하는 채로도 깨질 수 있는 것들이다.
  describe('절 번호와 쪽 번호', () => {
    const sectionNumbers = (html: string): number[] =>
      [...html.matchAll(/<h2[^>]*>\s*(\d+)\./g)].map((match) => Number(match[1]));

    // 이 리팩터가 고친 버그가 정확히 이것이다 — 「7.」이 두 번 찍히고, 각주가 "5페이지
    // 세금 설정과 6페이지"로 하드코딩돼 있었다. 몬테카를로 페이지가 빠지는 갈래에서
    // 번호가 하나씩 당겨지므로, 그 갈래로 검사해야 뜻이 있다.
    test('몬테카를로가 빠져도 절 번호가 1부터 중복 없이 이어진다', () => {
      const html = buildReportHtml({
        ...input(),
        sections: { ...fixture.sections, monteCarlo: '' },
      });

      const numbers = sectionNumbers(html);
      expect(numbers.length).toBeGreaterThan(0);
      expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
    });

    // 치환되지 않은 자리표시자가 그대로 인쇄되면 「{total_pages}」 같은 문자열이 사용자가
    // 내려받는 문서에 남는다. 골든은 이 입력에서만 그것이 없음을 보장한다.
    test('치환하지 못한 자리표시자를 남기지 않는다', () => {
      for (const html of [buildReportHtml(input()),
        buildReportHtml({ ...input(), sections: { ...fixture.sections, monteCarlo: '' } })]) {
        expect(html).not.toMatch(/\{[a-z_]+\}/);
      }
    });
  });

  // **여러 쪽으로 쪼개지는 갈래.** ROWS_PER_PAGE는 42인데 두 픽스처의 연도별 표는 36행과
  // 27행이라, 골든은 «한 쪽짜리» 표만 지난다. 35세·기대수명 95세면 61행이 되어 이 경로를
  // 타는데, 그때 절 번호가 두 쪽에 같은 값으로 붙는지·면책 고지가 한 번만 나오는지를
  // 지금까지 아무것도 잠그지 않았다.
  describe('연도별 표가 여러 쪽으로 나뉠 때', () => {
    const manyRows = (): ReportHtmlInput => {
      const base = input();
      const rows = base.result.yearlyResults;
      // 픽스처 행을 이어 붙여 42행을 넘긴다. 나이·연도는 이어지도록 다시 매긴다.
      const extended = [...rows, ...rows].map((row, index) => ({
        ...row,
        age: rows[0].age + index,
        year: rows[0].year + index,
      }));
      return { ...base, result: { ...base.result, yearlyResults: extended } };
    };

    test('쪽이 나뉘어도 절 번호는 하나이고 면책 고지는 한 번만 나온다', () => {
      const html = buildReportHtml(manyRows());

      expect(html).toContain('(1/2)');
      expect(html).toContain('(2/2)');
      // 두 쪽 머리글이 같은 절 번호를 달아야 한다. 서로 다르면 목차가 어긋난다.
      const headings = [...html.matchAll(/(\d+)\. 연령별 소득원 및 자산 추이 \((\d)\/2\)/g)];
      expect(headings).toHaveLength(2);
      expect(headings[0][1]).toBe(headings[1][1]);
      // 면책 고지는 마지막 쪽에만 붙는다.
      expect(html.split('중요 투자 및 시뮬레이션 법적 면책 고지')).toHaveLength(2);
    });
  });

});
