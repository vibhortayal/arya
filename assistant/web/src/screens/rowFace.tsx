import { asset } from "../lib/format";
import { charFor } from "../lib/characters";

/* A row's character picture. With onOpen it opens the same page as the
 * row's name link (owner, 2026-11-04: "clicking the characters on all
 * cards should open the same link as the text"). It stays out of the
 * tab order and screen readers: the name link is the one stop. */
export function Face({ name, onOpen }: { name: unknown; onOpen?: () => void }) {
  const c = charFor(name);
  if (!c) return null;
  const img = <img className="rowface" src={asset(`assets/characters/${c}`)} alt="" />;
  if (!onOpen) return img;
  return (
    <a href="#" className="facelink" aria-hidden="true" tabIndex={-1}
      onClick={ev => { ev.preventDefault(); onOpen(); }}>{img}</a>
  );
}
