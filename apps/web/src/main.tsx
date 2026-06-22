import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApolloProvider } from "@apollo/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";

import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./theme/theme.css";
import "./index.css";

import { App } from "./app/App";
import { PrivyAuthBridge } from "./components/PrivyAuthBridge";
import { TosGate } from "./components/TosGate";
import { apolloClient } from "./lib/apollo";
import { queryClient } from "./lib/queryClient";

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? "";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("#root element not found");
}

createRoot(rootEl).render(
  <StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Match the methods enabled in the Privy dashboard (email + external
        // wallet). Google/Twitter OAuth are disabled there — re-add here once
        // they're turned on in the dashboard, or their buttons are dead.
        loginMethods: ["email", "wallet"],
        embeddedWallets: {
          // Auto-provision an embedded EVM wallet on login. NOTE: this also
          // requires the dashboard "create on login" toggle to be enabled
          // (it currently is not — see docs/PHASE2-BLOCKERS.md / memory).
          createOnLogin: "users-without-wallets",
          showWalletUIs: true,
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        appearance: {
          theme: "dark",
          accentColor: "#c084fc",
        },
      }}
    >
      <ApolloProvider client={apolloClient}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <PrivyAuthBridge />
            <App />
            <TosGate />
            <Toaster theme="dark" position="bottom-right" />
          </BrowserRouter>
        </QueryClientProvider>
      </ApolloProvider>
    </PrivyProvider>
  </StrictMode>,
);
