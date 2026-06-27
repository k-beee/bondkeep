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

    @gl.public.view
    def get_agent(self, agent_id: str) -> str:
        if agent_id not in self.agent_status:
            return "{}"
        state = {
            "id": agent_id,
            "mandate": self.agent_mandates[agent_id],
            "evidence_url": self.agent_evidence_urls[agent_id],
            "bond_remaining": int(self.agent_bonds[agent_id]),
            "status": self.agent_status[agent_id],
            "audits": []
        }
        return json.dumps(state)

