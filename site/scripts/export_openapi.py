"""Write the public Lists API v1 OpenAPI spec to site/static/openapi.json.
Needs `pip install fastapi` (run from anywhere)."""
import json, pathlib, sys
root = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "assistant"))
from api.routes import lists_v1  # noqa: E402
out = root / "site" / "static" / "openapi.json"
spec = lists_v1.v1.openapi()
# On the docs site /developers is not a page; point at the app, and use the current menu path.
d = spec["info"].get("description", "")
d = d.replace("(/developers)", "(https://arya.teamnightshift.org/developers)")
d = d.replace("Settings, Use Arya in another AI app", "Settings, About Arya, Use Arya in Muse")
spec["info"]["description"] = d
out.write_text(json.dumps(spec, indent=2))
print("wrote", out)
