/**
 * `docs/wiki/**` 노트의 프런트매터를 읽는다.
 *
 * **YAML 파서를 쓰지 않는 이유**: 저장소에 YAML 의존성이 없고, 이 위키를 위해 하나 들이는
 * 것은 무결성 검사 하나에 비해 과하다. 대신 `docs/wiki/스키마.md`가 지원 문법을 세 가지로
 * 좁혀 두었고, 이 파서는 딱 그만큼만 읽는다. 스키마에 없는 문법(중첩 매핑, 여러 줄 문자열,
 * 앵커)을 노트에 쓰면 여기서 조용히 무시되므로, 스키마를 넓힐 때 이 파서도 함께 넓혀야 한다.
 *
 * 모든 값을 `string[]`로 정규화한다. 호출부가 스칼라와 배열을 분기하지 않게 하려는 것이다.
 */
export interface ParsedWikiNote {
  frontmatter: Record<string, string[]>;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return quoted && trimmed.length >= 2 ? trimmed.slice(1, -1) : trimmed;
}

/**
 * 인라인 배열 `[a, "b, c"]`를 쪼갠다. 따옴표 «안»의 쉼표로는 쪼개지 않는다 —
 * `sources: ["[[AGENTS]] 금융, 계산 원칙"]`처럼 값에 쉼표가 들어가는 경우가 실제로 있다.
 */
function splitInlineList(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ',') {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  items.push(current);

  return items.map(unquote).filter((item) => item.length > 0);
}

export function parseWikiNote(raw: string): ParsedWikiNote {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { frontmatter: {}, body: raw };

  const frontmatter: Record<string, string[]> = {};
  let currentKey: string | null = null;

  for (const line of match[1].split(/\r?\n/)) {
    const blockItem = /^\s+-\s+(.*)$/.exec(line);
    if (blockItem && currentKey) {
      frontmatter[currentKey].push(unquote(blockItem[1]));
      continue;
    }

    const entry = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!entry) continue;

    const [, key, rest] = entry;
    currentKey = key;

    const value = rest.trim();
    if (value.length === 0) {
      frontmatter[key] = [];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = splitInlineList(value.slice(1, -1));
    } else {
      frontmatter[key] = [unquote(value)];
    }
  }

  return { frontmatter, body: raw.slice(match[0].length) };
}

/** `[[대상]]`의 대상만 뽑는다. 별칭(`|`)과 섹션(`#`)은 잘라낸다. */
export function extractWikiLinks(text: string): string[] {
  const links: string[] = [];
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const target = match[1].split('|')[0].split('#')[0].trim();
    if (target.length > 0) links.push(target);
  }
  return links;
}
