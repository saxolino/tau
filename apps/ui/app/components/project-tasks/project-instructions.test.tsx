// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileContentResult } from '@taucad/fs-client/file-content-service';
import { ProjectInstructionsEditor } from '#components/project-tasks/project-instructions.js';

const files = vi.hoisted(() => ({
  resolve: vi.fn<(path: string) => Promise<FileContentResult>>(),
  writeFile: vi.fn<(path: string, bytes: Uint8Array<ArrayBuffer>, options: { source: string }) => Promise<void>>(),
  createDirectory: vi.fn(),
}));
vi.mock('#hooks/use-file-manager.js', () => ({
  useFileManager: (() => {
    const manager = {
      whenServicesReady: async () => ({ contentService: { resolve: files.resolve } }),
      writeFile: files.writeFile,
      createDirectory: files.createDirectory,
    };
    return () => manager;
  })(),
}));
vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ projectId: 'project-a' }) }));

beforeEach(() => {
  vi.clearAllMocks();
  files.resolve.mockResolvedValue({ kind: 'orphaned' });
  files.writeFile.mockResolvedValue(undefined);
  files.createDirectory.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Project instructions', () => {
  it('saves authored instructions through the filesystem and restores them when reopened', async () => {
    let persisted = '';
    files.resolve.mockImplementation(async () => ({ kind: 'text', content: new TextEncoder().encode(persisted) }));
    files.writeFile.mockImplementation(async (_path, bytes) => {
      persisted = new TextDecoder().decode(bytes);
    });
    const view = render(<ProjectInstructionsEditor />);
    const editor = await screen.findByRole('textbox', { name: 'Instructions' });
    await waitFor(() => {
      expect(editor.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.change(editor, { target: { value: 'Use millimeters. Reference: knowledge/materials.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
    await screen.findByRole('status');
    expect(files.writeFile).toHaveBeenCalledWith(
      '.tau/AGENTS.md',
      new TextEncoder().encode('Use millimeters. Reference: knowledge/materials.md'),
      { source: 'user' },
    );
    view.unmount();
    render(<ProjectInstructionsEditor />);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Instructions' })).toHaveProperty('value', persisted);
    });
  });

  it('retains the draft after a write failure and exposes recovery', async () => {
    files.writeFile.mockRejectedValue(new Error('Workspace is unavailable. Reconnect it and try again.'));
    render(<ProjectInstructionsEditor />);
    const editor = screen.getByRole('textbox', { name: 'Instructions' });
    await waitFor(() => {
      expect(editor.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.change(editor, { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Reconnect');
    expect(editor).toHaveProperty('value', 'Keep this draft');
  });

  it('does not overwrite instructions changed by another view', async () => {
    files.resolve.mockResolvedValueOnce({ kind: 'text', content: new TextEncoder().encode('Original') });
    files.resolve.mockResolvedValue({ kind: 'text', content: new TextEncoder().encode('Changed elsewhere') });
    render(<ProjectInstructionsEditor />);
    const editor = screen.getByRole('textbox', { name: 'Instructions' });
    await waitFor(() => {
      expect(editor.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.change(editor, { target: { value: 'My draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('changed elsewhere');
    expect(files.writeFile).not.toHaveBeenCalled();
  });

  it('keeps binary and oversized content out of the text editor', async () => {
    files.resolve.mockResolvedValue({ kind: 'too-large', size: 10_000_000, limit: 1_000_000 });
    render(<ProjectInstructionsEditor />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('too large');
    expect(screen.getByRole('textbox', { name: 'Instructions' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Save instructions' }).hasAttribute('disabled')).toBe(true);
    expect(files.writeFile).not.toHaveBeenCalled();
  });
});
