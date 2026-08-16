import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { REPORT_STYLES } from '@/web/features/Pdf/reportStyles';

// jspdf·html2canvas는 동적 import라 모듈 팩토리로 가로챈다. 실물 렌더는 jsdom에서 돌지
// 않으므로(캔버스 없음) 이 파일이 검사하는 것은 «렌더 주변의 계약»이다:
// 잘린 문서를 내주지 않는가, 실패해도 화면에 흔적을 남기지 않는가.
const save = vi.fn();
const addPage = vi.fn();
const addImage = vi.fn();
const html2canvas = vi.fn(async () => ({ toDataURL: () => 'data:image/jpeg;base64,x' }));

vi.mock('jspdf', () => ({
  default: class {
    save = save;
    addPage = addPage;
    addImage = addImage;
  },
}));
vi.mock('html2canvas', () => ({ default: (...args: unknown[]) => html2canvas(...(args as [])) }));

const { generateReportPdf, ReportPageOverflowError } =
  await import('@/web/features/Pdf/generateReportPdf');

// jsdom은 레이아웃을 하지 않아 scrollHeight·clientHeight가 언제나 0이라, 그대로 두면 어떤
// 페이지도 넘치지 않는다. 요소가 만들어지는 시점이 generateReportPdf 안(동적 import 뒤)이라
// 개별 노드에 값을 심을 틈이 없으므로 프로토타입에 getter를 건다. 넘칠 페이지는 픽스처가
// `data-overflow`로 표시한다.
const originalDescriptors = {
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.classList.contains('pdf-content') ? 100 : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains('pdf-content')) return 0;
      return this.hasAttribute('data-overflow') ? 500 : 100;
    },
  });
});

afterEach(() => {
  for (const [name, descriptor] of Object.entries(originalDescriptors)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
  document.body.innerHTML = '';
});

const page = (inner = '<div class="pdf-content">내용</div>') => `<div class="pdf-page">${inner}</div>`;
const overflowingPage = () => page('<div class="pdf-content" data-overflow>내용</div>');

describe('generateReportPdf', () => {
  test('정상 문서는 페이지 수만큼 그리고 저장한다', async () => {
    await generateReportPdf(page() + page(), 'report.pdf');

    expect(html2canvas).toHaveBeenCalledTimes(2);
    expect(addPage).toHaveBeenCalledTimes(1); // 첫 장은 jsPDF가 이미 갖고 있다
    expect(save).toHaveBeenCalledWith('report.pdf');
  });

  // 이 함수의 존재 이유다 — "잘린 리포트를 조용히 내주느니 실패하는 편이 낫다".
  test('넘친 페이지가 있으면 저장하지 않고 몇 쪽인지 알린다', async () => {
    const promise = generateReportPdf(page() + overflowingPage() + page(), 'report.pdf');

    await expect(promise).rejects.toBeInstanceOf(ReportPageOverflowError);
    await promise.catch((error: InstanceType<typeof ReportPageOverflowError>) => {
      // 쪽 번호를 실어 보내는 것이 이 오류 타입의 전부다. 버리면 사용자에게 「어디가
      // 넘쳤는지」를 말할 수 없고, 결정적 실패인데 "다시 시도"밖에 안내할 수 없다.
      expect(error.pageNumbers).toEqual([2]);
    });
    expect(save).not.toHaveBeenCalled();
  });

  // 높이 검사는 «구조가 있다»는 전제 위에서만 뜻이 있다. 전제가 깨졌을 때 통과시키면
  // 가드가 조용히 사라지고, 이 함수는 잘린 문서를 성공으로 저장한다.
  test('.pdf-content를 찾지 못하면 통과시키지 않고 멈춘다', async () => {
    const promise = generateReportPdf(page('<div class="renamed">내용</div>'), 'report.pdf');

    await expect(promise).rejects.toThrow(/구조가 손상/);
    expect(save).not.toHaveBeenCalled();
  });

  // 페이지가 0개면 루프가 한 번도 돌지 않는데, jsPDF는 암묵적으로 빈 첫 장을 갖고 있다.
  // 막지 않으면 «빈 PDF»가 성공으로 내려받아진다.
  test('페이지가 하나도 없으면 빈 PDF를 저장하지 않는다', async () => {
    await expect(generateReportPdf('', 'report.pdf')).rejects.toThrow(/페이지를 찾지 못했/);
    expect(save).not.toHaveBeenCalled();
  });

  // 예전에는 정상 경로와 예외 경로가 각자 removeChild를 불러, 그리는 중 예외가 나면
  // 화면 밖에 컨테이너가 그대로 남았다. PDF를 여러 번 시도하면 그만큼 쌓인다.
  test('그리는 중 터져도 임시 컨테이너를 남기지 않는다', async () => {
    html2canvas.mockRejectedValueOnce(new Error('canvas 실패'));
    const before = document.body.children.length;

    const promise = generateReportPdf(page(), 'report.pdf');

    await expect(promise).rejects.toThrow('canvas 실패');
    expect(document.body.children.length).toBe(before);
  });

  test('넘침으로 중단해도 임시 컨테이너를 남기지 않는다', async () => {
    const before = document.body.children.length;

    const promise = generateReportPdf(overflowingPage(), 'report.pdf');

    await expect(promise).rejects.toBeInstanceOf(ReportPageOverflowError);
    expect(document.body.children.length).toBe(before);
  });
});

// 두 값이 어긋나면 html2canvas가 CSS보다 작은 영역을 캡처해 모든 페이지가 잘린다.
// "반드시 같아야 한다"고 주석에 적어 두는 것만으로는 어긋남을 막지 못한다.
describe('페이지 크기', () => {
  test('REPORT_STYLES의 .pdf-page 크기가 캡처 크기와 같다', () => {
    expect(REPORT_STYLES).toContain('width: 794px');
    expect(REPORT_STYLES).toContain('height: 1123px');
  });
});
