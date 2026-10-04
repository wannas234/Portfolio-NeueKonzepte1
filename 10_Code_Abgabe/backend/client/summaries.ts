import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.ts';

export type SummaryTarget =
  { type: 'document'; source_document_id: string } | { type: 'course'; course_id: string };
export interface GenerateSummaryRequest {
  request_id: string;
  target: SummaryTarget;
}
export interface SummaryJobStatus {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  phase: 'queued' | 'sections' | 'document' | 'course' | 'completed' | 'failed';
  completed_steps: number;
  total_steps: number;
  summary_id: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}
export interface SummaryResult {
  summary_id: string;
  material_id: string;
  target: { type: 'document' | 'course'; course_id: string; source_document_id: string | null };
  content: {
    version: 1;
    language: 'de';
    text: string;
    sections: { heading: string; text: string; source_ids: string[] }[];
    sources: {
      id: string;
      source_document_id: string;
      material_id: string;
      title: string;
      page: number | null;
    }[];
  };
  sources: { id: string; material_id: string; file_id: string; title: string }[];
  created_at: string;
  is_stale: boolean;
}
export interface SummaryFailure {
  error: { code: string; details?: { source_document_ids: string[] } };
}
/** Keep request_id unchanged on network retries. A new source version needs a new request_id. */
export function generateSummary(client: SupabaseClient<Database>, request: GenerateSummaryRequest) {
  return client.functions.invoke<SummaryJobStatus>('summaries', {
    body: { ...request, action: 'generate' },
  });
}
export function getSummaryJob(client: SupabaseClient<Database>, jobId: string) {
  return client.functions.invoke<SummaryJobStatus>('summaries', {
    body: { action: 'status', job_id: jobId },
  });
}
export function getSummaryResult(client: SupabaseClient<Database>, summaryId: string) {
  return client.functions.invoke<SummaryResult>('summaries', {
    body: { action: 'result', summary_id: summaryId },
  });
}
export function retrySummaryJob(client: SupabaseClient<Database>, jobId: string) {
  return client.functions.invoke<SummaryJobStatus>('summaries', {
    body: { action: 'retry', job_id: jobId },
  });
}
