import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  invoke: vi.fn(),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  watch: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn(), invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ join: mocks.join }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: mocks.exists,
  lstat: mocks.lstat,
  mkdir: mocks.mkdir,
  readTextFile: mocks.readTextFile,
  watch: mocks.watch,
  writeFile: vi.fn(),
  writeTextFile: mocks.writeTextFile,
}));

import { tauriPlatform } from '../tauri';

describe('desktop project text files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lstat.mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 128 });
  });

  it('reads and writes UTF-8 files below the project directory', async () => {
    mocks.exists.mockResolvedValue(true);
    mocks.invoke.mockResolvedValueOnce('on start:\n    print("hello")');

    await expect(tauriPlatform.readProjectText?.('/projects/game', 'scripts/Player.feather')).resolves.toContain(
      'print',
    );
    expect(mocks.invoke).toHaveBeenCalledWith('read_project_text', {
      projectDir: '/projects/game',
      relativePath: 'scripts/Player.feather',
    });

    await tauriPlatform.writeProjectText?.('/projects/game', 'scripts/Player.feather', 'blueprint Player');
    expect(mocks.invoke).toHaveBeenCalledWith('write_project_text_atomic', {
      projectDir: '/projects/game',
      relativePath: 'scripts/Player.feather',
      contents: 'blueprint Player',
      checkExpected: false,
      expectedContents: null,
    });
  });

  it('passes an exact compare-and-swap guard to native linked-file writes', async () => {
    mocks.invoke.mockResolvedValueOnce({ kind: 'written' });

    await expect(
      tauriPlatform.writeProjectText?.(
        '/projects/game',
        'scripts/Player.feather',
        'blueprint Player\n\non start:\n    pass',
        { expectedContents: 'blueprint Player' },
      ),
    ).resolves.toEqual({ kind: 'written' });
    expect(mocks.invoke).toHaveBeenCalledWith('write_project_text_atomic', {
      projectDir: '/projects/game',
      relativePath: 'scripts/Player.feather',
      contents: 'blueprint Player\n\non start:\n    pass',
      checkExpected: true,
      expectedContents: 'blueprint Player',
    });
  });

  it('returns null for a missing linked file', async () => {
    mocks.exists.mockResolvedValue(false);
    mocks.invoke.mockResolvedValueOnce(null);

    await expect(tauriPlatform.readProjectText?.('/projects/game', 'scripts/Missing.feather')).resolves.toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith('read_project_text', {
      projectDir: '/projects/game',
      relativePath: 'scripts/Missing.feather',
    });
  });

  it.each([
    '../outside.feather',
    'scripts/../outside.feather',
    '/tmp/outside.feather',
    'C:\\tmp\\outside.feather',
    'scripts/Player.feather:stream',
    'scripts/CON.feather',
    'scripts/trailing. ',
  ])(
    'rejects unsafe project-relative path %s',
    async (relativePath) => {
      await expect(tauriPlatform.readProjectText?.('/projects/game', relativePath)).rejects.toThrow(
        'Unsafe project-relative path',
      );
      await expect(tauriPlatform.writeProjectText?.('/projects/game', relativePath, 'nope')).rejects.toThrow(
        'Unsafe project-relative path',
      );
      await expect(tauriPlatform.revealProjectFile?.('/projects/game', relativePath)).rejects.toThrow(
        'Unsafe project-relative path',
      );
    },
  );

  it('rejects a linked path with an existing symbolic-link component', async () => {
    mocks.exists.mockResolvedValue(true);
    mocks.lstat.mockImplementation(async (path: string) => ({
      isFile: !path.endsWith('/scripts'),
      isDirectory: false,
      isSymlink: path.endsWith('/scripts'),
      size: 128,
    }));

    await expect(
      tauriPlatform.readProjectText?.('/projects/game', 'scripts/Player.feather'),
    ).rejects.toThrow('cannot contain a symbolic link');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('debounces watches and reports only normalized paths inside requested project roots', async () => {
    let emit: ((event: { paths: string[] }) => void) | undefined;
    const stop = vi.fn();
    mocks.watch.mockImplementation(
      async (
        _paths: string[],
        callback: (event: { paths: string[] }) => void,
      ) => {
        emit = callback;
        return stop;
      },
    );
    const onChange = vi.fn();

    const cleanup = await tauriPlatform.watchProjectPaths?.(
      '/projects/game',
      ['scripts', 'scripts/Player.feather'],
      onChange,
      { debounceMs: 175 },
    );

    expect(mocks.watch).toHaveBeenCalledWith(
      ['/projects/game/scripts', '/projects/game/scripts/Player.feather'],
      expect.any(Function),
      { delayMs: 175, recursive: false },
    );
    emit?.({
      paths: [
        '/projects/game/scripts/Player.feather',
        '/projects/game/scripts/NPC.feather',
        '/projects/other/Outside.feather',
      ],
    });
    expect(onChange).toHaveBeenCalledWith(['scripts/Player.feather', 'scripts/NPC.feather']);

    cleanup?.();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('matches Windows watcher events without case-sensitive path loss', async () => {
    let emit: ((event: { paths: string[] }) => void) | undefined;
    mocks.exists.mockResolvedValue(false);
    mocks.watch.mockImplementation(
      async (_paths: string[], callback: (event: { paths: string[] }) => void) => {
        emit = callback;
        return vi.fn();
      },
    );
    const onChange = vi.fn();

    await tauriPlatform.watchProjectPaths?.('C:/Game', ['scripts'], onChange);
    emit?.({ paths: ['c:/game/SCRIPTS/Player.feather'] });

    expect(onChange).toHaveBeenCalledWith(['SCRIPTS/Player.feather']);
  });
});
