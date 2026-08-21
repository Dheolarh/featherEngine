import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSaveSlot,
  readSaveSlot,
  setSaveNamespace,
  writeSaveSlot,
} from '../editor/objectFactory';

describe('stable production save namespace', () => {
  beforeEach(() => localStorage.clear());

  it('reads the former project-name namespace and writes only the stable application id', () => {
    localStorage.setItem('nodeforge.save.legacy-game.slot1', JSON.stringify({ score: 42 }));
    setSaveNamespace('com.example.legacygame', ['Legacy Game']);

    expect(readSaveSlot('slot1')).toEqual({ score: 42 });
    localStorage.setItem('nodeforge.save.com-example-legacygame.slot1', '{corrupt');
    expect(readSaveSlot('slot1')).toEqual({ score: 42 });
    writeSaveSlot('slot1', { score: 99 });
    expect(localStorage.getItem('nodeforge.save.com-example-legacygame.slot1')).toBe(
      JSON.stringify({ score: 99 }),
    );
    expect(localStorage.getItem('nodeforge.save.legacy-game.slot1')).toBe(JSON.stringify({ score: 42 }));

    clearSaveSlot('slot1');
    expect(readSaveSlot('slot1')).toBeNull();
  });
});
