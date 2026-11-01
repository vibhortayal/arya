/* Drawn SVG icons, one stroke weight (DESIGN.md). Inner markup is
 * copied verbatim from the plain-JS app; constants only, never data. */
type P = { size?: number; className?: string };
const make = (inner: string, attrs: { sw?: number; fill?: boolean } = {}) =>
  function Icon({ className }: P) {
    return (
      <svg viewBox="0 0 24 24" fill={attrs.fill ? "currentColor" : "none"} stroke={attrs.fill ? undefined : "currentColor"}
        strokeWidth={attrs.fill ? undefined : attrs.sw ?? 1.8} strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true" className={className} dangerouslySetInnerHTML={{ __html: inner }} />
    );
  };

export const IconMore = make(`<circle cx="5.5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18.5" cy="12" r="2"/>`, { fill: true });
export const IconSearch = make(`<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>`, { sw: 1.8 });
export const IconCheck = make(`<path d="M4.5 12.5 10 18 19.5 6.5"/>`, { sw: 3.2 });
export const IconPen = make(`<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>`);
export const IconSpark = make(`<path d="M12 2.5l2.2 7.3 7.3 2.2-7.3 2.2L12 21.5l-2.2-7.3L2.5 12l7.3-2.2L12 2.5z"/>`, { fill: true });
export const IconBasket = make(`<path d="M8.8 13 11 7.2M15.2 13 13 7.2"/><path d="M3.5 13h17l-1.8 6a2 2 0 0 1-1.9 1.4H7.2A2 2 0 0 1 5.3 19L3.5 13z"/><path d="M9 16.2v2.3M12 16.2v2.3M15 16.2v2.3"/>`);
export const IconMic = make(`<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>`, { sw: 1.7 });
export const IconSpeaker = make(`<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10"/>`, { sw: 1.7 });

/* Today is a calendar day (tab review 2026-11-01): the sparkle is Ask's
 * AI mark, so Today no longer wears it. */
export const TabToday = make(`<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/><circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none"/>`);
export const TabLists = make(`<path d="M10 6h10M10 12h10M10 18h10"/><path d="M3.4 6.2 5 7.8 7.6 4.9M3.4 12.2 5 13.8 7.6 10.9M3.4 18.2 5 19.8 7.6 16.9"/>`);
export const TabAsk = make(`<path d="M4 6.2A2.7 2.7 0 0 1 6.7 3.5h10.6A2.7 2.7 0 0 1 20 6.2v7.6a2.7 2.7 0 0 1-2.7 2.7h-5L7.6 20.5v-4H6.7A2.7 2.7 0 0 1 4 13.8V6.2z"/><path d="M12 6.6l.85 2 2 .85-2 .85-.85 2-.85-2-2-.85 2-.85.85-2z" fill="currentColor" stroke="none"/>`);
export const TabHelp = make(`<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8"/><circle cx="12" cy="16.9" r="0.9" fill="currentColor" stroke="none"/>`);
export const TabSettings = make(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`);
export const TabReceipts = make(`<path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.4z"/><path d="M9 8h6M9 12h6"/>`);
export const TabStores = make(`<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/><path d="M5.5 11.5V20h13v-8.5"/><path d="M10 20v-5h4v5"/>`);
export const TabSpending = make(`<path d="M5 20V11M12 20V5M19 20v-7"/>`);
export const TabQuest = make(`<path d="M5 21V4"/><path d="M5 4.5h11.5l-2.2 3.7 2.2 3.8H5"/>`);
