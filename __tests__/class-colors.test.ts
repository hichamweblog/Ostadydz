import { describe, expect, it } from 'vitest';
import { CLASS_COLORS, DEFAULT_CLASS_COLOR, assignDistinctClassColors, pickClassColor } from '@/lib/class-colors';
import type { ClassRoom } from '@/lib/types';

function makeClass(id: string, color?: string): ClassRoom {
  return {
    id,
    name: `قسم ${id}`,
    level: '3AS',
    stream: 'علوم تجريبية',
    color,
  } as ClassRoom;
}

describe('class colour assignment', () => {
  it('returns a palette colour when nothing is used yet', () => {
    expect(CLASS_COLORS).toContain(pickClassColor([]));
    expect(DEFAULT_CLASS_COLOR).toBe(CLASS_COLORS[0]);
  });

  it('never repeats a colour already used by another class', () => {
    const first = pickClassColor([]);
    const second = pickClassColor([first]);
    const third = pickClassColor([first, second]);
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('ignores casing and whitespace when detecting used colours', () => {
    expect(pickClassColor([' #0D9488 '])).not.toBe('#0d9488');
  });

  it('falls back to a stable colour once the whole palette is consumed', () => {
    const used = CLASS_COLORS.map((color) => color);
    const next = pickClassColor(used);
    expect(CLASS_COLORS).toContain(next);
    expect(next).toBe(CLASS_COLORS[used.length % CLASS_COLORS.length]);
  });

  it('keeps manually chosen colours and only fills the gaps', () => {
    const classes = [makeClass('a', '#e11d48'), makeClass('b'), makeClass('c', '#e11d48')];
    const assigned = assignDistinctClassColors(classes);
    expect(assigned[0].color).toBe('#e11d48');
    expect(assigned[2].color).not.toBe('#e11d48');
    const colours = assigned.map((cls) => cls.color);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('leaves already distinct colours untouched', () => {
    const classes = [makeClass('a', CLASS_COLORS[0]), makeClass('b', CLASS_COLORS[1])];
    const assigned = assignDistinctClassColors(classes);
    expect(assigned[0].color).toBe(CLASS_COLORS[0]);
    expect(assigned[1].color).toBe(CLASS_COLORS[1]);
  });
});
