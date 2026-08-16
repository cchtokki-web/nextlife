import { REPORT_STYLES } from './reportStyles';

/** A4 794×1123px — REPORT_STYLES의 .pdf-page 크기와 반드시 같아야 한다. */
const PAGE_WIDTH_PX = 794;
const PAGE_HEIGHT_PX = 1123;
/** jsPDF의 A4 세로 크기(mm). */
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

export class ReportPageOverflowError extends Error {
  constructor(readonly pageNumbers: readonly number[]) {
    super(`PDF page overflow detected: ${pageNumbers.join(', ')}`);
    this.name = 'ReportPageOverflowError';
  }
}

/**
 * 조립된 HTML을 화면 밖에서 렌더해 PDF로 저장한다.
 *
 * buildReportHtml과 책임이 갈린다 — 저쪽은 «무엇을 쓸지», 여기는 «어떻게 그릴지»다.
 * 그래서 이 함수는 리포트 내용을 전혀 모르고, 반대로 buildReportHtml은 DOM을 모른다.
 *
 * **넘침 검사를 먼저 하고 그리기 시작한다.** 한 페이지라도 내용이 넘치면 잘린 문서가
 * 만들어지는데, html2canvas는 그것을 알려 주지 않는다. 잘린 리포트를 조용히 내주느니
 * 실패하는 편이 낫다.
 *
 * jsPDF와 html2canvas는 동적 import다 — 리포트를 내려받지 않는 사용자가 그 번들을
 * 받게 할 이유가 없다.
 */
export async function generateReportPdf(pagesHtml: string, fileName: string): Promise<void> {
  const jsPDF = (await import('jspdf')).default;
  const html2canvas = (await import('html2canvas')).default;

  // 화면 밖에 둔다. 보이는 자리에 붙이면 리포트가 잠깐 깜빡이며 나타난다.
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '800px';

  const styleBlock = document.createElement('style');
  styleBlock.innerHTML = REPORT_STYLES;
  container.appendChild(styleBlock);

  const pagesContainer = document.createElement('div');
  pagesContainer.innerHTML = pagesHtml;
  container.appendChild(pagesContainer);
  document.body.appendChild(container);

  try {
    const pages = container.querySelectorAll('.pdf-page');
    // **구조를 먼저 확인한다.** 넘침 검사는 `.pdf-content`의 높이를 재는데, 그 요소를 찾지
    // 못하면 「넘치지 않았다」와 구별되지 않는다. 셀렉터가 어긋나는 순간(buildReportHtml이나
    // reportStyles의 클래스명 변경) 가드가 조용히 모든 페이지를 통과시켜, 잘린 리포트를
    // 막겠다는 이 함수의 목적이 오류 없이 사라진다. 페이지가 0개면 더 나쁘다 — jsPDF가
    // 암묵적으로 갖는 빈 첫 장이 그대로 «성공»으로 저장된다.
    if (pages.length === 0) {
      throw new Error('리포트 페이지를 찾지 못했습니다 (.pdf-page 없음)');
    }
    const contents = Array.from(pages).map((page) =>
      page.querySelector('.pdf-content') as HTMLElement | null);
    const brokenPages = contents.flatMap((content, index) => content ? [] : [index + 1]);
    if (brokenPages.length > 0) {
      throw new Error(`리포트 페이지 구조가 손상됐습니다 (.pdf-content 없음): ${brokenPages.join(', ')}쪽`);
    }
    const overflowingPages = contents.flatMap((content, index) =>
      content!.scrollHeight > content!.clientHeight + 1 ? [index + 1] : []);
    if (overflowingPages.length > 0) {
      throw new ReportPageOverflowError(overflowingPages);
    }

    const pdf = new jsPDF('p', 'mm', 'a4');
    for (let i = 0; i < pages.length; i++) {
      if (i > 0) pdf.addPage();

      const canvas = await html2canvas(pages[i] as HTMLElement, {
        // 2배. 1배면 A4로 늘렸을 때 표의 10.5px 글자가 뭉개지고, 3배는 눈에 띄는 차이 없이
        // 캔버스 픽셀이 2.25배가 되어 toDataURL에서 큰 리포트가 메모리로 막힌다.
        scale: 2,
        useCORS: true,
        logging: false,
        width: PAGE_WIDTH_PX,
        height: PAGE_HEIGHT_PX,
      });

      pdf.addImage(canvas.toDataURL('image/jpeg', 1.0), 'JPEG', 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
    }

    pdf.save(fileName);
  } finally {
    // 넘침으로 중단되든 정상 저장이든 임시 컨테이너는 반드시 걷는다.
    // 예전에는 두 경로가 각자 removeChild를 불러, 그리는 중 예외가 나면 화면 밖에
    // 컨테이너가 그대로 남았다.
    document.body.removeChild(container);
  }
}
