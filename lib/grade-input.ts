/** Normalize localized digits and decimal separators accepted by phone keyboards. */
export function normalizeGradeInput(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/g, character => String(character.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, character => String(character.charCodeAt(0) - 0x06f0))
    .replace(/[،,\u066b]/g, '.');
}
