// main/apps/web/src/i18n/locales/zh-CN.ts
/**
 * Simplified Chinese translation strings.
 *
 * All keys must match those defined in en-US.ts.
 *
 * @module i18n-locale-zh-CN
 */

import type { FlatTranslationMap } from '../types';

// ============================================================================
// Simplified Chinese Translations
// ============================================================================

export const zhCN: FlatTranslationMap = {
  // Common
  'common.save': '保存',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.loading': '加载中...',
  'common.error': '出错了',
  'common.success': '成功',
  'common.confirm': '确认',
  'common.back': '返回',
  'common.next': '下一步',
  'common.submit': '提交',
  'common.search': '搜索',

  // Auth - Login
  'auth.login.title': '登录',
  'auth.login.email': '电子邮箱',
  'auth.login.password': '密码',
  'auth.login.submit': '登录',
  'auth.login.forgotPassword': '忘记密码？',
  'auth.login.noAccount': '还没有账号？',
  'auth.login.signUp': '注册',
  'auth.login.withPasskey': '使用通行密钥登录',

  // Auth - Register
  'auth.register.title': '创建账号',
  'auth.register.email': '电子邮箱',
  'auth.register.password': '密码',
  'auth.register.confirmPassword': '确认密码',
  'auth.register.submit': '创建账号',
  'auth.register.hasAccount': '已有账号？',
  'auth.register.signIn': '登录',

  // Auth - Forgot Password
  'auth.forgotPassword.title': '重置密码',
  'auth.forgotPassword.email': '电子邮箱',
  'auth.forgotPassword.submit': '发送重置链接',
  'auth.forgotPassword.sent': '请查收邮件中的重置链接',

  // Settings
  'settings.title': '设置',
  'settings.profile.title': '个人资料',
  'settings.security.title': '安全',
  'settings.sessions.title': '会话',
  'settings.passkeys.title': '通行密钥',
  'settings.dangerZone.title': '危险操作',

  // Settings - Preferences
  'settings.preferences.title': '偏好设置',
  'settings.preferences.description': '自定义应用的外观和行为。',
  'settings.preferences.theme.title': '主题',
  'settings.preferences.theme.description': '选择应用的外观。可以选定一个主题，或跟随系统设置。',
  'settings.preferences.theme.light': '浅色',
  'settings.preferences.theme.dark': '深色',
  'settings.preferences.theme.system': '跟随系统',
  'settings.preferences.theme.lightDescription': '始终使用浅色主题',
  'settings.preferences.theme.darkDescription': '始终使用深色主题',
  'settings.preferences.theme.systemDescription': '与操作系统设置保持一致',
  'settings.preferences.theme.currentSelection': '当前选择：',
  'settings.preferences.timezone.title': '时区',
  'settings.preferences.timezone.description': '设置用于显示日期和时间的首选时区。',
  'settings.preferences.language.title': '语言',
  'settings.preferences.language.description': '选择应用界面的首选语言。',
  'settings.preferences.language.saved': '语言偏好已保存。',

  // Errors
  'error.unauthorized': '您需要登录才能访问此页面',
  'error.forbidden': '您没有权限访问此资源',
  'error.notFound': '页面未找到',
  'error.serverError': '发生了意外错误，请重试。',
};
