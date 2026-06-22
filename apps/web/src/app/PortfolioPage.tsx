import { useQuery } from "@apollo/client";
import { usePrivy } from "@privy-io/react-auth";
import { Check, Circle } from "lucide-react";
import { GET_ME } from "@/gql/me";

interface MeData {
  me: {
    id: string;
    polymarketTradingAddress: string | null;
    polymarketWalletKind: string | null;
    hasServerSigner: boolean | null;
    isSafeDeployed: boolean | null;
    hasV1Approvals: boolean | null;
    hasV2Approvals: boolean | null;
    hasApiCredentials: boolean | null;
    isWalletSetupComplete: boolean | null;
  } | null;
}

/**
 * Portfolio page — for now a read-only **wallet-setup status** view (Phase 2).
 * The trading-wallet (Gnosis Safe funder) address is deterministically derived
 * server-side from the Privy embedded signer; the checklist reflects the `me`
 * setup flags. EXECUTING the steps (deploy / approvals / CLOB key) is gated
 * behind mainnet — there is no Amoy testnet CLOB (docs/PHASE2-BLOCKERS.md §2) —
 * so the action buttons are intentionally absent until that phase.
 */
export function PortfolioPage() {
  const { ready, authenticated } = usePrivy();
  const { data, loading } = useQuery<MeData>(GET_ME, { skip: !authenticated });

  const me = data?.me;
  const steps: Array<{ label: string; done: boolean }> = [
    { label: "Connect wallet (Privy signer)", done: me?.hasServerSigner ?? false },
    { label: "Deploy trading Safe", done: me?.isSafeDeployed ?? false },
    { label: "Set V1 exchange approvals", done: me?.hasV1Approvals ?? false },
    { label: "Set V2 exchange approvals", done: me?.hasV2Approvals ?? false },
    { label: "Derive CLOB API credentials", done: me?.hasApiCredentials ?? false },
  ];

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Portfolio</span>
        <span className="page-meta">wallet setup</span>
      </div>
      <div className="page-body spike-wrap">
        {!ready ? (
          <div className="state-msg">Initializing…</div>
        ) : !authenticated ? (
          <div className="state-msg">Log in to view your trading-wallet setup.</div>
        ) : loading ? (
          <div className="state-msg">Loading…</div>
        ) : (
          <>
            <div className="spike-row">
              <span className="pill">trading wallet</span>
              <span title={me?.polymarketTradingAddress ?? undefined}>
                {me?.polymarketTradingAddress ?? "—"}
                {me?.polymarketWalletKind ? ` (${me.polymarketWalletKind})` : ""}
              </span>
            </div>
            <p className="page-meta" style={{ marginTop: 4 }}>
              Predicted address — derived deterministically from your embedded
              signer. Not yet deployed; on-chain steps are gated behind mainnet.
            </p>

            <ul className="setup-checklist">
              {steps.map(({ label, done }) => (
                <li key={label} className={done ? "setup-step done" : "setup-step"}>
                  {done ? <Check size={14} /> : <Circle size={14} />}
                  <span>{label}</span>
                </li>
              ))}
            </ul>

            <div className="spike-row">
              <span className="pill">status</span>
              <span>{me?.isWalletSetupComplete ? "complete" : "incomplete"}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
