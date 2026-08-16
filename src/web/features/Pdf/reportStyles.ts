// PDF 리포트 전용 CSS.
//
// handleDownload 안에 78줄 문자열로 박혀 있던 것을 그대로 옮겼다. 보간이 하나도 없는
// 완전 정적 문자열이라 상수로 두는 것이 맞고, 조립 로직과 섞여 있을 이유가 없었다.
//
// **셀렉터에 반드시 .pdf- 접두를 붙인다.** generateReportPdf가 이 문자열을 <style>로 만들어
// 오프스크린 컨테이너 «안에» 넣지만, <style>의 삽입 위치는 CSS를 가두지 못한다 — 규칙은
// 문서 전역이다. 지금 화면에 닿지 않는 것은 컨테이너에 넣었기 때문이 아니라 모든 셀렉터가
// .pdf-*로 시작하기 때문이며, 접두 없는 규칙(예: `ul { list-style: disc; }`)을 하나 넣으면
// PDF를 만드는 동안 앱 화면 전체가 그 규칙을 맞는다.
//
// .pdf-page의 794×1123px는 generateReportPdf의 PAGE_WIDTH_PX·PAGE_HEIGHT_PX와 같아야 한다
// (reportStyles.test.ts가 강제한다). 어긋나면 모든 페이지가 잘린 채로 저장된다.
export const REPORT_STYLES = `
        .pdf-page {
          width: 794px;
          height: 1123px;
          padding: 50px 50px 40px 50px;
          box-sizing: border-box;
          background-color: #ffffff;
          color: #1e293b;
          font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
        }
        .pdf-content {
          flex-grow: 1;
          min-height: 0;
        }
        .pdf-data-table th,
        .pdf-data-table td {
          padding: 4px 5px !important;
          line-height: 1.15;
        }
        .pdf-footer {
          font-size: 10px;
          color: #94a3b8;
          border-top: 1px solid #cbd5e1;
          padding-top: 10px;
          display: flex;
          justify-content: space-between;
        }
        .pdf-page ul {
          list-style: disc;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          column-gap: 22px;
          margin-top: 15px;
        }
        .summary-item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-rows: auto minmax(30px, auto);
          column-gap: 14px;
          min-height: 78px;
          padding: 10px 0;
          border-bottom: 1px dashed #e2e8f0;
          box-sizing: border-box;
        }
        .summary-label {
          margin: 0;
          font-size: 13.5px;
          font-weight: 600;
          color: #475569;
          line-height: 1.35;
        }
        .summary-note {
          margin: 5px 0 0;
          font-size: 9.5px;
          font-weight: 400;
          color: #94a3b8;
          line-height: 1.45;
        }
        .summary-value {
          grid-column: 2;
          grid-row: 1 / span 2;
          align-self: center;
          max-width: 235px;
          font-size: 15px;
          color: #0f172a;
          font-weight: 700;
          line-height: 1.35;
          text-align: right;
        }
      `;
