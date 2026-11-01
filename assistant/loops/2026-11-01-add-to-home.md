# 2026-11-01 Landing: Add Arya to your Home Screen

Owner: shoppers don't read "iPhone and Android apps coming soon". Approved mockup (/mnt/project-files/arya-add-to-home-mockup/).

- The landing footer's line and the two store badges are gone. In their place, `A2hsLandCard` (ui/A2hs.tsx): "Add Arya to your Home Screen. Free, no app store. Opens full screen, like an app." with Install (the browser's prompt, where offered) or Show me how. Shown on iPhone and Android only, never once installed; computers keep the "made for your phone" line.
- The steps sheet has an iPhone / Android switch, starting on the phone's kind. Android: menu ⋮, Add to Home screen or Install app, Install. The iPhone-only tip shows only on iPhone.
- Android phones without the browser's prompt now get the steps everywhere (Today card, About Arya row, the header pill), not nothing.
- Help topic "Put Arya on your Home Screen" (opens About Arya); `arya_features.md` "Get the app" line.

Tests: getapp.test.tsx (card, switch, hidden when installed or on a computer, no coming-soon line); Python test_add_to_home_screen reads the iPhone list. vitest green; Python has the same 12 failures as main. Checked at 390x844 with this build on the live site as iPhone, Android and desktop, plus the Help topic in the demo; no page errors.
