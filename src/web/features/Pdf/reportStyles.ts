// PDF 리포트 전용 CSS.
//
// handleDownload 안에 78줄 문자열로 박혀 있던 것을 그대로 옮겼다. 보간이 하나도 없는
// 완전 정적 문자열이라 상수로 두는 것이 맞고, 조립 로직과 섞여 있을 이유가 없었다.
//
// 이 스타일은 화면이 아니라 html2canvas가 캡처할 오프스크린 컨테이너에만 적용된다
// (generateReportPdf 참고).
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
