import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { SimulationParams } from '@/core/entities/types';
import { initialParams } from '@/infrastructure/storage/localStore';

// isFieldVisible이 실제로 호출된 경로를 기록한다. 어떤 섹션도 렌더하지 않는 "고아 경로"를
// 잡기 위해서다 — 고아 경로가 SECTION_FIELDS에 남아 있으면 변경 개수 배지는 붙는데
// 그 값을 되돌릴 입력이 화면 어디에도 없어(전문가 모드로 올려도) 배지를 지울 방법이 없다.
//
// 소스 문자열을 스캔하지 않고 런타임 호출을 기록하는 이유: AdvancedSection처럼 경로를
// 템플릿 문자열(`taxSettings.${key}`)로 만드는 섹션이 있어 정적 스캔으로는 놓친다.
const recordedPaths = new Set<string>();

vi.mock('@/web/features/StrategySettings/fieldVisibility', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/web/features/StrategySettings/fieldVisibility')
  >();
  return {
    ...actual,
    isFieldVisible: (mode: Parameters<typeof actual.isFieldVisible>[0], path: string) => {
      recordedPaths.add(path);
      return actual.isFieldVisible(mode, path);
    },
  };
});

const { SECTION_FIELDS } = await import('@/web/features/StrategySettings/fieldVisibility');
const { PensionStrategySection } = await import('@/web/features/StrategySettings/sections/PensionStrategySection');
const { InvestmentStrategySection } = await import('@/web/features/StrategySettings/sections/InvestmentStrategySection');
const { EconomicAssumptionSection } = await import('@/web/features/StrategySettings/sections/EconomicAssumptionSection');
const { AdvancedSection } = await import('@/web/features/StrategySettings/sections/AdvancedSection');

// 조건부로만 렌더되는 필드(의료비 하위 항목 등)까지 모두 나타나도록 모든 하위 토글을 켠
// params. 이 fixture가 불완전하면 테스트가 거짓 실패한다.
const allEnabledParams: SimulationParams = {
  ...initialParams,
  useLatestExchangeRate: false,
  strategy: {
    mode: 'expert',
    objective: 'ai_recommended',
    spendingChoice: 'target',
    bequestStrategy: 'leave_some',
    nationalPensionStrategy: 'ai_optimized',
    privatePensionStrategy: 'ai_optimized',
    preferIsaFirst: 'pension_first',
    riskProfile: 'ai_recommended',
    economicScenario: 'ai_recommended',
  },
  healthcare: {
    enabled: true, costGrowthRate: 3, baseMonthlyCost: 500000,
    longTermCareEnabled: true, longTermCareStartAge: 80, longTermCareMonthlyCost: 1500000,
    shockEnabled: true, shockAge: 75, shockAmount: 30000000,
  },
};

const ai = { recommendation: null, error: null, improved: false };

const sectionProps = {
  params: allEnabledParams,
  onChangeParams: vi.fn(),
  mode: 'expert' as const,
  changed: new Set<string>() as ReadonlySet<string>,
};

beforeEach(() => {
  recordedPaths.clear();
  // EconomicAssumptionSection은 마운트 시 환율을 조회한다. useLatestExchangeRate: false로
  // 껐지만, 네트워크에 나가지 않도록 확실히 막는다.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network in test')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SECTION_FIELDS 경로 렌더 계약', () => {
  test('모든 SECTION_FIELDS 경로는 어느 섹션에선가 실제로 렌더된다', () => {
    render(
      <>
        <PensionStrategySection {...sectionProps} ai={ai} />
        <InvestmentStrategySection {...sectionProps} ai={ai} />
        <EconomicAssumptionSection {...sectionProps} />
        <AdvancedSection {...sectionProps} />
      </>
    );

    const allPaths = Object.values(SECTION_FIELDS).flat();
    const orphans = allPaths.filter((path) => !recordedPaths.has(path));

    // 고아 경로는 "해소할 수 없는 유령 배지"를 만든다. 새 경로를 등록했다면 그 필드를
    // 렌더하는 섹션도 함께 만들어야 한다.
    expect(orphans).toEqual([]);
  });
});
