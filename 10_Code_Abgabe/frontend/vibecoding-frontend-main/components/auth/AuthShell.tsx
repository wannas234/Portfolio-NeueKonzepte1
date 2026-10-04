import Link from "next/link";
import BrandLogo from "@/components/ui/BrandLogo";
import StudyIcon from "@/components/ui/StudyIcon";
import styles from "./auth.module.css";

type Variant = "login" | "register" | "forgot";
const content = {
  login: { eyebrow: "WILLKOMMEN ZURÜCK", title: <>Schön, dass<br />du wieder hier bist.</>, description: "Melde dich an, um bei deinen Unterlagen weiterzumachen." },
  register: { eyebrow: "LOS GEHT’S", title: <>Konto<br />erstellen<span>.</span></>, description: "Zwei Minuten Einrichtung, dann läuft dein erster Kurs." },
  forgot: { eyebrow: "KEIN PROBLEM", title: <>Passwort<br />vergessen?</>, description: "Gib deine E-Mail-Adresse ein. Wir senden dir einen sicheren Link zum Zurücksetzen deines Passworts." },
};
export default function AuthShell({ children, variant }: { children: React.ReactNode; variant?: Variant }) {
  const intro = variant ? content[variant] : null;
  return <main className={styles.page} data-variant={variant ?? "compact"} lang="de">
    <header className={styles.header}>
      <Link href="/" className={styles.logo} aria-label="UniVerse, zur Startseite"><BrandLogo /></Link>
      {variant === "register" ? <p className={styles.headerLink}>Du hast bereits ein Konto? <Link href="/login">Anmelden</Link></p>
        : <Link className={styles.backLink} href={variant === "forgot" ? "/login" : "/"}><span aria-hidden="true">←</span> {variant === "forgot" ? "Zurück zur Anmeldung" : "Zurück zur Startseite"}</Link>}
    </header>
    <div className={styles.layout}>
      {intro && <section className={styles.intro}>
        <p className={styles.eyebrow}>{intro.eyebrow}</p>
        <h1>{intro.title}</h1>
        <p className={styles.introText}>{intro.description}</p>
        {variant !== "forgot" && <ul className={styles.benefits}>
          <li><span className={styles.benefitIcon} data-tone={variant === "register" ? "blue" : "purple"}><StudyIcon kind={variant === "register" ? "shield" : "document"}/></span><div><strong>{variant === "register" ? "Schnell und kostenlos" : "Deine Unterlagen immer dabei"}</strong><p>{variant === "register" ? "In wenigen Minuten startklar" : "Auf allen Geräten verfügbar"}</p></div></li>
          <li><span className={styles.benefitIcon} data-tone={variant === "register" ? "blue" : "purple"}><StudyIcon kind="chat"/></span><div><strong>{variant === "register" ? "Alle Lernmaterialien an einem Ort" : "KI-Unterstützung beim Lernen"}</strong><p>{variant === "register" ? "Einfaches Hochladen und Organisieren" : "Zusammenfassen, Fragen, Karteikarten"}</p></div></li>
          <li><span className={styles.benefitIcon} data-tone={variant === "register" ? "orange" : "blue"}><StudyIcon kind="calendar"/></span><div><strong>{variant === "register" ? "Besser vorbereitet" : "Kurse, Termine und Noten im Blick"}</strong><p>{variant === "register" ? "Mit KI, Karteikarten und Terminen" : "Alles an einem Ort"}</p></div></li>
        </ul>}
      </section>}
      <div className={styles.card}>{children}</div>
    </div>
  </main>;
}
