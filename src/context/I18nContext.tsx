import { createContext, useContext, useState, type ReactNode } from 'react'
import { en } from '../i18n/en'

type Translations = Record<string, string>
const locales: Record<string, Translations> = { en }

type I18nContextValue = {
  locale: string
  setLocale: (locale: string) => void
  t: (key: string) => string
  availableLocales: string[]
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
  availableLocales: ['en'],
})

export function useI18n() {
  return useContext(I18nContext)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(
    () => localStorage.getItem('is-map-locale') || 'en',
  )

  const setLocale = (l: string) => {
    setLocaleState(l)
    localStorage.setItem('is-map-locale', l)
  }

  const t = (key: string): string =>
    locales[locale]?.[key] || locales.en?.[key] || key

  return (
    <I18nContext.Provider
      value={{ locale, setLocale, t, availableLocales: Object.keys(locales) }}
    >
      {children}
    </I18nContext.Provider>
  )
}
