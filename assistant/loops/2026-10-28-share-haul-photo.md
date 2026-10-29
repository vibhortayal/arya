# 2026-10-28 · Share a finished haul as a photo (owner request)

Owner wanted hauls to be shareable to Instagram, Facebook and WhatsApp.
Wireframe approved first (option A, photo only). No video.

## What changed
- `pwa/share.js`: the haul card is a still PNG (Story 1080x1920 or Post
  1080x1350). Recording to .webm is gone, so are the animation and
  `captureStream`. Options on the sheet: show handle, show level, haul
  photo (off by default), Save image, Copy caption, Share (the phone's
  own share sheet; Save image is the fallback).
- Make it special with Arya: Add my badge (only for a badge earned on
  this haul), Cast joins in, Storybook. The phone draws the art layer
  (cream ground + cast stickers, no words, no photo) and posts it to
  `POST /api/quest/share-look`; Muse Image paints it; the phone draws
  the words on top. Try another and Plain are always one tap away.
- Footer: "Made with Arya"; "Powered by Meta Muse" is added only when
  Muse painted the card. Plain text, no Meta logo.
- `api/sharelook.py` + the route: fixed prompt per look, nothing the
  player typed reaches the model, the upload is not stored. $0.01 per
  tap; counted as a demo live door.
- Fixed a hang: two stickers sharing one image replaced each other's
  onload, so the card never finished loading.

## Not done / open
- Not run against live Muse: tests fake the model. Check on a phone that
  Muse keeps the sticker positions and the calm top and bottom bands.
- A haul photo is the player's own and is NOT scrubbed of people (no SAM
  pass yet). It is off by default and switches the Muse looks off.
- Badge look needs a badge earned on this haul (the Score screen's New
  pill); reopening Score later has none.
- Share-link page (Open Graph) is not built; that was variant B.
