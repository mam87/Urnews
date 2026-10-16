-- Reference data and default settings. Sources are seeded in 20261017000006_sources.sql.

grant execute on function public.news_normalize(text) to anon, authenticated, service_role;

insert into public.categories (slug, name_ar, sort_order) values
  ('jordan',    'الأردن',               1),
  ('palestine', 'فلسطين',               2),
  ('arab',      'العالم العربي',        3),
  ('world',     'دولي',                 4),
  ('politics',  'سياسة',                5),
  ('economy',   'اقتصاد وأعمال',        6),
  ('tech',      'تكنولوجيا وذكاء اصطناعي', 7),
  ('health',    'صحة وعلوم',            8),
  ('sports',    'رياضة',                9)
on conflict (slug) do update set name_ar = excluded.name_ar, sort_order = excluded.sort_order;

insert into public.settings (key, value, description, is_public) values
  ('ingest_enabled',             'true',  'تشغيل/إيقاف الجلب الآلي بالكامل', false),
  ('scheduler_interval_minutes', '2',     'فترة تشغيل المُجدول (pg_cron). كل مصدر له فترة خاصة', true),
  ('max_sources_per_run',        '8',     'أقصى عدد مصادر في كل تشغيل (لحدود CPU في الخطة المجانية)', false),
  ('max_item_age_hours',         '48',    'تجاهل الأخبار الأقدم من هذا عند الجلب', false),
  ('auto_publish',               'true',  'نشر الأخبار تلقائياً، أو وضعها قيد المراجعة', false),
  ('breaking_hours',             '6',     'مدة بقاء الخبر العاجل في الشريط', true),
  ('retention_days',             '30',    'حذف الأخبار غير المثبتة الأقدم من هذا', false),
  ('stall_alert_minutes',        '15',    'تنبيه المسؤول إذا توقف الجلب لهذه المدة', false),
  ('ai_daily_limit',             '300',   'أقصى عدد استدعاءات ذكاء اصطناعي يومياً (حد إنفاق)', false),
  ('ai_summarize',               'false', 'تلخيص الأخبار العربية بالذكاء الاصطناعي (الترجمة تعمل دائماً إن توفر مفتاح)', false),
  ('allow_owner_claim',          'true',  'يسمح لأول مستخدم بالمطالبة بدور المالك ثم يُغلق تلقائياً', false),
  ('site_name',                  '"نبض الأخبار"', 'اسم الموقع', true)
on conflict (key) do nothing;
