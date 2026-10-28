# 2026-10-28 Crew visibility

Owner asked for the community and friends features to be easier to find.

Changed (PWA only, no backend, no model calls):
- Bottom bar is Today, List, Ask, Crew. Profile is no longer a tab.
- The avatar button (top right) opens Profile. Its ring fills toward the next level. The header email and Sign out are gone; both stay in Profile > Account.
- Crew tab: the old Community screen, now led by a friends and Shop-Off summary and links.
- Today shows one Crew card: a friend request, a running Shop-Off, a friend count, or a soft invite.
- Check the list has an optional "race a friend" link; Score has "Challenge a friend to beat this" on a settled hunt.
- Service worker cache arya-v46; 4 new tests, suite 443.

Not built (waiting on the owner): the Muse Image avatar maker and the photo avatar, Store news feed, labelled sample board.

## Second pass: avatar maker, Store news, sample board
- Avatar: 8 cast characters (free, also in the demo), or Muse Image from a description, or Muse Image edits from the player's own photo. A made picture waits as a candidate until Use this. The photo is read into memory, drawn and dropped; the test checks it is never written. Each make is one tap, $0.01, no retries. Demo cannot spend (closed doors).
- Store news: open Not-here reports grouped by store and item, in Crew. Own account only.
- Friends/Store/Global boards and an empty news feed show rows labelled Sample.
- Cache arya-v47, 8 new tests, suite 451.
