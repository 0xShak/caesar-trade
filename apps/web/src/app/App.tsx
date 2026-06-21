import { Navigate, Route, Routes } from "react-router-dom";
import { NavSidebar } from "@/components/NavSidebar";
import { MarketsPage } from "./MarketsPage";
import { MarketDetailPage } from "./MarketDetailPage";
import { SpikePrivyPage } from "./SpikePrivyPage";

function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <div className="page-header">
        <span className="page-title">{title}</span>
        <span className="page-meta">coming soon</span>
      </div>
      <div className="placeholder">
        {title} screen — not yet implemented.
      </div>
    </div>
  );
}

export function App() {
  return (
    <div className="terminal-shell">
      <NavSidebar />
      <main className="terminal-main">
        <Routes>
          <Route path="/markets" element={<MarketsPage />} />
          <Route path="/markets/:id" element={<MarketDetailPage />} />
          <Route path="/spike-privy" element={<SpikePrivyPage />} />
          <Route path="/multiview" element={<Placeholder title="Multiview" />} />
          <Route path="/traders" element={<Placeholder title="Traders" />} />
          <Route path="/portfolio" element={<Placeholder title="Portfolio" />} />
          <Route path="/signals" element={<Placeholder title="Signals" />} />
          <Route path="/monitor" element={<Placeholder title="Monitor" />} />
          <Route path="/data" element={<Placeholder title="Data" />} />
          <Route path="/news" element={<Placeholder title="News" />} />
          <Route path="/settings" element={<Placeholder title="Settings" />} />
          <Route path="*" element={<Navigate to="/markets" replace />} />
        </Routes>
      </main>
    </div>
  );
}
