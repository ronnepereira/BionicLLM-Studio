import { useSettingsStore } from '../stores/settingsStore'
import type { Settings } from '../types/settings'

const ptBR = {
  chat: 'Chat', create: 'Criar', voice: 'Voz', compare: 'Comparar',
  benchmark: 'Benchmark', models: 'Modelos', settings: 'Configurações', skills: 'Habilidades', agents: 'Agentes', schedules: 'Agenda',
  main: 'Principal', navigation: 'Navegação principal', sidebar: 'Alternar barra lateral',
  language: 'Idioma', theme: 'Tema', light: 'Claro', dark: 'Escuro',
  lightMode: 'Modo claro', darkMode: 'Modo escuro',
  minimize: 'Minimizar', maximize: 'Maximizar', restore: 'Restaurar', close: 'Fechar',
  languageNote: 'Escolha o idioma da interface.',
} as const

export type TranslationKey = keyof typeof ptBR
const en: Record<TranslationKey, string> = {
  chat: 'Chat', create: 'Create', voice: 'Voice', compare: 'Compare',
  benchmark: 'Benchmark', models: 'Models', settings: 'Settings', skills: 'Skills', agents: 'Agents', schedules: 'Schedule',
  main: 'Main', navigation: 'Main navigation', sidebar: 'Toggle sidebar',
  language: 'Language', theme: 'Theme', light: 'Light', dark: 'Dark',
  lightMode: 'Light mode', darkMode: 'Dark mode',
  minimize: 'Minimize', maximize: 'Maximize', restore: 'Restore', close: 'Close',
  languageNote: 'Choose the interface language.',
}

export function translate(language: Settings['language'], key: TranslationKey): string {
  return (language === 'en' ? en : ptBR)[key]
}

export function useTranslation() {
  const language = useSettingsStore((state) => state.settings.language)
  return { language, t: (key: TranslationKey) => translate(language, key) }
}
