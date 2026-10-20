const REPLACEMENTS: Array<[RegExp, string]> = [
  [/علوم\s*تجريبية/g, 'ع ت'],
  [/تقني\s*رياضي/g, 'ت ر'],
  [/آداب\s*وفلسفة/g, 'آ ف'],
  [/لغات\s*أجنبية/g, 'ل أ'],
  [/تسيير\s*واقتصاد/g, 'ت ا'],
  [/جذع\s*مشترك/g, 'ج م'],
];

/** A readable compact class label for the narrow central mobile action. */
export function compactClassName(name: string): string {
  let compact = name.trim();
  for (const [pattern, replacement] of REPLACEMENTS) compact = compact.replace(pattern, replacement);
  return compact.replace(/\s+/g, ' ').trim();
}
