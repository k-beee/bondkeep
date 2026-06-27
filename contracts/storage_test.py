# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

class StorageTest(gl.Contract):
    notes: TreeMap[str, str]
    count: u256

    def __init__(self):
        self.count = u256(0)

    @gl.public.write
    def put(self, k: str, v: str) -> None:
        self.notes[k] = v
        self.count = u256(int(self.count) + 1)

    @gl.public.view
    def get(self, k: str) -> str:
        if k not in self.notes:
            return ""
        return self.notes[k]
