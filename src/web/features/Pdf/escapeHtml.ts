/**
 * 사용자가 입력한 문자열을 HTML 본문에 넣을 수 있는 모양으로 바꾼다.
 *
 * 리포트 조립은 템플릿 문자열이고, 그 결과는 generateReportPdf에서 `innerHTML`로 실제
 * DOM이 된다(화면 밖이지만 `document.body` 아래다). 그래서 자산명·계좌명·기타소득 라벨처럼
 * 사용자가 자유롭게 적는 값은 반드시 이 함수를 지나야 한다.
 *
 * 이유가 둘이다.
 *
 * 1. **실행.** `innerHTML`은 `<script>`를 실행하지 않지만 `<img src=x onerror=...>`는
 *    붙는 즉시 실행한다. 시나리오는 서버를 왕복하므로(useScenarios) 이 문자열이 언제나
 *    본인이 쓴 것이라는 보장이 없다.
 * 2. **깨짐.** 공격이 아니어도 이름에 `<`나 `&`가 들어가면 `<li>`가 통째로 무너진다.
 *    그리고 generateReportPdf의 넘침 검사는 «높이»만 보므로 그 붕괴를 잡지 못한다.
 *
 * 정제 계층(normalizeSimulationParams)이 이 일을 대신할 수는 없다. 저쪽은 값이 문자열인지만
 * 보장하며, 마크업을 지우면 사용자가 실제로 적은 이름이 저장 데이터에서 사라진다.
 * 이스케이프는 «표시»의 책임이라 표시하는 자리에 있어야 한다.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
