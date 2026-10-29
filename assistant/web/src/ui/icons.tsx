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

export const IconCheck = make(`<path d="M4.5 12.5 10 18 19.5 6.5"/>`, { sw: 3.2 });
export const IconPen = make(`<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>`);
export const IconSpark = make(`<path d="M12 2.5l2.2 7.3 7.3 2.2-7.3 2.2L12 21.5l-2.2-7.3L2.5 12l7.3-2.2L12 2.5z"/>`, { fill: true });
export const IconBasket = make(`<path d="M8.8 13 11 7.2M15.2 13 13 7.2"/><path d="M3.5 13h17l-1.8 6a2 2 0 0 1-1.9 1.4H7.2A2 2 0 0 1 5.3 19L3.5 13z"/><path d="M9 16.2v2.3M12 16.2v2.3M15 16.2v2.3"/>`);
export const IconMic = make(`<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>`, { sw: 1.7 });
export const IconSpeaker = make(`<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10"/>`, { sw: 1.7 });

export const TabToday = make(`<path d="M12 3l2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1L12 3z"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>`);
export const TabLists = make(`<path d="M10 6h10M10 12h10M10 18h10"/><path d="M3.4 6.2 5 7.8 7.6 4.9M3.4 12.2 5 13.8 7.6 10.9M3.4 18.2 5 19.8 7.6 16.9"/>`);
export const TabAsk = make(`<path d="M4 6.2A2.7 2.7 0 0 1 6.7 3.5h10.6A2.7 2.7 0 0 1 20 6.2v7.6a2.7 2.7 0 0 1-2.7 2.7h-5L7.6 20.5v-4H6.7A2.7 2.7 0 0 1 4 13.8V6.2z"/><path d="M12 6.6l.85 2 2 .85-2 .85-.85 2-.85-2-2-.85 2-.85.85-2z" fill="currentColor" stroke="none"/>`);
export const TabQuest = make(`<path d="M5 21V4"/><path d="M5 4.5h11.5l-2.2 3.7 2.2 3.8H5"/>`);
