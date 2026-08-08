import { describe, test, expect } from 'vitest';
import { describeDepletionAge } from '@/core/usecases/dashboard/describeDepletionAge';

describe('describeDepletionAge', () => {
  test('고갈 나이가 있으면 그 나이를 그대로 쓴다', () => {
    expect(describeDepletionAge(82, 85, 'depleted')).toBe('82세');
  });

  test('고갈되지 않으면 기대수명까지 유지된다고 말한다', () => {
    expect(describeDepletionAge(null, 85, 'sustained')).toBe('기대수명(85세)까지 고갈 없음');
  });

  test('undefined도 null과 같게 다룬다', () => {
    expect(describeDepletionAge(undefined, 85, 'sustained')).toBe('기대수명(85세)까지 고갈 없음');
  });

  // 투자자산이 없는 계획은 엔진이 첫 해에 고갈로 판정하므로, 그 나이를 그대로 쓰면
  // PDF 요약이 "자산 고갈 예상 나이: 51세"라고 보고한다.
  test('투자자산 미보유면 고갈 나이 대신 미보유임을 밝힌다', () => {
    expect(describeDepletionAge(51, 90, 'no_investable_asset')).toBe('투자자산 미보유');
  });
});
