# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

class BondKeep(gl.Contract):
    # Fiduciary covenants mappings (gas-optimized state representation)
    agent_mandates: TreeMap[str, str]         # agent_id -> natural language mandate
    agent_evidence_urls: TreeMap[str, str]    # agent_id -> URL for behavior logs
    agent_bonds: TreeMap[str, u256]            # agent_id -> locked escrow bond balance
    agent_status: TreeMap[str, str]           # agent_id -> "ACTIVE" | "FROZEN" | "RETIRED"
    agent_owners: TreeMap[str, str]           # agent_id -> owner/deployer hex address
    agent_beneficiaries: TreeMap[str, str]    # agent_id -> SLA beneficiary hex address
    agent_telemetry_keys: TreeMap[str, str]   # agent_id -> authorized telemetry signer pubkey
    
    # Claimable balances (payable custody)
    beneficiary_claims: TreeMap[str, u256]    # beneficiary_address_hex -> claimable slashed funds
    reporter_claims: TreeMap[str, u256]       # reporter_address_hex -> claimable auditor bounties
    
    # Audit tracking mappings
    audit_counts: TreeMap[str, u256]           # agent_id -> count of audits
    audit_records: TreeMap[str, str]          # f"{agent_id}#{audit_index}" -> JSON-serialized audit result
    
    # Platform metrics & safety parameters
    penalty_pool: u256                        # Protocol treasury pool (slashed residue)
    violation_threshold: u256                 # Severity score threshold to trigger breach
    max_slash_cap: u256                       # Max slash percentage per breach

    def __init__(self):
        self.penalty_pool = u256(0)
        self.violation_threshold = u256(60)
        self.max_slash_cap = u256(50)

    @gl.public.write.payable
    def register_agent(self, agent_id: str, mandate: str,
                       evidence_url: str, beneficiary: str,
                       telemetry_key: str) -> str:
        if agent_id in self.agent_status:
            return self.get_agent(agent_id)
            
        bond_amount = gl.message.value
        
        self.agent_mandates[agent_id] = mandate
        self.agent_evidence_urls[agent_id] = evidence_url
        self.agent_bonds[agent_id] = bond_amount
        self.agent_status[agent_id] = "ACTIVE"
        self.agent_owners[agent_id] = gl.message.sender.as_hex
        self.agent_beneficiaries[agent_id] = beneficiary
        self.agent_telemetry_keys[agent_id] = telemetry_key
        self.audit_counts[agent_id] = u256(0)
        
        return self.get_agent(agent_id)

    @gl.public.write.payable
    def top_up_bond(self, agent_id: str) -> str:
        if agent_id not in self.agent_status:
            return "{}"
            
        amount = gl.message.value
        if int(amount) <= 0:
            return self.get_agent(agent_id)
            
        status = self.agent_status[agent_id]
        if status == "ACTIVE":
            current_bond = int(self.agent_bonds[agent_id])
            self.agent_bonds[agent_id] = u256(current_bond + int(amount))
            
        return self.get_agent(agent_id)

    @gl.public.write
    def audit(self, agent_id: str, reporter: str, reporter_payout_addr: str) -> str:
        if agent_id not in self.agent_status:
            return "{}"
        if self.agent_status[agent_id] == "FROZEN":
            return self.get_agent(agent_id)
            
        mandate = self.agent_mandates[agent_id]
        ev_url = self.agent_evidence_urls[agent_id]
        expected_key = self.agent_telemetry_keys[agent_id]
        
        def leader_fn():
            behavior = ""
            if ev_url:
                behavior = gl.nondet.web.render(ev_url, mode="text")
                
            task = (
                "You are an AI fiduciary watchdog auditing an autonomous AI Agent.\n"
                f"Agent Mandate (rules & obligations): {mandate}\n"
                f"Expected Telemetry Signer Key: {expected_key}\n"
                f"Agent Recent Behavior Logs: {behavior[:3000]}\n"
                "Verify if telemetry contains authenticated origin or valid logs.\n"
                "Evaluate if the agent is acting within its mandate. Identify deviation, abuse, or fraud.\n"
                "Provide a severity score (0 to 100) and a slash ratio (0 to 100, representing percent of bond to slash).\n"
                "Determine the verdict: COMPLIANT, WARNING, or VIOLATION.\n"
                "Return a JSON object with this exact shape:\n"
                '{"verdict": "COMPLIANT"|"WARNING"|"VIOLATION", "severity": <int 0-100>, "slash_ratio": <int 0-100>, "telemetry_valid": true|false, "reasoning": "brief explanation"}'
            )
            response = gl.nondet.exec_prompt(task, response_format="json")
            if isinstance(response, str):
                return json.loads(response)
            return response

        def validator_fn(leader_result) -> bool:
            # Independent Validator Verification
            if not isinstance(leader_result, dict):
                try:
                    leader_dict = json.loads(leader_result)
                except Exception:
                    return False
            else:
                leader_dict = leader_result
                
            leader_verdict = str(leader_dict.get("verdict", ""))
            leader_severity = int(leader_dict.get("severity", 0))
            leader_slash = int(leader_dict.get("slash_ratio", 0))
            
            # Re-fetch telemetry & evaluate independently on validator node
            behavior = ""
            if ev_url:
                behavior = gl.nondet.web.render(ev_url, mode="text")
                
            val_task = (
                "Independent Validator Audit Verification:\n"
                f"Agent Mandate: {mandate}\n"
                f"Expected Signer: {expected_key}\n"
                f"Behavior Logs: {behavior[:3000]}\n"
                "Determine independently: verdict (COMPLIANT|WARNING|VIOLATION), severity (0-100), slash_ratio (0-100).\n"
                'Return JSON: {"verdict": "...", "severity": <int>, "slash_ratio": <int>}'
            )
            val_response = gl.nondet.exec_prompt(val_task, response_format="json")
            if isinstance(val_response, str):
                val_dict = json.loads(val_response)
            else:
                val_dict = val_response
                
            val_verdict = str(val_dict.get("verdict", ""))
            val_severity = int(val_dict.get("severity", 0))
            
            # Equivalence Verification Criteria:
            severity_diff = abs(leader_severity - val_severity)
            verdict_match = (leader_verdict == val_verdict)
            slash_valid = (0 <= leader_slash <= 100)
            
            return (verdict_match or severity_diff <= 15) and slash_valid

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        
        try:
            report = result if isinstance(result, dict) else json.loads(result)
            if not isinstance(report, dict):
                report = {"verdict": "WARNING", "severity": 0, "slash_ratio": 0, "telemetry_valid": False, "reasoning": "Invalid format"}
        except Exception as e:
            report = {"verdict": "WARNING", "severity": 0, "slash_ratio": 0, "telemetry_valid": False, "reasoning": f"Parse error: {str(e)}"}
            
        severity = int(report.get("severity", 0))
        requested_slash_ratio = int(report.get("slash_ratio", 0))
        verdict = str(report.get("verdict", "WARNING"))
        
        # Enforce Bounded Slashing (Cap at max_slash_cap, e.g., 50%)
        bounded_slash_ratio = min(requested_slash_ratio, int(self.max_slash_cap))
        
        slashed = 0
        beneficiary_payout = 0
        reporter_payout = 0
        treasury_payout = 0
        
        current_bond = int(self.agent_bonds[agent_id])
        if severity >= int(self.violation_threshold):
            self.agent_status[agent_id] = "FROZEN"
            slashed = current_bond * bounded_slash_ratio // 100
            self.agent_bonds[agent_id] = u256(current_bond - slashed)
            
            # Beneficiary & Auditor Payout Split (70% Beneficiary, 20% Reporter Bounty, 10% Treasury)
            beneficiary_payout = slashed * 70 // 100
            reporter_payout = slashed * 20 // 100
            treasury_payout = slashed - beneficiary_payout - reporter_payout
            
            ben_addr = self.agent_beneficiaries[agent_id]
            curr_ben_claim = int(self.beneficiary_claims.get(ben_addr, u256(0)))
            self.beneficiary_claims[ben_addr] = u256(curr_ben_claim + beneficiary_payout)
            
            curr_rep_claim = int(self.reporter_claims.get(reporter_payout_addr, u256(0)))
            self.reporter_claims[reporter_payout_addr] = u256(curr_rep_claim + reporter_payout)
            
            self.penalty_pool = u256(int(self.penalty_pool) + treasury_payout)
            
        audit_idx = int(self.audit_counts.get(agent_id, u256(0)))
        audit_data = {
            "reporter": reporter,
            "reporter_address": reporter_payout_addr,
            "verdict": verdict,
            "severity": severity,
            "slashed": slashed,
            "beneficiary_payout": beneficiary_payout,
            "reporter_payout": reporter_payout,
            "treasury_payout": treasury_payout,
            "telemetry_valid": report.get("telemetry_valid", True),
            "reasoning": report.get("reasoning", "")
        }
        
        self.audit_records[f"{agent_id}#{audit_idx}"] = json.dumps(audit_data)
        self.audit_counts[agent_id] = u256(audit_idx + 1)
        
        return self.get_agent(agent_id)

    @gl.public.write
    def withdraw_unslashed_bond(self, agent_id: str) -> str:
        if agent_id not in self.agent_status:
            return "{}"
        if gl.message.sender.as_hex != self.agent_owners[agent_id]:
            return "{}"
            
        current_bond = int(self.agent_bonds[agent_id])
        if current_bond > 0:
            self.agent_bonds[agent_id] = u256(0)
            self.agent_status[agent_id] = "RETIRED"
            gl.transfer(gl.message.sender, u256(current_bond))
            
        return self.get_agent(agent_id)

    @gl.public.write
    def claim_beneficiary_payout(self) -> int:
        ben_addr_str = gl.message.sender.as_hex
        amount = int(self.beneficiary_claims.get(ben_addr_str, u256(0)))
        if amount > 0:
            self.beneficiary_claims[ben_addr_str] = u256(0)
            gl.transfer(gl.message.sender, u256(amount))
        return amount

    @gl.public.write
    def claim_reporter_bounty(self) -> int:
        rep_addr_str = gl.message.sender.as_hex
        amount = int(self.reporter_claims.get(rep_addr_str, u256(0)))
        if amount > 0:
            self.reporter_claims[rep_addr_str] = u256(0)
            gl.transfer(gl.message.sender, u256(amount))
        return amount

    @gl.public.view
    def get_agent(self, agent_id: str) -> str:
        if agent_id not in self.agent_status:
            return "{}"
            
        audits_list = []
        count = int(self.audit_counts.get(agent_id, u256(0)))
        for i in range(count):
            audit_key = f"{agent_id}#{i}"
            if audit_key in self.audit_records:
                audits_list.append(json.loads(self.audit_records[audit_key]))
                
        ben_addr = self.agent_beneficiaries[agent_id]
        owner_addr = self.agent_owners[agent_id]
        
        state = {
            "id": agent_id,
            "mandate": self.agent_mandates[agent_id],
            "evidence_url": self.agent_evidence_urls[agent_id],
            "bond_remaining": int(self.agent_bonds[agent_id]),
            "status": self.agent_status[agent_id],
            "owner": owner_addr,
            "beneficiary": ben_addr,
            "telemetry_key": self.agent_telemetry_keys[agent_id],
            "audits": audits_list
        }
        return json.dumps(state)

    @gl.public.view
    def get_penalty_pool(self) -> int:
        return int(self.penalty_pool)

    @gl.public.view
    def get_beneficiary_claimable(self, account: str) -> int:
        return int(self.beneficiary_claims.get(account, u256(0)))

    @gl.public.view
    def get_reporter_claimable(self, account: str) -> int:
        return int(self.reporter_claims.get(account, u256(0)))
