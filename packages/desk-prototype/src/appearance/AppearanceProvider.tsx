import { createContext, useContext, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { DEFAULT_APPEARANCE, resolveThemeVars } from './appearance';
import type { AppearanceState } from './appearance';

type AppearanceContextValue = {
  appearance: AppearanceState;
  setAppearance: (next: AppearanceState) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (value === null) throw new Error('useAppearance должен вызываться внутри AppearanceProvider');
  return value;
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function containerStyle(appearance: AppearanceState): CSSProperties {
  const vars = resolveThemeVars(appearance.themeId, systemPrefersDark());
  const custom: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (key.startsWith('--')) custom[key] = value;
  }
  return {
    colorScheme: vars.colorScheme,
    backgroundColor: 'var(--app-bg)',
    color: 'var(--app-text)',
    fontFamily: appearance.uiFontFamily,
    fontSize: `${appearance.fontSize}px`,
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    ...custom,
  } as CSSProperties;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<AppearanceState>(DEFAULT_APPEARANCE);
  const value = useMemo(() => ({ appearance, setAppearance }), [appearance]);
  return (
    <AppearanceContext.Provider value={value}>
      <div style={containerStyle(appearance)}>{children}</div>
    </AppearanceContext.Provider>
  );
}
