import { describe, expect, test } from 'vitest';
import { extractWikiLinks, parseWikiNote } from './parseWikiNote';

describe('parseWikiNote', () => {
  test('스칼라·인라인 배열·블록 배열을 모두 string[]로 정규화한다', () => {
    const raw = [
      '---',
      'type: concept',
      'code: [src/a.ts, src/b.ts]',
      'tests:',
      '  - src/tests/a.test.ts',
      '  - src/tests/b.test.ts',
      '---',
      '# 제목',
      '본문',
    ].join('\n');

    const { frontmatter, body } = parseWikiNote(raw);

    expect(frontmatter.type).toEqual(['concept']);
    expect(frontmatter.code).toEqual(['src/a.ts', 'src/b.ts']);
    expect(frontmatter.tests).toEqual(['src/tests/a.test.ts', 'src/tests/b.test.ts']);
    expect(body).toContain('# 제목');
  });

  test('따옴표를 벗기고, 따옴표 안의 쉼표로는 쪼개지 않는다', () => {
    const raw = ['---', 'sources: ["[[AGENTS]] 금융, 계산 원칙", "[[PRD]] §8.3"]', '---', ''].join(
      '\n',
    );

    expect(parseWikiNote(raw).frontmatter.sources).toEqual([
      '[[AGENTS]] 금융, 계산 원칙',
      '[[PRD]] §8.3',
    ]);
  });

  test('프런트매터가 없으면 빈 객체를 주고 본문을 그대로 돌려준다', () => {
    const { frontmatter, body } = parseWikiNote('# 제목만 있는 문서\n');

    expect(frontmatter).toEqual({});
    expect(body).toBe('# 제목만 있는 문서\n');
  });
});

describe('extractWikiLinks', () => {
  test('별칭과 섹션을 잘라낸 링크 대상만 돌려준다', () => {
    const text = '[[총수익률과 배당수익률]] [[PRD#8.3]] [[AGENTS|작업 지침]] 링크 아님';

    expect(extractWikiLinks(text)).toEqual(['총수익률과 배당수익률', 'PRD', 'AGENTS']);
  });

  test('링크가 없으면 빈 배열이다', () => {
    expect(extractWikiLinks('링크 없는 문장')).toEqual([]);
  });
});
