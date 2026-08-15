import { describe, test, expect } from 'vitest';
import {
  SECTION_FIELDS, isFieldVisible, isSectionVisible, SectionId,
} from '@/web/features/StrategySettings/fieldVisibility';
import { StrategyMode } from '@/core/entities/types';

// 「은퇴 목표」 섹션은 없다. 그 축들은 「은퇴 목표」 카드가 유일한 편집 경로다
// (normalizeGoalDrivenParams).
const ALL_SECTIONS: SectionId[] = ['basic', 'pension', 'investment', 'economic', 'advanced'];
const ALL_MODES: StrategyMode[] = ['simple', 'standard', 'expert'];

describe('fieldVisibility', () => {
  test('모든 섹션에 필드 목록이 정의되어 있다', () => {
    for (const s of ALL_SECTIONS) {
      expect(SECTION_FIELDS[s].length, `${s} 섹션`).toBeGreaterThan(0);
    }
  });

  test('같은 필드 경로가 두 섹션에 중복 등록되지 않는다', () => {
    const all = ALL_SECTIONS.flatMap((s) => SECTION_FIELDS[s]);
    expect(new Set(all).size).toBe(all.length);
  });

  test('전문가 모드에서는 모든 필드가 보인다', () => {
    for (const s of ALL_SECTIONS) {
      for (const path of SECTION_FIELDS[s]) {
        expect(isFieldVisible('expert', path), `${path}`).toBe(true);
      }
    }
  });

  test('간편 모드에서는 고급 설정 필드가 보이지 않는다', () => {
    for (const path of SECTION_FIELDS.advanced) {
      expect(isFieldVisible('simple', path), `${path}`).toBe(false);
    }
  });

  test('간편 모드에서도 나이와 연금 전략은 보인다', () => {
    expect(isFieldVisible('simple', 'userProfile.currentAge')).toBe(true);
    expect(isFieldVisible('simple', 'userProfile.expectancy')).toBe(true);
    expect(isFieldVisible('simple', 'strategy.nationalPensionStrategy')).toBe(true);
  });

  // 이 패널에 다시 등록하면 같은 값을 두 화면이 각자 편집하던 상태로 돌아간다.
  test('목표가 정하는 축은 어떤 모드에서도 이 패널에 없다', () => {
    const goalDriven = [
      'userProfile.retirementAge',
      'userProfile.targetMonthlySpending',
      'userProfile.targetBequest',
      'strategy.spendingChoice',
      'strategy.objective',
      'strategy.bequestStrategy',
      'strategy.spendingShape',
      'strategy.minMonthlySpending',
      'strategy.bequestSafetyMarginRate',
    ];
    for (const path of goalDriven) {
      for (const mode of ALL_MODES) {
        expect(isFieldVisible(mode, path), `${path} @ ${mode}`).toBe(false);
      }
    }
  });

  test('노출 범위는 간편 ⊆ 표준 ⊆ 전문가 순으로 넓어진다', () => {
    const visibleCount = (mode: StrategyMode) =>
      ALL_SECTIONS.flatMap((s) => SECTION_FIELDS[s]).filter((p) => isFieldVisible(mode, p)).length;

    expect(visibleCount('simple')).toBeLessThan(visibleCount('standard'));
    expect(visibleCount('standard')).toBeLessThan(visibleCount('expert'));
  });

  test('간편에서 보이는 필드는 표준/전문가에서도 전부 보인다', () => {
    const paths = ALL_SECTIONS.flatMap((s) => SECTION_FIELDS[s]);
    for (const path of paths.filter((p) => isFieldVisible('simple', p))) {
      for (const mode of ALL_MODES) {
        expect(isFieldVisible(mode, path), `${path} @ ${mode}`).toBe(true);
      }
    }
  });

  test('등록되지 않은 경로는 어떤 모드에서도 보이지 않는다', () => {
    expect(isFieldVisible('expert', 'nonexistent.path')).toBe(false);
  });

  describe('isSectionVisible', () => {
    test('간편 모드에서는 투자·경제·고급 섹션이 통째로 숨는다', () => {
      expect(isSectionVisible('simple', 'basic')).toBe(true);
      expect(isSectionVisible('simple', 'pension')).toBe(true);
      expect(isSectionVisible('simple', 'investment')).toBe(false);
      expect(isSectionVisible('simple', 'economic')).toBe(false);
      expect(isSectionVisible('simple', 'advanced')).toBe(false);
    });

    test('표준 모드에서는 고급 설정만 숨는다', () => {
      for (const s of ALL_SECTIONS.filter((x) => x !== 'advanced')) {
        expect(isSectionVisible('standard', s), `${s}`).toBe(true);
      }
      expect(isSectionVisible('standard', 'advanced')).toBe(false);
    });

    test('전문가 모드에서는 모든 섹션이 보인다', () => {
      for (const s of ALL_SECTIONS) {
        expect(isSectionVisible('expert', s), `${s}`).toBe(true);
      }
    });

    // 섹션 노출은 필드 노출에서 파생되어야 한다. 두 규칙이 따로 놀면 "보이는데 안이 빈
    // 섹션" 또는 "숨었는데 그 안의 필드는 보인다고 답하는" 모순이 생긴다.
    test('섹션이 보이는 것과 그 안에 보이는 필드가 있는 것은 항상 일치한다', () => {
      for (const mode of ALL_MODES) {
        for (const s of ALL_SECTIONS) {
          const hasVisibleField = SECTION_FIELDS[s].some((p) => isFieldVisible(mode, p));
          expect(isSectionVisible(mode, s), `${s} @ ${mode}`).toBe(hasVisibleField);
        }
      }
    });
  });
});
