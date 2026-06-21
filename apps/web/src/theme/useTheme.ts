import { create } from "zustand";

/** The five themes wired in index.html's pre-paint script (bible §11). */
export type Theme = "dark" | "dark-hc" | "light" | "light-hc" | "dusk";

export const THEMES: ReadonlyArray<{ id: Theme; label: string }> = [
  { id: "dark", label: "Dark" },
  { id: "dark-hc", label: "Dark · High Contrast" },
  { id: "light", label: "Light" },
  { id: "light-hc", label: "Light · High Contrast" },
  { id: "dusk", label: "Dusk" },
];

const STORAGE_KEY = "caesar-theme";

function readInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const fromDom = document.documentElement.dataset.theme;
    if (fromDom && THEMES.some((t) => t.id === fromDom)) {
      return fromDom as Theme;
    }
  }
  return "dark";
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  theme: readInitialTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* localStorage unavailable — keep in-memory only */
    }
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
    set({ theme });
  },
}));
