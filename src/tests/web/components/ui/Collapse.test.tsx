import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Collapse } from '@/web/components/ui/Collapse';

describe('Collapse', () => {
  test('기본값(defaultOpen=false)일 때 버튼의 aria-expanded는 false이고 내용이 보이지 않는다', () => {
    render(
      <Collapse title="제목">
        <p>내용</p>
      </Collapse>
    );
    expect(screen.getByRole('button', { name: '제목' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('내용')).not.toBeInTheDocument();
  });

  test('버튼을 클릭하면 열리고 aria-expanded가 true로 바뀌며 내용이 나타난다', () => {
    render(
      <Collapse title="제목">
        <p>내용</p>
      </Collapse>
    );
    fireEvent.click(screen.getByRole('button', { name: '제목' }));
    expect(screen.getByRole('button', { name: '제목' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('내용')).toBeInTheDocument();
  });

  test('defaultOpen=true면 처음부터 내용이 보인다', () => {
    render(
      <Collapse title="제목" defaultOpen>
        <p>내용</p>
      </Collapse>
    );
    expect(screen.getByText('내용')).toBeInTheDocument();
  });

  test('controlled 모드(open prop)에서는 onOpenChange만 호출되고, open이 실제로 바뀌어야 내용이 나타난다', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Collapse title="제목" open={false} onOpenChange={onOpenChange}>
        <p>내용</p>
      </Collapse>
    );

    fireEvent.click(screen.getByRole('button', { name: '제목' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText('내용')).not.toBeInTheDocument();

    rerender(
      <Collapse title="제목" open={true} onOpenChange={onOpenChange}>
        <p>내용</p>
      </Collapse>
    );
    expect(screen.getByText('내용')).toBeInTheDocument();
  });

  test('열려 있을 때 콘텐츠 영역이 role=region이고 버튼의 aria-controls와 id가 일치한다', () => {
    render(
      <Collapse title="제목" defaultOpen>
        <p>내용</p>
      </Collapse>
    );
    const button = screen.getByRole('button', { name: '제목' });
    const region = screen.getByRole('region');
    expect(button).toHaveAttribute('aria-controls', region.id);
  });
});
