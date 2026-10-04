"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { loadUsage, type UsageOverview as Usage } from "@/lib/usage";
import { formatBytes, formatResetDate, usageRatio, usageRemaining, usageTone } from "@/lib/usage-format";
import s from "./billing.module.css";

/**
 * Der eigene Verbrauch im laufenden Monat.
 *
 * Reine Anzeige: Die Grenzen setzt die Datenbank durch, nicht dieses Bauteil. Eine
 * Aktion kann deshalb auch dann abgelehnt werden, wenn hier noch Luft zu sehen ist —
 * etwa weil parallel in einem anderen Tab verbraucht wurde.
 */
export default function UsageOverview() {
  const [usage, setUsage] = useState<Usage | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    loadUsage(createClient())
      .then((loaded) => { if (active) setUsage(loaded); })
      .catch(() => { if (active) setUsage(null); });
    return () => { active = false; };
  }, []);

  if (usage === undefined) {
    return <p className={s.statusMessage} aria-live="polite">Verbrauch wird geladen …</p>;
  }
  // Ohne Daten lieber nichts behaupten als Nullen zeigen, die wie „nichts verbraucht“ aussehen.
  if (usage === null) return null;

  const resets = formatResetDate(usage.resetsAt);
  const grace = formatResetDate(usage.graceUntil);

  return (
    <section className={s.usage} aria-labelledby="usage-heading">
      <div className={s.usageHead}>
        <h2 id="usage-heading">Dein Verbrauch</h2>
        <p>
          Tarif {usage.plan === "pro" ? "Pro" : "Gratis"}
          {resets && ` · neue Kontingente am ${resets}`}
        </p>
      </div>

      {grace && (
        <p className={s.usageGrace} role="status">
          Deine letzte Zahlung ist fehlgeschlagen. Pro bleibt noch bis zum {grace} aktiv,
          danach gilt das Gratis-Kontingent.
        </p>
      )}

      <ul className={s.usageList}>
        {usage.entries.map((entry) => {
          const tone = usageTone(entry.used, entry.limit);
          const percent = Math.round(usageRatio(entry.used, entry.limit) * 100);
          return (
            <li key={entry.kind}>
              <div className={s.usageRow}>
                <span>{entry.label}</span>
                <span className={s.usageCount} data-tone={tone}>
                  {entry.limit === 0 ? "Im Gratis-Tarif gesperrt" : `${entry.used} / ${entry.limit}`}
                </span>
              </div>
              <div
                className={s.usageTrack}
                role="progressbar"
                aria-label={entry.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span className={s.usageBar} data-tone={tone} style={{ width: `${percent}%` }} />
              </div>
              {usage.plan === "free" && entry.proLimit > entry.limit && (
                <p className={s.usageHint}>Mit Pro: {entry.proLimit}</p>
              )}
            </li>
          );
        })}

        <li>
          <div className={s.usageRow}>
            <span>Speicher</span>
            <span className={s.usageCount} data-tone={usageTone(usage.storage.usedBytes, usage.storage.limitBytes)}>
              {formatBytes(usage.storage.usedBytes)} / {formatBytes(usage.storage.limitBytes)}
            </span>
          </div>
          <div
            className={s.usageTrack}
            role="progressbar"
            aria-label="Speicher"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usageRatio(usage.storage.usedBytes, usage.storage.limitBytes) * 100)}
          >
            <span
              className={s.usageBar}
              data-tone={usageTone(usage.storage.usedBytes, usage.storage.limitBytes)}
              style={{ width: `${Math.round(usageRatio(usage.storage.usedBytes, usage.storage.limitBytes) * 100)}%` }}
            />
          </div>
          <p className={s.usageHint}>
            {usage.plan === "free" && usage.storage.proLimitBytes > usage.storage.limitBytes
              ? `Mit Pro: ${formatBytes(usage.storage.proLimitBytes)}`
              : `Noch ${formatBytes(usageRemaining(usage.storage.usedBytes, usage.storage.limitBytes))} frei`}
          </p>
        </li>
      </ul>

      <p className={s.usageFoot}>
        Gelöschte Dateien geben Speicher sofort frei, die monatlichen Uploads aber nicht —
        die Verarbeitung hat bereits stattgefunden.
      </p>
    </section>
  );
}
