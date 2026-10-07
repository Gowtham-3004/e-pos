export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'elixir-theme';

export function getThemePref(): ThemePref {
  try {
    return (localStorage.getItem(KEY) as ThemePref) || 'light';
  } catch {
    return 'light';
  }
}

/** Apply theme to <html data-theme>. Operational POS defaults to light for counter readability. */
export function applyTheme(pref: ThemePref = getThemePref()) {
  const dark = pref === 'dark' || (pref === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable */
  }
}
