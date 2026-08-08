import { describe, test, expect } from 'vitest';
import { describeFireAge } from '@/core/usecases/dashboard/describeFireAge';

// fireAge는 **은퇴 나이와 비교되어야** 의미가 통한다. 60세 은퇴를 계획한
// 사용자에게 "FIRE 조기은퇴 가능 나이 73세"를 그대로 보여주면, 이미 지나간 시점을
// "조기은퇴 가능"이라고 말하는 형용모순이 된다.
describe('describeFireAge', () => {
  test('달성하지 못하면 달성 불가능으로 표기한다', () => {
    expect(describeFireAge(null, 60)).toBe('달성 불가능');
    expect(describeFireAge(undefined, 60)).toBe('달성 불가능');
  });

  test('은퇴 시점까지 달성하면 이미 달성했음을 표기한다', () => {
    expect(describeFireAge(60, 60)).toBe('60세 (은퇴 시점에 이미 달성)');
    expect(describeFireAge(55, 60)).toBe('55세 (은퇴 시점에 이미 달성)');
  });

  // 리포트가 실제로 보여준 조합(은퇴 60세 / FIRE 73세). 숫자만 보여주면 사용자는
  // 무엇이 13년 뒤에 일어난다는 것인지 알 수 없다.
  test('은퇴 나이보다 늦으면 몇 년 늦는지 함께 표기한다', () => {
    const text = describeFireAge(73, 60);

    expect(text).toContain('73세');
    expect(text).toContain('60세');
    expect(text).toContain('13년');
  });
});
