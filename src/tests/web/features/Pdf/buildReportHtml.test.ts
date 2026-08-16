import { describe, test, expect } from 'vitest';
import { buildReportHtml, type ReportHtmlInput } from '@/web/features/Pdf/buildReportHtml';
import capture from '@/tests/fixtures/pdfReport/reportCapture.json';

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

const fixture = capture as unknown as {
  params: ReportHtmlInput['params'];
  result: ReportHtmlInput['result'];
  taxSettings: ReportHtmlInput['taxSettings'];
  displayCurrencyUnit: string;
  generatedAtText: string;
  copyrightYear: number;
  sections: ReportHtmlInput['sections'];
  html: string;
};

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

function input(): ReportHtmlInput {
  return {
    params: fixture.params,
    result: fixture.result,
    taxSettings: fixture.taxSettings,
    displayCurrencyUnit: fixture.displayCurrencyUnit,
    formatValue: formatKrw,
    generatedAtText: fixture.generatedAtText,
    copyrightYear: fixture.copyrightYear,
    sections: fixture.sections,
  };
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
});
