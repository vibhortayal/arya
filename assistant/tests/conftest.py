import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def one_list(c, name="Groceries"):
    """Every item lives on a list (owner, 2026-11-02): an account that
    adds items in a test starts with one list, so adds file there the
    way they do for a shopper with one list."""
    r = c.post("/api/lists", json={"name": name, "stores": []})
    assert r.status_code == 200, r.text
    return r.json()
