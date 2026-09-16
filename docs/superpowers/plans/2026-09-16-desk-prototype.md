# Desk Prototype (visual redesign mocks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, browser-only React prototype (`packages/desk-prototype`) that demonstrates the approved visual redesign of Galley Desk's book window — flat/tonal surfaces on real theme tokens, two-font typography, icon-first header, redesigned review sidebar, background-highlighted edits/signals with gutter markers, and a mocked custom window frame — running on static fixture data with no Electron/IPC dependency.

**Architecture:** A new npm workspace package, Vite + React 18 + TypeScript, styled with Tailwind v4 bridged to `@inkyquill/galley-themes` CSS variables via `@theme inline`. Presentational logic that can be expressed as pure functions (text-segment highlighting, record formatting, literal search, theme/appearance resolution) lives in small tested modules; components are thin and hold only UI state (matches this repo's existing convention — see `apps/desktop/src/renderer/search/search.ts` + `ChapterSearch.tsx`, `appearance/Appearance.tsx`'s tested pure exports — no component-level test harness exists in this repo, so components stay untested and are verified by running the dev server).

**Tech Stack:** Vite 5, React 18.3.1, TypeScript 5.9.3 (strict, `verbatimModuleSyntax`), Tailwind CSS v4 (`@tailwindcss/vite`), `@tabler/icons-react` 3.x, `@inkyquill/galley-themes` 0.14.0, Vitest (already configured at repo root).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-16-visual-redesign-design.md` — every requirement in it must map to a task below.
- Package lives at `packages/desk-prototype`, covered automatically by the root `workspaces: ["packages/*", "apps/*"]` glob.
- No Electron, no `window.desk.*` IPC, no real persistence — all data is local fixtures/component state.
- Node `>=20`, React `18.3.1`, TypeScript `5.9.3`, strict mode, `verbatimModuleSyntax: true` (use `import type { ... }` for type-only imports everywhere).
- Test files use the `*.test.ts` extension (root `vitest.config.ts` only globs `packages/**/*.test.ts` / `apps/**/*.test.ts`) and hold **pure logic only** — this repo has no DOM/component test harness (no jsdom, no `@testing-library/react` anywhere), so don't introduce one; verify components by running `npm run dev` and checking in a browser.
- Russian UI copy throughout (matches `CONTEXT.md` terminology: Правка, Сигнал, Рецензент, Автор).
- Icon set: **Tabler Icons** (`@tabler/icons-react`) only, per the spec's "Иконки" section — don't mix in a second icon package.
- Scope: only Galley Desk's book-window UI is mocked here — no Pocket Editor, no Galley Pad changes.

---

## File Structure

```
packages/desk-prototype/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  public/
    galley-desk-icon.svg
  src/
    main.tsx
    App.tsx
    styles.css
    types.ts
    icons.ts
    appearance/
      appearance.ts
      appearance.test.ts
      AppearanceProvider.tsx
      AppearancePanel.tsx
    data/
      fixtures.ts
      fixtures.test.ts
    lib/
      marked-text.ts
      marked-text.test.ts
      record-format.ts
      record-format.test.ts
      search.ts
      search.test.ts
    components/
      Header.tsx
      ChapterSidebar.tsx
      ChapterContent.tsx
      EditFlyout.tsx
      ReviewSidebar.tsx
      RecordPopup.tsx
      SignalPicker.tsx
      TitleBar.tsx
```

---

### Task 1: Package scaffold — Vite + React + Tailwind v4

**Files:**
- Create: `packages/desk-prototype/package.json`
- Create: `packages/desk-prototype/tsconfig.json`
- Create: `packages/desk-prototype/vite.config.ts`
- Create: `packages/desk-prototype/index.html`
- Create: `packages/desk-prototype/src/main.tsx`
- Create: `packages/desk-prototype/src/App.tsx`
- Create: `packages/desk-prototype/src/styles.css`
- Modify: `/home/inky/Development/galley-desk/tsconfig.json`

**Interfaces:**
- Produces: a running Vite dev server at `packages/desk-prototype` rendering `<App />`; `--app-bg`/`--app-text` CSS variables with a static fallback until Task 2's provider takes over; Tailwind utilities `bg-app-bg`, `bg-app-panel`, `bg-app-panel-muted`, `bg-app-hover`, `text-app-text`, `text-app-text-muted`, `text-app-accent`, `bg-app-error`, `text-app-error` mapped to those CSS variables (used by every later task).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@galley-desk/desk-prototype",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --pretty false"
  },
  "dependencies": {
    "@inkyquill/galley-themes": "0.14.0",
    "@tabler/icons-react": "3.46.0",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "@types/react": "18.3.31",
    "@types/react-dom": "18.3.7",
    "@vitejs/plugin-react": "6.1.1",
    "tailwindcss": "4.3.3",
    "vite": "5.4.21"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (mirrors `apps/desktop/tsconfig.json`'s shape so it can join the root `tsc -b` composite graph)

```json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "rootDir": "src",
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Add the project reference to the root `tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "packages/pocket-format" },
    { "path": "packages/review-engine" },
    { "path": "packages/book-storage" },
    { "path": "packages/desk-prototype" },
    { "path": "apps/desktop" }
  ]
}
```

- [ ] **Step 4: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5183 },
});
```

- [ ] **Step 5: Create `index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Galley Desk — прототип</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `src/styles.css`**

```css
@import "tailwindcss";

@theme inline {
  --color-app-bg: var(--app-bg);
  --color-app-panel: var(--app-panel);
  --color-app-panel-muted: var(--app-panel-muted);
  --color-app-text: var(--app-text);
  --color-app-text-muted: var(--app-text-muted);
  --color-app-hover: var(--app-hover);
  --color-app-accent: var(--app-accent);
  --color-app-error: var(--app-error-text);
}

/* Нейтральная системная подложка до первой покраски AppearanceProvider —
   тот же приём, что и в apps/desktop/src/renderer/app.css, чтобы не
   мигать чужой темой на первом кадре. */
body {
  margin: 0;
  background: Canvas;
  color: CanvasText;
}
```

- [ ] **Step 7: Create `src/App.tsx`** (placeholder — replaced incrementally in later tasks)

```tsx
export default function App() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p>Прототип Galley Desk</p>
    </div>
  );
}
```

- [ ] **Step 8: Create `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Не найден корневой элемент #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Install dependencies and verify the dev server**

Run: `npm install` (from repo root — installs the new workspace)
Expected: install completes without errors, `node_modules/@galley-desk/desk-prototype` symlink exists.

Run: `npm run dev --workspace @galley-desk/desk-prototype`
Expected: Vite prints a local URL (`http://localhost:5183/`). Open it — a plain page with the text "Прототип Galley Desk" on the system-default background, no console errors. Stop the server (Ctrl+C) after checking.

- [ ] **Step 10: Verify typecheck**

Run: `npm run typecheck`
Expected: exits 0 (includes `packages/desk-prototype` now via the root reference).

- [ ] **Step 11: Commit**

```bash
git add packages/desk-prototype tsconfig.json
git commit -m "chore: scaffold desk-prototype package (Vite + React + Tailwind v4)"
```

---

### Task 2: Appearance state — theme/token resolution + provider

**Files:**
- Create: `packages/desk-prototype/src/appearance/appearance.ts`
- Create: `packages/desk-prototype/src/appearance/appearance.test.ts`
- Create: `packages/desk-prototype/src/appearance/AppearanceProvider.tsx`
- Modify: `packages/desk-prototype/src/App.tsx`

**Interfaces:**
- Consumes: `@inkyquill/galley-themes` (`BUILT_IN_THEMES`, `getTheme`, `isThemeId`, `themeToCssVariables`, types `ThemeCssVariables`, `ThemeDefinition`).
- Produces: `AppearanceState` type (`themeId`, `uiFontFamily`, `bookFontFamily`, `fontSize`, `lineWidth`), `DEFAULT_APPEARANCE`, `SYSTEM_THEME_ID`, `FONT_SIZE_BOUNDS`, `LINE_WIDTH_BOUNDS`, `themeOptions()`, `resolveThemeVars(themeId, systemDark)` — all consumed by Task 11's `AppearancePanel` and by `AppearanceProvider`. `AppearanceProvider` exposes `useAppearance()` returning `{ appearance, setAppearance }`, consumed by every later component task.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/desk-prototype/src/appearance/appearance.test.ts
import { describe, expect, it } from 'vitest';
import { getTheme } from '@inkyquill/galley-themes';
import { DEFAULT_APPEARANCE, resolveThemeVars, themeOptions } from './appearance';

describe('resolveThemeVars', () => {
  it('resolves a known light theme id directly', () => {
    const vars = resolveThemeVars('galley-light', false);
    expect(vars['--app-bg']).toBe('#f6f4ef');
    expect(vars['--app-accent']).toBe(getTheme('galley-light')!.tokens.app.focus);
  });

  it('falls back to galley-dark for "auto" under a dark system scheme', () => {
    const vars = resolveThemeVars('auto', true);
    expect(vars['--app-bg']).toBe(getTheme('galley-dark')!.tokens.app.bg);
  });

  it('falls back to galley-light for "auto" under a light system scheme', () => {
    const vars = resolveThemeVars('auto', false);
    expect(vars['--app-bg']).toBe(getTheme('galley-light')!.tokens.app.bg);
  });

  it('falls back to galley-light for an unknown theme id', () => {
    const vars = resolveThemeVars('does-not-exist', false);
    expect(vars['--app-bg']).toBe(getTheme('galley-light')!.tokens.app.bg);
  });

  it('uses a darker card shadow for dark themes', () => {
    const light = resolveThemeVars('galley-light', false);
    const dark = resolveThemeVars('galley-dark', false);
    expect(light['--app-card-shadow']).toContain('rgb(31 37 35');
    expect(dark['--app-card-shadow']).toContain('rgb(0 0 0');
  });
});

describe('themeOptions', () => {
  it('lists "Системная" first, followed by every built-in theme', () => {
    const options = themeOptions();
    expect(options[0]).toEqual({ id: 'auto', label: 'Системная' });
    expect(options).toHaveLength(14);
  });
});

describe('DEFAULT_APPEARANCE', () => {
  it('defaults to a 700px reading column and the Geist/Literata font pair', () => {
    expect(DEFAULT_APPEARANCE.lineWidth).toBe(700);
    expect(DEFAULT_APPEARANCE.uiFontFamily).toContain('Geist');
    expect(DEFAULT_APPEARANCE.bookFontFamily).toContain('Literata');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/desk-prototype/src/appearance/appearance.test.ts`
Expected: FAIL — `Cannot find module './appearance'`.

- [ ] **Step 3: Write `src/appearance/appearance.ts`**

```ts
// packages/desk-prototype/src/appearance/appearance.ts
import { BUILT_IN_THEMES, getTheme, isThemeId, themeToCssVariables } from '@inkyquill/galley-themes';
import type { ThemeCssVariables, ThemeDefinition } from '@inkyquill/galley-themes';

export const SYSTEM_THEME_ID = 'auto';

export const FONT_SIZE_BOUNDS = { min: 10, max: 48 } as const;
export const LINE_WIDTH_BOUNDS = { min: 320, max: 1600 } as const;

export type AppearanceState = {
  themeId: string;
  uiFontFamily: string;
  bookFontFamily: string;
  fontSize: number;
  lineWidth: number;
};

export const DEFAULT_APPEARANCE: AppearanceState = {
  themeId: SYSTEM_THEME_ID,
  uiFontFamily: 'Geist, system-ui, sans-serif',
  bookFontFamily: 'Literata, Georgia, serif',
  fontSize: 16,
  lineWidth: 700,
};

export function themeOptions(): { id: string; label: string }[] {
  return [
    { id: SYSTEM_THEME_ID, label: 'Системная' },
    ...BUILT_IN_THEMES.map((theme) => ({ id: theme.id, label: theme.label })),
  ];
}

function resolveTheme(themeId: string, systemDark: boolean): ThemeDefinition {
  if (isThemeId(themeId)) return getTheme(themeId)!;
  return getTheme(systemDark ? 'galley-dark' : 'galley-light')!;
}

/**
 * Токены темы плюс два дополнения, которые ещё не опубликованы в
 * @inkyquill/galley-themes (см. спеку, раздел «Новые токены») — здесь они
 * фикстуры прототипа, не часть пакета.
 */
export type ThemeVars = ThemeCssVariables & {
  '--app-accent': string;
  '--app-card-shadow': string;
};

export function resolveThemeVars(themeId: string, systemDark: boolean): ThemeVars {
  const theme = resolveTheme(themeId, systemDark);
  const base = themeToCssVariables(theme);
  const cardShadow =
    theme.scheme === 'dark'
      ? '0 10px 28px -10px rgb(0 0 0 / 45%)'
      : '0 10px 28px -14px rgb(31 37 35 / 28%)';
  return { ...base, '--app-accent': theme.tokens.app.focus, '--app-card-shadow': cardShadow };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/desk-prototype/src/appearance/appearance.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write `src/appearance/AppearanceProvider.tsx`**

```tsx
// packages/desk-prototype/src/appearance/AppearanceProvider.tsx
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
    minHeight: '100vh',
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
```

- [ ] **Step 6: Wire the provider into `src/App.tsx`**

```tsx
// packages/desk-prototype/src/App.tsx
import { AppearanceProvider } from './appearance/AppearanceProvider';

export default function App() {
  return (
    <AppearanceProvider>
      <div className="flex min-h-screen items-center justify-center text-app-text">
        <p>Прототип Galley Desk</p>
      </div>
    </AppearanceProvider>
  );
}
```

- [ ] **Step 7: Manually verify theming**

Run: `npm run dev --workspace @galley-desk/desk-prototype`
Expected: page background is the warm cream of `galley-light` (`#f6f4ef`) and text is dark, matching the approved "тёплая бумага" mock — not the plain system background from Task 1.

- [ ] **Step 8: Commit**

```bash
git add packages/desk-prototype/src/appearance packages/desk-prototype/src/App.tsx
git commit -m "feat(desk-prototype): resolve theme tokens and provide appearance context"
```

---

### Task 3: Fixture data — book, chapters, edit/signal records

**Files:**
- Create: `packages/desk-prototype/src/data/fixtures.ts`
- Create: `packages/desk-prototype/src/data/fixtures.test.ts`

**Interfaces:**
- Produces: types `SignalType`, `EditMarker`, `SignalMarker`, `RecordMarker`, `Chapter`, `Book`; value `book: Book`; function `findChapter(bookValue: Book, chapterId: string): Chapter | null`. Consumed by every remaining task (record-format, marked-text, all components).

- [ ] **Step 1: Write the failing test**

```ts
// packages/desk-prototype/src/data/fixtures.test.ts
import { describe, expect, it } from 'vitest';
import { book, findChapter } from './fixtures';

describe('fixtures', () => {
  it('has at least three openable chapters plus one missing chapter', () => {
    const openable = book.chapters.filter((chapter) => chapter.missing !== true);
    const missing = book.chapters.filter((chapter) => chapter.missing === true);
    expect(openable.length).toBeGreaterThanOrEqual(3);
    expect(missing.length).toBeGreaterThanOrEqual(1);
  });

  it('covers all four signal types across the fixture book', () => {
    const types = new Set(
      book.chapters.flatMap((chapter) => chapter.records).flatMap((r) => (r.kind === 'signal' ? [r.signalType] : [])),
    );
    expect(types).toEqual(new Set(['note', 'change_required', 'warning', 'review']));
  });

  it('places every record fully inside its chapter text', () => {
    for (const chapter of book.chapters) {
      for (const record of chapter.records) {
        expect(record.from).toBeGreaterThanOrEqual(0);
        expect(record.to).toBeLessThanOrEqual(chapter.text.length);
        expect(record.from).toBeLessThan(record.to);
      }
    }
  });

  it('finds a chapter by id and returns null for an unknown id', () => {
    const first = book.chapters[0]!;
    expect(findChapter(book, first.id)).toBe(first);
    expect(findChapter(book, 'no-such-chapter')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/desk-prototype/src/data/fixtures.test.ts`
Expected: FAIL — `Cannot find module './fixtures'`.

- [ ] **Step 3: Write `src/data/fixtures.ts`**

```ts
// packages/desk-prototype/src/data/fixtures.ts
export type SignalType = 'note' | 'change_required' | 'warning' | 'review';

export type EditMarker = {
  id: string;
  kind: 'edit';
  from: number;
  to: number;
  before: string;
  after: string;
};

export type SignalMarker = {
  id: string;
  kind: 'signal';
  from: number;
  to: number;
  signalType: SignalType;
  comment: string;
};

export type RecordMarker = EditMarker | SignalMarker;

export type Chapter = {
  id: string;
  title: string;
  text: string;
  note: string;
  records: RecordMarker[];
  missing?: boolean;
};

export type Book = {
  id: string;
  title: string;
  chapters: Chapter[];
};

/** Находит подстроку в тексте главы и возвращает её диапазон — фикстуры
 * задают правки/сигналы по содержимому, а не по хрупким числовым индексам. */
function span(text: string, needle: string): { from: number; to: number } {
  const from = text.indexOf(needle);
  if (from === -1) throw new Error(`Фикстура: подстрока не найдена: «${needle}»`);
  return { from, to: from + needle.length };
}

const prologueText =
  'Море не прощает тех, кто приходит к нему без имени. Капитан знал это лучше многих — он потерял своё имя ещё до того, как впервые ступил на палубу. Ветер крепчал с каждым часом, и такелаж пел тревожную песню.';

const prologueEditSpan = span(prologueText, 'крепчал с каждым часом');
const prologueSignalSpan = span(prologueText, 'потерял своё имя');

const departureText =
  'Корабль отчалил от причала на рассвете. Боцман проверил такелаж дважды, но верёвки всё равно скрипели тревожно. Команда молчала, будто предчувствуя недоброе.';

const departureEdit1Span = span(departureText, 'отчалил');
const departureEdit2Span = span(departureText, 'скрипели тревожно');
const departureNoteSpan = span(departureText, 'такелаж дважды');
const departureWarningSpan = span(departureText, 'предчувствуя недоброе');

const stormText =
  'Шторм ударил в полночь. Волны перехлёстывали через борт, и капитан приказал убрать паруса.';

const stormReviewSpan = span(stormText, 'убрать паруса');

export const book: Book = {
  id: 'book-1',
  title: 'Хроники Пепельного моря',
  chapters: [
    {
      id: 'ch-1',
      title: 'Пролог',
      note: 'Сверить даты отплытия с главой 4.',
      text: prologueText,
      records: [
        {
          id: 'rec-1',
          kind: 'edit',
          from: prologueEditSpan.from,
          to: prologueEditSpan.to,
          before: 'дул сильнее',
          after: 'крепчал с каждым часом',
        },
        {
          id: 'rec-2',
          kind: 'signal',
          from: prologueSignalSpan.from,
          to: prologueSignalSpan.to,
          signalType: 'change_required',
          comment: 'Уточнить, когда именно капитан потерял имя.',
        },
      ],
    },
    {
      id: 'ch-2',
      title: 'Глава 1. Отплытие',
      note: '',
      text: departureText,
      records: [
        {
          id: 'rec-3',
          kind: 'edit',
          from: departureEdit1Span.from,
          to: departureEdit1Span.to,
          before: 'отошёл',
          after: 'отчалил',
        },
        {
          id: 'rec-4',
          kind: 'edit',
          from: departureEdit2Span.from,
          to: departureEdit2Span.to,
          before: 'скрипели глухо',
          after: 'скрипели тревожно',
        },
        {
          id: 'rec-5',
          kind: 'signal',
          from: departureNoteSpan.from,
          to: departureNoteSpan.to,
          signalType: 'note',
          comment: 'Проверить, боцман или штурман должен это делать.',
        },
        {
          id: 'rec-6',
          kind: 'signal',
          from: departureWarningSpan.from,
          to: departureWarningSpan.to,
          signalType: 'warning',
          comment: '',
        },
      ],
    },
    {
      id: 'ch-3',
      title: 'Глава 2. Шторм',
      note: '',
      text: stormText,
      records: [
        {
          id: 'rec-7',
          kind: 'signal',
          from: stormReviewSpan.from,
          to: stormReviewSpan.to,
          signalType: 'review',
          comment: 'Сверить с картой ветров из главы 5.',
        },
      ],
    },
    {
      id: 'ch-4',
      title: 'Глава 3. Берег',
      note: '',
      text: '',
      records: [],
      missing: true,
    },
  ],
};

export function findChapter(bookValue: Book, chapterId: string): Chapter | null {
  return bookValue.chapters.find((chapter) => chapter.id === chapterId) ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/desk-prototype/src/data/fixtures.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desk-prototype/src/data
git commit -m "feat(desk-prototype): add fixture book/chapters/records"
```

---

### Task 4: `marked-text` — split chapter text into plain/highlighted segments

**Files:**
- Create: `packages/desk-prototype/src/lib/marked-text.ts`
- Create: `packages/desk-prototype/src/lib/marked-text.test.ts`

**Interfaces:**
- Consumes: `RecordMarker` from `../data/fixtures`.
- Produces: type `MarkedSegment = { text: string; record: RecordMarker | null }`; function `markText(text: string, records: RecordMarker[]): MarkedSegment[]`. Consumed by Task 9 (`ChapterContent`).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/desk-prototype/src/lib/marked-text.test.ts
import { describe, expect, it } from 'vitest';
import { markText } from './marked-text';
import type { RecordMarker } from '../data/fixtures';

const edit: RecordMarker = { id: 'e1', kind: 'edit', from: 6, to: 11, before: 'b', after: 'world' };

describe('markText', () => {
  it('returns the whole text as one plain segment when there are no records', () => {
    expect(markText('hello world', [])).toEqual([{ text: 'hello world', record: null }]);
  });

  it('splits a single marker in the middle into plain/marked/plain', () => {
    expect(markText('hello world', [edit])).toEqual([
      { text: 'hello ', record: null },
      { text: 'world', record: edit },
    ]);
  });

  it('marks a segment that starts at position 0', () => {
    const start: RecordMarker = { id: 'e2', kind: 'edit', from: 0, to: 5, before: 'x', after: 'hello' };
    expect(markText('hello world', [start])).toEqual([
      { text: 'hello', record: start },
      { text: ' world', record: null },
    ]);
  });

  it('sorts unsorted input records by position', () => {
    const second: RecordMarker = { id: 'e3', kind: 'edit', from: 6, to: 11, before: 'x', after: 'world' };
    const first: RecordMarker = { id: 'e4', kind: 'edit', from: 0, to: 5, before: 'y', after: 'hello' };
    expect(markText('hello world', [second, first])).toEqual([
      { text: 'hello', record: first },
      { text: ' ', record: null },
      { text: 'world', record: second },
    ]);
  });

  it('clamps a marker range that extends past the end of the text', () => {
    const overrun: RecordMarker = { id: 'e5', kind: 'edit', from: 6, to: 999, before: 'x', after: 'world' };
    expect(markText('hello world', [overrun])).toEqual([
      { text: 'hello ', record: null },
      { text: 'world', record: overrun },
    ]);
  });

  it('skips a zero-length marker range', () => {
    const empty: RecordMarker = { id: 'e6', kind: 'edit', from: 5, to: 5, before: '', after: '' };
    expect(markText('hello world', [empty])).toEqual([{ text: 'hello world', record: null }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/desk-prototype/src/lib/marked-text.test.ts`
Expected: FAIL — `Cannot find module './marked-text'`.

- [ ] **Step 3: Write `src/lib/marked-text.ts`**

```ts
// packages/desk-prototype/src/lib/marked-text.ts
import type { RecordMarker } from '../data/fixtures';

export type MarkedSegment = {
  text: string;
  record: RecordMarker | null;
};

/**
 * Разбивает текст главы на чередующиеся простые и подсвеченные сегменты по
 * непересекающимся диапазонам записей — источник для фоновой заливки правок
 * и сигналов (см. спеку, «Разметка правок и сигналов в редакторе»).
 */
export function markText(text: string, records: RecordMarker[]): MarkedSegment[] {
  const sorted = [...records].sort((a, b) => a.from - b.from);
  const segments: MarkedSegment[] = [];
  let cursor = 0;
  for (const record of sorted) {
    const from = Math.max(cursor, Math.min(record.from, text.length));
    const to = Math.max(from, Math.min(record.to, text.length));
    if (from > cursor) segments.push({ text: text.slice(cursor, from), record: null });
    if (to > from) segments.push({ text: text.slice(from, to), record });
    cursor = Math.max(cursor, to);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), record: null });
  return segments;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/desk-prototype/src/lib/marked-text.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desk-prototype/src/lib/marked-text.ts packages/desk-prototype/src/lib/marked-text.test.ts
git commit -m "feat(desk-prototype): add markText segment-splitting utility"
```

---

### Task 5: `record-format` — icon/color/label per record

**Files:**
- Create: `packages/desk-prototype/src/lib/record-format.ts`
- Create: `packages/desk-prototype/src/lib/record-format.test.ts`

**Interfaces:**
- Consumes: `RecordMarker`, `SignalType` from `../data/fixtures`.
- Produces: type `RecordDisplay = { icon: 'edit' | 'signal'; colorKey: 'accent' | SignalType; label: string }`; functions `truncate(value: string, max: number): string`, `recordDisplay(record: RecordMarker, maxLength?: number): RecordDisplay`, `recordColor(colorKey: RecordDisplay['colorKey']): string`. Consumed by Task 9 (gutter markers) and Task 10 (`ReviewSidebar`, `RecordPopup`).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/desk-prototype/src/lib/record-format.test.ts
import { describe, expect, it } from 'vitest';
import { recordColor, recordDisplay, truncate } from './record-format';
import type { EditMarker, SignalMarker } from '../data/fixtures';

describe('truncate', () => {
  it('leaves short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long strings with an ellipsis', () => {
    expect(truncate('a very long piece of text', 10)).toBe('a very lo…');
    expect(truncate('a very long piece of text', 10)).toHaveLength(10);
  });
});

describe('recordDisplay', () => {
  it('formats an edit as before → after with the accent color', () => {
    const edit: EditMarker = { id: 'e1', kind: 'edit', from: 0, to: 5, before: 'b', after: 'a' };
    expect(recordDisplay(edit)).toEqual({ icon: 'edit', colorKey: 'accent', label: 'b → a' });
  });

  it('formats a signal with a comment as the comment text', () => {
    const signal: SignalMarker = {
      id: 's1',
      kind: 'signal',
      from: 0,
      to: 5,
      signalType: 'warning',
      comment: 'Повтор слова.',
    };
    expect(recordDisplay(signal)).toEqual({ icon: 'signal', colorKey: 'warning', label: 'Повтор слова.' });
  });

  it('falls back to the Russian type label when a signal has no comment', () => {
    const signal: SignalMarker = { id: 's2', kind: 'signal', from: 0, to: 5, signalType: 'review', comment: '' };
    expect(recordDisplay(signal).label).toBe('На проверку');
  });
});

describe('recordColor', () => {
  it('resolves the accent color for edits', () => {
    expect(recordColor('accent')).toBe('var(--app-accent)');
  });

  it('resolves a fixed hex color for each signal type', () => {
    expect(recordColor('note')).toMatch(/^#[0-9a-f]{6}$/);
    expect(recordColor('change_required')).toMatch(/^#[0-9a-f]{6}$/);
    expect(recordColor('warning')).toMatch(/^#[0-9a-f]{6}$/);
    expect(recordColor('review')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/desk-prototype/src/lib/record-format.test.ts`
Expected: FAIL — `Cannot find module './record-format'`.

- [ ] **Step 3: Write `src/lib/record-format.ts`**

```ts
// packages/desk-prototype/src/lib/record-format.ts
import type { RecordMarker, SignalType } from '../data/fixtures';

export type RecordDisplay = {
  icon: 'edit' | 'signal';
  colorKey: 'accent' | SignalType;
  label: string;
};

const SIGNAL_LABEL: Record<SignalType, string> = {
  note: 'Заметка',
  change_required: 'Требуется правка',
  warning: 'Предупреждение',
  review: 'На проверку',
};

/** Цвета типов сигналов — семантика Pocket Editor, не зависит от темы
 * (см. спеку: «Семантика цвета сигналов не меняется»). */
const SIGNAL_COLOR: Record<SignalType, string> = {
  note: '#5d7cda',
  change_required: '#c0503f',
  warning: '#c98a3a',
  review: '#5f7d6d',
};

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function recordDisplay(record: RecordMarker, maxLength = 48): RecordDisplay {
  if (record.kind === 'edit') {
    return { icon: 'edit', colorKey: 'accent', label: truncate(`${record.before} → ${record.after}`, maxLength) };
  }
  const label = record.comment.trim().length > 0 ? record.comment : SIGNAL_LABEL[record.signalType];
  return { icon: 'signal', colorKey: record.signalType, label: truncate(label, maxLength) };
}

/** Правки красятся акцентом интерфейса (тема), сигналы — фиксированной
 * Pocket-палитрой, независимой от темы. */
export function recordColor(colorKey: RecordDisplay['colorKey']): string {
  return colorKey === 'accent' ? 'var(--app-accent)' : SIGNAL_COLOR[colorKey];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/desk-prototype/src/lib/record-format.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desk-prototype/src/lib/record-format.ts packages/desk-prototype/src/lib/record-format.test.ts
git commit -m "feat(desk-prototype): add record label/color formatting"
```

---

### Task 6: `search` — literal substring finder

**Files:**
- Create: `packages/desk-prototype/src/lib/search.ts`
- Create: `packages/desk-prototype/src/lib/search.test.ts`

**Interfaces:**
- Produces: type `SearchRange = { from: number; to: number }`; function `findLiteral(text: string, query: string): SearchRange[]`. Consumed by Task 7 (`Header`'s collapsible search).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/desk-prototype/src/lib/search.test.ts
import { describe, expect, it } from 'vitest';
import { findLiteral } from './search';

describe('findLiteral', () => {
  it('returns no ranges for an empty query', () => {
    expect(findLiteral('hello world', '')).toEqual([]);
  });

  it('returns no ranges when the query is absent', () => {
    expect(findLiteral('hello world', 'xyz')).toEqual([]);
  });

  it('finds a single match', () => {
    expect(findLiteral('hello world', 'world')).toEqual([{ from: 6, to: 11 }]);
  });

  it('finds multiple non-overlapping matches', () => {
    expect(findLiteral('a cat sat on a mat', 'at')).toEqual([
      { from: 3, to: 5 },
      { from: 7, to: 9 },
      { from: 17, to: 19 },
    ]);
  });

  it('advances past each match instead of scanning overlapping windows', () => {
    expect(findLiteral('aaaa', 'aa')).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/desk-prototype/src/lib/search.test.ts`
Expected: FAIL — `Cannot find module './search'`.

- [ ] **Step 3: Write `src/lib/search.ts`**

```ts
// packages/desk-prototype/src/lib/search.ts
export type SearchRange = { from: number; to: number };

/** Точная подстрока, без регулярных выражений — совпадения не пересекаются
 * (после найденного совпадения поиск продолжается сразу за ним). */
export function findLiteral(text: string, query: string): SearchRange[] {
  if (query === '') return [];
  const ranges: SearchRange[] = [];
  let index = text.indexOf(query);
  while (index !== -1) {
    ranges.push({ from: index, to: index + query.length });
    index = text.indexOf(query, index + query.length);
  }
  return ranges;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/desk-prototype/src/lib/search.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desk-prototype/src/lib/search.ts packages/desk-prototype/src/lib/search.test.ts
git commit -m "feat(desk-prototype): add literal search utility"
```

---

### Task 7: Header — icons, view toggle, collapsible search, Zen, overflow menu

**Files:**
- Create: `packages/desk-prototype/src/types.ts`
- Create: `packages/desk-prototype/src/icons.ts`
- Create: `packages/desk-prototype/src/components/Header.tsx`
- Modify: `packages/desk-prototype/src/App.tsx`

**Interfaces:**
- Consumes: `findLiteral`/`SearchRange` from `../lib/search` (search input's live match counter only — no reveal/scroll in this mock).
- Produces: `ViewMode = 'text' | 'comparison' | 'source'` (`types.ts`, reused by Tasks 9–12); `Header` props `{ bookTitle: string; viewMode: ViewMode; onViewModeChange: (mode: ViewMode) => void; zen: boolean; onToggleZen: () => void; onOpenAppearance: () => void; searchText: string }`.

- [ ] **Step 1: Write `src/types.ts`**

```ts
// packages/desk-prototype/src/types.ts
export type ViewMode = 'text' | 'comparison' | 'source';
```

- [ ] **Step 2: Write `src/icons.ts`** (single import point for the icon set, per the spec's "не смешивать" constraint)

```ts
// packages/desk-prototype/src/icons.ts
export {
  IconSearch,
  IconX,
  IconChevronUp,
  IconChevronDown,
  IconFileText,
  IconGitCompare,
  IconCode,
  IconTarget,
  IconTargetOff,
  IconDots,
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconTrash,
  IconCheck,
  IconPencil,
  IconBolt,
  IconAlertTriangle,
  IconMinus,
  IconSquare,
  IconLogout,
  IconMenu2,
  IconFilter,
} from '@tabler/icons-react';
```

- [ ] **Step 3: Write `src/components/Header.tsx`**

```tsx
// packages/desk-prototype/src/components/Header.tsx
import { useState } from 'react';
import {
  IconAdjustmentsHorizontal,
  IconCode,
  IconDots,
  IconFileText,
  IconGitCompare,
  IconLogout,
  IconSearch,
  IconTarget,
  IconTargetOff,
} from '../icons';
import { findLiteral } from '../lib/search';
import type { ViewMode } from '../types';

type Props = {
  bookTitle: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  zen: boolean;
  onToggleZen: () => void;
  onOpenAppearance: () => void;
  searchText: string;
};

const VIEW_OPTIONS: { mode: ViewMode; label: string; Icon: typeof IconFileText }[] = [
  { mode: 'text', label: 'Текст', Icon: IconFileText },
  { mode: 'comparison', label: 'Сравнение', Icon: IconGitCompare },
  { mode: 'source', label: 'Исходник', Icon: IconCode },
];

export function Header({ bookTitle, viewMode, onViewModeChange, zen, onToggleZen, onOpenAppearance, searchText }: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matches = findLiteral(searchText, query);

  return (
    <header className="flex items-center gap-2 rounded-2xl bg-app-panel px-3 py-2">
      <span className="mr-1 h-2 w-2 rounded-full bg-app-accent" title="Сохранено" aria-hidden="true" />
      <h1 className="flex-1 truncate font-semibold" style={{ fontFamily: 'var(--book-font, inherit)' }}>
        {bookTitle}
      </h1>

      {searchOpen ? (
        <div className="flex items-center gap-2 rounded-lg bg-app-panel-muted px-2 py-1">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query === '') setSearchOpen(false);
            }}
            placeholder="Найти…"
            aria-label="Поиск по главе"
            className="w-40 bg-transparent text-sm outline-none placeholder:text-app-text-muted"
          />
          <span className="text-xs text-app-text-muted">{query === '' ? '' : `${matches.length} совп.`}</span>
          <button type="button" aria-label="Закрыть поиск" onClick={() => setSearchOpen(false)} className="rounded p-1 hover:bg-app-hover">
            <IconSearch size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          title="Поиск по главе"
          aria-label="Поиск по главе"
          onClick={() => setSearchOpen(true)}
          className="rounded-lg p-1.5 text-app-text-muted hover:bg-app-hover"
        >
          <IconSearch size={16} />
        </button>
      )}

      <div className="flex gap-0.5 rounded-lg bg-app-panel-muted p-0.5" role="group" aria-label="Режим просмотра">
        {VIEW_OPTIONS.map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={viewMode === mode}
            onClick={() => onViewModeChange(mode)}
            className={`rounded-md p-1.5 ${viewMode === mode ? 'bg-app-panel text-app-text shadow-sm' : 'text-app-text-muted hover:bg-app-hover'}`}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>

      <button
        type="button"
        title="Режим Zen"
        aria-label="Режим Zen"
        onClick={onToggleZen}
        className="rounded-lg p-1.5 text-app-text-muted hover:bg-app-hover"
      >
        {zen ? <IconTargetOff size={16} /> : <IconTarget size={16} />}
      </button>

      <div className="relative">
        <button
          type="button"
          title="Ещё"
          aria-label="Ещё"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className={`rounded-lg p-1.5 hover:bg-app-hover ${menuOpen ? 'bg-app-hover' : 'text-app-text-muted'}`}
        >
          <IconDots size={16} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-9 z-10 w-48 rounded-xl bg-app-panel p-1 shadow-[var(--app-card-shadow)]">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onOpenAppearance();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-app-panel-muted"
            >
              <IconAdjustmentsHorizontal size={14} className="text-app-text-muted" />
              Оформление
            </button>
            <hr className="my-1 border-app-panel-muted" />
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-app-error hover:bg-app-panel-muted"
            >
              <IconLogout size={14} />
              Закрыть книгу
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Wire `Header` into `src/App.tsx`**

```tsx
// packages/desk-prototype/src/App.tsx
import { useState } from 'react';
import { AppearanceProvider } from './appearance/AppearanceProvider';
import { Header } from './components/Header';
import { book } from './data/fixtures';
import type { ViewMode } from './types';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [zen, setZen] = useState(false);

  return (
    <AppearanceProvider>
      <div className="mx-auto flex max-w-6xl flex-col gap-3 p-3">
        <Header
          bookTitle={book.title}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          zen={zen}
          onToggleZen={() => setZen((value) => !value)}
          onOpenAppearance={() => undefined}
          searchText=""
        />
      </div>
    </AppearanceProvider>
  );
}
```

- [ ] **Step 5: Manually verify**

Run: `npm run dev --workspace @galley-desk/desk-prototype`
Expected, in the browser: header shows the book title, a search icon that expands into an input on click, a three-icon segmented view toggle (document highlighted by default), a target icon that flips to target-off when clicked (Zen toggle — no layout change yet, wired in Task 12), and a "⋯" button that opens a menu with "Оформление" and red "Закрыть книгу".

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/desk-prototype/src/types.ts packages/desk-prototype/src/icons.ts packages/desk-prototype/src/components/Header.tsx packages/desk-prototype/src/App.tsx
git commit -m "feat(desk-prototype): add icon-first header with collapsible search and overflow menu"
```

---

### Task 8: Chapter sidebar — filter + list

**Files:**
- Create: `packages/desk-prototype/src/components/ChapterSidebar.tsx`
- Modify: `packages/desk-prototype/src/App.tsx`

**Interfaces:**
- Consumes: `Chapter` from `../data/fixtures`.
- Produces: `ChapterSidebar` props `{ chapters: Chapter[]; activeChapterId: string; onSelect: (chapterId: string) => void }`.

- [ ] **Step 1: Write `src/components/ChapterSidebar.tsx`**

```tsx
// packages/desk-prototype/src/components/ChapterSidebar.tsx
import { useState } from 'react';
import type { Chapter } from '../data/fixtures';

type Props = {
  chapters: Chapter[];
  activeChapterId: string;
  onSelect: (chapterId: string) => void;
};

export function ChapterSidebar({ chapters, activeChapterId, onSelect }: Props) {
  const [filter, setFilter] = useState('');
  const normalized = filter.trim().toLowerCase();
  const visible = normalized === '' ? chapters : chapters.filter((chapter) => chapter.title.toLowerCase().includes(normalized));

  return (
    <nav aria-label="Оглавление" className="flex w-48 flex-col gap-1 rounded-2xl bg-app-panel p-3">
      <input
        type="text"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Фильтр глав…"
        aria-label="Фильтр глав"
        className="mb-1 rounded-lg bg-app-panel-muted px-2 py-1 text-sm outline-none placeholder:text-app-text-muted"
      />
      {visible.map((chapter) => (
        <button
          key={chapter.id}
          type="button"
          disabled={chapter.missing === true}
          title={chapter.missing === true ? 'Файл главы отсутствует' : chapter.title}
          onClick={() => onSelect(chapter.id)}
          className={`rounded-lg px-2 py-1.5 text-left text-sm ${
            chapter.id === activeChapterId ? 'bg-app-hover font-medium text-app-text' : 'text-app-text-muted hover:bg-app-hover'
          } ${chapter.missing === true ? 'cursor-default opacity-45' : ''}`}
        >
          {chapter.title}
        </button>
      ))}
      {visible.length === 0 && <p className="px-2 text-sm text-app-text-muted">Главы не найдены</p>}
    </nav>
  );
}
```

- [ ] **Step 2: Wire `ChapterSidebar` into `src/App.tsx`**

```tsx
// packages/desk-prototype/src/App.tsx
import { useState } from 'react';
import { AppearanceProvider } from './appearance/AppearanceProvider';
import { ChapterSidebar } from './components/ChapterSidebar';
import { Header } from './components/Header';
import { book, findChapter } from './data/fixtures';
import type { ViewMode } from './types';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [zen, setZen] = useState(false);
  const [chapterId, setChapterId] = useState(book.chapters[0]!.id);
  const activeChapter = findChapter(book, chapterId) ?? book.chapters[0]!;

  return (
    <AppearanceProvider>
      <div className="mx-auto flex max-w-6xl flex-col gap-3 p-3">
        <Header
          bookTitle={book.title}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          zen={zen}
          onToggleZen={() => setZen((value) => !value)}
          onOpenAppearance={() => undefined}
          searchText={activeChapter.text}
        />
        <div className="flex gap-3">
          {!zen && <ChapterSidebar chapters={book.chapters} activeChapterId={chapterId} onSelect={setChapterId} />}
        </div>
      </div>
    </AppearanceProvider>
  );
}
```

- [ ] **Step 3: Manually verify**

Run: `npm run dev --workspace @galley-desk/desk-prototype`
Expected: sidebar lists "Пролог", "Глава 1. Отплытие", "Глава 2. Шторм" (clickable, active one highlighted) and "Глава 3. Берег" (greyed out, disabled). Typing in the filter narrows the list. Toggling Zen (target icon) hides the sidebar.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/desk-prototype/src/components/ChapterSidebar.tsx packages/desk-prototype/src/App.tsx
git commit -m "feat(desk-prototype): add chapter sidebar with filter"
```

---

### Task 9: Chapter content — reading card, background highlights, gutter markers, edit flyout

**Files:**
- Create: `packages/desk-prototype/src/components/EditFlyout.tsx`
- Create: `packages/desk-prototype/src/components/ChapterContent.tsx`
- Modify: `packages/desk-prototype/src/App.tsx`

**Interfaces:**
- Consumes: `markText`/`MarkedSegment` from `../lib/marked-text`; `recordDisplay`/`recordColor` from `../lib/record-format`; `RecordMarker`, `Chapter` from `../data/fixtures`; `useAppearance` from `../appearance/AppearanceProvider`.
- Produces: `EditFlyout` props `{ before: string; x: number; y: number }`. `ChapterContent` props `{ chapter: Chapter; records: RecordMarker[]; onMarkerActivate: (recordId: string) => void }`. `ChapterContent` internally exposes no new shared types but its "one gutter icon per marker, top-to-bottom in document order" behavior is a spec requirement Task 10/12 rely on visually.

**Scope note:** there is no CodeMirror/line-based editor in this prototype (spec explicitly keeps this a mock without editor backend). Gutter icons are stacked in document order next to the paragraph, not pixel-aligned to their exact source line — that pixel-perfect alignment needs the real `@inkyquill/galley-editor` gutter API and belongs to the later implementation pass, not this mock.

- [ ] **Step 1: Write `src/components/EditFlyout.tsx`**

```tsx
// packages/desk-prototype/src/components/EditFlyout.tsx
type Props = {
  before: string;
};

/** Показывает оригинал (`before`) правки — рендерится родителем и только
 * когда курсор/hover активны над подсветкой (см. ChapterContent). */
export function EditFlyout({ before }: Props) {
  return (
    <span
      role="tooltip"
      className="absolute left-0 top-full z-20 mt-1 w-max max-w-xs rounded-lg bg-app-text px-2 py-1 text-xs text-app-bg shadow-[var(--app-card-shadow)]"
    >
      Было: «{before}»
    </span>
  );
}
```

- [ ] **Step 2: Write `src/components/ChapterContent.tsx`**

```tsx
// packages/desk-prototype/src/components/ChapterContent.tsx
import { useState } from 'react';
import { useAppearance } from '../appearance/AppearanceProvider';
import type { Chapter, RecordMarker } from '../data/fixtures';
import { markText } from '../lib/marked-text';
import { recordColor, recordDisplay } from '../lib/record-format';
import { IconBolt, IconPencil } from '../icons';
import { EditFlyout } from './EditFlyout';

type Props = {
  chapter: Chapter;
  records: RecordMarker[];
  onMarkerActivate: (recordId: string) => void;
};

export function ChapterContent({ chapter, records, onMarkerActivate }: Props) {
  const { appearance } = useAppearance();
  const [activeFlyoutId, setActiveFlyoutId] = useState<string | null>(null);
  const segments = markText(chapter.text, records);

  return (
    <section className="mx-auto" style={{ width: `min(100%, ${appearance.lineWidth}px)` }}>
      <h2 className="mb-2 text-sm text-app-text-muted">{chapter.title}</h2>
      <div className="flex gap-2 rounded-2xl bg-app-panel p-5 shadow-[var(--app-card-shadow)]">
        <div className="flex w-5 flex-none flex-col items-center gap-1 pt-1" aria-hidden="true">
          {records.map((record) => {
            const display = recordDisplay(record);
            const Icon = display.icon === 'edit' ? IconPencil : IconBolt;
            return (
              <button
                key={record.id}
                type="button"
                title={display.label}
                onClick={() => onMarkerActivate(record.id)}
                className="rounded p-0.5 hover:bg-app-hover"
                style={{ color: recordColor(display.colorKey) }}
              >
                <Icon size={13} />
              </button>
            );
          })}
        </div>
        <p className="flex-1 leading-relaxed" style={{ fontFamily: appearance.bookFontFamily }}>
          {segments.map((segment, index) => {
            if (segment.record === null) return <span key={index}>{segment.text}</span>;
            const record = segment.record;
            const display = recordDisplay(record);
            const color = recordColor(display.colorKey);
            const highlightStyle =
              record.kind === 'edit'
                ? { boxShadow: `inset 0 0 0 100vw ${color}22` }
                : {
                    backgroundImage: `linear-gradient(${color}55, ${color}55)`,
                    backgroundRepeat: 'no-repeat' as const,
                    backgroundSize: '100% 34%',
                    backgroundPosition: 'bottom' as const,
                  };
            return (
              <span
                key={index}
                tabIndex={0}
                role="button"
                onMouseEnter={() => setActiveFlyoutId(record.id)}
                onMouseLeave={() => setActiveFlyoutId((current) => (current === record.id ? null : current))}
                onFocus={() => setActiveFlyoutId(record.id)}
                onBlur={() => setActiveFlyoutId((current) => (current === record.id ? null : current))}
                onClick={() => onMarkerActivate(record.id)}
                className="relative cursor-pointer rounded-sm outline-none"
                style={highlightStyle}
              >
                {segment.text}
                {activeFlyoutId === record.id && record.kind === 'edit' && <EditFlyout before={record.before} />}
              </span>
            );
          })}
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wire `ChapterContent` into `src/App.tsx`**

```tsx
// packages/desk-prototype/src/App.tsx
import { useEffect, useState } from 'react';
import { AppearanceProvider } from './appearance/AppearanceProvider';
import { ChapterContent } from './components/ChapterContent';
import { ChapterSidebar } from './components/ChapterSidebar';
import { Header } from './components/Header';
import { book, findChapter } from './data/fixtures';
import type { RecordMarker } from './data/fixtures';
import type { ViewMode } from './types';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [zen, setZen] = useState(false);
  const [chapterId, setChapterId] = useState(book.chapters[0]!.id);
  const activeChapter = findChapter(book, chapterId) ?? book.chapters[0]!;
  const [records, setRecords] = useState<RecordMarker[]>(activeChapter.records);

  useEffect(() => {
    setRecords(activeChapter.records);
  }, [activeChapter]);

  return (
    <AppearanceProvider>
      <div className="mx-auto flex max-w-6xl flex-col gap-3 p-3">
        <Header
          bookTitle={book.title}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          zen={zen}
          onToggleZen={() => setZen((value) => !value)}
          onOpenAppearance={() => undefined}
          searchText={activeChapter.text}
        />
        <div className="flex gap-3">
          {!zen && <ChapterSidebar chapters={book.chapters} activeChapterId={chapterId} onSelect={setChapterId} />}
          <div className="flex-1">
            <ChapterContent chapter={activeChapter} records={records} onMarkerActivate={() => undefined} />
          </div>
        </div>
      </div>
    </AppearanceProvider>
  );
}
```

- [ ] **Step 4: Manually verify**

Run: `npm run dev --workspace @galley-desk/desk-prototype`
Expected: the reading card is centred, roughly 700px wide, with a rounded soft shadow (no hard border). The edited phrase has a tinted background in the interface accent color; signal phrases have a bottom-third colored band, one color per signal type. The gutter (left of the paragraph) shows one pencil/bolt icon per record, colored to match. Hovering or tab-focusing an edit's highlighted text shows "Было: «…»" below it.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/desk-prototype/src/components/EditFlyout.tsx packages/desk-prototype/src/components/ChapterContent.tsx packages/desk-prototype/src/App.tsx
git commit -m "feat(desk-prototype): render chapter text with background-highlighted edits/signals and gutter markers"
```

---

### Task 10: Review sidebar, record popup, and new-signal picker

**Files:**
- Create: `packages/desk-prototype/src/components/ReviewSidebar.tsx`
- Create: `packages/desk-prototype/src/components/RecordPopup.tsx`
- Create: `packages/desk-prototype/src/components/SignalPicker.tsx`
- Modify: `packages/desk-prototype/src/components/ChapterContent.tsx`
- Modify: `packages/desk-prototype/src/App.tsx`

**Interfaces:**
- Consumes: `recordDisplay`/`recordColor` from `../lib/record-format`; `RecordMarker`, `SignalType` from `../data/fixtures`.
- Produces: `ReviewSidebar` props `{ chapterNote: string; records: RecordMarker[]; onSelect: (recordId: string) => void }`. `RecordPopup` props `{ record: RecordMarker; onClose: () => void; onSaveComment: (recordId: string, comment: string) => void; onDelete: (recordId: string) => void }`. `SignalPicker` props `{ x: number; y: number; onPick: (type: SignalType) => void; onDismiss: () => void }`. `ChapterContent` gains an `onTextSelect: (selection: { from: number; to: number; x: number; y: number }) => void` prop.

- [ ] **Step 1: Write `src/components/ReviewSidebar.tsx`**

```tsx
// packages/desk-prototype/src/components/ReviewSidebar.tsx
import type { RecordMarker } from '../data/fixtures';
import { recordColor, recordDisplay } from '../lib/record-format';
import { IconBolt, IconPencil } from '../icons';

type Props = {
  chapterNote: string;
  records: RecordMarker[];
  onSelect: (recordId: string) => void;
};

export function ReviewSidebar({ chapterNote, records, onSelect }: Props) {
  return (
    <aside aria-label="Рецензия" className="flex w-56 flex-none flex-col gap-2 rounded-2xl bg-app-panel p-3">
      {chapterNote !== '' && <p className="rounded-lg bg-app-panel-muted p-2 text-xs text-app-text-muted">{chapterNote}</p>}
      <ul className="flex flex-col gap-1">
        {records.map((record) => {
          const display = recordDisplay(record);
          const Icon = display.icon === 'edit' ? IconPencil : IconBolt;
          return (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => onSelect(record.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-app-panel-muted"
              >
                <Icon size={14} style={{ color: recordColor(display.colorKey) }} className="flex-none" />
                <span className="truncate">{display.label}</span>
              </button>
            </li>
          );
        })}
        {records.length === 0 && <li className="px-2 text-sm text-app-text-muted">Записей пока нет</li>}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2: Write `src/components/RecordPopup.tsx`**

```tsx
// packages/desk-prototype/src/components/RecordPopup.tsx
import { useState } from 'react';
import type { RecordMarker } from '../data/fixtures';
import { IconCheck, IconTrash, IconX } from '../icons';

type Props = {
  record: RecordMarker;
  onClose: () => void;
  onSaveComment: (recordId: string, comment: string) => void;
  onDelete: (recordId: string) => void;
};

export function RecordPopup({ record, onClose, onSaveComment, onDelete }: Props) {
  const [comment, setComment] = useState(record.kind === 'signal' ? record.comment : '');

  return (
    <div role="dialog" aria-label={record.kind === 'edit' ? 'Правка' : 'Сигнал'} className="w-64 rounded-2xl bg-app-panel p-3 shadow-[var(--app-card-shadow)]">
      {record.kind === 'edit' ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="text-app-text-muted">Было:</span> {record.before}
          </p>
          <p>
            <span className="text-app-text-muted">Стало:</span> {record.after}
          </p>
        </div>
      ) : (
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Комментарий…"
          aria-label="Комментарий сигнала"
          className="h-16 w-full resize-none rounded-lg bg-app-panel-muted p-2 text-sm outline-none placeholder:text-app-text-muted"
        />
      )}
      <div className="mt-2 flex justify-end gap-1">
        <button
          type="button"
          title="Удалить"
          aria-label="Удалить"
          onClick={() => {
            onDelete(record.id);
            onClose();
          }}
          className="rounded-lg p-1.5 text-app-error hover:bg-app-panel-muted"
        >
          <IconTrash size={15} />
        </button>
        {record.kind === 'signal' && (
          <button
            type="button"
            title="Сохранить"
            aria-label="Сохранить"
            onClick={() => {
              onSaveComment(record.id, comment);
              onClose();
            }}
            className="rounded-lg p-1.5 text-app-accent hover:bg-app-panel-muted"
          >
            <IconCheck size={15} />
          </button>
        )}
        <button type="button" title="Закрыть" aria-label="Закрыть" onClick={onClose} className="rounded-lg p-1.5 hover:bg-app-panel-muted">
          <IconX size={15} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/components/SignalPicker.tsx`**

```tsx
// packages/desk-prototype/src/components/SignalPicker.tsx
import type { SignalType } from '../data/fixtures';
import { recordColor } from '../lib/record-format';
import { IconBolt } from '../icons';

type Props = {
  x: number;
  y: number;
  onPick: (type: SignalType) => void;
  onDismiss: () => void;
};

const OPTIONS: { type: SignalType; label: string }[] = [
  { type: 'note', label: 'Заметка' },
  { type: 'change_required', label: 'Требуется правка' },
  { type: 'warning', label: 'Предупреждение' },
  { type: 'review', label: 'На проверку' },
];

export function SignalPicker({ x, y, onPick, onDismiss }: Props) {
  return (
    <div
      role="menu"
      aria-label="Выбор типа сигнала"
      style={{ position: 'fixed', left: x, top: y }}
      className="z-30 flex gap-1 rounded-full bg-app-panel p-1 shadow-[var(--app-card-shadow)]"
      onMouseLeave={onDismiss}
    >
      {OPTIONS.map(({ type, label }) => (
        <button
          key={type}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => onPick(type)}
          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-app-panel-muted"
        >
          <IconBolt size={14} style={{ color: recordColor(type) }} />
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add text-selection handling to `ChapterContent.tsx`**

Add an `onTextSelect` prop and a `handleMouseUp` handler on the reading card's text container. Insert the following near the top of the component (after the existing `useState` line) and attach `ref`/`onMouseUp` to the `<p>` element:

```tsx
// packages/desk-prototype/src/components/ChapterContent.tsx — additions
import { useRef, useState } from 'react';
// ...existing imports stay, add onTextSelect to Props:

type Props = {
  chapter: Chapter;
  records: RecordMarker[];
  onMarkerActivate: (recordId: string) => void;
  onTextSelect: (selection: { from: number; to: number; x: number; y: number }) => void;
};

function textOffsetOf(root: Node, node: Node, offset: number): number | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
    if (current === node) return consumed + offset;
    consumed += (current as Text).data.length;
  }
  return null;
}

function resolveSelectionOffsets(root: Node, selection: Selection): { from: number; to: number } | null {
  if (selection.anchorNode === null || selection.focusNode === null) return null;
  const a = textOffsetOf(root, selection.anchorNode, selection.anchorOffset);
  const b = textOffsetOf(root, selection.focusNode, selection.focusOffset);
  if (a === null || b === null) return null;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}
```

Inside `ChapterContent`, add a ref and handler, and wire them onto the `<p>`:

```tsx
export function ChapterContent({ chapter, records, onMarkerActivate, onTextSelect }: Props) {
  const { appearance } = useAppearance();
  const [activeFlyoutId, setActiveFlyoutId] = useState<string | null>(null);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const segments = markText(chapter.text, records);

  const handleMouseUp = (): void => {
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || textRef.current === null) return;
    const text = selection.toString();
    if (text.trim().length === 0) return;
    const offsets = resolveSelectionOffsets(textRef.current, selection);
    if (offsets === null) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    onTextSelect({ ...offsets, x: rect.left, y: rect.bottom + window.scrollY });
    selection.removeAllRanges();
  };

  // ...unchanged JSX below, but the <p> element gains:
  //   ref={textRef} onMouseUp={handleMouseUp}
```

Update the `<p>` tag:

```tsx
        <p
          ref={textRef}
          onMouseUp={handleMouseUp}
          className="flex-1 leading-relaxed"
          style={{ fontFamily: appearance.bookFontFamily }}
        >
```

- [ ] **Step 5: Wire everything into `src/App.tsx`**

```tsx
// packages/desk-prototype/src/App.tsx
import { useEffect, useState } from 'react';
import { AppearanceProvider } from './appearance/AppearanceProvider';
import { ChapterContent } from './components/ChapterContent';
import { ChapterSidebar } from './components/ChapterSidebar';
import { Header } from './components/Header';
import { RecordPopup } from './components/RecordPopup';
import { ReviewSidebar } from './components/ReviewSidebar';
import { SignalPicker } from './components/SignalPicker';
import { book, findChapter } from './data/fixtures';
import type { RecordMarker, SignalType } from './data/fixtures';
import type { ViewMode } from './types';

type DraftSelection = { from: number; to: number; x: number; y: number };

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [zen, setZen] = useState(false);
  const [chapterId, setChapterId] = useState(book.chapters[0]!.id);
  const activeChapter = findChapter(book, chapterId) ?? book.chapters[0]!;
  const [records, setRecords] = useState<RecordMarker[]>(activeChapter.records);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [draftSelection, setDraftSelection] = useState<DraftSelection | null>(null);

  useEffect(() => {
    setRecords(activeChapter.records);
    setSelectedRecordId(null);
    setDraftSelection(null);
  }, [activeChapter]);

  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;

  const handleSaveComment = (recordId: string, comment: string): void => {
    setRecords((current) => current.map((record) => (record.id === recordId && record.kind === 'signal' ? { ...record, comment } : record)));
  };

  const handleDelete = (recordId: string): void => {
    setRecords((current) => current.filter((record) => record.id !== recordId));
  };

  const handlePickSignal = (type: SignalType): void => {
    if (draftSelection === null) return;
    const newRecord: RecordMarker = {
      id: `draft-${Date.now()}`,
      kind: 'signal',
      from: draftSelection.from,
      to: draftSelection.to,
      signalType: type,
      comment: '',
    };
    setRecords((current) => [...current, newRecord]);
    setSelectedRecordId(newRecord.id);
    setDraftSelection(null);
  };

  return (
    <AppearanceProvider>
      <div className="mx-auto flex max-w-6xl flex-col gap-3 p-3">
        <Header
          bookTitle={book.title}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          zen={zen}
          onToggleZen={() => setZen((value) => !value)}
          onOpenAppearance={() => undefined}
          searchText={activeChapter.text}
        />
        <div className="flex gap-3">
          {!zen && <ChapterSidebar chapters={book.chapters} activeChapterId={chapterId} onSelect={setChapterId} />}
          <div className="relative flex-1">
            <ChapterContent
              chapter={activeChapter}
              records={records}
              onMarkerActivate={setSelectedRecordId}
              onTextSelect={setDraftSelection}
            />
            {draftSelection !== null && (
              <SignalPicker x={draftSelection.x} y={draftSelection.y} onPick={handlePickSignal} onDismiss={() => setDraftSelection(null)} />
            )}
            {selectedRecord !== null && (
              <div style={{ position: 'fixed', left: 0, right: 0, top: '30%', display: 'flex', justifyContent: 'center' }}>
                <RecordPopup record={selectedRecord} onClose={() => setSelectedRecordId(null)} onSaveComment={handleSaveComment} onDelete={handleDelete} />
              </div>
            )}
          </div>
          {!zen && <ReviewSidebar chapterNote={activeChapter.note} records={records} onSelect={setSelectedRecordId} />}
        </div>
      </div>
    </AppearanceProvider>
  );
}
```

- [ ] **Step 6: Manually verify**

Run: `npm run dev --workspace @galley-desk/desk-prototype`
Expected: the right panel lists every record as an icon + one-line truncated text. Clicking a gutter icon, a highlighted span, or a review-list row opens the same popup (centred). Editing a signal's comment and clicking the check icon updates its text in the sidebar. Clicking the trash icon removes the record from both the text and the sidebar. Selecting any plain text in the reading card pops up four colored signal-type buttons near the selection; picking one adds a new record to the sidebar and immediately opens its popup for a comment.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/desk-prototype/src/components/ReviewSidebar.tsx packages/desk-prototype/src/components/RecordPopup.tsx packages/desk-prototype/src/components/SignalPicker.tsx packages/desk-prototype/src/components/ChapterContent.tsx packages/desk-prototype/src/App.tsx
git commit -m "feat(desk-prototype): wire review sidebar, record popup, and new-signal picker"
```

---

### Task 11: Appearance panel — theme + two fonts + size + line width

**Files:**
- Create: `packages/desk-prototype/src/appearance/AppearancePanel.tsx`
- Modify: `packages/desk-prototype/src/App.tsx`

**Interfaces:**
- Consumes: `themeOptions`, `FONT_SIZE_BOUNDS`, `LINE_WIDTH_BOUNDS` from `./appearance`; `useAppearance` from `./AppearanceProvider`.
- Produces: `AppearancePanel` — no props, reads/writes via `useAppearance()` directly (matches the existing app's pattern of a self-contained settings form).

- [ ] **Step 1: Write `src/appearance/AppearancePanel.tsx`**

```tsx
// packages/desk-prototype/src/appearance/AppearancePanel.tsx
import { FONT_SIZE_BOUNDS, LINE_WIDTH_BOUNDS, themeOptions } from './appearance';
import { useAppearance } from './AppearanceProvider';

function clamp(value: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

export function AppearancePanel() {
  const { appearance, setAppearance } = useAppearance();

  return (
    <section aria-label="Оформление" className="grid max-w-md gap-2 rounded-2xl bg-app-panel p-3">
      <label className="grid grid-cols-[auto_1fr] items-center gap-3 text-sm">
        Тема
        <select
          value={appearance.themeId}
          onChange={(event) => setAppearance({ ...appearance, themeId: event.target.value })}
          className="rounded-lg bg-app-panel-muted px-2 py-1"
        >
          {themeOptions().map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid grid-cols-[auto_1fr] items-center gap-3 text-sm">
        Шрифт интерфейса
        <input
          type="text"
          value={appearance.uiFontFamily}
          onChange={(event) => setAppearance({ ...appearance, uiFontFamily: event.target.value })}
          className="rounded-lg bg-app-panel-muted px-2 py-1"
        />
      </label>
      <label className="grid grid-cols-[auto_1fr] items-center gap-3 text-sm">
        Шрифт книги
        <input
          type="text"
          value={appearance.bookFontFamily}
          onChange={(event) => setAppearance({ ...appearance, bookFontFamily: event.target.value })}
          className="rounded-lg bg-app-panel-muted px-2 py-1"
        />
      </label>
      <label className="grid grid-cols-[auto_1fr] items-center gap-3 text-sm">
        {`Размер шрифта (${FONT_SIZE_BOUNDS.min}–${FONT_SIZE_BOUNDS.max})`}
        <input
          type="number"
          min={FONT_SIZE_BOUNDS.min}
          max={FONT_SIZE_BOUNDS.max}
          value={appearance.fontSize}
          onChange={(event) => setAppearance({ ...appearance, fontSize: clamp(Number(event.target.value), FONT_SIZE_BOUNDS) })}
          className="rounded-lg bg-app-panel-muted px-2 py-1"
        />
      </label>
      <label className="grid grid-cols-[auto_1fr] items-center gap-3 text-sm">
        {`Ширина строки (${LINE_WIDTH_BOUNDS.min}–${LINE_WIDTH_BOUNDS.max})`}
        <input
          type="number"
          min={LINE_WIDTH_BOUNDS.min}
          max={LINE_WIDTH_BOUNDS.max}
          value={appearance.lineWidth}
          onChange={(event) => setAppearance({ ...appearance, lineWidth: clamp(Number(event.target.value), LINE_WIDTH_BOUNDS) })}
          className="rounded-lg bg-app-panel-muted px-2 py-1"
        />
      </label>
    </section>
  );
}
```

- [ ] **Step 2: Wire it into `src/App.tsx`** (open/close state driven by `Header`'s "Оформление" menu item)

Add `const [appearanceOpen, setAppearanceOpen] = useState(false);`, pass `onOpenAppearance={() => setAppearanceOpen((open) => !open)}` to `Header`, and render the panel right after `Header`:

```tsx
        <Header
          bookTitle={book.title}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          zen={zen}
          onToggleZen={() => setZen((value) => !value)}
          onOpenAppearance={() => setAppearanceOpen((open) => !open)}
          searchText={activeChapter.text}
        />
        {appearanceOpen && !zen && <AppearancePanel />}
```

Add the import: `import { AppearancePanel } from './appearance/AppearancePanel';`

- [ ] **Step 3: Manually verify**

Run: `npm run dev --workspace @galley-desk/desk-prototype`
Expected: clicking "Оформление" in the header's "⋯" menu shows the panel with a theme select (14 options, "Системная" first), two font text inputs (defaulting to "Geist, system-ui, sans-serif" and "Literata, Georgia, serif"), and font-size/line-width number inputs (line width starts at 700). Changing the theme select immediately re-tints the whole page (bg/panels/accent). Changing "Шрифт книги" changes the reading card's font live; changing "Шрифт интерфейса" changes everything else's font live.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/desk-prototype/src/appearance/AppearancePanel.tsx packages/desk-prototype/src/App.tsx
git commit -m "feat(desk-prototype): add appearance panel with independent UI/book fonts"
```

---

### Task 12: Title bar mock, Zen wiring, final composition

**Files:**
- Create: `packages/desk-prototype/public/galley-desk-icon.svg`
- Create: `packages/desk-prototype/src/components/TitleBar.tsx`
- Modify: `packages/desk-prototype/src/App.tsx`

**Interfaces:**
- Produces: `TitleBar` — no props, purely decorative (mock only, per spec's "Кастомный window frame и системное меню" — no real Electron `BrowserWindow` wiring here).

- [ ] **Step 1: Copy the existing app icon asset into the prototype's `public/` folder**

Run: `cp /home/inky/Development/galley-desk/apps/desktop/assets/branding/galley-desk-icon.svg /home/inky/Development/galley-desk/packages/desk-prototype/public/galley-desk-icon.svg`
Expected: file copied, `ls packages/desk-prototype/public` shows `galley-desk-icon.svg`.

- [ ] **Step 2: Write `src/components/TitleBar.tsx`**

```tsx
// packages/desk-prototype/src/components/TitleBar.tsx
import { useState } from 'react';
import { IconMenu2, IconMinus, IconSquare, IconX } from '../icons';

const MENU_ITEMS = ['Файл', 'Правка', 'Вид', 'Справка'];

/**
 * Визуальный мок стилизованного заголовка окна и системного меню — не
 * настраивает реальный Electron BrowserWindow (frame/titleBarStyle), см.
 * спеку «Кастомный window frame и системное меню».
 */
export function TitleBar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-app-text-muted">
      <img src="/galley-desk-icon.svg" alt="Galley Desk" className="h-4 w-4" />
      <div className="relative">
        <button
          type="button"
          title="Меню"
          aria-label="Меню"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className={`rounded-lg p-1 hover:bg-app-hover ${menuOpen ? 'bg-app-hover' : ''}`}
        >
          <IconMenu2 size={14} />
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-8 z-20 w-40 rounded-xl bg-app-panel p-1 shadow-[var(--app-card-shadow)]">
            {MENU_ITEMS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMenuOpen(false)}
                className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-app-panel-muted"
              >
                {item}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as never} />
      <div className="flex gap-1">
        <button type="button" title="Свернуть" aria-label="Свернуть" onClick={() => undefined} className="rounded-lg p-1 hover:bg-app-hover">
          <IconMinus size={14} />
        </button>
        <button type="button" title="Развернуть" aria-label="Развернуть" onClick={() => undefined} className="rounded-lg p-1 hover:bg-app-hover">
          <IconSquare size={12} />
        </button>
        <button type="button" title="Закрыть" aria-label="Закрыть" onClick={() => undefined} className="rounded-lg p-1 hover:bg-app-error hover:text-app-bg">
          <IconX size={14} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Compose the final `src/App.tsx`** — add `TitleBar`, hide it plus the header/sidebars/appearance panel in Zen, keep a persistent exit control (mirrors the real app's `book__zen-exit`)

```tsx
// packages/desk-prototype/src/App.tsx
import { useEffect, useState } from 'react';
import { AppearancePanel } from './appearance/AppearancePanel';
import { AppearanceProvider } from './appearance/AppearanceProvider';
import { ChapterContent } from './components/ChapterContent';
import { ChapterSidebar } from './components/ChapterSidebar';
import { Header } from './components/Header';
import { RecordPopup } from './components/RecordPopup';
import { ReviewSidebar } from './components/ReviewSidebar';
import { SignalPicker } from './components/SignalPicker';
import { TitleBar } from './components/TitleBar';
import { book, findChapter } from './data/fixtures';
import type { RecordMarker, SignalType } from './data/fixtures';
import { IconTargetOff } from './icons';
import type { ViewMode } from './types';

type DraftSelection = { from: number; to: number; x: number; y: number };

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [zen, setZen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [chapterId, setChapterId] = useState(book.chapters[0]!.id);
  const activeChapter = findChapter(book, chapterId) ?? book.chapters[0]!;
  const [records, setRecords] = useState<RecordMarker[]>(activeChapter.records);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [draftSelection, setDraftSelection] = useState<DraftSelection | null>(null);

  useEffect(() => {
    setRecords(activeChapter.records);
    setSelectedRecordId(null);
    setDraftSelection(null);
  }, [activeChapter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && zen) setZen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zen]);

  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;

  const handleSaveComment = (recordId: string, comment: string): void => {
    setRecords((current) => current.map((record) => (record.id === recordId && record.kind === 'signal' ? { ...record, comment } : record)));
  };

  const handleDelete = (recordId: string): void => {
    setRecords((current) => current.filter((record) => record.id !== recordId));
  };

  const handlePickSignal = (type: SignalType): void => {
    if (draftSelection === null) return;
    const newRecord: RecordMarker = {
      id: `draft-${Date.now()}`,
      kind: 'signal',
      from: draftSelection.from,
      to: draftSelection.to,
      signalType: type,
      comment: '',
    };
    setRecords((current) => [...current, newRecord]);
    setSelectedRecordId(newRecord.id);
    setDraftSelection(null);
  };

  return (
    <AppearanceProvider>
      <div className="mx-auto flex max-w-6xl flex-col gap-3 p-3">
        {!zen && <TitleBar />}
        {!zen && (
          <Header
            bookTitle={book.title}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            zen={zen}
            onToggleZen={() => setZen(true)}
            onOpenAppearance={() => setAppearanceOpen((open) => !open)}
            searchText={activeChapter.text}
          />
        )}
        {appearanceOpen && !zen && <AppearancePanel />}
        {zen && (
          <button
            type="button"
            title="Выйти из Zen (Esc)"
            aria-label="Выйти из Zen"
            onClick={() => setZen(false)}
            className="fixed right-3 top-3 z-40 flex items-center gap-1 rounded-full bg-app-panel px-3 py-1.5 text-sm shadow-[var(--app-card-shadow)]"
          >
            <IconTargetOff size={14} />
            Выйти из Zen
          </button>
        )}
        <div className="flex gap-3">
          {!zen && <ChapterSidebar chapters={book.chapters} activeChapterId={chapterId} onSelect={setChapterId} />}
          <div className="relative flex-1">
            <ChapterContent
              chapter={activeChapter}
              records={records}
              onMarkerActivate={setSelectedRecordId}
              onTextSelect={setDraftSelection}
            />
            {draftSelection !== null && (
              <SignalPicker x={draftSelection.x} y={draftSelection.y} onPick={handlePickSignal} onDismiss={() => setDraftSelection(null)} />
            )}
            {selectedRecord !== null && (
              <div style={{ position: 'fixed', left: 0, right: 0, top: '30%', display: 'flex', justifyContent: 'center' }}>
                <RecordPopup record={selectedRecord} onClose={() => setSelectedRecordId(null)} onSaveComment={handleSaveComment} onDelete={handleDelete} />
              </div>
            )}
          </div>
          {!zen && <ReviewSidebar chapterNote={activeChapter.note} records={records} onSelect={setSelectedRecordId} />}
        </div>
      </div>
    </AppearanceProvider>
  );
}
```

- [ ] **Step 4: Full manual walkthrough**

Run: `npm run dev --workspace @galley-desk/desk-prototype`

Check every item, against `docs/superpowers/specs/2026-09-16-visual-redesign-design.md`:
- [ ] Title bar shows the Galley Desk mark, a "☰" menu opening a static Файл/Правка/Вид/Справка list, and mock minimize/maximize/close buttons.
- [ ] Header: search collapses/expands, three-icon view toggle, target/target-off Zen icon, "⋯" opens Оформление/Закрыть книгу.
- [ ] Switching chapters in the sidebar updates the reading card, gutter markers, and review list together.
- [ ] "Глава 3. Берег" is disabled in the sidebar.
- [ ] Edits show only the result text with a tinted background (no strikethrough, no inline `before`); hovering or tab-focusing shows the original in a flyout.
- [ ] Signals show a bottom-band highlight (not an underline) colored per type; four distinct colors appear across the fixture chapters.
- [ ] Gutter shows one pencil/bolt icon per record, clicking any of them opens the same popup as clicking the review-list row.
- [ ] Selecting plain text opens the four-color signal picker; picking a type adds a record to the sidebar and opens its popup.
- [ ] Appearance panel: theme switch re-tints everything live; UI font and book font change independently; line width defaults to 700 and resizing the reading card live-updates its width.
- [ ] Entering Zen hides title bar, header, both sidebars, and the appearance panel, leaving only the reading card and a persistent "Выйти из Zen" button; Escape exits Zen.

- [ ] **Step 5: Typecheck and run the full test suite**

Run: `npm run typecheck && npm test`
Expected: both exit 0; `npm test` reports the pure-logic suites (`appearance`, `fixtures`, `marked-text`, `record-format`, `search`) passing alongside the rest of the monorepo's existing tests.

- [ ] **Step 6: Commit**

```bash
git add packages/desk-prototype/public packages/desk-prototype/src/components/TitleBar.tsx packages/desk-prototype/src/App.tsx
git commit -m "feat(desk-prototype): add title bar mock and complete Zen-mode composition"
```

---

## Self-Review Notes

- **Spec coverage:** direction/tonal system → Tasks 1–2 (theme bridge) + Task 9 (card styling); two fonts → Tasks 2, 11; icon-first header/overflow menu → Task 7; review sidebar reformat → Task 10; edit/signal rendering (background highlight, gutter icons, flyout) → Task 9–10; icon set (Tabler) → `icons.ts` in Task 7, used everywhere after; window frame/menu mock → Task 12; app icon reuse → Task 12; 700px default line width → Task 2, verified in Task 11.
- **Out of scope reminders carried into the plan:** no Electron `BrowserWindow` wiring (Task 12 docstring says so explicitly), no Pocket Editor/Galley Pad changes, no real IPC — all persistence is `useState`.
- **Type consistency checked:** `RecordMarker`/`SignalType`/`Chapter`/`Book` (Task 3) are the single source, re-used verbatim by `marked-text.ts`, `record-format.ts`, and every component through Task 12 — no renamed duplicates. `ViewMode` (Task 7) is imported, never redefined. `AppearanceState` (Task 2) fields (`themeId`, `uiFontFamily`, `bookFontFamily`, `fontSize`, `lineWidth`) match `AppearancePanel`'s (Task 11) field names exactly.
