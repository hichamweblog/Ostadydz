import type { RegulationFramework, SourceRef } from './types';

export const SOURCES: Record<string, SourceRef> = {
  DECISION_186_2006: {
    id: 'decision-186-2006',
    kind: 'DECISION',
    title: 'القرار الوزاري رقم 186 المؤرخ في 23 صفر 1427 هـ الموافق لـ 23 مارس 2006 المتضمن مواقيت ومعاملات المواد في التعليم الثانوي العام والتكنولوجي',
    date: '2006-03-23',
  },
  IMG_MINISTRY_TABLE: {
    id: 'img-ministry-table',
    kind: 'MINISTRY_TABLE_IMAGE',
    title: 'جدول مواقيت المواد في مرحلة التعليم الثانوي العام والتكنولوجي (نسخة مختومة بختم وزارة التربية الوطنية)',
    note: 'يبين الحجم الساعي الإجمالي وحصص التفويج بين قوسين لجميع الشعب والمستويات',
  },
  FET_PDF: {
    id: 'fet-pdf',
    kind: 'TIMETABLE_TOOL_SHEET',
    title: 'جداول المواقيت الأسبوعية للمواد التعليمية للطور الثانوي (برنامج FET — 7 صفحات للشعب)',
    note: 'يبين ساعات التلميذ، ساعات الأستاذ، والتقسيم الأسبوعي للحصص النظرية والتطبيقية',
  },
  CIRCULAR_837_2005: {
    id: 'circular-837-2005',
    kind: 'DECISION',
    title: 'المنشور الوزاري رقم 837 المؤرخ في أوت 2005 المتعلق بإسناد المواد وإكمال النصاب القانوني الأسبوعي',
    date: '2005-08-01',
  },
  EDDIRASA_D20_REPORT: {
    id: 'eddirasa-d20-report',
    kind: 'SECONDARY_WEBSITE',
    title: 'مقارنة المعاملات والمواقيت السابقة (القرار 186/2006) مع جدول القرار 20 الملغى',
    note: 'يُعتمد منه عمود «القديم (186/2006)» فقط وتُستبعد قيم القرار 20 الملغى',
  },
  EDDIRASA_D36_REPORT: {
    id: 'eddirasa-d36-report',
    kind: 'MINISTRY_STATEMENT',
    title: 'القرار رقم 36 المؤرخ في 09 سبتمبر 2026 المتضمن إلغاء القرار رقم 20 والعمل بأحكام القرار 186 لسنة 2006',
    date: '2026-09-09',
  },
  MINISTRY_STATEMENT_2026_07_29: {
    id: 'eddirasa-ministry-statement-2026-07-29',
    kind: 'MINISTRY_STATEMENT',
    title: 'بلاغ وزارة التربية الوطنية حول الترتيبات البيداغوجية للموسم الدراسي 2026/2027',
    date: '2026-07-29',
  },
  MD_TABLE: {
    id: 'md-table',
    kind: 'SECONDARY_WEBSITE',
    title: 'الجدول النصي المرفق للمواقيت والمعاملات',
    note: 'يُستعمل بعد تنقيته من القيم الملوثة بالقرار 20 الملغى ومطابقته مع الصورة المختومة وFET',
  },
};

export const DZ_SEC_2006_FRAMEWORK: RegulationFramework = {
  id: 'DZ_SEC_2006',
  labelAr: 'نظام التعليم الثانوي العام والتكنولوجي — القرار رقم 186 المؤرخ في 23 مارس 2006',
  status: 'ACTIVE',
  academicYears: ['2025/2026', '2026/2027'],
  sources: [
    SOURCES.DECISION_186_2006,
    SOURCES.EDDIRASA_D36_REPORT,
    SOURCES.IMG_MINISTRY_TABLE,
    SOURCES.FET_PDF,
  ],
  notes: 'الإطار الساري المفعول رسمياً بعد إلغاء القرار رقم 20 بموجب القرار رقم 36 المؤرخ في 09 سبتمبر 2026.',
};
