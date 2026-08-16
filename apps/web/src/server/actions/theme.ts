"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { THEME_COOKIE, type ThemeChoice } from "@/server/theme";

/**
 * Persist a theme choice.
 *
 * Deliberately unauthenticated: the sign-in page has a toggle too, and a
 * display preference is not workspace data. The cookie holds one of three
 * fixed strings and is validated here, so nothing user-controlled reaches the
 * `data-theme` attribute.
 */
export async function setTheme(choice: ThemeChoice): Promise<void> {
  const jar = await cookies();

  if (choice === "system") {
    // No cookie means the media query decides, which is what "system" is.
    jar.delete(THEME_COOKIE);
  } else if (choice === "light" || choice === "dark") {
    jar.set(THEME_COOKIE, choice, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    return;
  }

  // The attribute lives on <html> in the root layout, so the whole tree has to
  // re-render for the change to land.
  revalidatePath("/", "layout");
}
