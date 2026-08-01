import { describe, test, expect } from 'vitest';
import { SECTION_FIELDS, isFieldVisible, SectionId } from '@/web/features/StrategySettings/fieldVisibility';
import { StrategyMode } from '@/core/entities/types';

const ALL_SECTIONS: SectionId[] = ['basic', 'goal', 'pension', 'investment', 'economic', 'advanced'];
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

  test('간편 모드에서도 나이와 목표 우선순위는 보인다', () => {
    expect(isFieldVisible('simple', 'userProfile.currentAge')).toBe(true);
    expect(isFieldVisible('simple', 'userProfile.retirementAge')).toBe(true);
    expect(isFieldVisible('simple', 'strategy.objective')).toBe(true);
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
});
