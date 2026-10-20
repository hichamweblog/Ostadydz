import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'شروط الاستخدام | معين الأستاذ',
  description: 'شروط استخدام تطبيق معين الأستاذ.',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[var(--surface)] px-5 py-10 text-[var(--text-primary)]" dir="rtl">
      <article className="mx-auto max-w-3xl">
        <nav className="mb-10 flex flex-wrap gap-4 text-sm font-bold">
          <Link className="text-[var(--primary)] hover:underline" href="/">العودة إلى الرئيسية</Link>
          <Link className="text-[var(--text-secondary)] hover:text-[var(--primary)]" href="/privacy">سياسة الخصوصية</Link>
        </nav>
        <h1 className="text-2xl font-bold text-[var(--primary)]">شروط الاستخدام</h1>
        <p className="mt-4 text-sm leading-8">آخر تحديث: 19 سبتمبر 2026</p>
        <section className="mt-8 space-y-6 text-sm leading-8">
          <div>
            <h2 className="font-bold">الاستخدام المقبول</h2>
            <p>يستخدم «معين الأستاذ» لإدارة العمل التربوي الشخصي. يلتزم المستخدم بإدخال بيانات يملك حق معالجتها، وبالامتثال للقوانين والأنظمة المعمول بها، وبحماية بيانات التلاميذ وعدم مشاركتها مع غير المخولين.</p>
          </div>
          <div>
            <h2 className="font-bold">مسؤولية النسخ الاحتياطي</h2>
            <p>يوفر التطبيق أدوات تصدير ونسخ احتياطي، ويظل المستخدم مسؤولاً عن الاحتفاظ بنسخ مناسبة من ملفاته المهمة والتحقق من دقتها قبل اعتمادها أو طباعتها.</p>
          </div>
          <div>
            <h2 className="font-bold">الخدمة السحابية</h2>
            <p>قد تعتمد بعض الميزات على Supabase أو Google أو Netlify، وقد تتأثر بتوفر هذه الخدمات أو حدود خطتها المجانية.</p>
          </div>
          <div>
            <h2 className="font-bold">حدود المسؤولية</h2>
            <p>يبذل مالك التطبيق جهداً معقولاً للحفاظ على الخدمة، لكنه لا يضمن خلوها من الانقطاع أو الأخطاء. لا يغني التطبيق عن المراجعة المهنية أو الالتزامات الرسمية الخاصة بالمؤسسة التعليمية.</p>
          </div>
          <div>
            <h2 className="font-bold">التعديلات والتواصل</h2>
            <p>قد تتغير الميزات أو هذه الشروط عند الحاجة. استمرار استخدام التطبيق بعد نشر التعديلات يعني الاطلاع عليها. للاستفسارات، استخدم <a className="font-bold text-[var(--primary)] hover:underline" href="https://github.com/hichamweblog/Ostad" rel="noreferrer">المستودع الرسمي على GitHub</a>.</p>
          </div>
        </section>
      </article>
    </main>
  );
}
