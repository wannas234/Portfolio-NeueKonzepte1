"use client";

import type { ReactNode } from "react";
import type { IndexingProgress } from "./documentIndexing";
import styles from "./coursesList.module.css";

const ICONS: Record<IndexingProgress["tone"], string> = {
  pending: "•",
  active: "•",
  ready: "✓",
  failed: "✕",
};

/**
 * One status line per uploaded file: a progress bar while the backend is still
 * extracting and indexing, a check mark once the document is searchable, and a
 * cross with the reason when a stage failed.
 */
export default function DocumentIndexingStatus({
  fileName,
  progress,
  action,
}: {
  fileName: string;
  progress: IndexingProgress;
  action?: ReactNode;
}) {
  const showBar = progress.tone === "pending" || progress.tone === "active";

  return (
    <div className={styles.indexStatus} data-tone={progress.tone} role="status">
      <span className={styles.indexIcon} aria-hidden="true">
        {ICONS[progress.tone]}
      </span>
      <div className={styles.indexBody}>
        <span className={styles.indexLabel}>{progress.label}</span>
        {showBar && (
          <div
            className={styles.indexTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress.percent}
            aria-label={`Verarbeitungsfortschritt von ${fileName}`}
          >
            <div className={styles.indexFill} style={{ width: `${progress.percent}%` }} />
          </div>
        )}
        {progress.detail && <span className={styles.indexDetail}>{progress.detail}</span>}
        {action}
      </div>
    </div>
  );
}
