// main/apps/web/src/i18n/locales/pt-BR.ts
/**
 * Brazilian Portuguese translation strings.
 *
 * All keys must match those defined in en-US.ts.
 *
 * @module i18n-locale-pt-BR
 */

import type { FlatTranslationMap } from '../types';

// ============================================================================
// Brazilian Portuguese Translations
// ============================================================================

export const ptBR: FlatTranslationMap = {
  // Common
  'common.save': 'Salvar',
  'common.cancel': 'Cancelar',
  'common.delete': 'Excluir',
  'common.edit': 'Editar',
  'common.loading': 'Carregando...',
  'common.error': 'Algo deu errado',
  'common.success': 'Sucesso',
  'common.confirm': 'Confirmar',
  'common.back': 'Voltar',
  'common.next': 'Avançar',
  'common.submit': 'Enviar',
  'common.search': 'Pesquisar',

  // Auth - Login
  'auth.login.title': 'Entrar',
  'auth.login.email': 'Endereço de e-mail',
  'auth.login.password': 'Senha',
  'auth.login.submit': 'Entrar',
  'auth.login.forgotPassword': 'Esqueceu a senha?',
  'auth.login.noAccount': 'Não tem uma conta?',
  'auth.login.signUp': 'Cadastre-se',
  'auth.login.withPasskey': 'Entrar com chave de acesso',

  // Auth - Register
  'auth.register.title': 'Criar conta',
  'auth.register.email': 'Endereço de e-mail',
  'auth.register.password': 'Senha',
  'auth.register.confirmPassword': 'Confirmar senha',
  'auth.register.submit': 'Criar conta',
  'auth.register.hasAccount': 'Já tem uma conta?',
  'auth.register.signIn': 'Entrar',

  // Auth - Forgot Password
  'auth.forgotPassword.title': 'Redefinir senha',
  'auth.forgotPassword.email': 'Endereço de e-mail',
  'auth.forgotPassword.submit': 'Enviar link de redefinição',
  'auth.forgotPassword.sent': 'Verifique seu e-mail para obter o link de redefinição',

  // Settings
  'settings.title': 'Configurações',
  'settings.profile.title': 'Perfil',
  'settings.security.title': 'Segurança',
  'settings.sessions.title': 'Sessões',
  'settings.passkeys.title': 'Chaves de acesso',
  'settings.dangerZone.title': 'Zona de perigo',

  // Settings - Preferences
  'settings.preferences.title': 'Preferências',
  'settings.preferences.description': 'Personalize a aparência e o comportamento do aplicativo.',
  'settings.preferences.theme.title': 'Tema',
  'settings.preferences.theme.description':
    'Escolha a aparência do aplicativo. Selecione um tema ou deixe-o seguir as configurações do sistema.',
  'settings.preferences.theme.light': 'Claro',
  'settings.preferences.theme.dark': 'Escuro',
  'settings.preferences.theme.system': 'Sistema',
  'settings.preferences.theme.lightDescription': 'Sempre usar o tema claro',
  'settings.preferences.theme.darkDescription': 'Sempre usar o tema escuro',
  'settings.preferences.theme.systemDescription':
    'Acompanhar a configuração do sistema operacional',
  'settings.preferences.theme.currentSelection': 'Seleção atual:',
  'settings.preferences.timezone.title': 'Fuso horário',
  'settings.preferences.timezone.description':
    'Defina seu fuso horário preferido para exibir datas e horários.',
  'settings.preferences.language.title': 'Idioma',
  'settings.preferences.language.description':
    'Escolha seu idioma preferido para a interface do aplicativo.',
  'settings.preferences.language.saved': 'Preferência de idioma salva.',

  // Errors
  'error.unauthorized': 'Você precisa entrar para acessar esta página',
  'error.forbidden': 'Você não tem permissão para acessar este recurso',
  'error.notFound': 'Página não encontrada',
  'error.serverError': 'Ocorreu um erro inesperado. Tente novamente.',
};
