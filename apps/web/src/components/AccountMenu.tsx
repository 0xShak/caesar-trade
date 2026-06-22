import { useQuery } from "@apollo/client";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { LogIn, LogOut } from "lucide-react";
import { GET_ME } from "@/gql/me";

interface MeData {
  me: {
    id: string;
    tosAccepted: boolean | null;
    isWalletSetupComplete: boolean | null;
    polymarketTradingAddress: string | null;
  } | null;
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Auth surface in the nav footer (Phase 2). Logged out → "Log in" (Privy modal).
 * Logged in → the Privy account label (embedded-wallet address or email) + a
 * logout button. The `me` row is server-resolved once the token is attached.
 */
export function AccountMenu() {
  const { ready, authenticated, user, logout } = usePrivy();
  const { login } = useLogin();
  const { data } = useQuery<MeData>(GET_ME, { skip: !authenticated });

  if (!ready) return null;

  if (!authenticated) {
    return (
      <button className="nav-account-btn" onClick={() => login()}>
        <LogIn size={14} />
        <span>Log in</span>
      </button>
    );
  }

  const wallet =
    data?.me?.polymarketTradingAddress ??
    user?.wallet?.address ??
    null;
  const label = wallet
    ? short(wallet)
    : user?.email?.address ?? user?.id ?? "Account";

  return (
    <div className="nav-account">
      <span className="nav-account-label" title={wallet ?? undefined}>
        {label}
      </span>
      <button className="nav-account-btn" onClick={() => logout()}>
        <LogOut size={14} />
        <span>Log out</span>
      </button>
    </div>
  );
}
