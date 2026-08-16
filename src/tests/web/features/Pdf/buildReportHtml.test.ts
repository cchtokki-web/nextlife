import { describe, test, expect } from 'vitest';
import { buildReportHtml, type ReportHtmlInput } from '@/web/features/Pdf/buildReportHtml';
import capture from '@/tests/fixtures/pdfReport/reportCapture.json';
import captureNoAccounts from '@/tests/fixtures/pdfReport/reportCaptureNoAccounts.json';

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
});
