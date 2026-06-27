# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

class BondKeep(gl.Contract):
    # Fiduciary covenants mappings (gas-optimized state representation)
    agent_mandates: TreeMap[str, str]       # agent_id -> natural language mandate
    agent_evidence_urls: TreeMap[str, str]  # agent_id -> URL for behavior logs
    agent_bonds: TreeMap[str, u256]          # agent_id -> remaining bond in cents
    agent_status: TreeMap[str, str]         # agent_id -> "ACTIVE" | "FROZEN"
    
    # Audit tracking mappings
    audit_counts: TreeMap[str, u256]         # agent_id -> count of audits
    audit_records: TreeMap[str, str]        # f"{agent_id}#{audit_index}" -> JSON-serialized audit result
    
    # Platform metrics
    penalty_pool: u256                      # Slashed funds pool
    violation_threshold: u256               # Severity score threshold to freeze & slash

    def __init__(self):
        # Platform configurations (do not assign TreeMap/DynArray here to avoid compiler errors)
        self.penalty_pool = u256(0)
        self.violation_threshold = u256(60)

    @gl.public.write
    def register_agent(self, agent_id: str, mandate: str,
                       evidence_url: str, bond: int) -> str:
        if agent_id in self.agent_status:
            return self.get_agent(agent_id)
            
        self.agent_mandates[agent_id] = mandate
        self.agent_evidence_urls[agent_id] = evidence_url
        self.agent_bonds[agent_id] = u256(int(bond))
        self.agent_status[agent_id] = "ACTIVE"
        self.audit_counts[agent_id] = u256(0)
        
        return self.get_agent(agent_id)

    @gl.public.write
    def top_up_bond(self, agent_id: str, amount: int) -> str:
        if agent_id not in self.agent_status:
            return "{}"
        if int(amount) <= 0:
            return self.get_agent(agent_id)
            
        status = self.agent_status[agent_id]
        if status == "ACTIVE":
            current_bond = int(self.agent_bonds[agent_id])
            self.agent_bonds[agent_id] = u256(current_bond + int(amount))
            
        return self.get_agent(agent_id)

    @gl.public.write
    def audit(self, agent_id: str, reporter: str) -> str:
        if agent_id not in self.agent_status:
            return "{}"
        if self.agent_status[agent_id] == "FROZEN":
            return self.get_agent(agent_id)
            
        mandate = self.agent_mandates[agent_id]
        ev_url = self.agent_evidence_urls[agent_id]
        
        def leader_fn():
            behavior = ""
            if ev_url:
                behavior = gl.nondet.web.render(ev_url, mode="text")
            task = (
                "You are an AI fiduciary watchdog auditing an autonomous AI Agent.\n"
                f"Agent Mandate (rules & obligations): {mandate}\n"
                f"Agent Recent Behavior Logs: {behavior[:3000]}\n"
                "Evaluate if the agent is acting within its mandate. Identify deviation, abuse, or fraud.\n"
                "Provide a severity score (0 to 100) and a slash ratio (0 to 100, representing percent of bond to slash).\n"
                "Determine the verdict: COMPLIANT, WARNING, or VIOLATION.\n"
                "Return a JSON object with this exact shape:\n"
                '{"verdict": "COMPLIANT"|"WARNING"|"VIOLATION", "severity": <int 0-100>, "slash_ratio": <int 0-100>, "reasoning": "brief explanation"}'
            )
            response = gl.nondet.exec_prompt(task, response_format="json")
            return json.loads(response)

        def validator_fn(leader_result) -> bool:
            return isinstance(leader_result, gl.vm.Return)

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        
        try:
            report = result if isinstance(result, dict) else json.loads(result)
            if not isinstance(report, dict):
                report = {"verdict": "WARNING", "severity": 0, "slash_ratio": 0, "reasoning": "Invalid format"}
        except Exception as e:
            report = {"verdict": "WARNING", "severity": 0, "slash_ratio": 0, "reasoning": f"Parse error: {str(e)}"}
            
        severity = int(report.get("severity", 0))
        slash_ratio = int(report.get("slash_ratio", 0))
        verdict = report.get("verdict", "WARNING")
        
        slashed = 0
        current_bond = int(self.agent_bonds[agent_id])
        if severity >= int(self.violation_threshold):
            self.agent_status[agent_id] = "FROZEN"
            slashed = current_bond * slash_ratio // 100
            self.agent_bonds[agent_id] = u256(current_bond - slashed)
            self.penalty_pool = u256(int(self.penalty_pool) + slashed)
            
        audit_idx = int(self.audit_counts.get(agent_id, u256(0)))
        audit_data = {
            "reporter": reporter,
            "verdict": verdict,
            "severity": severity,
            "slashed": slashed,
            "reasoning": report.get("reasoning", "")
        }
        
        self.audit_records[f"{agent_id}#{audit_idx}"] = json.dumps(audit_data)
        self.audit_counts[agent_id] = u256(audit_idx + 1)
        
        return self.get_agent(agent_id)

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
                
        state = {
            "id": agent_id,
            "mandate": self.agent_mandates[agent_id],
            "evidence_url": self.agent_evidence_urls[agent_id],
            "bond_remaining": int(self.agent_bonds[agent_id]),
            "status": self.agent_status[agent_id],
            "audits": audits_list
        }
        return json.dumps(state)

    @gl.public.view
    def get_penalty_pool(self) -> int:
        return int(self.penalty_pool)


