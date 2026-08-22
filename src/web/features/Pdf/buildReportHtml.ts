import type { SimulationParams, SimulationResult, SimulationYearlyResult, TaxSettings } from '../../../core/entities/types';
import { describePrivatePensionLabel } from './describePrivatePension';
import { describeInvestmentAssetLabel } from './describeInvestmentAsset';
import { describeIsaAccountLabel } from './describeIsaAccount';
import { escapeHtml } from './escapeHtml';
import { computeMonthlySpendingComposition, type MonthlySpendingComposition } from '../../../core/usecases/MonthlySpendingComposition';
import { formatCurrencyUnit } from './pdfReportSections';
import {
  NATIONAL_PENSION_DEFERRED_MAX_AGE,
  NATIONAL_PENSION_EARLY_MIN_AGE,
  NATIONAL_PENSION_NORMAL_START_AGE,
} from '../../../core/usecases/pension/nationalPensionRules';

/** 이미 렌더된 섹션 조각들. 각 값은 pdfReportSections의 render*Section 결과다. */
export interface ReportSectionHtml {
  planVerdict: string;
  /**
   * 「내가 고른 목표들이 서로 맞지 않는다」. 충돌이 없으면 빈 문자열이고, 그때는 자리 자체가
   * 생기지 않는다 — 빈 껍데기도 「충돌 없음」 문구도 두지 않는다.
   *
   * 선택 필드로 두지 않는다. 빠뜨려도 컴파일이 통과하면 충돌은 「없다」가 아니라 조용히
   * 사라지고, 그 침묵은 「목표가 서로 맞는다」와 구분되지 않는다.
   */
  goalConflict: string;
  strategyRecommendation: string;
  riskAlerts: string;
  shortfallSummary: string;
  nationalPension: string;
  executionRoadmap: string;
  sensitivityTable: string;
  keyLevers: string;
  /** 워커가 아직 끝나지 않았으면 빈 문자열이고, 그때는 이 페이지를 통째로 생략한다. */
  monteCarlo: string;
}

export interface ReportHtmlInput {
  /** 결과(result)를 만든 params. 사용자가 입력한 원본이 아니다 — handleDownload 주석 참고. */
  params: SimulationParams;
  result: SimulationResult;
  /** resolveTaxSettings를 이미 거친 «완전한» 설정. 부분 설정을 넘기면 화면과 값이 갈린다. */
  taxSettings: Required<TaxSettings>;
  displayCurrencyUnit: string;
  formatValue: (value: number) => string;
  /**
   * 시계는 호출자가 읽어 «포맷된 문자열»로 넘긴다. toLocaleString()은 실행 환경의
   * 로케일에 따라 결과가 달라져, 여기서 부르면 이 함수가 순수하지 않게 되고
   * 골든 테스트가 환경에 따라 깨진다.
   */
  generatedAtText: string;
  copyrightYear: number;
  sections: ReportSectionHtml;
}



/**
 * 연도별 자산·소득 표 페이지들.
 *
 * 42행씩 나뉘어 여러 장이 되지만 섹션 번호는 하나다 — 첫 청크에서만 소비한다.
 *
 * **firstPageNo를 반환하는 이유**: 이 표가 실제로 몇 페이지에서 시작하는지는 앞 섹션들이
 * 몇 장을 썼는지에 달려 있고, 다른 페이지의 각주가 그 번호를 가리킨다. 예전에는 바깥
 * 변수에 대입해 넘겼는데, 그러면 이 함수가 호출자의 상태를 몰래 바꾸는 셈이라 순서를
 * 옮기는 순간 조용히 틀어진다. 값으로 돌려주면 호출자가 받아 쓰는 것이 눈에 보인다.
 */
function renderYearlyTablePages(args: {
  chunks: readonly SimulationYearlyResult[][];
  /** 생활비 표가 뒤따르는지. 마지막 청크인지 판정해 페이지 꼬리 문구를 가른다. */
  hasSpendingSection: boolean;
  nextSection: () => number;
  nextPage: () => number;
  formatValuePrint: (value: number) => string;
  hasHealthcareCost: boolean;
  healthcareNoteHtml: string;
  realValueNoteHtml: string;
  copyrightYear: number;
}): { html: string; firstPageNo: number } {
  const {
    chunks, hasSpendingSection, nextSection, nextPage, formatValuePrint,
    hasHealthcareCost, healthcareNoteHtml, realValueNoteHtml, copyrightYear,
  } = args;
  let out = '';
  let firstPageNo = 0;
      const yearlyTableSectionNo = nextSection();
      chunks.forEach((chunk, chunkIdx) => {
        const pageNum = nextPage();
        if (chunkIdx === 0) firstPageNo = pageNum;
        const isLastChunk = chunkIdx === chunks.length - 1 && !hasSpendingSection;
        out += `
          <div class="pdf-page"${chunkIdx === 0 ? ' data-page-anchor="yearly"' : ''}>
            <div class="pdf-content">
              <h2 style="font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 12px;">
                ${yearlyTableSectionNo}. 연령별 소득원 및 자산 추이 (${chunkIdx + 1}/${chunks.length})
              </h2>
              ${realValueNoteHtml}
              ${healthcareNoteHtml}
              <table class="pdf-data-table" style="width: 100%; border-collapse: collapse; font-size: 9px;">
                <thead>
                  <tr>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center; background-color: #f1f5f9; font-weight: 700; color: #334155;">나이</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center; background-color: #f1f5f9; font-weight: 700; color: #334155;">연도</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">총 자산</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">총 소득</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">생활비${hasHealthcareCost ? '<br/>(의료비 포함)' : ''}</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">배당/투자</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">연금</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">기타</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">금융소득과세</th>
                  </tr>
                </thead>
                <tbody>
        `;

        chunk.forEach((yr, idx) => {
          const bg = idx % 2 === 1 ? 'background-color: #f8fafc;' : '';
          out += `
            <tr style="${bg}">
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center;">${yr.age}세</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center;">${yr.year}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.totalAssets)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.totalIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.spending)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.dividendIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.pensionIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.otherIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; ${yr.hasTaxWarning ? 'color: #ef4444; font-weight: bold;' : ''}">${formatValuePrint(yr.comprehensiveTaxPaid)}${yr.hasTaxWarning ? ' ⚠️' : ''}</td>
            </tr>
          `;
        });

        out += `
                </tbody>
              </table>
        `;

        if (isLastChunk) {
          out += `
            <div style="margin-top: 25px; font-size: 10px; color: #64748b; border-top: 1px solid #cbd5e1; padding-top: 10px;">
              <p style="margin: 0 0 4px 0;"><strong>중요 투자 및 시뮬레이션 법적 면책 고지</strong></p>
              <p style="margin: 0; line-height: 1.4;">본 NextLife 웹 서비스에서 산출 및 표시되는 모든 결과는 사용자가 가정치와 과거 시장 데이터에 기반한 시뮬레이션 결과입니다. 이는 미래의 실제 자산 가치 및 수익률을 보장하지 않습니다. 실제 투자 결정 시에는 반드시 전문 공인 재무 설계사와 상의하시기 바랍니다.</p>
              <p style="margin: 4px 0 0 0;">&copy; ${copyrightYear} NextLife. Created by TokkiLab. All rights reserved.</p>
            </div>
          `;
        }

        out += `
            </div>
            <div class="pdf-footer">
              <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
              <span class="pdf-page-number">페이지 ${pageNum} / {total_pages}</span>
            </div>
          </div>
        `;
      });
  return { html: out, firstPageNo };
}

/** 생활비 재원 구성 표 페이지들. 은퇴 후 구간이 없으면 한 장도 만들지 않는다. */
function renderSpendingTablePages(args: {
  chunks: readonly MonthlySpendingComposition[][];
  hasSpendingSection: boolean;
  nextSection: () => number;
  nextPage: () => number;
  formatValuePrint: (value: number) => string;
  realValueNoteHtml: string;
  copyrightYear: number;
}): string {
  const {
    chunks: spendingChunks, hasSpendingSection, nextSection, nextPage,
    formatValuePrint, realValueNoteHtml, copyrightYear,
  } = args;
  let out = '';
      const spendingTableSectionNo = hasSpendingSection ? nextSection() : 0;
      spendingChunks.forEach((chunk, chunkIdx) => {
        const pageNum = nextPage();
        const isLastChunk = chunkIdx === spendingChunks.length - 1;
        out += `
          <div class="pdf-page">
            <div class="pdf-content">
              <h2 style="font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 12px;">
                ${spendingTableSectionNo}. 은퇴 후 월 생활비 재원 구성 (${chunkIdx + 1}/${spendingChunks.length})
              </h2>
              ${realValueNoteHtml}
              <table class="pdf-data-table" style="width: 100%; border-collapse: collapse; font-size: 9px;">
                <thead>
                  <tr>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center; background-color: #f1f5f9; font-weight: 700; color: #334155;">나이</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">국민연금</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">사적연금</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">배당소득</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">기타소득</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">자산인출</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">자산부족</th>
                  </tr>
                </thead>
                <tbody>
        `;

        chunk.forEach((d, idx) => {
          const bg = idx % 2 === 1 ? 'background-color: #f8fafc;' : '';
          out += `
            <tr style="${bg}">
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center;">${d.age}세</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(d.nationalUsed)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(d.privatePenUsed)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(d.dividendUsed)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(d.otherUsed)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(d.assetWithdrawal)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; ${d.shortfall > 0 ? 'color: #ef4444; font-weight: bold;' : ''}">${formatValuePrint(d.shortfall)}</td>
            </tr>
          `;
        });

        out += `
                </tbody>
              </table>
              <p style="margin-top: 10px; font-size: 10px; color: #64748b;">* 월 생활비 재원 구성은 연간 금액을 월 단위로 환산한 값이며, 사적연금 열은 저율과세 한도와 무관하게 실제 시뮬레이션 인출액을 그대로 반영합니다. 한도 초과 시 발생하는 세금은 <span data-page-ref="tax">{tax_page}</span>페이지 세금 설정과 <span data-page-ref="yearly">{yearly_page}</span>페이지 금융소득과세 열을 참고하세요.</p>
        `;

        if (isLastChunk) {
          out += `
            <div style="margin-top: 25px; font-size: 10px; color: #64748b; border-top: 1px solid #cbd5e1; padding-top: 10px;">
              <p style="margin: 0 0 4px 0;"><strong>중요 투자 및 시뮬레이션 법적 면책 고지</strong></p>
              <p style="margin: 0; line-height: 1.4;">본 NextLife 웹 서비스에서 산출 및 표시되는 모든 결과는 사용자가 가정치와 과거 시장 데이터에 기반한 시뮬레이션 결과입니다. 이는 미래의 실제 자산 가치 및 수익률을 보장하지 않습니다. 실제 투자 결정 시에는 반드시 전문 공인 재무 설계사와 상의하시기 바랍니다.</p>
              <p style="margin: 4px 0 0 0;">&copy; ${copyrightYear} NextLife. Created by TokkiLab. All rights reserved.</p>
            </div>
          `;
        }

        out += `
            </div>
            <div class="pdf-footer">
              <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
              <span class="pdf-page-number">페이지 ${pageNum} / {total_pages}</span>
            </div>
          </div>
        `;
      });
  return out;
}

// 9pt 표와 4px 셀 여백에서는 A4 한 장에 42행이 잘림 없이 들어간다. 기존 30행은
// 10~12행짜리 반쪽 페이지를 반복해서 만들어 동일 샘플이 10페이지까지 늘어났다.
const ROWS_PER_PAGE = 42;

/** 표를 한 장 분량씩 나눈다. 연도별 표와 생활비 구성 표가 같은 규칙을 쓴다. */
function chunkRows<T>(rows: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    chunks.push(rows.slice(i, i + ROWS_PER_PAGE));
  }
  return chunks;
}

/**
 * 「연금·자산 현황」의 계좌 목록 한 덩어리.
 *
 * 사적연금·투자자산·ISA·기타소득 네 목록이 완전히 같은 모양이라(제목 + <ul> + 항목 또는
 * 「없음」), 예전에는 if/forEach/else가 네 번 복제돼 있었다. 그중 세 곳에서 표기 결함이
 * 각각 따로 발견됐다 — 한 곳을 고쳐도 나머지는 그대로였다는 뜻이다.
 *
 * **들여쓰기가 출력의 일부다.** 템플릿 리터럴 안의 공백이 그대로 HTML에 실리므로
 * 보기 좋게 당기면 골든이 깨진다(buildReportHtml 주석 참고).
 */
function renderAccountList<T>(
  title: string,
  items: readonly T[] | undefined,
  describeItem: (item: T) => string,
  emptyText: string,
): string {
  const body = items && items.length > 0
    ? items.map(describeItem).join('')
    : `<li>${emptyText}</li>`;
  return `              <div>
                <strong>${title}:</strong>
                <ul style="padding-left: 20px; margin-top: 4px; margin-bottom: 0;">
      ${body}
                </ul>
              </div>`;
}

/**
 * 리포트 전 페이지의 HTML을 만든다.
 *
 * **DOM도 jsPDF도 건드리지 않는 순수 함수다.** 같은 입력이면 같은 문자열을 준다 —
 * 그래서 골든 스냅샷으로 잠글 수 있다(buildReportHtml.test.ts).
 *
 * 예전에는 page.tsx의 handleDownload 안에 632줄로 들어 있었다. 그 안에서는 DOM 생성·
 * html2canvas·jsPDF와 뒤섞여 있어 조립 결과만 따로 확인할 방법이 없었고, 실제로
 * 「undefined (IRP)」·「KODEX 200 (etf)」·「퇴직연금이 기타로」 같은 결함이 실물 PDF를
 * 눈으로 훑기 전까지 드러나지 않았다.
 *
 * **아래 본문의 들여쓰기가 한 단계 깊은 것은 실수가 아니다.** 템플릿 리터럴 안의 공백은
 * 곧 출력 HTML의 공백이라, 보기 좋게 당기는 순간 골든이 깨진다(실제로 한 번 깨뜨렸다).
 * 원문 그대로 옮겼다.
 *
 * **번호 카운터의 순서 결합도 그대로다.** nextSection()/nextPage()는 템플릿 리터럴의
 * 좌→우 평가 순서로 소비된다(아래 주석 참고). 이번 변경은 «이동»만 하고 그 설계는
 * 손대지 않는다 — 이동과 재설계를 같이 하면 무엇이 틀어졌는지 가릴 수 없다.
 */
export function buildReportHtml(input: ReportHtmlInput): string {
  const {
    params: reportParams,
    result,
    taxSettings: currentTaxSettings,
    displayCurrencyUnit,
    formatValue: formatValuePrint,
    generatedAtText,
    copyrightYear,
    sections,
  } = input;

  // retirementScore·depletionAge·endingAssets는 1페이지 판정 블록이 소유한다
  // (planVerdict 섹션에서 이미 렌더되어 들어온다). 여기서 다시 꺼내지 않는다.
  const { yearlyResults } = result;
  const {
    userProfile,
    assets,
    privatePensions,
    isaAccounts,
    nationalPension,
    otherIncomes,
    inflationRate,
    inflationMode,
    baseExchangeRate,
  } = reportParams;

  // 저장값을 그대로 찍으면 안 된다. 엔진(SimulationEngine)과 explainNationalPension이 모두
  // [60, 70]으로 clamp한 나이로 계산하므로, 옛 시나리오의 58 같은 값을 여기서만 원문으로
  // 내면 「58세부터 수령」 바로 아래 표가 「60세 개시」라고 말하는 문서가 된다.
  const nationalPensionClaimAge = Math.min(
    NATIONAL_PENSION_DEFERRED_MAX_AGE,
    Math.max(
      NATIONAL_PENSION_EARLY_MIN_AGE,
      reportParams.withdrawalPlan?.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE,
    ),
  );

  const {
    planVerdict: planVerdictSectionHtml,
    // 목표 충돌 고지. 「현재 계획 진단」 아래, 「NextLife 추천」 «위»에 놓는다 — 무엇이
    // 부딪히는지를 먼저 알아야 추천이 왜 그런 모양인지 이해된다(스펙). 추천 절 «안»이
    // 아닌 이유도 같다: 충돌은 추천의 근거가 아니라 목표들 사이의 사실이다.
    //
    // 절 번호를 주지 않는다. 조건부로만 나타나는 고지에 번호를 매기면 계획에 따라 뒤
    // 절들의 번호가 밀린다(리스크 알림도 같은 이유로 번호가 없다).
    //
    // 아래 조립에서 이 값은 「NextLife 추천」 제목 «바로 앞»에 이어 붙는다. 줄을 따로
    // 잡지 않는 이유는, 충돌이 없는 계획의 리포트가 빈 줄 하나도 얻지 않아야 하기
    // 때문이다 — 없는 것은 자리도 만들지 않는다.
    goalConflict: goalConflictSectionHtml,
    strategyRecommendation: strategyRecommendationHtml,
    riskAlerts: riskAlertsSectionHtml,
    shortfallSummary: shortfallSummarySectionHtml,
    nationalPension: nationalPensionSectionHtml,
    executionRoadmap: executionRoadmapSectionHtml,
    sensitivityTable: sensitivityTableSectionHtml,
    keyLevers: keyLeversSectionHtml,
    monteCarlo: monteCarloHtml,
  } = sections;

      // **페이지·섹션 번호를 리터럴로 쓰지 않는다.**
      //
      // 예전에는 두 번호가 전부 하드코딩이었고, 조건부인 시장 변동성 페이지 때문에 실제로
      // 어긋나 있었다: 「7. 시장 변동성 분석」과 「7. 연령별 소득원…」이 둘 다 7번이었고,
      // 재원 구성 각주는 "5페이지 세금 설정과 6페이지 금융소득과세"를 고정 문자열로 가리켰다.
      // 섹션 하나만 넣거나 빼도 문서 전체의 번호가 조용히 틀어지는 구조였다.
      //
      // 두 카운터는 **문서에 등장하는 순서대로** 소비된다(템플릿 리터럴은 왼쪽부터 평가된다).
      //
      // **쪽 번호는 여기서 «잠정»으로 찍힌다.** 이 함수는 각 조각이 실제로 몇 픽셀을
      // 차지하는지 모르므로(DOM이 없다), 내용이 한 장을 넘치면 reflowReportPages가 그리기
      // 직전에 이어지는 쪽을 만들어 넣는다. 그 순간 여기서 매긴 번호는 밀린다. 그래서
      // 쪽 번호는 class="pdf-page-number"로, 번호를 가리키는 각주는 data-page-ref로,
      // 가리켜지는 쪽은 data-page-anchor로 표시해 둔다 — 그 표시가 없으면 재배치 뒤
      // 「7페이지 세금 설정」이 다른 쪽을 가리키게 된다.
      let sectionNo = 0;
      const nextSection = () => (sectionNo += 1);
      let pageNo = 0;
      const nextPage = () => (pageNo += 1);
      // 각주가 가리키는 페이지 번호를 나중에 채우기 위한 자리표. 실제 번호는 그 페이지를
      // 만들 때 확정되므로, 하드코딩 대신 치환으로 잇는다.
      let taxSettingsPageNo = 0;
      let firstYearlyTablePageNo = 0;

      // 시장 변동 검증은 **진단·추천 바로 뒤에 둔다**(화면의 「계획의 근거」 첫 항목과 같다).
      //
      // 예전에는 마지막 고정 페이지였다. 그래서 1페이지의 "기대수명까지 고갈 없음"을 읽은
      // 사용자가 여섯 페이지 뒤에야 "1,000회 중 37%만 남음"을 보게 됐다. 앞의 좋은 결과를
      // 강조하고 뒤의 위험을 별도 페이지에 숨긴 구조였다. 수익률 순서 위험(같은 평균,
      // 다른 순서)은 이 리포트에서 가장 값어치 있는 분석이기도 하다.
      //
      // 워커가 아직 끝나지 않았으면 이 페이지는 생략된다. 그때도 1페이지의 판정 블록이
      // "아직 계산되지 않았습니다"라고 밝히므로(renderPlanVerdictSection), 리포트가
      // 결정론 결과만 담은 채 완결된 문서처럼 보이는 일은 없다.
      const monteCarloPageHtml = () => monteCarloHtml === '' ? '' : `
        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">${nextSection()}. 시장 변동 검증</h2>
            ${monteCarloHtml}
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span class="pdf-page-number">페이지 ${nextPage()} / {total_pages}</span>
          </div>
        </div>
      `;

      // Page 1: Summary and Settings
      // 네 목록을 먼저 만들어 둔다 — 템플릿 안에서 조립하면 pagesHtml += 가 네 번 끼어들어
      // 한 페이지의 HTML이 다섯 조각으로 끊긴다.
      // 네 목록만이 이 문서에서 «사용자가 자유롭게 적은 문자열»을 싣는 자리다. 나머지는 전부
      // 숫자이거나 우리가 고른 라벨이라, escapeHtml이 필요한 곳은 정확히 여기뿐이다.
      const accountListsHtml = [
        renderAccountList('사적연금', privatePensions, (p) =>
          `<li style="margin-bottom: 4px;"><strong>${escapeHtml(describePrivatePensionLabel(p))}</strong>: 현재 잔액 ${p.balance.toLocaleString()} ${formatCurrencyUnit(p.currency)}, 매월 ${p.monthlyContribution.toLocaleString()} ${formatCurrencyUnit(p.currency)} 납입, 연 총수익률 ${p.totalReturn}%${p.dividendYield ? ` (배당 ${p.dividendYield}% 포함)` : ''}</li>`,
          '등록된 사적연금 없음'),
        renderAccountList('투자 자산', assets, (a) =>
          `<li style="margin-bottom: 4px;"><strong>${escapeHtml(describeInvestmentAssetLabel(a))}</strong>: ${a.quantity}주(개) x 평균단가 ${a.averagePrice.toLocaleString()} ${formatCurrencyUnit(a.currency)}, 매월 ${a.monthlyContribution.toLocaleString()} ${formatCurrencyUnit(a.currency)} 납입, 연 총수익률 ${a.totalReturn}% (배당 ${a.dividendYield}% 포함), 배당 재투자 ${a.reinvestDividend ? 'O' : 'X'}</li>`,
          '등록된 투자 자산 없음'),
        renderAccountList('ISA 계좌', isaAccounts, (isa) =>
          `<li style="margin-bottom: 4px;"><strong>${escapeHtml(describeIsaAccountLabel(isa))}</strong>: 현재 잔액 ${isa.balance.toLocaleString()} ${formatCurrencyUnit(isa.currency)}, 매월 ${isa.monthlyContribution.toLocaleString()} ${formatCurrencyUnit(isa.currency)} 납입, 연 총수익률 ${isa.totalReturn}% (배당 ${isa.dividendYield}% 포함), 만기 ${isa.maturityYears}년</li>`,
          '등록된 ISA 계좌 없음'),
        renderAccountList('기타 소득', otherIncomes, (i) =>
          `<li style="margin-bottom: 4px;"><strong>${escapeHtml(i.label)}</strong>: 매월 ${i.monthlyAmount.toLocaleString()} ${formatCurrencyUnit(i.currency)}</li>`,
          '등록된 기타 소득 없음'),
      ].join('\n');

      let pagesHtml = `
        <div class="pdf-page">
          <div class="pdf-content">
            <h1 style="font-size: 26px; border-bottom: 3px solid #3b82f6; padding-bottom: 12px; color: #1e3a8a; margin-top: 0;">NextLife 은퇴 자산 시뮬레이션 결과 리포트</h1>
            <p style="font-size: 11px; color: #64748b; margin-bottom: 25px;">출력 일시: ${generatedAtText}</p>
            
            <h2 style="margin-top: 0; font-size: 17px; color: #0f172a; border-bottom: none; padding-bottom: 0; margin-bottom: 12px;">${nextSection()}. 현재 계획 진단</h2>
            ${planVerdictSectionHtml}
            ${shortfallSummarySectionHtml}
            ${riskAlertsSectionHtml}

            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 25px; margin-bottom: 10px;">${nextSection()}. 시뮬레이션 설정 상태</h2>
            <ul style="padding-left: 20px; margin-top: 5px; margin-bottom: 25px; font-size: 13px; line-height: 1.6;">
              <li style="margin-bottom: 6px;"><strong>현재 나이:</strong> ${userProfile.currentAge}세 / <strong>은퇴 목표 나이:</strong> ${userProfile.retirementAge}세 / <strong>기대 수명:</strong> ${userProfile.expectancy}세</li>
              <li style="margin-bottom: 6px;"><strong>목표 월 생활비:</strong> ${userProfile.targetMonthlySpending.toLocaleString()} ${displayCurrencyUnit}</li>
              <li style="margin-bottom: 6px;"><strong>인출 전략:</strong> ${reportParams.spendingStrategy === 'dividend_only' ? '배당금(이자) 100% 소비' : reportParams.spendingStrategy === 'max_sustainable' ? '최대 가능 생활비 자동계산' : '고정 목표 생활비'}</li>
              <li style="margin-bottom: 6px;"><strong>물가 상승률:</strong> ${inflationRate}% (${inflationMode === 'real' ? '실질 가치 기준 — 아래 모든 표의 생활비·연금 금액은 오늘 화폐가치로 고정 표시되며, 인플레이션은 자산 성장률에 사전 차감 반영되었습니다' : '명목 가치 기준 — 아래 모든 표의 생활비·연금 금액에 물가상승률이 매년 누적 반영되어 있습니다'})</li>
              <li style="margin-bottom: 6px;"><strong>표시 통화 / 기준 환율:</strong> ${displayCurrencyUnit} / 1 $ = ${baseExchangeRate.toLocaleString()}원</li>
            </ul>
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span class="pdf-page-number">페이지 ${nextPage()} / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
          <div class="pdf-content">
            ${goalConflictSectionHtml}<h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">${nextSection()}. NextLife 추천</h2>
            <p style="font-size: 11px; color: #64748b; margin-top: 0; margin-bottom: 14px;">목표에 가장 가까운 최종 전략과, 현재 계획에서 바뀌는 점만 비교합니다.</p>
            ${strategyRecommendationHtml}
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span class="pdf-page-number">페이지 ${nextPage()} / {total_pages}</span>
          </div>
        </div>

        ${monteCarloPageHtml()}

        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">${nextSection()}. 실행 시점 및 민감도 분석</h2>
            <p style="font-size: 11px; color: #64748b; margin-top: 0; margin-bottom: 14px;">무엇부터 손대야 하는지, 현재 설정에서 나이별로 무슨 일이 일어나는지, 그리고 핵심 가정이 바뀌었을 때 결과가 얼마나 민감한지를 보여줍니다.</p>

            ${keyLeversSectionHtml}

            <h3 style="font-size: 13px; color: #0f172a; margin-bottom: 8px;">실행 로드맵</h3>
            ${executionRoadmapSectionHtml}

            <h3 style="font-size: 13px; color: #0f172a; margin-top: 20px; margin-bottom: 8px;">민감도 분석 (자산 고갈 나이 기준)</h3>
            ${sensitivityTableSectionHtml}
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span class="pdf-page-number">페이지 ${nextPage()} / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page" data-page-anchor="tax">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">${nextSection()}. 연금·자산 현황 및 세금 설정</h2>
            <div style="font-size: 13px; line-height: 1.6; display: grid; grid-template-columns: 1fr; gap: 12px;">
              <div>
                <!-- nationalPension에는 ?.를 붙이지 않는다. SimulationParams의 «필수» 필드이고,
                     로드 경계(normalizeSimulationParams)가 이 객체를 반드시 채워서 내보낸다.
                     붙여 봐야 뒤가 체이닝되지 않아 「undefined원」이 찍히므로 방어처럼 보일 뿐
                     방어가 아니었다. 저장 데이터의 결손을 견디는 자리는 그 로드 경계이지
                     여기가 아니다. (SimulationEngine도 체인 없이 읽지만 그쪽은 구조분해
                     기본값을 두고 있어, 「없으면 먼저 터진다」는 근거는 성립하지 않는다.)
                     아래 withdrawalPlan?.는 실제로 선택 필드라 ??와 함께 그대로 둔다. -->
                <strong>국민연금:</strong> 예상 월 수령액 ${nationalPension.expectedMonthlyAmount.toLocaleString()}원 (${nationalPensionClaimAge}세부터 수령)
                ${nationalPensionSectionHtml}
              </div>
${accountListsHtml}
            </div>

            <h3 style="font-size: 13px; color: #0f172a; margin-top: 18px; margin-bottom: 6px;">세금 설정 (2024년 기준 단순화 모델)</h3>
            <p style="font-size: 9.5px; color: #94a3b8; margin: 0 0 6px;">실제 과세는 계좌·상품·소득 구간과 최신 세법에 따라 달라질 수 있으며, 세액공제·지방소득세 등 일부 항목은 포함하지 않습니다.</p>
            <ul style="padding-left: 20px; margin-top: 5px; margin-bottom: 0; font-size: 11px; line-height: 1.45;">
              <li style="margin-bottom: 6px;"><strong>금융소득종합과세 반영:</strong> ${currentTaxSettings.enableComprehensiveTax ? `반영 (2천만원 초과분 ${currentTaxSettings.comprehensiveTaxRate}% 추가 과세)` : '미반영'}</li>
              <li style="margin-bottom: 6px;"><strong>추가 건강보험료 반영:</strong> ${currentTaxSettings.enableHealthInsurance ? `반영 (초과분 ${currentTaxSettings.healthInsuranceRate}%)` : '미반영'}</li>
              <li style="margin-bottom: 6px;"><strong>배당소득세율:</strong> 해외 주식/ETF ${currentTaxSettings.usDividendTaxRate}% / 국내 주식/ETF ${currentTaxSettings.domesticDividendTaxRate}%</li>
              <li style="margin-bottom: 6px;"><strong>사적연금 고세율 과세 반영:</strong> ${currentTaxSettings.enablePrivatePensionTax ? '반영 - 한도 초과 시 고세율 적용' : '미반영 - 연령별 저율과세 유지'}</li>
              <li style="margin-bottom: 6px;"><strong>사적연금 저율과세 한도(연간):</strong> ${currentTaxSettings.privatePensionLimit.toLocaleString()}원, 한도 초과 시 세율 ${currentTaxSettings.privatePensionExcessTaxRate}%</li>
              <li style="margin-bottom: 6px;"><strong>사적연금 저율과세 한도 내 인출:</strong> ${currentTaxSettings.limitPrivatePensionToTaxLimit ? '한도 내 인출 (절세 최적화)' : '기본 인출 (일반 인출 계획)'}</li>
            </ul>
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span class="pdf-page-number">페이지 ${(taxSettingsPageNo = nextPage())} / {total_pages}</span>
          </div>
        </div>
      `;

      // Tables (이후 페이지 수는 데이터 양에 따라 달라진다)
      const chunks = chunkRows(yearlyResults);
      const spendingComposition = computeMonthlySpendingComposition(yearlyResults, reportParams, result);
      const spendingChunks = chunkRows(spendingComposition);
      const hasSpendingSection = spendingChunks.length > 0;

      // 의료비는 spending에 이미 합산되어 있어 "생활비" 열만 보면 왜 커졌는지 알 수 없다.
      // 의료비 가정을 실제로 켠 시나리오에서만 열 이름과 각주로 포함 사실을 밝힌다.
      //
      // "별도 지출이 아니다"를 무조건 단언하면 안 된다. 자산이 고갈된 해에는 엔진이 실제
      // 인출액을 가능한 만큼으로 깎으므로 spending < healthcareSpending이 되고, 그 해의
      // 「생활비」 열에는 의료비 전액이 들어 있지 않다(types.ts SimulationYearlyResult
      // .healthcareSpending의 "예외" 참조). 각주는 PDF에 그대로 인쇄되므로 단서를 붙인다.
      const hasHealthcareCost = yearlyResults.some((yr) => yr.healthcareSpending > 0);
      const healthcareNoteHtml = hasHealthcareCost
        ? '<p style="font-size: 9.5px; color: #94a3b8; margin: 0 0 8px;">* 「생활비」 열에는 의료비·장기요양비가 합산되어 있습니다(별도 지출이 아니라 같은 금액의 내역입니다). 다만 자산이 고갈된 해에는 인출 가능한 금액까지만 표시되므로 의료비 전액이 반영되지 않을 수 있습니다.</p>'
        : '';

      const realValueNoteHtml = inflationMode === 'real'
        ? '<p style="font-size: 9.5px; color: #94a3b8; margin: 0 0 8px;">* 아래 금액은 모두 오늘 시점 기준 실질 가치입니다(물가상승률은 자산 성장률에 사전 차감 반영되었습니다). 명목(미래 실제 지급) 금액이 아닙니다.</p>'
        : '<p style="font-size: 9.5px; color: #94a3b8; margin: 0 0 8px;">* 아래 금액은 물가상승률이 매년 누적 반영된 명목 가치입니다.</p>';

      // 섹션 번호는 여러 페이지로 나뉘어도 하나다 — 첫 청크에서만 소비한다.
      const yearlyTables = renderYearlyTablePages({
        chunks, hasSpendingSection, nextSection, nextPage, formatValuePrint,
        hasHealthcareCost, healthcareNoteHtml, realValueNoteHtml, copyrightYear,
      });
      pagesHtml += yearlyTables.html;
      firstYearlyTablePageNo = yearlyTables.firstPageNo;

      pagesHtml += renderSpendingTablePages({
        chunks: spendingChunks, hasSpendingSection, nextSection, nextPage,
        formatValuePrint, realValueNoteHtml, copyrightYear,
      });

      // 카운터가 실제로 만들어 낸 장수 그대로다 — 더 이상 따로 세지 않는다.
      pagesHtml = pagesHtml
        .replaceAll('{total_pages}', pageNo.toString())
        .replaceAll('{tax_page}', taxSettingsPageNo.toString())
        .replaceAll('{yearly_page}', firstYearlyTablePageNo.toString());

  return pagesHtml;
}
