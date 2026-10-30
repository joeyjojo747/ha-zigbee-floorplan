// The colour theme: the viewer's choice, and the theme it resolves to. The resolved theme is
// set as data-theme on <html>, which styles.css keys on. index.html sets it before the first
// paint (so a dark page doesn't flash light); App keeps it in step after that.

export type ThemeChoice = 'auto' | 'light' | 'dark' | 'hologram';
export type Theme = 'light' | 'dark' | 'hologram';

export const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: 'auto', label: 'Auto (system)' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'hologram', label: 'Hologram' },
];

/** Where the choice is remembered; index.html reads the same key. */
export const THEME_KEY = 'zigbee-floorplan:theme';

export const resolveTheme = (choice: ThemeChoice, systemDark: boolean): Theme =>
  choice === 'auto' ? (systemDark ? 'dark' : 'light') : choice;

/** The remembered choice from its stored JSON, or Auto if it's missing or unrecognised. */
export function parseThemeChoice(raw: string | null): ThemeChoice {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return THEME_CHOICES.some((c) => c.value === value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}
