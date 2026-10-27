"""PreparedCart — the list as a sandbox cart (§3). The cart sends no
order and makes no payment; approval is a state change only."""
import time


def prepare(smart_list, names, store="Costco"):
    return {"cart_id": "cart-" + smart_list["list_id"], "list_id": smart_list["list_id"],
            "store": store,
            "items": [{"item_id": i["item_id"], "name": names.get(i["item_id"], i["item_id"]),
                       "qty": i["qty"]} for i in smart_list["items"]],
            "state": "waiting", "approved_at": None}


def approve(cart):
    cart["state"] = "approved"
    cart["approved_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    return cart
