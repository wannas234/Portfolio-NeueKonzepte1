// Provider-neutral contract. A future Mistral adapter must return this format.
export const EXTRACTION_VERSION = 'visual-blocks-v1';
export type BlockKind = 'text' | 'heading' | 'list' | 'table' | 'formula' | 'figure';
export interface TableCell {
  row: number;
  column: number;
  row_span: number;
  column_span: number;
  header: boolean;
  text: string;
}
export interface DocumentBlock {
  id: string;
  kind: BlockKind;
  start: number;
  end: number;
  // Whole table data is retained even when retrieval uses individual rows.
  cells?: TableCell[];
  row_ends?: number[];
}
export interface DocumentPage {
  page: number;
  text: string;
  native_text?: string;
  route?: 'local' | 'visual';
  reasons?: string[];
  blocks?: DocumentBlock[];
  extraction?: {
    version: string;
    provider: string;
    model: string;
    configuration?: { revision?: string; [key: string]: unknown };
    request_duration_ms?: number;
    retry_wait_ms?: number;
    attempts?: { duration_ms: number; status: number }[];
    warnings: string[];
    // Provider reported unreadable parts (complete=false); readable blocks are kept.
    incomplete?: boolean;
    usage: { input: number | null; output: number | null; thinking: number | null };
  };
}
export interface Extraction {
  text: string;
  pages: DocumentPage[] | null;
}

export function pendingVisualPages(pages: DocumentPage[]): DocumentPage[] {
  return pages.filter((p) => p.route === 'visual' && !p.extraction);
}
