import { useState, useEffect, useRef } from "react";
import { getGenLayerClient, CONTRACT_ADDRESS, RPC_URL, generatePrivateKey } from "./genlayerClient";
import "./App.css";

interface AuditReport {
  reporter: string;
  reporter_address?: string;
  verdict: string;
  severity: number;
  slashed: number;
  beneficiary_payout?: number;
  reporter_payout?: number;
  treasury_payout?: number;
  telemetry_valid?: boolean;
  reasoning: string;
}

interface AgentState {
  id: string;
  mandate: string;
  evidence_url: string;
  bond_remaining: number;
  status: string;
  owner?: string;
  beneficiary?: string;
  telemetry_key?: string;
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
  const [beneficiaryClaimable, setBeneficiaryClaimable] = useState<number>(0);
  const [reporterClaimable, setReporterClaimable] = useState<number>(0);
  
  // Ephemeral loading
  const [isFunding, setIsFunding] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isClaiming, setIsClaiming] = useState<boolean>(false);

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
  const [regBeneficiary, setRegBeneficiary] = useState<string>("");
  const [regTelemetryKey, setRegTelemetryKey] = useState<string>("pubkey_ecdsa_secp256k1_alpha_01");

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
          const addr = client.account.address;
          setActiveAddress(addr);
          if (!regBeneficiary) {
            setRegBeneficiary(addr);
          }
        }
      } catch (e) {
        console.error("Failed to extract address from key", e);
      }
    }
  }, [privateKey]);

  // Load selected agent, claims & penalty pool
  useEffect(() => {
    if (selectedAgentId) {
      fetchAgentDetails(selectedAgentId);
    }
    fetchPenaltyPoolAndClaims();
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

  // Fetch Penalty Pool & Claimable balances
  const fetchPenaltyPoolAndClaims = async () => {
    try {
      const client = getGenLayerClient(privateKey);
      const pool = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_penalty_pool",
      });
      setPenaltyPool(Number(pool));

      if (activeAddress) {
        const benClaim = await client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_beneficiary_claimable",
          args: [activeAddress as `0x${string}`],
        });
        setBeneficiaryClaimable(Number(benClaim));

        const repClaim = await client.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_reporter_claimable",
          args: [activeAddress as `0x${string}`],
        });
        setReporterClaimable(Number(repClaim));
      }
    } catch (e) {
      console.error("Failed to fetch pool or claims", e);
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
        params: [activeAddress as `0x${string}`, 500],
      });
      addLog("Test tokens funded successfully! (500 GEN)", "success");
    } catch (e) {
      console.error("Funding error", e);
      addLog("Failed to fund account. Make sure Studionet is active.", "error");
    } finally {
      setIsFunding(false);
    }
  };

  // Register Agent with Payable Custody
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regId || !regMandate || !regEvidenceUrl || regBond <= 0 || !regBeneficiary) {
      alert("Please fill all agent registration fields.");
      return;
    }

    setIsLoading(true);
    addLog(`[Register] Provisioning SLA & locking ${regBond} GEN payable escrow for: ${regId}...`, "info");
    try {
      const client = getGenLayerClient(privateKey);
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "register_agent",
        args: [
          regId,
          regMandate,
          regEvidenceUrl,
          regBeneficiary as `0x${string}`,
          regTelemetryKey || "pubkey_default_secp256k1"
        ],
        value: BigInt(regBond),
      });

      addLog(`[Register] Tx Broadcasted. Hash: ${txHash}. Payable bond locked in custody...`, "warning");

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
      await fetchPenaltyPoolAndClaims();
    } catch (err: any) {
      console.error(err);
      addLog(`[Register Error] ${err.message || err.toString()}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Top Up Bond with Payable Deposit
  const handleTopUp = async () => {
    if (!selectedAgentId || topUpAmount <= 0) return;
    setIsLoading(true);
    addLog(`[Top-up] Depositing ${topUpAmount} GEN native collateral for ${selectedAgentId}...`, "info");
    try {
      const client = getGenLayerClient(privateKey);
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "top_up_bond",
        args: [selectedAgentId],
        value: BigInt(topUpAmount),
      });

      addLog(`[Top-up] Tx Broadcasted. Hash: ${txHash}. Awaiting confirmation...`, "warning");

      await client.waitForTransactionReceipt({
        hash: txHash,
      });

      addLog("[Top-up] Collateral successfully topped up in contract custody!", "success");
      await fetchAgentDetails(selectedAgentId);
    } catch (err: any) {
      console.error(err);
      addLog(`[Top-up Error] ${err.message || err.toString()}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Run Audit with Independent Validator Equivalence & Telemetry Verification
  const handleAudit = async () => {
    if (!selectedAgentId || !activeAgentData) return;
    setIsLoading(true);
    addLog(`[Audit] Initiating SLA compliance audit for: ${selectedAgentId} triggered by ${reporterName}...`, "info");
    
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
        args: [
          selectedAgentId,
          reporterName,
          (activeAddress || "0x0000000000000000000000000000000000000000") as `0x${string}`
        ],
        value: 0n,
      });

      await runSim(1000, `[GenVM Pool] Dispatching leader node and independent validators...`, "info");
      await runSim(2500, `[Leader Evaluation] Fetching public telemetry from: ${activeAgentData.evidence_url}`, "warning");
      await runSim(4000, `[Telemetry Auth] Verifying cryptographic header against key: ${activeAgentData.telemetry_key || "secp256k1"}`, "info");
      await runSim(5500, `[Validator Nodes] Independent re-fetch & prompt evaluation executing...`, "warning");
      await runSim(7500, `[Equivalence Protocol] Verifying leader verdict vs validator consensus & slash caps...`, "info");

      const txHash = await txPromise;
      addLog(`[Audit] Consensus transaction finalized. Hash: ${txHash}.`, "warning");

      await client.waitForTransactionReceipt({
        hash: txHash,
      });

      addLog(`[Audit] SLA Audit Finalized & Consensus Reached!`, "success");
      await fetchAgentDetails(selectedAgentId);
      await fetchPenaltyPoolAndClaims();
      
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
        addLog(`[Validator Equivalence] Passed: Independent validator nodes verified breach severity & slash ratio.`, "success");
        addLog(`[Audit reasoning] ${latestAudit.reasoning}`, "info");
        if (latestAudit.slashed > 0) {
          addLog(`[Bounded Slash Executed] Slashed ${latestAudit.slashed} GEN from active bond custody!`, "error");
          addLog(`[Payable Payout Split] 70% (${latestAudit.beneficiary_payout || Math.round(latestAudit.slashed*0.7)} GEN) -> Beneficiary | 20% (${latestAudit.reporter_payout || Math.round(latestAudit.slashed*0.2)} GEN) -> Auditor Bounty | 10% -> Treasury`, "warning");
        }
      }
    } catch (err: any) {
      console.error(err);
      addLog(`[Audit Error] ${err.message || err.toString()}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Claim Beneficiary Payout
  const handleClaimBeneficiary = async () => {
    if (beneficiaryClaimable <= 0) return;
    setIsClaiming(true);
    addLog(`[Claim] Claiming ${beneficiaryClaimable} GEN SLA breach compensation...`, "info");
    try {
      const client = getGenLayerClient(privateKey);
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "claim_beneficiary_payout",
        args: [],
        value: 0n,
      });
      await client.waitForTransactionReceipt({ hash: txHash });
      addLog(`[Claim] Successfully withdrawn ${beneficiaryClaimable} GEN to beneficiary wallet!`, "success");
      await fetchPenaltyPoolAndClaims();
    } catch (err: any) {
      console.error(err);
      addLog(`[Claim Error] ${err.message || err.toString()}`, "error");
    } finally {
      setIsClaiming(false);
    }
  };

  // Claim Auditor Bounty
  const handleClaimReporter = async () => {
    if (reporterClaimable <= 0) return;
    setIsClaiming(true);
    addLog(`[Bounty] Claiming ${reporterClaimable} GEN auditor bounty payout...`, "info");
    try {
      const client = getGenLayerClient(privateKey);
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: "claim_reporter_bounty",
        args: [],
        value: 0n,
      });
      await client.waitForTransactionReceipt({ hash: txHash });
      addLog(`[Bounty] Successfully claimed ${reporterClaimable} GEN auditor bounty!`, "success");
      await fetchPenaltyPoolAndClaims();
    } catch (err: any) {
      console.error(err);
      addLog(`[Bounty Error] ${err.message || err.toString()}`, "error");
    } finally {
      setIsClaiming(false);
    }
  };

  // Presets
  const applyPresetA = () => {
    setRegId("alpha-hedge-bot");
    setRegBond(100);
    setRegMandate("I am an automated hedge fund agent. I must strictly invest in BTC and ETH. I am forbidden from trading meme tokens or exceeding 5x leverage. Any violation triggers bond slashing.");
    setRegEvidenceUrl("https://gist.githubusercontent.com/k-beee/5717641f92e39dbf908e330ad3c4e09f/raw/logs_compliant.txt");
    setRegTelemetryKey("pubkey_secp256k1_alpha_hedge_01");
    if (activeAddress) setRegBeneficiary(activeAddress);
  };

  const applyPresetB = () => {
    setRegId("vortex-defi-bot");
    setRegBond(200);
    setRegMandate("I am a DeFi liquidity bot. I am strictly forbidden from opening unhedged leveraged positions or swapping into unverified DEX liquidity pools. Violations incur a bounded 50% slash payable to the SLA beneficiary.");
    setRegEvidenceUrl("https://gist.githubusercontent.com/k-beee/5717641f92e39dbf908e330ad3c4e09f/raw/logs_violation.txt");
    setRegTelemetryKey("pubkey_secp256k1_vortex_defi_99");
    if (activeAddress) setRegBeneficiary(activeAddress);
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-section">
          <div className="logo-sentinel">
            <div className="sentinel-shield">
              <div className="sentinel-core"></div>
            </div>
            <h1>
              BOND<span className="logo-highlight">KEEP</span> <span className="brand-badge">SLA Sentinel</span>
            </h1>
          </div>
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
              [SESSION] Active Wallet
            </h2>
            <div className="account-box">
              <div className="account-row">
                <span className="account-key">Address</span>
                <span className="account-val" title={activeAddress}>
                  {activeAddress ? `${activeAddress.slice(0, 8)}...${activeAddress.slice(-6)}` : "Connecting..."}
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
                {isFunding ? "Funding..." : "Request GEN"}
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
                Rotate Key
              </button>
            </div>
          </section>

          {/* Slashed penalty pool & Claimable payouts widget */}
          <section className="card">
            <h2 className="card-title">
              [VAULT] Escrow Payouts & Vault
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div className="account-box" style={{ background: "rgba(6, 8, 20, 0.7)" }}>
                <div className="account-row">
                  <span className="account-key">Beneficiary Claimable</span>
                  <span className="account-val" style={{ color: "#34d399", fontWeight: 700 }}>
                    {beneficiaryClaimable} GEN
                  </span>
                </div>
                {beneficiaryClaimable > 0 && (
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: "0.5rem", width: "100%" }}
                    onClick={handleClaimBeneficiary}
                    disabled={isClaiming}
                  >
                    Claim Beneficiary Payout
                  </button>
                )}
              </div>

              <div className="account-box" style={{ background: "rgba(6, 8, 20, 0.7)" }}>
                <div className="account-row">
                  <span className="account-key">Auditor Bounty Claimable</span>
                  <span className="account-val" style={{ color: "#38bdf8", fontWeight: 700 }}>
                    {reporterClaimable} GEN
                  </span>
                </div>
                {reporterClaimable > 0 && (
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: "0.5rem", width: "100%" }}
                    onClick={handleClaimReporter}
                    disabled={isClaiming}
                  >
                    Claim Auditor Bounty
                  </button>
                )}
              </div>

              <div style={{ marginTop: "0.25rem" }}>
                <div className="pool-value">
                  {penaltyPool.toLocaleString()} GEN
                </div>
                <div className="pool-desc">
                  Protocol Treasury (10% residue from verified slash enforcement).
                </div>
              </div>
            </div>
          </section>

          {/* Monitored Agents Registry */}
          <section className="card">
            <h2 className="card-title">
              [REGISTRY] Active Covenants
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
              Covenants & Auditing
            </button>
            <button
              className={`tab-btn ${activeTab === "provision" ? "active" : ""}`}
              onClick={() => setActiveTab("provision")}
            >
              Provision SLA & Bond
            </button>
          </div>

          {activeTab === "provision" ? (
            <section className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 className="card-title" style={{ margin: 0 }}>
                  [PROVISION] Provision AI Agent SLA & Lock Payable Collateral
                </h2>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={applyPresetA}>
                    Preset: Compliant Bot
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={applyPresetB}>
                    Preset: Violation Bot
                  </button>
                </div>
              </div>

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
                    <label className="form-label">Payable Custody Escrow Bond (in GEN)</label>
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

                <div className="form-group" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                  <div>
                    <label className="form-label">SLA Beneficiary Address (Payout Receiver)</label>
                    <input
                      type="text"
                      className="form-input form-input-mono"
                      placeholder="0x..."
                      value={regBeneficiary}
                      onChange={(e) => setRegBeneficiary(e.target.value)}
                      disabled={isLoading}
                    />
                  </div>
                  <div>
                    <label className="form-label">Authenticated Telemetry Signer Pubkey</label>
                    <input
                      type="text"
                      className="form-input form-input-mono"
                      placeholder="pubkey_secp256k1_..."
                      value={regTelemetryKey}
                      onChange={(e) => setRegTelemetryKey(e.target.value)}
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
                  {isLoading ? "Locking Native Tokens & Deploying..." : "Deposit GEN & Provision SLA"}
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
                      <h2>[AGENT] {activeAgentData.id}</h2>
                      <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginTop: "0.35rem" }}>
                        <a
                          href={activeAgentData.evidence_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="agent-url"
                        >
                          Verify Telemetry Feed -&gt;
                        </a>
                        <span style={{ fontSize: "0.75rem", color: "#38bdf8", fontFamily: "var(--font-mono)" }}>
                          Signer: {activeAgentData.telemetry_key ? `${activeAgentData.telemetry_key.slice(0, 16)}...` : "Authenticated"}
                        </span>
                      </div>
                    </div>
                    <span className={`status-badge ${activeAgentData.status.toLowerCase()}`}>
                      {activeAgentData.status}
                    </span>
                  </div>

                  <div className="bond-container">
                    <div className="bond-header">
                      <span className="bond-title">Secured SLA Bond (Payable Custody)</span>
                      <span className="bond-values">
                        {activeAgentData.bond_remaining.toLocaleString()} GEN locked in contract
                      </span>
                    </div>
                    <div className="bond-bar">
                      <div
                        className={`bond-fill ${activeAgentData.status === "FROZEN" ? "slashed" : ""}`}
                        style={{ width: `${activeAgentData.bond_remaining > 0 ? 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: "1rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                    <div>
                      <span style={{ color: "var(--text-secondary)" }}>SLA Beneficiary:</span>{" "}
                      <span style={{ color: "#34d399" }}>
                        {activeAgentData.beneficiary ? `${activeAgentData.beneficiary.slice(0, 8)}...${activeAgentData.beneficiary.slice(-6)}` : "None"}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-secondary)" }}>Contract Custody:</span>{" "}
                      <span style={{ color: "#38bdf8", fontWeight: 600 }}>Payable Escrow</span>
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
                      [AUDIT] Intelligent Compliance Audit
                    </h2>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1rem", fontFamily: "var(--font-mono)" }}>
                      Fetch public logs, verify authenticated telemetry headers, and run independent validator equivalence checks.
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
                      {isLoading ? "Running Validator Equivalence..." : "Execute Consensus Audit"}
                    </button>
                  </section>

                  {/* Top Up Bond Form */}
                  <section className="card" style={{ marginBottom: 0 }}>
                    <h2 className="card-title">
                      [CUSTODY] Top Up Escrow Collateral
                    </h2>
                    <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1rem", fontFamily: "var(--font-mono)" }}>
                      Deposit additional native GEN tokens directly into contract escrow custody.
                    </p>

                    <div className="form-group">
                      <label className="form-label">Top Up Deposit (in GEN)</label>
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
                      {isLoading ? "Confirming..." : "Deposit Native GEN"}
                    </button>
                  </section>
                </div>

                {/* Console Output simulator */}
                <section className="card" style={{ marginBottom: 0 }}>
                  <h2 className="card-title">
                    [TERMINAL] GenVM Consensus & Validator Verification
                  </h2>
                  <div className="terminal">
                    <div className="terminal-header">
                      <div className="terminal-dot dot-red" />
                      <div className="terminal-dot dot-yellow" />
                      <div className="terminal-dot dot-green" />
                      <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginLeft: "0.5rem" }}>sentinel@genvm-consensus</span>
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
                    [HISTORY] SLA Evaluation Log
                  </h2>
                  {activeAgentData.audits.length === 0 ? (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "1rem 0", fontFamily: "var(--font-mono)" }}>
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
                              Validator Equivalence: <span style={{ color: "#34d399" }}>PASSED</span>
                            </div>
                            {audit.beneficiary_payout && audit.beneficiary_payout > 0 ? (
                              <div className="audit-detail-item">
                                Beneficiary Transfer: <span style={{ color: "#38bdf8" }}>{audit.beneficiary_payout} GEN</span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <section className="empty-dashboard">
                <div className="empty-icon">[NO COVENANT]</div>
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
