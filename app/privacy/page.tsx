import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية | معين الأستاذ',
  description: 'سياسة الخصوصية لتطبيق معين الأستاذ.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[var(--surface)] px-5 py-10 text-[var(--text-primary)]" dir="rtl">
      <article className="mx-auto max-w-3xl">
        <nav className="mb-10 flex flex-wrap gap-4 text-sm font-bold">
          <Link className="text-[var(--primary)] hover:underline" href="/">العودة إلى الرئيسية</Link>
          <Link className="text-[var(--text-secondary)] hover:text-[var(--primary)]" href="/terms">شروط الاستخدام</Link>
        </nav>
        <h1 className="text-2xl font-bold text-[var(--primary)]">سياسة الخصوصية</h1>
        <p className="mt-4 text-sm leading-8">آخر تحديث: 19 سبتمبر 2026</p>
        <section className="mt-8 space-y-6 text-sm leading-8">
          <div>
            <h2 className="font-bold">البيانات التي نعالجها</h2>
            <p>يعالج تطبيق «معين الأستاذ» بيانات الحساب الأساسية التي يوفرها مزود تسجيل الدخول، مثل الاسم والبريد الإلكتروني والصورة عند استخدام Google. كما يعالج البيانات التي يدخلها الأستاذ لإدارة عمله التربوي، مثل الأقسام وقوائم التلاميذ والدرجات والحضور والمذكرات.</p>
          </div>
          <div>
            <h2 className="font-bold">استخدام البيانات</h2>
            <p>تستخدم البيانات لتوفير دفتر الأستاذ، حفظ البيانات ومزامنتها بين أجهزتك، وإتاحة التصدير والنسخ الاحتياطي. لا نبيع البيانات ولا نستخدمها للإعلانات الموجهة أو لإنشاء ملفات تسويقية عن المستخدمين.</p>
          </div>
          <div>
            <h2 className="font-bold">التخزين والحماية</h2>
            <p>تخزن البيانات السحابية عبر Supabase، مع عزل حسابات المستخدمين بسياسات وصول مناسبة. تبقى بعض البيانات وملفات النسخ الاحتياطي محلياً في متصفح جهازك لدعم العمل دون اتصال. لا توجد وسيلة نقل أو تخزين إلكترونية مضمونة بشكل مطلق، لذلك احرص على حماية جهازك وحسابك.</p>
          </div>
          <div>
            <h2 className="font-bold">الاحتفاظ والحذف</h2>
            <p>نحتفظ بالبيانات ما دام الحساب مستخدماً أو ما دامت لازمة لتقديم الخدمة. يمكنك حذف بيانات مساحة العمل من داخل التطبيق، كما يمكنك طلب حذف الحساب والبيانات السحابية المرتبطة به عبر التواصل مع مالك التطبيق. قد تبقى نسخ احتياطية مؤقتة وفق سياسات مزودي البنية التحتية.</p>
          </div>
          <div>
            <h2 className="font-bold">الخدمات الخارجية</h2>
            <p>قد يعتمد التطبيق على Google لتسجيل الدخول، وSupabase للتخزين والمزامنة، وNetlify للاستضافة. تخضع معالجة البيانات لدى هذه الخدمات لسياساتها الخاصة.</p>
          </div>
          <div>
            <h2 className="font-bold">التواصل</h2>
            <p>للاستفسارات أو طلبات الخصوصية، تواصل مع مالك التطبيق عبر <a className="font-bold text-[var(--primary)] hover:underline" href="https://github.com/hichamweblog/Ostad" rel="noreferrer">المستودع الرسمي على GitHub</a>.</p>
          </div>
        </section>
      </article>
    </main>
  );
}
