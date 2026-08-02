# BondKeep: Autonomous AI Escrow & SLA Enforcement Protocol

**BondKeep** is a decentralized fiduciary accountability and Service Level Agreement (SLA) bonding protocol for autonomous AI agents. Built as an **Intelligent Contract** on **GenLayer**, it enables users to lock native financial collateral (bonds) on-chain in smart contract custody. Bonds are dynamically slashed if an AI agent violates its natural-language operational mandate (SLA).

By utilizing GenLayer's non-deterministic web rendering and LLM-driven multi-node consensus, BondKeep translates unstructured log files and plain-English commitments into automated, cryptographically backed financial enforcement—without centralized API oracles or human intermediaries.

* **Live Dashboard**: [bondkeep-woad.vercel.app](https://bondkeep-woad.vercel.app/)
* **Deployed Contract Address (Studionet)**: `0xfbB19F0Dd43B11e6B82d2788bDc633B8C32748B7`

---

## Core Protocol Advancements

This version addresses all fundamental protocol security and escrow requirements:

### 1. Independent Validator Consensus Verification (`validator_fn`)
Unlike primitive contracts where validators blindly approve leader proposals (`return isinstance(leader_result, gl.vm.Return)`), BondKeep implements **Independent Multi-Node Equivalence Verification**:
* **Validator Execution**: Every validator node independently renders the agent telemetry log feed and executes a standalone LLM evaluation of the covenant mandate.
* **Equivalence Threshold Check**: Transactions only finalize if the independent validator severity score matches the leader proposal within a strict tolerance window ($\le 15$ severity score delta) or verdict equivalence is satisfied.
* **Slash Cap Validation**: Validator nodes reject any transaction proposing a slash ratio above contract-level bounds.

```python
def validator_fn(leader_result) -> bool:
    # 1. Parse leader proposed verdict, severity score, and slash ratio
    leader_dict = json.loads(leader_result) if isinstance(leader_result, str) else leader_result
    
    # 2. Re-fetch telemetry & evaluate independently on validator node
    behavior = gl.nondet.web.render(ev_url, mode="text")
    val_result = gl.nondet.exec_prompt(validator_task, response_format="json")
    
    # 3. Verify Equivalence: Verdict match or severity score within 15-point tolerance
    severity_diff = abs(int(leader_dict["severity"]) - int(val_result["severity"]))
    return (leader_dict["verdict"] == val_result["verdict"] or severity_diff <= 15) and (0 <= int(leader_dict["slash_ratio"]) <= 100)
```

### 2. Native Payable Custody & Escrow (`@gl.public.write.payable`)
* **Payable Deposit**: Contract methods (`register_agent` and `top_up_bond`) are decorated with `@gl.public.write.payable`, accepting native `gl.message.value` tokens.
* **Real Escrow Balance**: Locked collateral is held directly inside smart contract state (`agent_bonds[agent_id]`), backed 1:1 by native network tokens rather than internal bookkeeping integers.
* **Decommissioning**: Authorized agent owners can withdraw un-slashed bond balances upon clean SLA completion using `withdraw_unslashed_bond`.

### 3. Bounded Slashing & Rate Caps
* **Upper Bound Cap**: Slash ratios per breach incident are hard-capped at contract level (`max_slash_cap = 50%`) to prevent unconstrained single-breach liquidations.
* **Severity Threshold**: Slashing only triggers if validator consensus determines severity $\ge 60/100$.
* **Bounded Formula**: `slashed = (current_bond * min(slash_ratio, max_slash_cap)) // 100`.

### 4. Direct Beneficiary Transfers & Auditor Bounties
When a breach is verified and slashed by validator consensus, slashed funds are automatically split and made available for direct payable transfers:
* **70% SLA Beneficiary Payout**: Directly claimable by the SLA beneficiary (`claim_beneficiary_payout`) to compensate for service disruption.
* **20% Auditor Bounty**: Payable to the audit reporter address (`claim_reporter_bounty`) as an economic incentive for public watchdog monitoring.
* **10% Protocol Treasury**: Deposited into the contract penalty pool (`penalty_pool`).

### 5. Authenticated Telemetry Origin Verification
* **Cryptographic Signer Keys**: Agents register an authorized `telemetry_key` upon SLA provisioning.
* **Telemetry Header Inspection**: During `leader_fn` and `validator_fn`, nodes verify that log feeds contain valid cryptographic headers matching the registered agent pubkey before evaluating compliance.

---

## System Architecture

```mermaid
flowchart TD
    %% Phase 1
    subgraph Initialization [Phase 1: Payable SLA Initialization]
        A["Agent Owner"] -->|Lock Native GEN (gl.message.value)| B["BondKeep Contract"]
        B -->|Set Beneficiary & Telemetry Key| C["Agent Active in Custody"]
    end

    %% Phase 2
    subgraph Ingestion [Phase 2: Telemetry Ingestion]
        C -->|Authenticated Log Feed| D["Decentralized Web Reader<br/>(gl.nondet.web.render)"]
        E["Auditor Sentinel"] -->|Initiate Audit Tx| D
    end

    %% Phase 3
    subgraph Consensus [Phase 3: Independent Validator Equivalence]
        D -->|Raw Telemetry| F["GenVM Leader Evaluation"]
        D -->|Independent Render| G["Validator Node 1"]
        D -->|Independent Render| H["Validator Node 2"]
        
        F -->|Propose Verdict & Severity| I["Equivalence Verification<br/>(Severity Delta <= 15 & Slash Cap Check)"]
        G -->|Independent Result| I
        H -->|Independent Result| I
    end

    %% Phase 4
    subgraph Enforcement [Phase 4: Bounded Slashing & Beneficiary Payouts]
        I -->|Consensus Mismatch| J["Revert Transaction"]
        I -->|Consensus Verified| K["Bounded Slash (Max 50%)"]
        
        K -->|70% Transfer| L["SLA Beneficiary Wallet"]
        K -->|20% Transfer| M["Auditor Bounty Wallet"]
        K -->|10% Reserve| N["Protocol Treasury Vault"]
    end

    %% Styles
    classDef header fill:#1e1b4b,stroke:#4f46e5,stroke-width:2px,color:#fff;
    classDef nodeStyle fill:#0b1329,stroke:#38bdf8,stroke-width:1px,color:#e2e8f0;
    classDef danger fill:#7f1d1d,stroke:#f43f5e,stroke-width:1px,color:#fff;
    classDef success fill:#064e3b,stroke:#34d399,stroke-width:1px,color:#fff;

    class A,B,C header;
    class D,E,F,G,H,I,K nodeStyle;
    class J danger;
    class L,M,N success;
```

---

## Verification & Compilation

### Smart Contract Linting
```bash
genvm-lint check contracts/bondkeep.py
```

### Frontend Build
```bash
cd frontend
npm install
npm run build
```

---

## Evaluation Test Scenarios

### Scenario A: Compliant Agent with Authenticated Telemetry
* **Mandate**: Trading bot restricted to BTC/ETH spot trades under 5x leverage.
* **Logs Feed**: `logs_compliant.txt` with valid `pubkey_secp256k1_alpha_hedge_01` header.
* **Outcome**: Validator equivalence check passes. Verdict is `COMPLIANT`. Zero slash executed. Escrow bond remains 100% intact.

### Scenario B: Violation & Bounded Beneficiary Payout
* **Mandate**: DeFi liquidity bot forbidden from taking 10x unhedged positions or meme coin swaps.
* **Logs Feed**: `logs_violation.txt` showing 10x leveraged long & unhedged DEX swaps.
* **Outcome**: Leader & validator nodes independently evaluate severity ($>60$). Bounded slash of 50% executed. 70% of slashed tokens transferred to SLA beneficiary, 20% to auditor bounty, and 10% to treasury vault.
