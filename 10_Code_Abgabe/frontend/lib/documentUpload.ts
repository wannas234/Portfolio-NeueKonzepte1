// Single source of truth for which files the learning-material upload accepts.
//
// Backend contract (verified in ../backend, `dev`): the `files` function and the storage
// bucket accept PDF, TXT, PPTX and DOCX up to 50 MiB, but text extraction and indexing
// (`_shared/document-extraction.ts`, `documents-process`) only handle PDF and TXT up to
// MAX_DOCUMENT_BYTES = 10 MiB. Anything else would upload fine and then fail permanently
// with UNSUPPORTED_FORMAT / INVALID_DOCUMENT, so the upload only offers what the whole
// learning workflow can process.
//
// This is UX only: the backend validates type, size and content itself and stays authoritative.

export const DOCUMENT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const SUPPORTED_FORMATS = [
  { extension: "pdf", mimeType: "application/pdf", label: "PDF" },
  { extension: "txt", mimeType: "text/plain", label: "TXT" },
] as const;

export const DOCUMENT_UPLOAD_ACCEPT = SUPPORTED_FORMATS.map((format) => `.${format.extension}`).join(",");

const FORMAT_LIST = SUPPORTED_FORMATS.map((format) => format.label).join(" oder ");
const MAX_MIB = DOCUMENT_UPLOAD_MAX_BYTES / (1024 * 1024);

/** Visible upload hint, e.g. "PDF oder TXT, maximal 10 MiB". */
export const DOCUMENT_UPLOAD_HINT = `${FORMAT_LIST}, maximal ${MAX_MIB} MiB`;

export type DocumentUploadErrorCode = "INVALID_FILE" | "FILE_TOO_LARGE" | "EMPTY_FILE";

/** Codes are shared with the backend `files` function, which reports the same two rejections. */
export const DOCUMENT_UPLOAD_ERROR_MESSAGES: Record<DocumentUploadErrorCode, string> = {
  INVALID_FILE: `Diese Datei wird für Lernunterlagen nicht unterstützt oder ist beschädigt. Erlaubt sind ${FORMAT_LIST}.`,
  FILE_TOO_LARGE: `Die Datei darf maximal ${MAX_MIB} MiB groß sein.`,
  EMPTY_FILE: "Die Datei ist leer.",
};

export type DocumentFileValidation =
  | { ok: true; mimeType: string }
  | { ok: false; code: DocumentUploadErrorCode };

/**
 * The extension decides the format; a browser MIME type may be empty, generic or slightly
 * off, so it is only rejected when it names a *different* supported format (e.g. `.pdf`
 * reported as `text/plain`). Without an extension a supported MIME type is required.
 */
export function validateDocumentFile(file: { name: string; type: string; size: number }): DocumentFileValidation {
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const declared = file.type.split(";")[0].trim().toLowerCase();
  const byExtension = SUPPORTED_FORMATS.find((format) => format.extension === extension);
  const byType = SUPPORTED_FORMATS.find((format) => format.mimeType === declared);

  const format = extension ? byExtension : byType;
  if (!format || (byType && byType.mimeType !== format.mimeType)) return { ok: false, code: "INVALID_FILE" };
  if (file.size <= 0) return { ok: false, code: "EMPTY_FILE" };
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) return { ok: false, code: "FILE_TOO_LARGE" };
  return { ok: true, mimeType: format.mimeType };
}
