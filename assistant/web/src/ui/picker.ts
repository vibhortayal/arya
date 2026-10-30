import type { KeyboardEvent } from "react";

/* A <label> that opens a hidden file input is not a tab stop on its
 * own (no role, no tabindex). Spread this on it so the keyboard reaches
 * it the way Today's "Take a photo" does (UI/UX pass, issue 5). */
export function pickerProps(inputId: string) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onKeyDown: (ev: KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); document.getElementById(inputId)?.click(); }
    },
  };
}
