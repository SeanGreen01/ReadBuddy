import Reader from "@/components/Reader";
import { ReadingIcon } from "@/components/ReadingIcons";

export default function Home() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#reading-space">Skip to reading</a>
      <header className="site-header">
        <div className="brand"><span className="brand-mark"><ReadingIcon name="book" /></span>ReadBuddy<span className="brand-dot">.</span></div>
        <span className="header-note">A little reading. A little growing.</span>
      </header>
      <main id="reading-space" className="main-content" tabIndex={-1}>
        <div className="welcome">
          <p className="eyebrow">Your reading corner</p>
          <h1>A story, at your pace<span>.</span></h1>
          <p>Get comfy, pick a story, and let’s read together.</p>
        </div>
        <Reader />
      </main>
      <footer className="site-footer">
        <span><ReadingIcon name="leaf" /> Little steps count.</span>
        <details>
          <summary>For parents &amp; grown-ups</summary>
          <p>ReadBuddy is a reading-practice prototype. When the microphone is on,
            audio is sent to ElevenLabs for speech recognition. It can sometimes
            hear words differently. ReadBuddy does not diagnose dyslexia or assess
            reading ability.</p>
        </details>
      </footer>
    </div>
  );
}
