import { describe, test, expect } from 'vitest';
import {
  MAX_COMPARE_SCENARIO_COUNT,
  parseCompareScenarioIds,
} from '@/core/utils/compareScenarios';

describe('parseCompareScenarioIds', () => {
  test('저장된 배열을 순서 그대로 읽는다', () => {
    expect(parseCompareScenarioIds(JSON.stringify(['s3', 's1']))).toEqual(['s3', 's1']);
  });

  test('값이 없으면 빈 목록이다', () => {
    expect(parseCompareScenarioIds(null)).toEqual([]);
    expect(parseCompareScenarioIds(undefined)).toEqual([]);
    expect(parseCompareScenarioIds('')).toEqual([]);
  });

  // 이 값이 깨져 있다는 이유로 시나리오 목록 전체가 500이 되면, 사용자는 자기 데이터를 열지
  // 못한 채 "비교 대상 하나"를 잃는 대가를 치른다.
  test('깨진 JSON에도 던지지 않고 빈 목록으로 답한다', () => {
    expect(parseCompareScenarioIds('{not json')).toEqual([]);
  });

  test('배열이 아닌 값은 빈 목록으로 읽는다', () => {
    expect(parseCompareScenarioIds(JSON.stringify({ id: 's1' }))).toEqual([]);
    expect(parseCompareScenarioIds(JSON.stringify('s1'))).toEqual([]);
  });

  test('문자열이 아닌 항목과 빈 문자열은 걸러 낸다', () => {
    expect(parseCompareScenarioIds(JSON.stringify(['s1', 3, null, '', 's2']))).toEqual(['s1', 's2']);
  });

  // 차트 범례와 색상이 이 수를 전제로 한다. 어떤 경로로든 한도를 넘긴 값이 저장돼 있으면
  // 읽는 쪽에서 자른다.
  test('한도를 넘는 항목은 잘라 낸다', () => {
    const tooMany = ['s1', 's2', 's3', 's4', 's5'];

    expect(parseCompareScenarioIds(JSON.stringify(tooMany)))
      .toHaveLength(MAX_COMPARE_SCENARIO_COUNT);
  });
});
