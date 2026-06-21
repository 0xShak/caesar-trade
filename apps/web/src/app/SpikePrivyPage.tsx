import { useState } from "react";
import { useIdentityToken, useLogin, usePrivy } from "@privy-io/react-auth";
import { toast } from "sonner";

/**
 * Spike C (bible §13 step 3_GET_ACCESS_TOKEN): prove the Privy login →
 * backend token-verification round-trip.
 *
 * Flow: Login with Privy → grab access token + identity token → POST both to
 * /api/spike/privy-verify (Vite-proxied to api) → render the verified user id
 * + embedded wallet address the server resolves.
 */
type VerifyResult = unknown;

export function SpikePrivyPage() {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { login } = useLogin();
  // Privy v2: useIdentityToken() exposes the current `identityToken` string
  // (refreshed by the SDK); it is sent alongside the access token.
  const { identityToken } = useIdentityToken();

  const [result, setResult] = useState<VerifyResult>(null);
  const [busy, setBusy] = useState(false);

  const embeddedWallet = user?.linkedAccounts.find(
    (a) => a.type === "wallet" && "walletClientType" in a && a.walletClientType === "privy",
  );

  async function runVerify() {
    setBusy(true);
    setResult(null);
    try {
      const accessToken = await getAccessToken();
      const idToken = identityToken ?? null;

      const res = await fetch("/api/spike/privy-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accessToken, identityToken: idToken }),
      });

      const json: unknown = await res.json().catch(() => ({
        error: "non-JSON response",
        status: res.status,
      }));
      setResult(json);
      if (!res.ok) toast.error(`Verify failed (${res.status})`);
      else toast.success("Privy round-trip verified");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult({ error: message });
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Spike C · Privy</span>
        <span className="page-meta">login → server token verify</span>
      </div>

      <div className="page-body spike-wrap">
        <p className="page-meta" style={{ marginTop: 0 }}>
          Logs in with Privy, then POSTs the access + identity tokens to{" "}
          <code>/api/spike/privy-verify</code> and renders the server response.
        </p>

        {!ready ? (
          <div className="state-msg">Initializing Privy…</div>
        ) : !authenticated ? (
          <div className="spike-row">
            <button className="btn btn-acc" onClick={() => login()}>
              Login with Privy
            </button>
          </div>
        ) : (
          <>
            <div className="spike-row">
              <span className="pill">user</span>
              <span>{user?.id ?? "—"}</span>
            </div>
            <div className="spike-row">
              <span className="pill">embedded wallet</span>
              <span>
                {embeddedWallet && "address" in embeddedWallet
                  ? embeddedWallet.address
                  : "—"}
              </span>
            </div>
            <div className="spike-row">
              <button
                className="btn btn-acc"
                onClick={runVerify}
                disabled={busy}
              >
                {busy ? "Verifying…" : "Run privy-verify"}
              </button>
              <button className="btn" onClick={() => logout()}>
                Logout
              </button>
            </div>
          </>
        )}

        {result !== null ? (
          <pre className="spike-json">{JSON.stringify(result, null, 2)}</pre>
        ) : null}
      </div>
    </div>
  );
}
