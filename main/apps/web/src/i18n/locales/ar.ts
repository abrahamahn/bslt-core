// main/apps/web/src/i18n/locales/ar.ts
/**
 * Arabic translation strings.
 *
 * All keys must match those defined in en-US.ts.
 * Arabic is a right-to-left locale; the app shell mirrors layout via
 * `dir="rtl"` on the document root (see LOCALE_METADATA and I18nProvider).
 *
 * @module i18n-locale-ar
 */

import type { FlatTranslationMap } from '../types';

// ============================================================================
// Arabic Translations
// ============================================================================

export const ar: FlatTranslationMap = {
  // Common
  'common.save': 'حفظ',
  'common.cancel': 'إلغاء',
  'common.delete': 'حذف',
  'common.edit': 'تعديل',
  'common.loading': 'جارٍ التحميل...',
  'common.error': 'حدث خطأ ما',
  'common.success': 'تم بنجاح',
  'common.confirm': 'تأكيد',
  'common.back': 'رجوع',
  'common.next': 'التالي',
  'common.submit': 'إرسال',
  'common.search': 'بحث',

  // Auth - Login
  'auth.login.title': 'تسجيل الدخول',
  'auth.login.email': 'البريد الإلكتروني',
  'auth.login.password': 'كلمة المرور',
  'auth.login.submit': 'تسجيل الدخول',
  'auth.login.forgotPassword': 'هل نسيت كلمة المرور؟',
  'auth.login.noAccount': 'ليس لديك حساب؟',
  'auth.login.signUp': 'إنشاء حساب',
  'auth.login.withPasskey': 'تسجيل الدخول بمفتاح المرور',

  // Auth - Register
  'auth.register.title': 'إنشاء حساب',
  'auth.register.email': 'البريد الإلكتروني',
  'auth.register.password': 'كلمة المرور',
  'auth.register.confirmPassword': 'تأكيد كلمة المرور',
  'auth.register.submit': 'إنشاء حساب',
  'auth.register.hasAccount': 'لديك حساب بالفعل؟',
  'auth.register.signIn': 'تسجيل الدخول',

  // Auth - Forgot Password
  'auth.forgotPassword.title': 'إعادة تعيين كلمة المرور',
  'auth.forgotPassword.email': 'البريد الإلكتروني',
  'auth.forgotPassword.submit': 'إرسال رابط إعادة التعيين',
  'auth.forgotPassword.sent': 'تحقق من بريدك الإلكتروني للحصول على رابط إعادة التعيين',

  // Settings
  'settings.title': 'الإعدادات',
  'settings.profile.title': 'الملف الشخصي',
  'settings.security.title': 'الأمان',
  'settings.sessions.title': 'الجلسات',
  'settings.passkeys.title': 'مفاتيح المرور',
  'settings.dangerZone.title': 'منطقة الخطر',

  // Settings - Preferences
  'settings.preferences.title': 'التفضيلات',
  'settings.preferences.description': 'خصص مظهر التطبيق وسلوكه.',
  'settings.preferences.theme.title': 'المظهر',
  'settings.preferences.theme.description':
    'اختر كيف يبدو التطبيق. حدد مظهرًا أو دعه يتبع إعدادات نظامك.',
  'settings.preferences.theme.light': 'فاتح',
  'settings.preferences.theme.dark': 'داكن',
  'settings.preferences.theme.system': 'النظام',
  'settings.preferences.theme.lightDescription': 'استخدام المظهر الفاتح دائمًا',
  'settings.preferences.theme.darkDescription': 'استخدام المظهر الداكن دائمًا',
  'settings.preferences.theme.systemDescription': 'مطابقة إعداد نظام التشغيل لديك',
  'settings.preferences.theme.currentSelection': 'التحديد الحالي:',
  'settings.preferences.timezone.title': 'المنطقة الزمنية',
  'settings.preferences.timezone.description': 'حدد منطقتك الزمنية المفضلة لعرض التواريخ والأوقات.',
  'settings.preferences.language.title': 'اللغة',
  'settings.preferences.language.description': 'اختر لغتك المفضلة لواجهة التطبيق.',
  'settings.preferences.language.saved': 'تم حفظ تفضيل اللغة.',

  // Errors
  'error.unauthorized': 'يجب تسجيل الدخول للوصول إلى هذه الصفحة',
  'error.forbidden': 'ليست لديك صلاحية الوصول إلى هذا المورد',
  'error.notFound': 'الصفحة غير موجودة',
  'error.serverError': 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.',
};
