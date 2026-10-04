import s from "@/components/profile/profile.module.css";

export default function Loading() {
  return (
    <div className={s.page} aria-busy="true" aria-live="polite">
      <p className={s.eyebrow}>07 / PERSÖNLICHER BEREICH</p>
      <h1>Profil wird geladen …</h1>
      <p className={s.intro}>Deine Kontoinformationen werden sicher abgerufen.</p>
      <div className={s.loadingCard} aria-hidden="true" />
    </div>
  );
}
