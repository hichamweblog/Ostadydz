import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import DOMPurify from 'dompurify';
import { exportHtmlToDocx } from './docx-exporter';
import { showToast } from '@/components/Toast';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface ExportToDocOptions {
  landscape?: boolean;
  title?: string;
}

const EXPORT_COLOR_NAMES: Record<string, string> = {
  '#000': 'black',
  '#000000': 'black',
  '#ffffff': 'white',
  '#1a1c1e': 'black',
  '#0d2c3b': 'darkslategray',
  '#0d6547': 'seagreen',
  '#0d9488': 'teal',
  '#2e7d9b': 'steelblue',
  '#334155': 'slategray',
  '#475569': 'slategray',
  '#4f46e5': 'indigo',
  '#5c6370': 'slategray',
  '#64748b': 'slategray',
  '#065f46': 'seagreen',
  '#094530': 'darkgreen',
  '#16a34a': 'green',
  '#0284c7': 'steelblue',
  '#059669': 'seagreen',
  '#2563eb': 'royalblue',
  '#7c3aed': 'indigo',
  '#92400e': 'saddlebrown',
  '#b45309': 'darkorange',
  '#ca8a04': 'darkgoldenrod',
  '#d97706': 'darkorange',
  '#db2777': 'deeppink',
  '#dc2626': 'firebrick',
  '#e11d48': 'crimson',
  '#94a3b8': 'darkgray',
  '#cbd5e1': 'lightgray',
  '#d5dfdc': 'lightgray',
  '#e2e8f0': 'lightgray',
  '#f1f5f9': 'whitesmoke',
  '#f8fafc': 'snow',
  '#fafaf9': 'ivory',
  '#fffbeb': 'lemonchiffon',
  '#ecfdf5': 'honeydew',
  '#f0fdf4': 'honeydew',
};

export function sanitizeExportColors(htmlContent: string): string {
  return htmlContent.replace(/#[0-9a-f]{3,8}\b/gi, (color) => {
    const named = EXPORT_COLOR_NAMES[color.toLowerCase()];
    if (named) return named;
    const hex = color.slice(1);
    const expanded = hex.length === 3
      ? hex.split('').map((digit) => digit + digit).join('')
      : hex.slice(0, 6);
    const channels = [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
    return `rgb(${channels.join(', ')})`;
  });
}

/**
 * Phase 6: every Word export in the app produces a real .docx (OOXML) file — A4 paper,
 * right-to-left — instead of the legacy HTML-renamed .doc.
 */
export function exportToDocx(htmlContent: string, filename: string, options?: ExportToDocOptions) {
  const sanitizedContent = DOMPurify.sanitize(htmlContent);
  void exportHtmlToDocx(sanitizedContent, filename, {
    landscape: options?.landscape,
    title: options?.title || filename,
  }).catch(error => showToast(error instanceof Error ? error.message : 'تعذر تصدير الوثيقة.', 'error'));
}

export function triggerHapticFeedback() {
  if (typeof window !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(50);
  }
}
