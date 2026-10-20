import type { AssignmentBundleDef, SubjectId } from '../types';

/**
 * حزم الإسناد التربوي المشترك في التعليم الثانوي بالجزائر
 * (وفق المنشور الوزاري رقم 837 المؤرخ في أوت 2005 والخرائط التربوية المعتمدة).
 * يستطيع الأستاذ اختيار حزمة جاهزة أو تعديل قائمة مواده المسندة بحرية تامة.
 */
export const ASSIGNMENT_BUNDLES: AssignmentBundleDef[] = [
  {
    id: 'MGMT_ECO_ALL',
    labelAr: 'أستاذ العلوم الاقتصادية والتسيير (محاسبة + اقتصاد + قانون)',
    descriptionAr: 'الإسناد الرسمي لشعبة التسيير والاقتصاد: التسيير المحاسبي والمالي، الاقتصاد والمناجمنت، والقانون.',
    primarySubjectId: 'ACCOUNTING_FIN',
    subjectIds: ['ACCOUNTING_FIN', 'ECON_MGMT', 'LAW'],
    notes: 'يمكّن الأستاذ من تدريس الفوج نفسه في المواد الثلاث والتبديل بينها بضغطة واحدة.',
  },
  {
    id: 'ECON_LAW_PAIR',
    labelAr: 'الاقتصاد والمناجمنت + القانون',
    descriptionAr: 'إسناد مادتي الاقتصاد والمناجمنت والقانون لأقسام التسيير والاقتصاد.',
    primarySubjectId: 'ECON_MGMT',
    subjectIds: ['ECON_MGMT', 'LAW'],
  },
  {
    id: 'TECH_WITH_INF',
    labelAr: 'أستاذ التكنولوجيا (الهندسة) + الإعلام الآلي',
    descriptionAr: 'تدريس التكنولوجيا في التخصص الهندسي والجذع المشترك مع إسناد مادة الإعلام الآلي لإكمال النصاب القانوني.',
    primarySubjectId: 'TECHNOLOGY',
    subjectIds: ['TECHNOLOGY', 'COMPUTER_SCI'],
    notes: 'وفق المنشور الوزاري رقم 837 المؤرخ في أوت 2005.',
  },
  {
    id: 'PHYSICS_WITH_1AS_TECH',
    labelAr: 'أستاذ العلوم الفيزيائية + تكنولوجيا السنة الأولى (ج.م.ع.ت)',
    descriptionAr: 'تدريس العلوم الفيزيائية مع إسناد التكنولوجيا في الجذع المشترك علوم وتكنولوجيا (مجال الهندسة الكهربائية/الطرائق).',
    primarySubjectId: 'PHYSICS',
    subjectIds: ['PHYSICS', 'TECHNOLOGY'],
  },
  {
    id: 'NATURAL_SCI_WITH_1AS_TECH',
    labelAr: 'أستاذ علوم الطبيعة والحياة + تكنولوجيا السنة الأولى (ج.م.ع.ت)',
    descriptionAr: 'تدريس علوم الطبيعة والحياة مع إسناد التكنولوجيا أو الإعلام الآلي في الجذع المشترك علوم وتكنولوجيا.',
    primarySubjectId: 'NATURAL_SCI',
    subjectIds: ['NATURAL_SCI', 'TECHNOLOGY'],
  },
  {
    id: 'MATH_WITH_INF',
    labelAr: 'أستاذ الرياضيات + الإعلام الآلي (1AS)',
    descriptionAr: 'تدريس الرياضيات مع إسناد حصص الإعلام الآلي للسنة الأولى ثانوي لإكمال النصاب.',
    primarySubjectId: 'MATH',
    subjectIds: ['MATH', 'COMPUTER_SCI'],
  },
];

/**
 * يقترح المواد الإضافية الشائعة الإسناد مع المادة الأساسية المختارة
 */
export function getRelatedSubjectsForAssignment(primarySubjectId: SubjectId): SubjectId[] {
  switch (primarySubjectId) {
    case 'ACCOUNTING_FIN':
      return ['ECON_MGMT', 'LAW'];
    case 'ECON_MGMT':
      return ['ACCOUNTING_FIN', 'LAW'];
    case 'LAW':
      return ['ECON_MGMT', 'ACCOUNTING_FIN'];
    case 'TECHNOLOGY':
      return ['COMPUTER_SCI', 'PHYSICS'];
    case 'COMPUTER_SCI':
      return ['TECHNOLOGY', 'MATH'];
    case 'PHYSICS':
      return ['TECHNOLOGY', 'COMPUTER_SCI'];
    case 'NATURAL_SCI':
      return ['TECHNOLOGY', 'COMPUTER_SCI'];
    case 'MATH':
      return ['COMPUTER_SCI', 'TECHNOLOGY'];
    default:
      return [];
  }
}
