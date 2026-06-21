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
        loginMethods: ["email", "wallet", "google", "twitter"],
        embeddedWallets: {
          createOnLogin: "all-users",
          showWalletUIs: true,
          ethereum: { createOnLogin: "all-users" },
          solana: { createOnLogin: "all-users" },
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
            <App />
            <Toaster theme="dark" position="bottom-right" />
          </BrowserRouter>
        </QueryClientProvider>
      </ApolloProvider>
    </PrivyProvider>
  </StrictMode>,
);
