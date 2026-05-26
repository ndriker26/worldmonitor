const STORAGE_KEY = 'gev-theme';
const DEFAULT_THEME = 'dark';

export function initGevTheme(): void {
  const saved = localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME;
  applyTheme(saved);
}

export function toggleGevTheme(): void {
  const current = getGevTheme();
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

export function getGevTheme(): string {
  return document.documentElement.dataset.theme ?? DEFAULT_THEME;
}

function applyTheme(theme: string): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}
