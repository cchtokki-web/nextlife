import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAiAdvisor } from '@/web/features/Dashboard/hooks/useAiAdvisor';

function makeStreamResponse(lines: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      lines.forEach((line) => controller.enqueue(encoder.encode(line + '\n')));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const baseInput = { score: 80, monthlyTarget: 3000000, isPro: false, depletionAge: null };

describe('useAiAdvisor', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('스트리밍 응답의 message.content를 순서대로 누적해 advice에 반영한다', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStreamResponse([JSON.stringify({ message: { content: '안녕' } }), JSON.stringify({ message: { content: '하세요' } })])
    );

    const { result } = renderHook(() => useAiAdvisor(baseInput));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.advice).toBe('안녕하세요');
    expect(result.current.error).toBeNull();
  });

  test('isRuleBased 플래그가 오면 isRuleBased를 true로 반영한다', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeStreamResponse([JSON.stringify({ isRuleBased: true, response: '기본 안내' })])
    );

    const { result } = renderHook(() => useAiAdvisor(baseInput));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isRuleBased).toBe(true);
    expect(result.current.advice).toBe('기본 안내');
  });

  test('내용을 하나도 받지 못하고 파싱마저 실패하면 에러 메시지를 반영한다', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeStreamResponse(['이건 JSON이 아님']));

    const { result } = renderHook(() => useAiAdvisor(baseInput));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).not.toBeNull();
  });

  test('advice가 이미 있고 rule-based가 아니면 입력이 바뀌어도 자동 재요청하지 않고 isStale만 true가 된다', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(makeStreamResponse([JSON.stringify({ response: 'v1' })]));

    const { result, rerender } = renderHook((props: typeof baseInput) => useAiAdvisor(props), {
      initialProps: baseInput,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.advice).toBe('v1');

    rerender({ ...baseInput, score: 85 });

    await waitFor(() => expect(result.current.isStale).toBe(true));
    expect(result.current.advice).toBe('v1');
  });

  test('retry()를 호출하면 최신 입력으로 다시 fetch해 advice를 갱신한다', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(makeStreamResponse([JSON.stringify({ response: 'v1' })]));

    const { result, rerender } = renderHook((props: typeof baseInput) => useAiAdvisor(props), {
      initialProps: baseInput,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    fetchMock.mockResolvedValueOnce(makeStreamResponse([JSON.stringify({ response: 'v2' })]));
    rerender({ ...baseInput, score: 85 });
    await waitFor(() => expect(result.current.isStale).toBe(true));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.advice).toBe('v2'));
  });
});
