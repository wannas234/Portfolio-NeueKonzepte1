import Link from "next/link";
import BrandLogo from "@/components/ui/BrandLogo";
import StudyIcon from "@/components/ui/StudyIcon";
import s from "./landing.module.css";

const features = [
  { title: "Unterlagen organisieren", text: "Alle Materialien an einem Ort.", kind: "document" as const, tone: "blue" },
  { title: "KI-Unterstützung", text: "Zusammenfassungen, Fragen, Karteikarten und mehr.", kind: "chat" as const, tone: "purple" },
  { title: "Besser vorbereitet", text: "Kurse, Noten und Termine immer im Blick.", kind: "calendar" as const, tone: "orange" },
];

function DashboardPreview() {
  return <figure className={s.preview} aria-label="Beispielhafte Vorschau der UniVerse-Übersicht">
    <div className={s.previewSidebar} aria-hidden="true">
      <BrandLogo />
      {["Übersicht", "KI-Assistent", "Kurse", "Kalender", "Unterlagen", "Karteikarten", "Noten", "Profil"].map((label,i)=><div key={label} data-active={i===0}><StudyIcon kind={i===1 ? "chat" : i===3 ? "calendar" : "document"}/><span>{label}</span></div>)}
      <small>Dein Studienraum</small>
    </div>
    <div className={s.previewMain}>
      <div className={s.previewSearch}><span aria-hidden="true">⌕</span> Kurse, Dokumente, Karteikarten … <kbd>⌘K</kbd></div>
      <div className={s.previewHero}><small>GUTEN MORGEN</small><h2>Hallo, test123 <span aria-hidden="true">👋</span></h2><p>Bereit für deine nächste Lerneinheit?</p><div className={s.previewQuote}>„Bildung ist die mächtigste Waffe, um die Welt zu verändern.“<small>— Nelson Mandela</small></div></div>
      <div className={s.previewCards}>
        <div><h3><StudyIcon kind="calendar"/> Nächster Termin <span>›</span></h3><div className={s.eventPreview}><div className={s.previewDate}><small>HEUTE</small><strong>27</strong><span>Sep.</span></div><div><b>Übung 4 – Kryptografie</b><p>IT Sicherheit</p><small>◷ 10:00 – 12:00 Uhr<br/>◎ Online</small></div></div><span className={s.previewTeal}>Details ansehen ›</span></div>
        <div><h3><StudyIcon/> Aktueller Kurs <span>›</span></h3><div className={s.eventPreview}><span className={s.courseBadge}>IS</span><div><b>IT Sicherheit</b><p>12 Unterlagen · 48 Karten</p><div className={s.previewProgress}><i/> <small>64 %</small></div></div></div><span className={s.previewViolet}>Kurs öffnen ›</span></div>
      </div>
    </div>
    <figcaption>Beispielansicht mit Demodaten</figcaption>
  </figure>;
}

export default function LandingPage() {
  return <main className={s.page}>
    <div className={s.stage}>
      <header className={s.header}>
        <Link href="/" aria-label="UniVerse, zur Startseite" className={s.logo}><BrandLogo/></Link>
        <nav className={s.sectionNav} aria-label="Mehr über UniVerse"><a href="#features">Features</a><a href="#fuer-wen">Für wen?</a><a href="#faq">FAQ</a></nav>
        <nav className={s.nav} aria-label="Kontozugang"><Link href="/login" className={s.secondaryButton}>Anmelden</Link><Link href="/register" className={s.primaryButton}>Registrieren <span aria-hidden="true">→</span></Link></nav>
      </header>
      <section className={s.hero} aria-labelledby="hero-title">
        <div className={s.heroCopy}>
          <p className={s.eyebrow}>FÜR STUDIERENDE</p>
          <h1 id="hero-title">Ein Ort für<br/>Vorlesung, Notizen<br/>und <em>Prüfung<span>.</span></em></h1>
          <p className={s.heroSubtitle}>Lade deine Vorlesungsfolien hoch und organisiere sie mit UniVerse in deinen Kursen. Lerne mit KI-Zusammenfassungen und Karteikarten und behalte deine Termine und Prüfungsvorbereitung im Blick.</p>
          <div className={s.heroActions}><Link href="/register" className={s.primaryButton}>Jetzt kostenlos starten <span aria-hidden="true">→</span></Link><a href="#features" className={s.secondaryButton}>Mehr erfahren <span aria-hidden="true">⌄</span></a></div>
        </div>
        <DashboardPreview/>
      </section>
      <div className={s.featureStrip}>{features.map((f)=><div key={f.title}><span className={s.featureIcon} data-tone={f.tone}><StudyIcon kind={f.kind}/></span><div><h2>{f.title}</h2><p>{f.text}</p></div></div>)}</div>
    </div>
    <div className={s.sections}>
      <section id="features" className={s.section} aria-labelledby="features-title"><p className={s.eyebrow}>DEIN STUDIENALLTAG</p><h2 id="features-title">Vom ersten Upload bis zur Prüfung.</h2><div className={s.featureGrid}>{[
        ["01", "Ein Kurs. Alles dabei.", "Sammle Vorlesungsmaterial in deinen Kursen und finde deine Dokumente schnell wieder."],
        ["02", "Verstehen statt nur lesen.", "Stelle Fragen zu deinen Unterlagen. Die KI unterstützt dich mit Erklärungen und Verweisen auf dein Material."],
        ["03", "Wissen, das bleibt.", "Erstelle Zusammenfassungen und Karteikarten aus deinen Unterlagen und wiederhole das Gelernte."],
        ["04", "Dein Studium im Blick.", "Plane Termine im Kalender und behalte deine Prüfungsleistungen und Noten im Überblick."],
      ].map(([number,title,text])=><article key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div></section>
      <section id="fuer-wen" className={`${s.section} ${s.audience}`} aria-labelledby="audience-title"><div><p className={s.eyebrow}>FÜR DEIN STUDIUM</p><h2 id="audience-title">Viel Stoff. Ein klarer Überblick.</h2></div><p>Ob Bachelor oder Master: UniVerse begleitet dich beim Organisieren deiner Vorlesungen, beim Verstehen neuer Inhalte und beim Wiederholen vor der Prüfung. Dein Kurs und deine Unterlagen bleiben dabei der Ausgangspunkt.</p></section>
      <section id="faq" className={s.section} aria-labelledby="faq-title"><p className={s.eyebrow}>GUT ZU WISSEN</p><h2 id="faq-title">Deine Fragen, beantwortet.</h2><div className={s.faq}>{[
        ["Wie starte ich mit UniVerse?", "Erstelle ein Konto, bestätige deine E-Mail-Adresse und lege deinen ersten Kurs an. Anschließend kannst du deine Unterlagen hochladen."],
        ["Welche Dateien kann ich hochladen?", "Aktuell kannst du PDF- und TXT-Dateien mit bis zu 10 MiB pro Datei in deine Kurse hochladen."],
        ["Worauf basieren die KI-Antworten?", "Der Assistent nutzt deine ausgewählten Kursunterlagen und zeigt Quellenbezüge an. KI-Antworten können Fehler enthalten; prüfe wichtige Aussagen anhand deiner Unterlagen."],
        ["Kann ich UniVerse auf dem Smartphone nutzen?", "Ja. Die Weboberfläche passt sich an Smartphone, Tablet und Desktop an. Melde dich im Browser mit deinem Konto an."],
      ].map(([q,a])=><details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>)}</div></section>
      <section className={s.finalCta}><h2>Dein nächster Kurs beginnt hier.</h2><p>Schaffe Platz fürs Lernen.</p><Link className={s.primaryButton} href="/register">Kostenlos loslegen <span aria-hidden="true">→</span></Link></section>
      <footer className={s.footer}><BrandLogo/><span>Dein Studium. Dein UniVerse.</span><a href="#hero-title">Nach oben ↑</a></footer>
    </div>
  </main>;
}
