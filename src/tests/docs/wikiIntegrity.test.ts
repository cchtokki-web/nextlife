import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { extractWikiLinks, parseWikiNote } from './parseWikiNote';

/**
 * 위키가 «조용히 낡는 것»을 막는다.
 *
 * 개념 노트는 근거 코드와 테스트를 가리키는데, 그 파일이 옮겨지거나 지워져도 마크다운은
 * 아무 신호를 내지 않는다. 그러면 노트는 없는 코드를 가리킨 채 남고, 그걸 읽은 사람이나
 * 에이전트는 틀린 근거로 판단한다. 여기서 깨뜨려 그 순간에 고치게 한다.
 *
 * **이 테스트가 잡지 못하는 것**: 노트 본문이 코드와 «의미적으로» 어긋나는 것. 배당 규칙이
 * 바뀌었는데 노트 문장만 옛날 그대로여도 통과한다. 그건 AGENTS.md의 갱신 규칙과 사람
 * 검수의 몫이다. 이 파일은 경로와 링크만 본다.
 *
 * **위반을 모아서 한 번에 보고한다.** 노트마다 테스트를 따로 만들면 첫 실패에서 멈춰,
 * 아홉 개를 고치려고 아홉 번 돌려야 한다. 검사 하나가 모든 노트를 훑고 위반 목록을 통째로
 * 내놓는 편이 고치는 쪽에 훨씬 낫다.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const WIKI_ROOT = join(REPO_ROOT, 'docs/wiki');

/** 보관함 스캔에서 건너뛸 디렉터리. node_modules를 걷다 죽지 않게 하는 것이 주 목적이다. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.claude',
  '.worktrees',
  '.obsidian',
  '.superpowers',
  'coverage',
  'out',
  'build',
]);

function walkMarkdown(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkMarkdown(full, found);
    else if (entry.endsWith('.md')) found.push(full);
  }
  return found;
}

interface WikiNoteFile {
  /** repo 루트 기준 상대 경로. 실패 메시지에 그대로 쓴다 */
  path: string;
  kind: 'concept' | 'decision';
  frontmatter: Record<string, string[]>;
  body: string;
}

function loadNotes(): WikiNoteFile[] {
  const notes: WikiNoteFile[] = [];
  for (const kind of ['concept', 'decision'] as const) {
    const dir = join(WIKI_ROOT, kind === 'concept' ? 'concepts' : 'decisions');
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.md'))) {
      const full = join(dir, file);
      const { frontmatter, body } = parseWikiNote(readFileSync(full, 'utf8'));
      notes.push({ path: relative(REPO_ROOT, full), kind, frontmatter, body });
    }
  }
  return notes;
}

/** Obsidian은 보관함 안 파일을 basename으로 해석한다. 같은 규칙으로 링크 대상을 모은다. */
function loadLinkTargets(): Set<string> {
  const targets = new Set<string>();
  for (const file of walkMarkdown(REPO_ROOT)) {
    const rel = relative(REPO_ROOT, file);
    targets.add(rel.replace(/\.md$/, ''));
    targets.add(rel.split('/').pop()!.replace(/\.md$/, ''));
  }
  return targets;
}

function noteName(note: WikiNoteFile): string {
  return note.path.split('/').pop()!.replace(/\.md$/, '');
}

const notes = loadNotes();
const concepts = notes.filter((note) => note.kind === 'concept');
const decisions = notes.filter((note) => note.kind === 'decision');
const linkTargets = loadLinkTargets();
const conceptNames = new Set(concepts.map(noteName));

const CONCEPT_SECTIONS = ['## 한 줄 정의', '## 계약', '## 흔한 위반', '## 근거', '## 관련'];
const DECISION_SECTIONS = [
  '## 결정',
  '## 배경',
  '## 기각한 대안과 범위 제외',
  '## 호환성 처리',
  '## 영향받는 개념',
];
const STATUSES = ['enforced', 'partial', 'not-implemented'];

/** 대상 노트를 훑어 위반 문자열을 모은다. 통과는 빈 배열이다. */
function collect(
  targets: WikiNoteFile[],
  check: (note: WikiNoteFile, fail: (reason: string) => void) => void,
): string[] {
  const violations: string[] = [];
  for (const note of targets) {
    check(note, (reason) => violations.push(`${note.path}: ${reason}`));
  }
  return violations;
}

describe('위키 무결성', () => {
  /**
   * 파서가 망가지거나 폴더 이름이 바뀌면 `notes`가 빈 배열이 되고, 아래 검사들이 전부
   * 빈 배열을 비교하며 통과한다. 그 «조용한 통과»가 가장 위험하므로 먼저 막는다.
   */
  test('노트를 실제로 찾았다', () => {
    expect(concepts.length).toBeGreaterThan(0);
  });

  /**
   * 파일럿 18건이 실제로 있는지 잠근다. 위 «노트를 실제로 찾았다»는 한 건만 있어도 통과하므로,
   * 노트가 통째로 사라지는 것을 막지 못한다.
   *
   * 노트를 «추가»할 때는 이 숫자를 올린다. 노트를 «지울» 때는 그 결정이 의도적인지 확인하는
   * 자리가 여기다 — 숫자를 낮추는 diff가 리뷰에 보이게 하려는 것이다.
   */
  test('파일럿 노트 19건이 있다', () => {
    expect(concepts).toHaveLength(13);
    expect(decisions).toHaveLength(6);
  });

  test('type이 폴더와 일치한다', () => {
    const violations = collect(notes, (note, fail) => {
      const type = note.frontmatter.type?.[0];
      if (type !== note.kind) fail(`type이 '${type ?? '없음'}'이다. '${note.kind}'여야 한다`);
    });
    expect(violations).toEqual([]);
  });

  test('근거 원자료가 [[링크]]로 적혀 있다', () => {
    const violations = collect(notes, (note, fail) => {
      const field = note.kind === 'concept' ? 'sources' : 'source';
      const values = note.frontmatter[field] ?? [];
      if (values.length === 0) return fail(`${field}가 비어 있다`);
      for (const value of values) {
        if (extractWikiLinks(value).length === 0) fail(`${field}의 "${value}"에 [[링크]]가 없다`);
      }
    });
    expect(violations).toEqual([]);
  });

  test('code·tests 경로가 실존한다', () => {
    const violations = collect(notes, (note, fail) => {
      for (const path of [...(note.frontmatter.code ?? []), ...(note.frontmatter.tests ?? [])]) {
        if (!existsSync(join(REPO_ROOT, path))) fail(`${path}가 없다`);
      }
    });
    expect(violations).toEqual([]);
  });

  test('모든 [[링크]] 대상이 보관함에서 해석된다', () => {
    const violations = collect(notes, (note, fail) => {
      const frontmatterText = Object.values(note.frontmatter).flat().join('\n');
      for (const target of extractWikiLinks(`${frontmatterText}\n${note.body}`)) {
        if (!linkTargets.has(target)) fail(`[[${target}]]를 해석할 수 없다`);
      }
    });
    expect(violations).toEqual([]);
  });

  test('필수 섹션이 모두 있다', () => {
    const violations = collect(notes, (note, fail) => {
      const required = note.kind === 'concept' ? CONCEPT_SECTIONS : DECISION_SECTIONS;
      for (const heading of required) {
        if (!note.body.includes(heading)) fail(`${heading} 섹션이 없다`);
      }
    });
    expect(violations).toEqual([]);
  });

  test('개념 노트의 status가 허용값이고 enforced면 근거 테스트가 있다', () => {
    const violations = collect(concepts, (note, fail) => {
      const status = note.frontmatter.status?.[0];
      if (!status || !STATUSES.includes(status)) return fail(`status가 '${status ?? '없음'}'이다`);
      if (status === 'enforced' && (note.frontmatter.tests ?? []).length === 0) {
        fail('status가 enforced인데 tests가 비어 있다');
      }
    });
    expect(violations).toEqual([]);
  });

  test('개념 노트가 다른 개념 노트를 최소 1건 링크한다', () => {
    // 개념이 하나뿐인 동안에는 링크할 상대가 없다. 둘 이상일 때만 요구한다.
    if (concepts.length < 2) return;
    const violations = collect(concepts, (note, fail) => {
      const self = noteName(note);
      const linked = extractWikiLinks(note.body).filter(
        (target) => conceptNames.has(target) && target !== self,
      );
      if (linked.length === 0) fail('다른 개념 노트로 가는 링크가 없다');
    });
    expect(violations).toEqual([]);
  });

  test('ADR의 decided가 YYYY-MM-DD이고 파일명 접두사와 일치한다', () => {
    const violations = collect(decisions, (note, fail) => {
      const decided = note.frontmatter.decided?.[0] ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(decided)) return fail(`decided가 '${decided}'다`);
      if (!noteName(note).startsWith(`${decided}-`)) {
        fail(`파일명이 '${decided}-'로 시작하지 않는다`);
      }
    });
    expect(violations).toEqual([]);
  });
});
