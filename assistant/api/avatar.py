"""Avatar (owner, 2026-10-28): one avatar for the whole app. A
character from the cast, a Muse Image picture from a description, or
a Muse Image picture made from the player's own photo. The same
avatar hosts the haul cards and the love note.

Photo rule: the photo is read once, sent to Muse Image to be drawn as
a cartoon, and dropped. Only the drawing is kept; the original is
never written to disk. A made picture waits as a candidate until the
player taps Use this, so a try-again never replaces a chosen avatar.
"""
import os

from api import quest, state

CUSTOM = "custom"   # quest.avatar value when the drawn picture is the avatar
PROMPT_MAX = 200
STYLE = ("Friendly flat cartoon avatar, one subject centred in a circle, "
         "soft colours, plain background, no text. Subject: ")
PHOTO_STYLE = ("Redraw the person in this photo as a friendly flat cartoon "
               "avatar, head and shoulders, centred, soft colours, plain "
               "background, no text.")


def _file(name):
    return os.path.join(state.data_dir(), name)


def get():
    """One avatar: quest.avatar holds a cast portrait file, or CUSTOM
    when a drawn picture is in use. Haul cards, the love note and the
    header all read this one field."""
    file = quest.my_avatar()
    s = state._load("avatar.json", {})
    return {"file": file,
            "image": file == CUSTOM and os.path.exists(_file("avatar.webp")),
            "version": s.get("version", 0),
            "candidate": os.path.exists(_file("avatar-candidate.webp"))}


def _write(name, data):
    os.makedirs(state.data_dir(), exist_ok=True)
    with open(_file(name), "wb") as f:
        f.write(data)


def read_image(candidate=False):
    path = _file("avatar-candidate.webp" if candidate else "avatar.webp")
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return f.read()


def make_from_prompt(prompt, client):
    prompt = " ".join(str(prompt or "").split())
    if not prompt:
        raise ValueError("describe your avatar first")
    if len(prompt) > PROMPT_MAX:
        raise ValueError(f"keep the description under {PROMPT_MAX} characters")
    img, _, cost = client.generate_image(STYLE + prompt)
    _write("avatar-candidate.webp", img)
    return cost


def make_from_photo(photo, media_type, client):
    """The photo bytes live only in this call's memory."""
    img, _, cost = client.edit_image(photo, PHOTO_STYLE, media_type)
    _write("avatar-candidate.webp", img)
    return cost


def use_candidate():
    img = read_image(candidate=True)
    if img is None:
        raise ValueError("nothing to use yet, make one first")
    _write("avatar.webp", img)
    os.remove(_file("avatar-candidate.webp"))
    s = state._load("avatar.json", {})
    s["version"] = s.get("version", 0) + 1
    state._save("avatar.json", s)
    with state.file_lock("quest.json"):
        q = quest._store()
        q["avatar"] = CUSTOM
        quest._save_store(q)
    return get()
