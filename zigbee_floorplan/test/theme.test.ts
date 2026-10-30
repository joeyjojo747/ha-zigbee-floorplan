import { describe, expect, it } from 'vitest';
import { parseThemeChoice, resolveTheme } from '../src/web/theme.js';

describe('theme', () => {
  it('follows the system for Auto and keeps an explicit choice', () => {
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('hologram', false)).toBe('hologram');
  });

  it('reads a remembered choice, falling back to Auto', () => {
    expect(parseThemeChoice('"hologram"')).toBe('hologram');
    expect(parseThemeChoice(null)).toBe('auto');
    expect(parseThemeChoice('"neon"')).toBe('auto');
    expect(parseThemeChoice('{bad json')).toBe('auto');
  });
});
