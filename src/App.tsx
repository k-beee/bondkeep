import { useState, useEffect, useRef } from "react";
import { getGenLayerClient, CONTRACT_ADDRESS, RPC_URL, generatePrivateKey } from "./genlayerClient";
import "./App.css";

interface AuditReport {
  reporter: string;
  verdict: string;
  severity: number;
  slashed: number;
  reasoning: string;
}

interface AgentState {
  id: string;
  mandate: string;
  evidence_url: string;
  bond_remaining: number;
  status: string;
  audits: AuditReport[];
}

interface LogLine {
  timestamp: string;
  text: string;
  type: "info" | "success" | "error" | "warning";
}

function App() {
  // Account & Client Settings
  const [privateKey, setPrivateKey] = useState<string>("");
  const [activeAddress, setActiveAddress] = useState<string>("");
  const [contractAddress] = useState<string>(CONTRACT_ADDRESS);
  const [penaltyPool, setPenaltyPool] = useState<number>(0);
  
  // Ephemeral loading
  const [isFunding, setIsFunding] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Registry & Active Selection
  const [agentsRegistry, setAgentsRegistry] = useState<string[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [activeAgentData, setActiveAgentData] = useState<AgentState | null>(null);

  // Console Logs
  const [consoleLogs, setConsoleLogs] = useState<LogLine[]>([]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Load private key on mount
  useEffect(() => {
    let key = localStorage.getItem("bondkeep_private_key");
    if (!key) {
      key = generatePrivateKey();
      localStorage.setItem("bondkeep_private_key", key);
    }
    setPrivateKey(key);
  }, []);

  // Update address when privateKey changes
  useEffect(() => {
    if (privateKey) {
      try {
        const client = getGenLayerClient(privateKey);
        if (client.account) {
          setActiveAddress(client.account.address);
        }
      } catch (e) {
        console.error("Failed to extract address from key", e);
      }
    }
  }, [privateKey]);

  // Add line to custom console
  const addLog = (text: string, type: "info" | "success" | "error" | "warning" = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setConsoleLogs((prev) => [...prev, { timestamp, text, type }]);
  };

  // Fund Account (Studionet only)
  const fundAccount = async () => {
    if (!activeAddress) return;
    setIsFunding(true);
    addLog(`Requesting test tokens for ${activeAddress}...`, "info");
    try {
      const client = getGenLayerClient(privateKey);
      await client.request({
        method: "sim_fundAccount",
        params: [activeAddress as `0x${string}`, 100],
      });
      addLog("Test tokens funded successfully! (100 GEN)", "success");
    } catch (e) {
      console.error("Funding error", e);
      addLog("Failed to fund account. Make sure Studionet is active.", "error");
    } finally {
      setIsFunding(false);
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <h1>
            🛡️ BONDKEEP <span className="brand-badge">SLA Sentinel</span>
          </h1>
        </div>
        
        <div className="header-meta">
          <div className="contract-chip">
            <span>Contract</span>
            <span className="address" title={contractAddress}>
              {contractAddress.slice(0, 6)}...{contractAddress.slice(-4)}
            </span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Left Sidebar */}
        <aside className="sidebar">
          {/* Active Wallet Box */}
          <section className="card">
            <h2 className="card-title">
              🔑 Active Wallet
            </h2>
            <div className="account-box">
              <div className="account-row">
                <span className="account-key">Address</span>
                <span className="account-val" title={activeAddress}>
                  {activeAddress || "Connecting..."}
                </span>
              </div>
              <div className="account-row">
                <span className="account-key">Network</span>
                <span className="account-val" title={RPC_URL}>
                  Studionet
                </span>
              </div>
            </div>
            
            <div className="account-actions">
              <button 
                className="btn btn-secondary btn-sm"
                onClick={fundAccount}
                disabled={isFunding}
              >
                {isFunding ? "Funding..." : "⚡ Request GEN"}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const newKey = generatePrivateKey();
                  setPrivateKey(newKey);
                  localStorage.setItem("bondkeep_private_key", newKey);
                  addLog("Generated new ephemeral keys.", "info");
                }}
              >
                🔄 Rotate Key
              </button>
            </div>
          </section>

          {/* Slashed penalty pool widget */}
          <section className="card">
            <h2 className="card-title">
              💰 Penalty Vault
            </h2>
            <div>
              <div className="pool-value">
                ${(penaltyPool / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div className="pool-desc">
                Collateral confiscated from agents due to natural-language mandate violations.
              </div>
            </div>
          </section>
        </aside>

        {/* Right Main Panel */}
        <main className="main-panel">
          <section className="empty-dashboard">
            <div className="empty-icon">🤖</div>
            <h3>System Ready</h3>
            <p>Select or register an AI agent to monitor covenants and enforce SLA bonds.</p>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
