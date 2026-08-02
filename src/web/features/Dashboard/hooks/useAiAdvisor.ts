import { useEffect, useMemo, useState } from 'react';
import {
  InvestmentAsset,
  NationalPension,
  OtherIncome,
  PrivatePension,
  SpendingStrategy,
  StrategyRecommendation,
  TaxSettings,
  UserProfile,
  UtilityBreakdown,
} from '../../../../core/entities/types';
import { RetirementGrade } from '../../../../core/entities/retirementGrade';

export interface UseAiAdvisorInput {
  score: number;
  retirementGrade?: RetirementGrade;
  monthlyTarget: number;
  isPro: boolean;
  userProfile?: UserProfile;
  depletionAge: number | null;
  goalAchievementRate?: number;
  fireAge?: number | null;
  endingAssets?: number;
  assets?: InvestmentAsset[];
  privatePensions?: PrivatePension[];
  nationalPension?: NationalPension;
  // 시뮬레이션에 실제로 들어간 국민연금 개시 나이(effective 기준). 이 값을 넘기지 않으면
  // 이미 70세로 계산 중인 계획에 LLM이 "연기 수령을 검토해 보세요"라고 쓴다.
  nationalPensionStartAge?: number;
  otherIncomes?: OtherIncome[];
  taxSettings?: TaxSettings;
  spendingStrategy?: SpendingStrategy;
  inflationRate?: number;
  inflationMode?: 'nominal' | 'real';
  utility?: UtilityBreakdown;
  recommendation?: StrategyRecommendation;
}

export interface UseAiAdvisorResult {
  advice: string;
  displayAdvice: string; // "빈 thinking 태그" 접두사를 제거한 표시용 텍스트
  isLoading: boolean;
  error: string | null;
  isRuleBased: boolean;
  isStale: boolean; // 입력이 바뀌었지만 아직 재요청 전(또는 재요청 대기 중)인 상태
  retry: () => void;
}

const EMPTY_THOUGHT_TAG = '<|channel>thought\n<channel|>';

function stripEmptyThoughtTag(advice: string): string {
  if (advice.startsWith(EMPTY_THOUGHT_TAG)) return advice.substring(EMPTY_THOUGHT_TAG.length);
  if (EMPTY_THOUGHT_TAG.startsWith(advice)) return '';
  return advice;
}

// UtilityCard.tsx에 있던 /api/ai-advisor 스트리밍 fetch 로직을 그대로 이관한 훅.
// 입력(currentKey)이 바뀌면 즉시 재요청하지 않고 isStale만 true로 켠다 — 사용자가 읽던 의견이
// rule-based 안내이거나 아직 아무 내용도 없을 때만 자동 재요청하고, 그 외에는 retry()로
// 사용자가 명시적으로 "의견 업데이트"를 눌러야 갱신된다(읽던 도중 내용이 바뀌는 것을 방지).
export function useAiAdvisor(input: UseAiAdvisorInput): UseAiAdvisorResult {
  const [advice, setAdvice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggerFetch, setTriggerFetch] = useState(0);
  const [lastFetchKey, setLastFetchKey] = useState('');
  const [isRuleBased, setIsRuleBased] = useState(false);

  const currentKey = useMemo(() => JSON.stringify(input), [input]);
  const isStale = lastFetchKey !== '' && currentKey !== lastFetchKey;

  useEffect(() => {
    const abortController = new AbortController();

    const fetchAdvice = async () => {
      setIsLoading(true);
      setError(null);
      setAdvice('');
      setIsRuleBased(false);
      setLastFetchKey(currentKey);

      try {
        const response = await fetch('/api/ai-advisor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: currentKey,
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error('Failed to fetch advice');
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No readable stream');

        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        // 모든 라인이 파싱에 실패하면 advice는 계속 빈 문자열로 남고 에러도 없이 로딩만
        // 끝나버려 카드가 조용히 빈 채로 멈춘다. 파싱 실패 여부와 실제 콘텐츠 수신 여부를
        // 추적해, 스트림이 끝났는데 콘텐츠를 하나도 못 받았다면 명시적으로 에러를 표시한다.
        let receivedContent = false;
        let hadParseFailure = false;

        const consumeLine = (line: string) => {
          if (line.trim() === '') return;
          try {
            const parsed = JSON.parse(line);
            if (parsed.isRuleBased) setIsRuleBased(true);
            const chunk = parsed.message?.content || parsed.response;
            if (chunk) {
              receivedContent = true;
              setAdvice((prev) => prev + chunk);
            }
          } catch {
            hadParseFailure = true;
            console.warn('Failed to parse JSON line:', line);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          lines.forEach(consumeLine);
        }

        if (buffer.trim()) consumeLine(buffer);

        if (!receivedContent && hadParseFailure) {
          setError('AI 응답을 해석하지 못했습니다. 잠시 후 다시 시도해주세요.');
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('Fetch aborted due to params change');
        } else {
          console.error('Error fetching AI advice:', err);
          setError('AI 의견을 가져오는 데 실패했습니다.');
        }
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchAdvice();

    return () => {
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerFetch]);

  // 입력이 바뀌었는데 아직 rule-based 폴백이거나 의견이 비어 있으면 다시 받아 온다.
  //
  // 이펙트가 아니라 렌더 중에 조정한다. 이펙트로 하면 낡은 의견으로 한 번 커밋한 뒤 재요청이
  // 시작되고, 세 의존성 중 아무거나 바뀔 때마다 조건이 참인 동안 계속 재요청이 걸렸다.
  // 조건이 거짓→참으로 넘어가는 순간에만 한 번 올리면 그 반복이 사라진다.
  const shouldRefetch = isStale && (isRuleBased || advice === '');
  const [wasRefetchNeeded, setWasRefetchNeeded] = useState(shouldRefetch);
  if (shouldRefetch !== wasRefetchNeeded) {
    setWasRefetchNeeded(shouldRefetch);
    if (shouldRefetch) setTriggerFetch((prev) => prev + 1);
  }

  return {
    advice,
    displayAdvice: stripEmptyThoughtTag(advice),
    isLoading,
    error,
    isRuleBased,
    isStale,
    retry: () => setTriggerFetch((prev) => prev + 1),
  };
}
