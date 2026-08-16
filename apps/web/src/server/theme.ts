import "server-only";
import { cookies } from "next/headers";

/**
 * Theme resolution.
 *
 * The choice is a cookie rather than localStorage so the *server* knows it. A
 * client-side theme has to paint once before the script runs, which is the
 * white flash every dark-first app is known for — and on this product the first
 * paint is a full page of figures, so the flash is especially loud.
 *
 * "system" is the default and stores no preference, letting the media query in
 * themes.css decide. Only an explicit choice writes a value.
 */

export const THEME_COOKIE = "falorb-theme";

export type ThemeChoice = "light" | "dark" | "system";

export async function getTheme(): Promise<ThemeChoice> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * The `data-theme` attribute for <html>, or undefined for "system".
 *
 * Undefined matters: an attribute of "system" would match neither selector in
 * themes.css and, worse, `[data-theme="dark"]` negation in the media query
 * would stop applying. Absence is what lets the preference through.
 */
export function themeAttribute(choice: ThemeChoice): "light" | "dark" | undefined {
  return choice === "system" ? undefined : choice;
}
