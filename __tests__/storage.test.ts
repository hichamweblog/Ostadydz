import { describe, expect, it } from 'vitest';
import { exportBackupJSON, getInitialState, importBackupJSON } from '@/lib/storage';
import { sanitizeExportColors } from '@/lib/utils';

describe('backup validation', () => {
  it('removes hardcoded hex colors from generated export markup', () => {
    const html = sanitizeExportColors(
      '<table style="border: 1px solid #94a3b8"><td style="color:#dc2626">نص</td></table>',
    );

    expect(html).toContain('border: 1px solid darkgray');
    expect(html).toContain('color:firebrick');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('rejects malformed backup files', () => {
    expect(() => importBackupJSON('{"state":{"profile":{}}}')).toThrow();
  });

  it('round-trips a valid app state without writing to storage during parsing', () => {
    const state = getInitialState();
    const restored = importBackupJSON(exportBackupJSON(state));
    expect(restored.profile.name).toBe(state.profile.name);
    expect(restored.classes).toHaveLength(state.classes.length);
  });
});
