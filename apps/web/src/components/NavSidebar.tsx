import { NavLink } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bell,
  Database,
  LayoutGrid,
  Newspaper,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { AccountMenu } from "./AccountMenu";

interface NavItem {
  to: string;
  label: string;
  Icon: ComponentType<{ size?: number | string }>;
}

const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { to: "/markets", label: "Markets", Icon: BarChart3 },
  { to: "/multiview", label: "Multiview", Icon: LayoutGrid },
  { to: "/traders", label: "Traders", Icon: Users },
  { to: "/portfolio", label: "Portfolio", Icon: Wallet },
  { to: "/signals", label: "Signals", Icon: Activity },
  { to: "/monitor", label: "Monitor", Icon: Bell },
  { to: "/data", label: "Data", Icon: Database },
  { to: "/news", label: "News", Icon: Newspaper },
  { to: "/settings", label: "Settings", Icon: Settings },
];

export function NavSidebar() {
  return (
    <nav className="nav-sidebar">
      <div className="nav-brand">CAESAR</div>
      <ul className="nav-list">
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                isActive ? "nav-link nav-link-active" : "nav-link"
              }
            >
              <Icon size={15} />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="nav-footer">
        <AccountMenu />
        <ThemeSwitcher />
      </div>
    </nav>
  );
}
