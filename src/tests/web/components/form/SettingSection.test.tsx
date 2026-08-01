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

  // 헤더 우측의 chevron은 토글 버튼 바깥에 있는 형제 요소라 클릭해도 아무 일도
  // 일어나지 않았다. 사용자에게는 그 아이콘이 곧 "펼치기" 버튼으로 보인다.
  test('우측 chevron 아이콘을 눌러도 펼쳐진다', () => {
    const { container } = render(
      <SettingSection icon={<Target size={16} />} title="고급 설정">
        <p>본문</p>
      </SettingSection>
    );

    const chevron = container.querySelector('[data-toggle-chevron]');
    expect(chevron).not.toBeNull();

    fireEvent.click(chevron!);

    expect(screen.getByRole('button', { name: /고급 설정/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('본문')).toBeInTheDocument();
  });

  test('AI 추천 버튼이 있어도 chevron으로 토글할 수 있다', () => {
    const onAiRecommend = vi.fn();
    const { container } = render(
      <SettingSection icon={<Target size={16} />} title="연금 전략" onAiRecommend={onAiRecommend}>
        <p>본문</p>
      </SettingSection>
    );

    fireEvent.click(container.querySelector('[data-toggle-chevron]')!);

    expect(screen.getByRole('button', { name: /연금 전략$/ })).toHaveAttribute('aria-expanded', 'true');
    expect(onAiRecommend).not.toHaveBeenCalled();
  });

  test('changedCount가 0보다 크면 변경 개수 배지를 표시한다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="은퇴 목표" changedCount={3}>
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.getByText('3개 변경')).toBeInTheDocument();
  });

  // 헤더 폭 308px 중 토글 버튼에 돌아오는 자리는 135px뿐이다(나머지는 AI 추천 버튼과
  // chevron). 배지를 그 버튼 안에 함께 두면 제목과 폭을 나눠 쓰다 제목이 밀려 내려가고,
  // 세로 중앙 정렬된 아이콘이 제목이 아니라 배지 옆에 붙어 화면이 깨져 보였다.
  test('배지는 토글 버튼 밖 별도 줄에 렌더링된다', () => {
    render(
      <SettingSection icon={<Target size={16} />} title="은퇴 목표" changedCount={2} hiddenChangedCount={1}>
        <p>본문</p>
      </SettingSection>
    );

    const toggle = screen.getByRole('button', { name: /은퇴 목표/ });
    expect(toggle).toHaveTextContent('은퇴 목표');
    expect(toggle).not.toHaveTextContent('2개 변경');
    expect(toggle).not.toHaveTextContent('숨겨진 사용자 설정 1개');

    // 버튼 밖으로 옮기더라도 화면에서는 계속 보여야 한다.
    expect(screen.getByText('2개 변경')).toBeInTheDocument();
    expect(screen.getByText('숨겨진 사용자 설정 1개')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /AI 추천/ }));

    expect(onAiRecommend).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('본문')).not.toBeInTheDocument();
  });

  test('AI 버튼의 접근성 이름에 섹션 제목이 포함된다', () => {
    // 세 섹션(goal/pension/investment)이 모두 'AI 추천'만으로 접근성 이름을 만들면
    // 스크린리더 사용자가 role+name으로 이동할 때 세 버튼을 구분할 수 없다.
    render(
      <SettingSection icon={<Target size={16} />} title="연금 전략" onAiRecommend={vi.fn()}>
        <p>본문</p>
      </SettingSection>
    );

    expect(screen.getByRole('button', { name: '연금 전략 AI 추천' })).toBeInTheDocument();
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

  // B5: StrategySettingsPanel은 defaultOpen={mode === 'expert'}로 고급 설정을 여는데,
  // useState(defaultOpen)은 초기값만 읽고 key도 안정적이라 리마운트가 없다. 기본 모드가
  // 'simple'이므로 마운트 시 false로 굳어 이후 전문가 모드로 올려도 영영 열리지 않았다.
  describe('defaultOpen이 바뀌면 열림 상태를 따라간다', () => {
    const section = (defaultOpen: boolean) => (
      <SettingSection icon={<Target size={16} />} title="고급 설정" defaultOpen={defaultOpen}>
        <p>본문</p>
      </SettingSection>
    );

    // 접힘 여부는 aria-expanded로 확인한다. 본문 텍스트는 AnimatePresence의 exit 애니메이션
    // 동안 DOM에 남아 있어 "방금 접혔다"를 즉시 관찰할 수 없다.
    const header = () => screen.getByRole('button', { name: /고급 설정/ });

    test('false → true로 바뀌면 펼쳐진다', () => {
      const { rerender } = render(section(false));
      expect(header()).toHaveAttribute('aria-expanded', 'false');

      rerender(section(true));

      expect(header()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('본문')).toBeInTheDocument();
    });

    test('true → false로 바뀌면 접힌다', () => {
      const { rerender } = render(section(true));

      rerender(section(false));

      expect(header()).toHaveAttribute('aria-expanded', 'false');
    });

    test('defaultOpen이 그대로면 사용자가 접은 상태를 유지한다', () => {
      const { rerender } = render(section(true));
      fireEvent.click(header());
      expect(header()).toHaveAttribute('aria-expanded', 'false');

      // 다른 prop만 바뀐 리렌더가 사용자의 조작을 되돌려서는 안 된다.
      rerender(
        <SettingSection
          icon={<Target size={16} />} title="고급 설정" defaultOpen changedCount={2}
        >
          <p>본문</p>
        </SettingSection>
      );

      expect(header()).toHaveAttribute('aria-expanded', 'false');
    });
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

    expect(screen.getByRole('button', { name: /이미 최적/ })).toBeDisabled();
  });
});
