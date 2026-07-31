import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Target } from 'lucide-react';
import { SettingSection } from '@/web/components/form/SettingSection';

describe('SettingSection', () => {
  test('제목을 표시하고 defaultOpen이면 자식을 렌더링한다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="은퇴 목표" defaultOpen>
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.getByText('은퇴 목표')).toBeInTheDocument();
    expect(screen.getByText('본문')).toBeInTheDocument();
  });

  test('defaultOpen이 아니면 자식을 렌더링하지 않는다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="고급 설정">
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.queryByText('본문')).not.toBeInTheDocument();
  });

  test('헤더를 누르면 펼쳐진다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="고급 설정">
        <p>본문</p>
      </SettingSection>
    );

    fireEvent.click(screen.getByRole('button', { name: /고급 설정/ }));

    expect(screen.getByText('본문')).toBeInTheDocument();
  });

  test('changedCount가 0보다 크면 변경 개수 배지를 표시한다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="은퇴 목표" changedCount={3}>
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.getByText('3개 변경')).toBeInTheDocument();
  });

  test('hiddenChangedCount가 0보다 크면 숨겨진 설정을 알린다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="경제 가정" hiddenChangedCount={2}>
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.getByText('숨겨진 사용자 설정 2개')).toBeInTheDocument();
  });

  test('onAiRecommend가 있으면 AI 추천 버튼을 렌더링하고, 눌러도 섹션이 토글되지 않는다', () => {
    const onAiRecommend = vi.fn();
    render(
      <SettingSection icon={<Target size={16} />} title="연금 전략" onAiRecommend={onAiRecommend}>
        <p>본문</p>
      </SettingSection>
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 추천' }));

    expect(onAiRecommend).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('본문')).not.toBeInTheDocument();
  });

  test('highlighted면 강조 표식이 붙고, 아니면 붙지 않는다', () => {
    const { rerender, container } = render(
      <SettingSection icon={<Target size={16} />} title="은퇴 목표" highlighted>
        <p>본문</p>
      </SettingSection>
    );

    expect(container.querySelector('[data-highlighted]')).not.toBeNull();

    rerender(
      <SettingSection icon={<Target size={16} />} title="은퇴 목표">
        <p>본문</p>
      </SettingSection>
    );

    expect(container.querySelector('[data-highlighted]')).toBeNull();
  });

  test('aiDisabled면 AI 추천 버튼이 비활성화된다', () => {
    render(
      <SettingSection
        icon={<Target size={16} />} title="연금 전략"
        onAiRecommend={vi.fn()} aiDisabled aiLabel="이미 최적"
      >
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.getByRole('button', { name: '이미 최적' })).toBeDisabled();
  });
});
