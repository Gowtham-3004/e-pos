/** Runtime platform detection: Tauri desktop shell vs browser tab. */
export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const platformLabel = (): 'Desktop' | 'Web' => (isTauri() ? 'Desktop' : 'Web');

export const APP_VERSION = '1.4.0';

export function osLabel(): string {
  if (typeof navigator === 'undefined') return 'Unknown';
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}
