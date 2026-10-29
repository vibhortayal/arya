import { useNav } from "../app/nav";

/* Port of pwa/index.html #view-about. Back lands on Profile. */
export function About() {
  const nav = useNav();
  return (
    <section id="view-about" className="view">
      <p><a href="#" id="pfa-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}>‹ Back</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>About</h2>
      <div className="group pad">
        <p className="nomargin">Built by <a href="https://www.linkedin.com/in/vibhortayal" target="_blank" rel="noopener">Vibhor Tayal</a>.</p>
        <p className="muted" style={{ marginTop: 8 }}>Built on Meta models: SAM 3.1 finds the shelves, Muse Spark reads lists and labels the shelves, Muse Wonder reads receipt photos, Muse Voice Transcribe takes dictation, and Muse Image drew the characters that cheer each grab.</p>
      </div>
    </section>
  );
}
