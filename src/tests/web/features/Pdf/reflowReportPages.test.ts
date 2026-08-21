import { describe, test, expect } from 'vitest';
import { reflowReportPages, type MeasureContent } from '@/web/features/Pdf/reflowReportPages';

// jsdom은 레이아웃을 하지 않아 실제 높이가 언제나 0이다. 그래서 reflowReportPages는 재는
// 방법을 주입받고, 여기서는 자식마다의 높이를 `data-h`로 적어 둔다 — 「이 조각은 120px」을
// 시험이 직접 정할 수 있어야 「넘칠 때 어떻게 나뉘는가」를 고정할 수 있다.
const PAGE_HEIGHT = 100;

const measure: MeasureContent = (content) => {
  let cursor = 0;
  const bottoms = Array.from(content.children).map((child) => {
    cursor += Number((child as HTMLElement).dataset.h ?? 0);
    return cursor;
  });
  return { available: PAGE_HEIGHT, bottoms };
};

function build(pagesHtml: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = pagesHtml;
  document.body.appendChild(container);
  return container;
}

const footer = (pageNo: number, total: number) =>
  `<div class="pdf-footer"><span>NextLife</span>`
  + `<span class="pdf-page-number">페이지 ${pageNo} / ${total}</span></div>`;

const page = (children: string, pageNo: number, total: number, attrs = '') =>
  `<div class="pdf-page"${attrs}><div class="pdf-content">${children}</div>${footer(pageNo, total)}</div>`;

const block = (height: number, text = '내용') => `<div data-h="${height}">${text}</div>`;
const heading = (height: number, text = '제목') => `<h2 data-h="${height}">${text}</h2>`;

const contentsOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.pdf-content'))
    .map((content) => Array.from(content.children).map((child) => child.textContent));

const pageNumbersOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.pdf-page-number')).map((label) => label.textContent);

describe('reflowReportPages', () => {
  test('한 장에 담기는 쪽은 건드리지 않는다', () => {
    const container = build(page(block(40, 'A') + block(40, 'B'), 1, 1));

    reflowReportPages(container, measure);

    expect(container.querySelectorAll('.pdf-page')).toHaveLength(1);
    expect(contentsOf(container)).toEqual([['A', 'B']]);
  });

  // 이 함수의 존재 이유다 — 예전에는 이 문서가 저장 자체를 거부당했다.
  test('넘치는 뒷부분을 이어지는 쪽으로 흘려보낸다', () => {
    const container = build(page(block(60, 'A') + block(60, 'B'), 1, 1));

    reflowReportPages(container, measure);

    expect(contentsOf(container)).toEqual([['A'], ['B']]);
  });

  test('한 쪽으로도 모자라면 담길 때까지 계속 나눈다', () => {
    const container = build(page(block(60, 'A') + block(60, 'B') + block(60, 'C'), 1, 1));

    reflowReportPages(container, measure);

    expect(contentsOf(container)).toEqual([['A'], ['B'], ['C']]);
  });

  // 제목만 쪽 바닥에 남고 본문이 다음 장으로 넘어가면, 읽는 사람은 그 제목이 무엇의
  // 제목인지 알 수 없다.
  test('제목만 남기고 본문을 넘기지 않는다', () => {
    const container = build(page(block(50, 'A') + heading(20, '리스크 알림') + block(50, 'B'), 1, 1));

    reflowReportPages(container, measure);

    expect(contentsOf(container)).toEqual([['A'], ['리스크 알림', 'B']]);
  });

  // 목록이 쪽을 넘어가면 다음 장은 알림 상자부터 시작한다. 제목이 없으면 읽는 사람은
  // 그것이 무엇의 목록인지, 앞 쪽에서 이어진 것인지 알 수 없다.
  test('이어지는 쪽에 「제목 (계속)」을 붙인다', () => {
    const container = build(page(
      heading(20, '⚠ 리스크 알림') + block(50, 'A') + block(50, 'B'), 1, 1));

    reflowReportPages(container, measure);

    expect(contentsOf(container)).toEqual([['⚠ 리스크 알림', 'A'], ['⚠ 리스크 알림 (계속)', 'B']]);
  });

  test('이어받을 제목이 없으면 붙이지 않는다', () => {
    const container = build(page(block(60, 'A') + block(60, 'B'), 1, 1));

    reflowReportPages(container, measure);

    expect(contentsOf(container)).toEqual([['A'], ['B']]);
  });

  // 복제본을 또 복제하는 자리다. 꼬리가 쌓이면 「(계속) (계속) (계속)」이 인쇄된다.
  test('세 쪽으로 나뉘어도 꼬리를 겹쳐 붙이지 않는다', () => {
    const container = build(page(
      heading(20, '⚠ 리스크 알림') + block(50, 'A') + block(50, 'B') + block(50, 'C'), 1, 1));

    reflowReportPages(container, measure);

    expect(contentsOf(container)).toEqual([
      ['⚠ 리스크 알림', 'A'],
      ['⚠ 리스크 알림 (계속)', 'B'],
      ['⚠ 리스크 알림 (계속)', 'C'],
    ]);
  });

  // 제목 자체가 다음 장으로 넘어가는 경우다(위의 keep-with-next). 그 제목은 이어진 것이
  // 아니라 «처음» 등장하는 것이므로 꼬리를 붙이면 거짓말이 된다.
  test('제목이 통째로 넘어갈 때는 꼬리를 붙이지 않는다', () => {
    const container = build(page(block(50, 'A') + heading(20, '⚠ 리스크 알림') + block(50, 'B'), 1, 1));

    reflowReportPages(container, measure);

    expect(contentsOf(container)).toEqual([['A'], ['⚠ 리스크 알림', 'B']]);
  });

  // 한 덩어리가 그 자체로 한 장보다 크면 쪼갤 수 없다. 통째로 다음 장에 옮겨 봐야 똑같이
  // 넘치므로, 빈 쪽을 끝없이 만들지 말고 그대로 두어 넘침 가드가 알리게 한다.
  test('한 장보다 큰 덩어리 하나는 빈 쪽을 만들지 않는다', () => {
    const container = build(page(block(300, 'A'), 1, 1));

    reflowReportPages(container, measure);

    expect(container.querySelectorAll('.pdf-page')).toHaveLength(1);
    expect(contentsOf(container)).toEqual([['A']]);
  });

  test('쪽이 늘어나면 쪽 번호를 다시 매긴다', () => {
    const container = build(
      page(block(60, 'A') + block(60, 'B'), 1, 2)
      + page(block(40, 'C'), 2, 2));

    reflowReportPages(container, measure);

    expect(pageNumbersOf(container)).toEqual([
      '페이지 1 / 3', '페이지 2 / 3', '페이지 3 / 3',
    ]);
  });

  // 각주가 「7페이지 세금 설정」이라고 적어 놓았는데 재배치로 그 쪽이 8쪽이 되면, 문서가
  // 조용히 엉뚱한 쪽을 가리킨다. 리포트는 화면보다 오래 남고 그대로 인용된다.
  test('쪽을 가리키는 각주를 실제 자리로 다시 잇는다', () => {
    const container = build(
      page(block(60, 'A') + block(60, 'B'), 1, 3)
      + page('<p data-h="10">세금은 <span data-page-ref="tax">3</span>페이지 참고</p>', 2, 3)
      + page(block(40, '세금 설정'), 3, 3, ' data-page-anchor="tax"'));

    reflowReportPages(container, measure);

    expect(container.querySelector('[data-page-ref="tax"]')!.textContent).toBe('4');
  });

  // 닻이 복제본에도 남으면 각주가 「이어지는 쪽」을 가리킨다 — 그 쪽에는 가리킬 내용이 없다.
  test('나뉜 쪽의 닻은 원래 쪽에만 남는다', () => {
    const container = build(
      page(block(60, 'A') + block(60, 'B'), 1, 1, ' data-page-anchor="tax"'));

    reflowReportPages(container, measure);

    const anchored = container.querySelectorAll('[data-page-anchor="tax"]');
    expect(anchored).toHaveLength(1);
    expect(anchored[0].querySelector('.pdf-content')!.textContent).toBe('A');
  });

  test('이어지는 쪽도 바닥글을 갖는다', () => {
    const container = build(page(block(60, 'A') + block(60, 'B'), 1, 1));

    reflowReportPages(container, measure);

    expect(container.querySelectorAll('.pdf-footer')).toHaveLength(2);
  });
});
