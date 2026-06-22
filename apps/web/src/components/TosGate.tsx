import { useMutation, useQuery } from "@apollo/client";
import { usePrivy } from "@privy-io/react-auth";
import { toast } from "sonner";
import { GET_ME, SYNC_TOS_FROM_PRIVY } from "@/gql/me";

interface MeData {
  me: { id: string; tosAccepted: boolean | null } | null;
}

/**
 * Onboarding gate #1 (bible §13): once logged in, a user must accept the Terms
 * of Service before using authenticated features. Renders a blocking modal when
 * `me` exists and `tosAccepted` is false; "Accept" calls `syncTosFromPrivy`,
 * which stamps the current ToS version server-side. Read-only browsing stays
 * available behind the modal (it doesn't unmount the app).
 */
export function TosGate() {
  const { authenticated } = usePrivy();
  const { data } = useQuery<MeData>(GET_ME, { skip: !authenticated });
  const [syncTos, { loading }] = useMutation(SYNC_TOS_FROM_PRIVY, {
    refetchQueries: ["GetMe"],
  });

  const needsTos = authenticated && data?.me != null && !data.me.tosAccepted;
  if (!needsTos) return null;

  async function accept() {
    try {
      await syncTos({ variables: { acceptTos: true } });
      toast.success("Terms accepted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to accept terms");
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-title">Terms of Service</div>
        <p className="modal-body">
          Caesar Terminal is a trading interface for Polymarket and Kalshi. By
          continuing you confirm you are eligible to trade in your jurisdiction
          and accept the Terms of Service and Privacy Policy.
        </p>
        <div className="modal-actions">
          <button className="btn btn-acc" onClick={accept} disabled={loading}>
            {loading ? "Accepting…" : "Accept & continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
