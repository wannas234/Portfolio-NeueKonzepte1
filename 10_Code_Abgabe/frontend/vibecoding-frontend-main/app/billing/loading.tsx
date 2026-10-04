import s from "@/components/billing/billing.module.css";

export default function Loading() {
  return (
    <div className={s.page} aria-busy="true" aria-live="polite">
      <p className={s.eyebrow}>ABO</p>
      <h1>Abo wird geladen …</h1>
      <p className={s.intro}>Dein Abo-Status wird sicher abgerufen.</p>
      <div className={s.loadingCard} aria-hidden="true" />
    </div>
  );
}
