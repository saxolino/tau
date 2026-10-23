// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { ChatTextareaSubmitButton } from '#components/chat/chat-textarea-submit-button.js';

const renderButton = (properties: {
  readonly status?: string;
  readonly canResume?: boolean;
  readonly refusal?: string;
  readonly describedBy?: string;
  readonly onSubmit?: () => void;
  readonly onCancel?: () => void;
}) =>
  render(
    <TooltipProvider>
      <p id='reason'>Claude Test can&apos;t read images.</p>
      <ChatTextareaSubmitButton
        status={properties.status ?? 'ready'}
        canResume={properties.canResume}
        isSubmitting={false}
        refusal={properties.refusal}
        describedBy={properties.describedBy}
        formattedCancelKeyCombination='Ctrl+Backspace'
        onSubmit={properties.onSubmit ?? vi.fn()}
        onCancel={properties.onCancel ?? vi.fn()}
      />
    </TooltipProvider>,
  );

describe('ChatTextareaSubmitButton', () => {
  it('should visibly name the resume action and activate it with the keyboard', async () => {
    const onSubmit = vi.fn();
    renderButton({ status: 'error', canResume: true, onSubmit });

    const resume = screen.getByRole('button', { name: 'Resume' });
    expect(resume).toHaveTextContent('Resume');
    expect(resume).toHaveAttribute('aria-keyshortcuts', 'Enter');
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await userEvent.tab();
    expect(resume).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('should be named Send and send when nothing refuses it (F1)', async () => {
    const onSubmit = vi.fn();
    renderButton({ onSubmit });

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveAttribute('aria-disabled', 'false');
    expect(send).not.toHaveAttribute('aria-describedby');
    await userEvent.click(send);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('should stay focusable while it refuses, described by the reason, and refuse to send (F14, S14)', async () => {
    const onSubmit = vi.fn();
    renderButton({ refusal: "Claude Test can't read images.", describedBy: 'reason', onSubmit });

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeEnabled();
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).toHaveAccessibleDescription("Claude Test can't read images.");
    await userEvent.tab();
    expect(send).toHaveFocus();
    await userEvent.click(send);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it.each(['submitted', 'streaming'])('should send into the queue while %s', async (status) => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    renderButton({ status, canResume: true, onSubmit, onCancel });
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
