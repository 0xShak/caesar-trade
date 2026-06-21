import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Palette } from "lucide-react";
import { THEMES, useTheme } from "@/theme/useTheme";

export function ThemeSwitcher() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="btn theme-trigger" aria-label="Switch theme">
          <Palette size={14} />
          <span>Theme</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="dropdown-content"
          align="start"
          sideOffset={6}
        >
          {THEMES.map((t) => (
            <DropdownMenu.Item
              key={t.id}
              className="dropdown-item"
              onSelect={() => setTheme(t.id)}
            >
              <span className="dropdown-check">
                {theme === t.id ? <Check size={13} /> : null}
              </span>
              {t.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
