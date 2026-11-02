"""Write the public Lists API v1 OpenAPI spec to site/static/openapi.json.
Needs `pip install fastapi` (run from anywhere)."""
import json, pathlib, sys
root = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "assistant"))
from api.routes import lists_v1  # noqa: E402
out = root / "site" / "static" / "openapi.json"
out.write_text(json.dumps(lists_v1.v1.openapi(), indent=2))
print("wrote", out)
