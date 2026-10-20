/**
 * دليل التقديرات والإرشادات البيداغوجية الرسمية لمادة العلوم الإسلامية
 * بالتعليم الثانوي الجزائري، مصنفة حسب فئات النقاط والمعدلات.
 */

export type ScoreTier =
  | 'EXCELLENT'      // 18 - 20
  | 'VERY_GOOD'      // 16 - 17.99
  | 'GOOD'           // 14 - 15.99
  | 'NEAR_GOOD'      // 12 - 13.99
  | 'AVERAGE'        // 10 - 11.99
  | 'BELOW_AVERAGE'  // 08 - 09.99
  | 'POOR'           // أقل من 08
  | 'UNRATED';       // لم تُسجل بعد أو غائب

export interface TierData {
  tier: ScoreTier;
  rangeLabel: string;
  label: string;
  colorClass: string;
  defaultEstimation: string;
  defaultGuidance: string;
  estimations: string[];
  guidanceList: string[];
}

export const PEDAGOGICAL_TIERS: Record<ScoreTier, TierData> = {
  EXCELLENT: {
    tier: 'EXCELLENT',
    rangeLabel: '18 - 20',
    label: 'امتياز (18 - 20)',
    colorClass: 'text-emerald-700 bg-emerald-50',
    defaultEstimation: 'نتائج ممتازة',
    defaultGuidance: 'نتائج ممتازة ومرضية وواصل',
    estimations: [
      'نتائج ممتازة'
    ],
    guidanceList: [
      'نتائج ممتازة ومرضية وواصل'
    ]
  },
  VERY_GOOD: {
    tier: 'VERY_GOOD',
    rangeLabel: '16 - 17.99',
    label: 'جيد جداً (16 - 17.99)',
    colorClass: 'text-teal-700 bg-teal-50',
    defaultEstimation: 'نتائج جيدة جداً',
    defaultGuidance: 'نتائج جيدة ومشجعة وواصل',
    estimations: [
      'نتائج جيدة جداً'
    ],
    guidanceList: [
      'نتائج جيدة ومشجعة وواصل'
    ]
  },
  GOOD: {
    tier: 'GOOD',
    rangeLabel: '14 - 15.99',
    label: 'جيد (14 - 15.99)',
    colorClass: 'text-blue-700 bg-blue-50',
    defaultEstimation: 'نتائج جيدة',
    defaultGuidance: 'واصل الاجتهاد والمثابرة',
    estimations: [
      'نتائج جيدة'
    ],
    guidanceList: [
      'واصل الاجتهاد والمثابرة'
    ]
  },
  NEAR_GOOD: {
    tier: 'NEAR_GOOD',
    rangeLabel: '12 - 13.99',
    label: 'قريب من الجيد (12 - 13.99)',
    colorClass: 'text-cyan-700 bg-cyan-50',
    defaultEstimation: 'نتائج حسنة',
    defaultGuidance: 'نتائج مقبولة بإمكانك تحسينها',
    estimations: [
      'نتائج حسنة'
    ],
    guidanceList: [
      'نتائج مقبولة بإمكانك تحسينها'
    ]
  },
  AVERAGE: {
    tier: 'AVERAGE',
    rangeLabel: '10 - 11.99',
    label: 'متوسط (10 - 11.99)',
    colorClass: 'text-amber-700 bg-amber-50',
    defaultEstimation: 'نتائج متوسطة',
    defaultGuidance: 'بمقدورك تحقيق نتائج أفضل',
    estimations: [
      'نتائج متوسطة'
    ],
    guidanceList: [
      'بمقدورك تحقيق نتائج أفضل'
    ]
  },
  BELOW_AVERAGE: {
    tier: 'BELOW_AVERAGE',
    rangeLabel: '08 - 09.99',
    label: 'دون المتوسط (08 - 09.99)',
    colorClass: 'text-orange-700 bg-orange-50',
    defaultEstimation: 'نتائج دون المتوسط',
    defaultGuidance: 'ينقصك الحرص والتركيز',
    estimations: [
      'نتائج دون المتوسط'
    ],
    guidanceList: [
      'ينقصك الحرص والتركيز'
    ]
  },
  POOR: {
    tier: 'POOR',
    rangeLabel: 'أقل من 08',
    label: 'ضعيف (أقل من 08)',
    colorClass: 'text-rose-700 bg-rose-50',
    defaultEstimation: 'نتائج غير مقبولة',
    defaultGuidance: 'احذر التهاون',
    estimations: [
      'نتائج غير مقبولة'
    ],
    guidanceList: [
      'احذر التهاون'
    ]
  },
  UNRATED: {
    tier: 'UNRATED',
    rangeLabel: '-',
    label: '-',
    colorClass: 'text-slate-600 bg-slate-50',
    defaultEstimation: '',
    defaultGuidance: 'الالتزام بالحضور والمواظبة على الدروس',
    estimations: [],
    guidanceList: []
  }
};

/**
 * تحديد الفئة البيداغوجية حسب المعدل أو النقطة
 */
export function getScoreTier(avg: number | null | undefined): ScoreTier {
  if (avg === null || avg === undefined || isNaN(avg)) return 'UNRATED';
  if (avg >= 18) return 'EXCELLENT';
  if (avg >= 16) return 'VERY_GOOD';
  if (avg >= 14) return 'GOOD';
  if (avg >= 12) return 'NEAR_GOOD';
  if (avg >= 10) return 'AVERAGE';
  if (avg >= 8) return 'BELOW_AVERAGE';
  return 'POOR';
}

/**
 * التقدير البيداغوجي الافتراضي حسب النقطة
 */
export function getDefaultEstimation(avg: number | null | undefined): string {
  const tier = getScoreTier(avg);
  return PEDAGOGICAL_TIERS[tier].defaultEstimation;
}

/**
 * الإرشاد البيداغوجي الافتراضي حسب النقطة
 */
export function getDefaultGuidance(avg: number | null | undefined): string {
  const tier = getScoreTier(avg);
  return PEDAGOGICAL_TIERS[tier].defaultGuidance;
}
