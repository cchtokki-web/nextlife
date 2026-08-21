/**
 * 한 장에 담기지 않는 쪽을 «이어지는 쪽»으로 흘려보낸다.
 *
 * buildReportHtml은 DOM이 없어 각 조각이 몇 픽셀인지 모른다. 그래서 「진단」 쪽처럼 길이가
 * 계획마다 달라지는 내용(부족액 요약이 있는지, 리스크 알림이 몇 개인지)이 A4 한 장을
 * 넘길 수 있는데, 예전에는 그때 generateReportPdf의 넘침 가드가 저장을 통째로 중단했다.
 * 사용자에게는 "리포트 1쪽의 내용이 페이지를 넘어서 저장을 중단했습니다"만 남았고, 계획을
 * 고치는 것 말고는 문서를 받을 방법이 없었다 — 그런데 그 알림이 뜨는 계획이야말로
 * 리포트가 가장 필요한 계획이다.
 *
 * **이 단계는 «어떻게 그릴지»에 속한다.** 무엇을 쓸지는 그대로 두고, 실제로 잰 높이에
 * 맞춰 쪽 경계만 다시 긋는다. 그래서 buildReportHtml은 여전히 DOM을 모르는 순수 함수다.
 *
 * 가드는 그대로 남는다 — 한 덩어리가 그 자체로 한 장보다 크면 여기서도 쪼갤 수 없고,
 * 그때는 잘린 문서를 내주느니 멈추는 편이 낫다.
 */

/** 넘침 판정의 허용 오차. generateReportPdf의 가드와 같은 값이어야 한다. */
const OVERFLOW_TOLERANCE_PX = 1;

/** 잰 결과. 모든 값은 .pdf-content의 위쪽을 0으로 하는 px다. */
export interface ContentMetrics {
  /** 이 쪽이 내용에 내줄 수 있는 높이. */
  available: number;
  /** 자식마다의 아래끝. 여백이 포함된 실제 점유 높이라 단순 합보다 정확하다. */
  bottoms: readonly number[];
}

export type MeasureContent = (content: HTMLElement) => ContentMetrics;

/**
 * 실제 레이아웃을 재는 기본 구현.
 *
 * 주입 가능하게 둔 이유는 시험 때문이다 — jsdom은 레이아웃을 하지 않아 높이가 언제나 0이라,
 * 이 함수를 그대로 쓰면 「아무것도 넘치지 않는 문서」밖에 시험할 수 없다.
 */
export const measureContentByLayout: MeasureContent = (content) => {
  const contentTop = content.getBoundingClientRect().top;
  return {
    available: content.clientHeight,
    bottoms: Array.from(content.children).map(
      (child) => child.getBoundingClientRect().bottom - contentTop),
  };
};

/** 뒤에 오는 내용과 떨어지면 안 되는 요소. 제목만 남기고 본문을 넘기지 않는다. */
const KEEP_WITH_NEXT_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** 이어지는 쪽의 제목에 붙는 꼬리. 「⚠ 리스크 알림 (계속)」 */
const CONTINUATION_SUFFIX = ' (계속)';

/**
 * pagesContainer 안의 모든 .pdf-page를 훑어 넘치는 쪽을 나누고, 쪽 번호와 각주를 다시 맞춘다.
 *
 * 컨테이너가 이미 document에 붙어 있어야 한다(붙기 전에는 잴 수 없다).
 */
export function reflowReportPages(
  pagesContainer: HTMLElement,
  measure: MeasureContent = measureContentByLayout,
): void {
  let page = firstPage(pagesContainer);
  while (page !== null) {
    // 새로 만든 이어지는 쪽도 다시 검사한다. 남은 내용이 여전히 한 장을 넘으면 또 나뉜다.
    const continuation = spillOverflow(page, measure);
    page = continuation ?? nextPage(page);
  }

  renumberPages(pagesContainer);
  resolvePageReferences(pagesContainer);
}

function firstPage(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.pdf-page');
}

function nextPage(page: HTMLElement): HTMLElement | null {
  let sibling = page.nextElementSibling;
  while (sibling !== null && !sibling.classList.contains('pdf-page')) {
    sibling = sibling.nextElementSibling;
  }
  return sibling as HTMLElement | null;
}

/**
 * 넘치는 뒷부분을 새 쪽으로 옮긴다. 옮길 것이 없으면 null.
 *
 * 구조가 깨진 쪽(.pdf-content 없음)은 건드리지 않는다 — 그 판정은 호출자의 몫이고,
 * 여기서 조용히 넘어가야 호출자가 「구조가 손상됐다」고 정확히 말할 수 있다.
 */
function spillOverflow(page: HTMLElement, measure: MeasureContent): HTMLElement | null {
  const content = page.querySelector<HTMLElement>('.pdf-content');
  if (content === null) return null;

  const splitIndex = findSplitIndex(content, measure);
  if (splitIndex === null) return null;

  const continuation = page.cloneNode(false) as HTMLElement;
  // 닻은 «원래» 쪽에 남는다. 복제본에까지 남기면 각주가 이어지는 쪽을 가리킨다.
  continuation.removeAttribute('data-page-anchor');

  const continuationContent = content.cloneNode(false) as HTMLElement;
  continuation.appendChild(continuationContent);

  const footer = page.querySelector('.pdf-footer');
  if (footer !== null) continuation.appendChild(footer.cloneNode(true));

  // 내용을 옮기기 «전에» 제목을 놓는다. 뒤에 붙이면 알림들 아래에 제목이 오게 된다.
  const heading = buildContinuationHeading(content, splitIndex);
  if (heading !== null) continuationContent.appendChild(heading);

  // splitIndex를 고정해 두고 반복하면 원래 순서대로 옮겨진다(앞을 떼어 낼수록 뒤가 당겨진다).
  while (content.children.length > splitIndex) {
    continuationContent.appendChild(content.children[splitIndex]);
  }

  page.after(continuation);
  return continuation;
}

/**
 * 이어지는 쪽 맨 위에 놓을 「… (계속)」 제목. 이어받을 제목이 없으면 null.
 *
 * 목록이 쪽을 넘어가면 다음 장은 제목 없이 알림 상자부터 시작한다. 그러면 읽는 사람은
 * 그것이 무엇의 목록인지, 앞 쪽에서 이어진 것인지 알 수 없다. 앞쪽에 남은 가장 가까운
 * 제목을 그대로 복제해(글꼴·여백까지 같아야 한다) 꼬리만 붙인다.
 *
 * 텍스트만 갈아 끼우는 이유는 제목이 순수 문자열이기 때문이다. 안쪽 마크업이 생기면
 * 여기서 지워지므로, 그때는 이 함수를 함께 손봐야 한다.
 */
function buildContinuationHeading(content: HTMLElement, splitIndex: number): HTMLElement | null {
  for (let index = splitIndex - 1; index >= 0; index -= 1) {
    const child = content.children[index];
    if (!KEEP_WITH_NEXT_TAGS.has(child.tagName)) continue;
    const heading = child.cloneNode(false) as HTMLElement;
    const text = (child.textContent ?? '').trim();
    // 세 쪽으로 나뉘어도 「(계속) (계속)」이 되지 않는다 — 복제본을 또 복제하기 때문이다.
    heading.textContent = text.endsWith(CONTINUATION_SUFFIX) ? text : text + CONTINUATION_SUFFIX;
    // 원래 자리에서는 앞 내용과 떨어뜨리려고 위쪽 여백을 두지만, 쪽 맨 위에서는 그 여백이
    // 그대로 빈 띠가 된다. buildReportHtml도 쪽 첫 제목에는 margin-top: 0을 준다.
    heading.style.marginTop = '0';
    return heading;
  }
  return null;
}

/**
 * 몇 번째 자식부터 다음 쪽으로 넘길지. 넘길 필요가 없거나 넘길 수 없으면 null.
 *
 * 첫 자식부터 넘쳐 버리면(한 덩어리가 한 장보다 크다) null을 준다. 그 쪽을 통째로 다음
 * 장으로 옮겨 봐야 똑같이 넘치고, 빈 쪽만 끝없이 만들어진다.
 */
function findSplitIndex(content: HTMLElement, measure: MeasureContent): number | null {
  const { available, bottoms } = measure(content);
  const limit = available + OVERFLOW_TOLERANCE_PX;
  if (bottoms.length === 0 || bottoms[bottoms.length - 1] <= limit) return null;

  let splitIndex = bottoms.findIndex((bottom) => bottom > limit);
  const children = content.children;
  while (splitIndex > 0 && KEEP_WITH_NEXT_TAGS.has(children[splitIndex - 1].tagName)) {
    splitIndex -= 1;
  }
  return splitIndex > 0 ? splitIndex : null;
}

/** 「페이지 3 / 8」을 실제 장수로 다시 쓴다. 재배치로 번호가 밀렸을 수 있다. */
function renumberPages(container: HTMLElement): void {
  const pages = container.querySelectorAll('.pdf-page');
  pages.forEach((page, index) => {
    const label = page.querySelector('.pdf-page-number');
    if (label !== null) label.textContent = `페이지 ${index + 1} / ${pages.length}`;
  });
}

/** 「{n}페이지 세금 설정」 같은 각주를, 그 쪽이 실제로 놓인 자리로 다시 잇는다. */
function resolvePageReferences(container: HTMLElement): void {
  const pages = Array.from(container.querySelectorAll('.pdf-page'));
  container.querySelectorAll<HTMLElement>('[data-page-ref]').forEach((reference) => {
    const anchor = reference.dataset.pageRef;
    const index = pages.findIndex((page) => page.getAttribute('data-page-anchor') === anchor);
    // 가리키는 쪽이 없으면(그 섹션이 이 계획에 없다) 원래 번호를 그대로 둔다. 지우면
    // 「페이지 세금 설정」이라는 조각난 문장이 인쇄된다.
    if (index >= 0) reference.textContent = (index + 1).toString();
  });
}
