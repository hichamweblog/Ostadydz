# معين الأستاذ — قواعد وكلاء الذكاء الاصطناعي

هذه الوثيقة هي **مصدر الحقيقة الوحيد لوكلاء الذكاء الاصطناعي** في المستودع.
يجب قراءتها قبل أي تعديل، وتحديثها عند تغيير المعمارية أو الحالة أو المزامنة.
لا توجد وثيقة أخرى ملزمة تنافسها.

## 1. هوية المنتج

- الاسم: معين الأستاذ (Mueen Al-Ostad).
- الإنتاج: `https://ostady.vercel.app`.
- المنتج: دفتر عمل شخصي لأستاذ التعليم الثانوي العام والتكنولوجي بالجزائر لجميع المواد الـ 18 وفق القرار رقم 186 المؤرخ في 23 مارس 2006، مع دعم إسناد أكثر من مادة للأستاذ الواحد.
- اللغة والاتجاه: العربية RTL؛ الأسلوب رسمي وموجز.
- الأيقونة المعتمدة: `brand-logo-text.png` مع حزمة PWA الموجودة في `public/`.

## 2. التقنية والبنية

- Next.js 16.3.8، App Router، React 19، TypeScript.
- Tailwind CSS v4 و`lucide-react`.
- البناء عبر Webpack في scripts الموجودة في `package.json`.
- المسارات المستقلة: `/dashboard`, `/classes`, `/students`, `/attendance`,
  `/grades`, `/council`, `/sessions`, `/annual-distribution`, `/curriculum`,
  `/timetable`, `/lesson-preparation`, `/documents`, `/settings`.
- لا تستخدم query tabs؛ التنقل يمر عبر `usePathname` و`router.push`.
- Server Components هي الافتراضي. استخدم `'use client'` فقط للـ hooks أو
  أحداث المتصفح أو IndexedDB، ومرر البيانات عبر حدود واضحة.
- `lib/storage.ts` هو عقد `AppState` والأنواع؛ لا تنشئ store أو snapshot
  منافساً لدورة `useCloudAppState`.
- ملفات التصدير الرسمية تمر عبر `exportToDocx`/`lib/docx-exporter.ts` بمقاس A4
  وRTL. لا تستبدل OOXML بملف نصي متنكر في `.docx`.

## 3. قواعد ممنوعة

- لا تستخدم `alert`, `prompt`, أو `confirm`; استخدم `showToast` و`ConfirmDialog`.
- لا تضف `dark:` أو وضعاً ليلياً؛ التطبيق فاتح فقط.
- لا تضف Hex داخل JSX/CSS الخاص بالواجهة؛ استخدم tokens من `app/globals.css`.
  ألوان قوالب التصدير المستقلة مسموحة داخل exporter constants.
- لا تضف عنوان صفحة ثانياً داخل المحتوى؛ العنوان في `TopHeaderSanad`.
- لا ترحّل بيانات تجريبية إلى Supabase. تبدأ مساحة المستخدم فارغة.
- لا تستدعي `reset_workspace` دون تأكيد صريح وتحذير واضح.
- لا تضف حالة قابلة للتغيير أو تخزيناً جديداً دون تحديد مصدر الحقيقة ومسار
  الرفع والحذف وإعادة المحاولة والتعارض واختباراته.

## 4. عقد البيانات والمزامنة

### مصدر الحقيقة

Supabase هو المصدر الوحيد للحالة المنظمة. IndexedDB هو:

1. cache محلي قابل للاستبدال.
2. outbox دائم للتعديلات غير المؤكدة.
3. تخزين ثنائي مؤقت لملفات PDF/avatar، وليس مصدراً مستقلاً.

`useCloudAppState` هو المالك الوحيد للتحميل والحفظ والمزامنة. المكونات تعدل
الحالة عبر `useAppState()` ولا تكتب إلى Supabase أو IndexedDB مباشرة إلا عبر
helpers المعتمدة.

### التحميل والدمج

- عند التحميل، اقرأ الكاش فقط لعرض العمل المحلي المؤقت أو لإعادة تشغيل outbox.
- بعد نجاح قراءة Supabase، تفوز السحابة دائماً.
- لا يُستبقى سجل غير موجود في السحابة إلا إذا كان له `pendingRecordIds` في
  outbox غير مؤكد.
- الحالة السحابية الفارغة حالة صحيحة؛ لا تستخدم طول roster لاستنتاج فشل الحذف.
- اقرأ `sync_tombstones` قبل الدمج. الحذف مطلق ويمنع إعادة ظهور السجل.
- `SyncConflictError` نتيجة فشل صريحة، ولا يُمسح شاهد الحذف تلقائياً.
- لا يسمح `allowTombstoneOverride` إلا بقرار صريح من نافذة التعارض.
- استخدم `shouldApplyRemoteRefresh` قبل وبعد `await` لمنع clobber لكتابة محلية.
- استخدم `isSelfAuthoredChange` لتجاهل صدى الجهاز نفسه و`nextRevisionFloor` لمنع
  رجوع ساعة المراجعة.

### Outbox

- كل عملية تحمل owner، entity، record id، revision، operation id، وdevice id.
- enqueue محلي حتى دون شبكة أو جلسة؛ flush فقط بعد تحقق جلسة مصادق عليها
  ومطابقة `auth.uid()` لمالك العملية.
- لا يُحذف outbox قبل إقرار Supabase.
- الفشل يبقي العملية في الطابور مع backoff وحالة ظاهرة.
- التعارض لا يعاد تلقائياً إلى ما لا نهاية؛ يعرض قرار keep remote/local.
- الخروج يفرغ الطابور إن أمكن، ثم يستدعي `purgeLocalUserData`. إذا فشل flush
  يجب تحذير المستخدم قبل قبول فقدان العمل غير المؤكد.

### عزل المستخدمين والملفات

- مفاتيح الحالة: `sanad:app-state:v4:<ownerId>`.
- PDF: `sanad:pdf:<ownerId>:<unitId>`.
- memoranda outbox: `sanad:memoranda-outbox:<ownerId>:<operationId>`.
- avatar/outbox/cache يجب حذفها عند الخروج؛ لا تترك legacy unscoped blobs.
- لا تعتمد على localStorage لبيانات المستخدم؛ المسموح فقط معرف الجهاز.
- Service Worker لا يخزن أي طلب Supabase أو OAuth مصادق عليه؛ قواعد
  `NetworkOnly` يجب أن تسبق `defaultCache` في `app/sw.ts`.
- سياسة CSP الحالية تبدأ بوضع `Report-Only` حتى لا تكسر OAuth أو موارد Next.js؛
  عند استقرار تقارير الإنتاج تُنقل إلى `Content-Security-Policy` الحاجزة مع
  إبقاء نطاقات Supabase وWebSocket وموارد PWA المطلوبة فقط.

### الكيانات

الجداول المملوكة للمستخدم: `profiles`, `app_settings`, `classes`, `students`,
`grades`, `sessions`, `attendance`, `session_behaviors`, `timetable_slots`,
`lesson_progress`, `lesson_plans`, `custom_units`, `dashboard_tasks`,
`file_assets`/`memoranda_files`, `sync_operations`, `sync_conflicts`,
`sync_tombstones`.

- `profiles` و`app_settings` يحفظان المواد المسندة للأستاذ (`primarySubjectId`, `taughtSubjectIds`)، المادة النشطة (`activeSubjectId`)، وتخصيصات مخططات التقويم (`educationOverrides`).
- تشترك جميع المواد المسندة للفوج الواحد في نفس قائمة `students`، بينما تُعزل `grades` و`sessions` و`timetable_slots` و`lesson_progress` و`custom_units` و`lesson_plans` بمفتاح `subjectId`.

كل جدول متزامن يجب أن يملك RLS وسياسات owner صحيحة، وأن يكون في
`SYNCHRONIZED_TABLES` إذا كان Realtime مطلوباً، ومضافاً إلى `supabase_realtime`
مع `replica identity full` للأحداث التي تحتاج بيانات DELETE.

## 5. قواعد المجال والواجهة

- المرجعية القانونية: القرار الوزاري رقم 186 المؤرخ في 23 صفر 1427 هـ الموافق لـ 23 مارس 2006 (جداول المواقيت الأسبوعية والمعاملات الرسمية لجميع المواد الـ 18 والشعب)، والمنشور الوزاري رقم 837 المؤرخ في أوت 2005 للإسناد التربوي متعدد المواد.
- الساعات الأسبوعية والمعاملات: تحسب عبر `resolveWeeklyHours()` و`resolveCoefficient()` و`getWeeklyHours()` وفق القرار 186/2006 لكل مادة ومستوى وشعبة.
- مخططات التقويم الفصلي: تدعم `STD4` (مراقبة + فرض + اختبار×2 ÷ 4)، `LAB5` للمواد المخبرية (+ أعمال تطبيقية ÷ 5)، و`LANG5` للغات (+ تعبير شفوي ÷ 5)، مع قابلية التخصيص للأستاذ عبر `educationOverrides`.
- استيراد الرقمنة/ممتاز يمر عبر parsers والـ roster batch دون إسقاط الطلاب
  الموجودين أو الكتابة فوق بيانات مستخدم آخر، مع ربط العلامات بـ `(classId, subjectId, trimester)`.
- أزرار اللمس لا تقل عن 44px، والأزرار الأيقونية لها accessible name.
- الحوارات تستخدم `AccessibleDialog`/`ResponsiveOverlay` مع focus trap وEscape
  واستعادة التركيز وAndroid Back.
- أخطاء النماذج inline مع `aria-invalid` و`aria-describedby` قدر الإمكان.
- احترم `prefers-reduced-motion` وsafe areas.

## 6. الاختبارات الإلزامية قبل إنهاء التغيير

شغّل على الأقل:

```bash
npm run lint
npm run test
npm run build
git diff --check
```

عند تغيير الحالة أو المزامنة يجب أن تغطي الاختبارات:

- remote empty + stale cache => remote wins.
- حذف آخر قسم ثم reload لا يعيد القسم أو الطلاب أو الحضور.
- tombstone يمنع edit/upsert حتى قرار override صريح.
- outbox survives offline and is removed only after acknowledgement.
- logout purges owner-scoped cache, binaries, avatar, memoranda, and outbox.
- two owners cannot read or flush each other's local records.
- realtime tables and service-worker NetworkOnly rules remain aligned.

## 7. توثيق القرارات

لا تنشئ وثيقة مراجعة أو جرد جديدة. عند تغيير الحالة أو المزامنة حدّث هذا الملف
في نفس التغيير، وأضف/حدّث اختباراً يثبت السلوك. `README.md` موجه للمستخدمين
ووصف المشروع فقط، ولا يكرر عقد المزامنة التفصيلي.
