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

  // Tab Control
  const [activeTab, setActiveTab] = useState<"dashboard" | "provision">("dashboard");

  // Register Form
  const [regId, setRegId] = useState<string>("");
  const [regMandate, setRegMandate] = useState<string>("");
  const [regEvidenceUrl, setRegEvidenceUrl] = useState<string>("");
  const [regBond, setRegBond] = useState<number>(100); // 100 GEN

  // Interaction Forms
  const [topUpAmount, setTopUpAmount] = useState<number>(50); // 50 GEN
  const [reporterName, setReporterName] = useState<string>("watcher-alice");


  // Console Logs
  const [consoleLogs, setConsoleLogs] = useState<LogLine[]>([]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Load private key and registry on mount
  useEffect(() => {
    let key = localStorage.getItem("bondkeep_private_key");
    if (!key) {
      key = generatePrivateKey();
      localStorage.setItem("bondkeep_private_key", key);
    }
    setPrivateKey(key);

    const savedAgents = localStorage.getItem("bondkeep_registered_agents");
    if (savedAgents) {
      try {
        const parsed = JSON.parse(savedAgents);
        setAgentsRegistry(parsed);
        if (parsed.length > 0) {
          setSelectedAgentId(parsed[0]);
        }
      } catch (e) {
        console.error("Failed to parse registry", e);
      }
    } else {
      setAgentsRegistry(["alpha-oracle-bot"]);
      setSelectedAgentId("alpha-oracle-bot");
      localStorage.setItem("bondkeep_registered_agents", JSON.stringify(["alpha-oracle-bot"]));
    }
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

  // Load selected agent & penalty pool
  useEffect(() => {
    if (selectedAgentId) {
      fetchAgentDetails(selectedAgentId);
    }
    fetchPenaltyPool();
  }, [selectedAgentId, activeAddress]);

  // Auto-scroll console
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleLogs]);

  // Add line to custom console
  const addLog = (text: string, type: "info" | "success" | "error" | "warning" = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setConsoleLogs((prev) => [...prev, { timestamp, text, type }]);
  };

  // Fetch Penalty Pool
  const fetchPenaltyPool = async () => {
    try {
      const client = getGenLayerClient(privateKey);
      const pool = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_penalty_pool",
      });
      setPenaltyPool(Number(pool));
    } catch (e) {
      console.error("Failed to fetch penalty pool", e);
    }
  };

  // Fetch details of a specific agent
  const fetchAgentDetails = async (agentId: string) => {
    if (!agentId) return;
    try {
      const client = getGenLayerClient(privateKey);
      const res = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_agent",
        args: [agentId],
      });
      
      const resStr = String(res);
      if (resStr === "{}" || !resStr) {
        setActiveAgentData(null);
      } else {
        const parsed = JSON.parse(resStr) as AgentState;
        setActiveAgentData(parsed);
      }
    } catch (e) {
      console.error("Failed to load agent details", e);
      setActiveAgentData(null);
    }
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

  // Register Agent
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regId || !regMandate || !regEvidenceUrl || regBond <= 0) {
      alert("Please fill all agent registration fields.");
      return;
    }

    setIsLoading(true);
    addLog(`[Register] Provisioning SLA covenant for: ${regId}...`, "info");
    try {
      const client = getGenLayerClient(privateKey);
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "register_agent",
        args: [regId, regMandate, regEvidenceUrl, regBond],
        value: 0n,
      });

      addLog(`[Register] Tx Broadcasted. Hash: ${txHash}. Awaiting finalization...`, "warning");

      const receipt = await client.waitForTransactionReceipt({
        hash: txHash,
      });

      addLog(`[Register] Transformed to Block. Status: ${receipt.status}`, "success");
      
      // Update local registry
      if (!agentsRegistry.includes(regId)) {
        const updated = [...agentsRegistry, regId];
        setAgentsRegistry(updated);
        localStorage.setItem("bondkeep_registered_agents", JSON.stringify(updated));
      }

      // Reset form
      setRegId("");
      setRegMandate("");
      setRegEvidenceUrl("");
      
      // Switch tab and focus on registered agent
      setActiveTab("dashboard");
      setSelectedAgentId(regId);
      await fetchAgentDetails(regId);
      await fetchPenaltyPool();
    } catch (err: any) {
      console.error(err);
      addLog(`[Register Error] ${err.message || err.toString()}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Top Up Bond
  const handleTopUp = async () => {
    if (!selectedAgentId || topUpAmount <= 0) return;
    setIsLoading(true);
    addLog(`[Top-up] Depositing ${topUpAmount} GEN collateral for ${selectedAgentId}...`, "info");
    try {
      const client = getGenLayerClient(privateKey);
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "top_up_bond",
        args: [selectedAgentId, topUpAmount],
        value: 0n,
      });

      addLog(`[Top-up] Tx Broadcasted. Hash: ${txHash}. Awaiting confirmation...`, "warning");

      await client.waitForTransactionReceipt({
        hash: txHash,
      });

      addLog("[Top-up] Collateral successfully topped up!", "success");
      await fetchAgentDetails(selectedAgentId);
    } catch (err: any) {
      console.error(err);
      addLog(`[Top-up Error] ${err.message || err.toString()}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Run Audit
  const handleAudit = async () => {
    if (!selectedAgentId || !activeAgentData) return;
    setIsLoading(true);
    addLog(`[Audit] Initiating compliance audit for: ${selectedAgentId} triggered by ${reporterName}...`, "info");
    
    const runSim = (delay: number, text: string, type: "info" | "success" | "error" | "warning" = "info") => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          addLog(text, type);
          resolve();
        }, delay);
      });
    };

    try {
      const client = getGenLayerClient(privateKey);
      const txPromise = client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "audit",
        args: [selectedAgentId, reporterName],
        value: 0n,
      });

      await runSim(1000, `[GenVM] Tx sent to consensus pool. Dispatching validators...`, "info");
      await runSim(2500, `[GenVM] Leader node selected. Initiating evidence render...`, "warning");
      await runSim(4000, `[gl.nondet.web.render] Scraping activity logs from source: ${activeAgentData.evidence_url}`, "info");
      await runSim(6000, `[gl.nondet.exec_prompt] Prompting LLM for mandate compliance...`, "warning");
      await runSim(8000, `[GenVM] Validators verifying leader's return against consensus threshold...`, "info");

      const txHash = await txPromise;
      addLog(`[Audit] Consensus transaction mined. Hash: ${txHash}. Finalizing...`, "warning");

      await client.waitForTransactionReceipt({
        hash: txHash,
      });

      addLog(`[Audit] SLA Audit Finalized!`, "success");
      await fetchAgentDetails(selectedAgentId);
      await fetchPenaltyPool();
      
      const refreshedClient = getGenLayerClient(privateKey);
      const res = await refreshedClient.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_agent",
        args: [selectedAgentId],
      });
      const parsed = JSON.parse(String(res)) as AgentState;
      const latestAudit = parsed.audits[parsed.audits.length - 1];
      if (latestAudit) {
        const severityColor = latestAudit.severity >= 60 ? "error" : latestAudit.severity >= 30 ? "warning" : "success";
        addLog(`[Audit Result] Verdict: ${latestAudit.verdict} (Severity: ${latestAudit.severity}/100)`, severityColor);
        addLog(`[Audit reasoning] ${latestAudit.reasoning}`, "info");
        if (latestAudit.slashed > 0) {
          addLog(`[Slashed Alert] Slashed ${latestAudit.slashed} GEN from active bond!`, "error");
        }
      }
    } catch (err: any) {
      console.error(err);
      addLog(`[Audit Error] ${err.message || err.toString()}`, "error");
    } finally {
      setIsLoading(false);
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
                {penaltyPool.toLocaleString()} GEN
              </div>
              <div className="pool-desc">
                Collateral confiscated from agents due to natural-language mandate violations.
              </div>
            </div>
          </section>

          {/* Monitored Agents Registry */}
          <section className="card">
            <h2 className="card-title">
              🤖 Active Covenants
            </h2>
            {agentsRegistry.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>No monitored agents.</p>
            ) : (
              <div className="registry-list">
                {agentsRegistry.map((id) => (
                  <div
                    key={id}
                    className={`registry-item ${selectedAgentId === id ? "active" : ""}`}
                    onClick={() => setSelectedAgentId(id)}
                  >
                    <span className="registry-id">{id}</span>
                    <span className={`status-badge ${(activeAgentData?.id === id ? activeAgentData.status : "ACTIVE").toLowerCase()}`}>
                      {activeAgentData?.id === id ? activeAgentData.status : "ACTIVE"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>

        {/* Right Main Panel */}
        <main className="main-panel">
          {/* Tab Navigation */}
          <div className="tab-navigation">
            <button
              className={`tab-btn ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              📊 Covenants & Auditing
            </button>
            <button
              className={`tab-btn ${activeTab === "provision" ? "active" : ""}`}
              onClick={() => setActiveTab("provision")}
            >
              ✍️ Provision SLA & Bond
            </button>
          </div>

          {activeTab === "provision" ? (
            <section className="card">
              <h2 className="card-title">
                ✍️ Provision AI Agent SLA & Lock Collateral
              </h2>
              <form onSubmit={handleRegister}>
                <div className="form-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <div>
                    <label className="form-label">Agent ID / Registry Key</label>
                    <input
                      type="text"
                      className="form-input form-input-mono"
                      placeholder="e.g. alpha-oracle-bot"
                      value={regId}
                      onChange={(e) => setRegId(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  <div>
                    <label className="form-label">Escrow Collateral Bond (in GEN)</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="100 (= 100 GEN)"
                      value={regBond}
                      onChange={(e) => setRegBond(Number(e.target.value))}
                      disabled={isLoading}
                    />
                  </div>
                </div>
                
                <div className="form-group">
                  <label className="form-label">Service Level Agreement (SLA) Mandate</label>
                  <textarea
                    className="form-textarea"
                    placeholder="Describe agent constraints in plain natural language..."
                    value={regMandate}
                    onChange={(e) => setRegMandate(e.target.value)}
                    disabled={isLoading}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Evidence Log Feed URL</label>
                  <input
                    type="url"
                    className="form-input"
                    placeholder="https://gist.githubusercontent.com/.../raw/logs.txt"
                    value={regEvidenceUrl}
                    onChange={(e) => setRegEvidenceUrl(e.target.value)}
                    disabled={isLoading}
                  />
                </div>

                <button type="submit" className="btn btn-primary" disabled={isLoading}>
                  {isLoading ? "Broadcasting to GenLayer..." : "🔒 Lock Bond & Deploy SLA"}
                </button>
              </form>
            </section>
          ) : (
            /* Dashboard Tab */
            activeAgentData ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                {/* Agent Header / Info */}
                <section className="card">
                  <div className="agent-header-card">
                    <div className="agent-title-area">
                      <h2>🤖 {activeAgentData.id}</h2>
                      <a
                        href={activeAgentData.evidence_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="agent-url"
                      >
                        🔗 Verify Public Telemetry Feed ↗
                      </a>
                    </div>
                    <span className={`status-badge ${activeAgentData.status.toLowerCase()}`}>
                      {activeAgentData.status}
                    </span>
                  </div>

                  <div className="bond-container">
                    <div className="bond-header">
                      <span className="bond-title">Secured SLA Bond</span>
                      <span className="bond-values">
                        {activeAgentData.bond_remaining.toLocaleString()} GEN active
                      </span>
                    </div>
                    <div className="bond-bar">
                      <div
                        className={`bond-fill ${activeAgentData.status === "FROZEN" ? "slashed" : ""}`}
                        style={{ width: `${activeAgentData.bond_remaining > 0 ? 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: "1.25rem" }}>
                    <span className="form-label">SLA Fiduciary Mandate</span>
                    <div className="mandate-quote">
                      "{activeAgentData.mandate}"
                    </div>
                  </div>
                </section>

                {/* Action Boxes */}
                <div className="action-box-grid">
                  {/* Audit Trigger */}
                  <section className="card" style={{ marginBottom: 0 }}>
                    <h2 className="card-title">
                      🔍 Evaluate Compliance SLA
                    </h2>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1rem" }}>
                      Fetch public logs and execute LLM verification under validator consensus.
                    </p>
                    
                    <div className="form-group">
                      <label className="form-label">Auditor / Reporter ID</label>
                      <input
                        type="text"
                        className="form-input form-input-mono"
                        value={reporterName}
                        onChange={(e) => setReporterName(e.target.value)}
                        disabled={isLoading || activeAgentData.status === "FROZEN"}
                      />
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={handleAudit}
                      disabled={isLoading || activeAgentData.status === "FROZEN"}
                    >
                      {isLoading ? "Running SLA Audit..." : "🚀 Run Intelligent Audit"}
                    </button>
                  </section>

                  {/* Top Up Bond Form */}
                  <section className="card" style={{ marginBottom: 0 }}>
                    <h2 className="card-title">
                      💸 Top up Bond Collateral
                    </h2>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1rem" }}>
                      Increase locked escrow collateral to support higher transaction volumes.
                    </p>

                    <div className="form-group">
                      <label className="form-label">Top up Amount (in GEN)</label>
                      <input
                        type="number"
                        className="form-input"
                        value={topUpAmount}
                        onChange={(e) => setTopUpAmount(Number(e.target.value))}
                        disabled={isLoading || activeAgentData.status === "FROZEN"}
                      />
                    </div>

                    <button
                      className="btn btn-secondary"
                      onClick={handleTopUp}
                      disabled={isLoading || activeAgentData.status === "FROZEN"}
                    >
                      {isLoading ? "Confirming..." : "➕ Deposit Collateral"}
                    </button>
                  </section>
                </div>

                {/* Console Output simulator */}
                <section className="card" style={{ marginBottom: 0 }}>
                  <h2 className="card-title">
                    💻 GenVM Consensus Telemetry
                  </h2>
                  <div className="terminal">
                    <div className="terminal-header">
                      <div className="terminal-dot dot-red" />
                      <div className="terminal-dot dot-yellow" />
                      <div className="terminal-dot dot-green" />
                      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginLeft: "0.5rem" }}>sentinel@genvm</span>
                    </div>
                    {consoleLogs.length === 0 ? (
                      <div className="terminal-line info">Awaiting SLA transaction execution...</div>
                    ) : (
                      consoleLogs.map((log, idx) => (
                        <div key={idx} className={`terminal-line ${log.type}`}>
                          [{log.timestamp}] {log.text}
                        </div>
                      ))
                    )}
                    <div ref={terminalEndRef} />
                  </div>
                </section>

                {/* Audit history list */}
                <section className="card" style={{ marginBottom: 0 }}>
                  <h2 className="card-title">
                    📜 SLA Evaluation History
                  </h2>
                  {activeAgentData.audits.length === 0 ? (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "1rem 0" }}>
                      No evaluation reports recorded for this covenant yet.
                    </p>
                  ) : (
                    <div className="audit-timeline">
                      {activeAgentData.audits.slice().reverse().map((audit, idx) => (
                        <div 
                          key={idx} 
                          className={`audit-node node-${audit.verdict.toLowerCase()}`}
                        >
                          <div className="audit-meta">
                            <span className={`audit-verdict ${audit.verdict.toLowerCase()}`}>
                              {audit.verdict}
                            </span>
                            <span className="audit-reporter">
                              Audited by <strong>{audit.reporter}</strong>
                            </span>
                            {audit.slashed > 0 && (
                              <span className="audit-slashed">
                                -{audit.slashed} GEN slashed
                              </span>
                            )}
                          </div>
                          
                          <div className="audit-reasoning">
                            {audit.reasoning}
                          </div>
                          
                          <div className="audit-details-row">
                            <div className="audit-detail-item">
                              Severity: <span>{audit.severity}/100</span>
                            </div>
                            <div className="audit-detail-item">
                              Slash Ratio: <span>{audit.slashed > 0 ? `${Math.round(audit.slashed / (activeAgentData.bond_remaining + audit.slashed) * 100)}%` : "0%"}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <section className="empty-dashboard">
                <div className="empty-icon">📊</div>
                <h3>No Covenant Selected</h3>
                <p>Select a registered covenant from the left panel, or provision a new one in the SLA tab.</p>
              </section>
            )
          )}
        </main>
      </div>
    </div>
  );
}

export default App;

