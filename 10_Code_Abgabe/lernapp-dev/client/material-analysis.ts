import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types.ts';
import type {
  AnalysisContext,
  AnalysisResult,
} from '../supabase/functions/_shared/material-analysis.ts';
export type {
  AnalysisContext,
  AnalysisResult,
  CalendarSuggestion,
} from '../supabase/functions/_shared/material-analysis.ts';

export interface CalendarConfirmation {
  title: string;
  description: string | null;
  kind: 'lecture' | 'exercise' | 'study' | 'presentation' | 'exam' | 'deadline' | 'other';
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
}
export interface AnalysisDecision {
  item_id: string;
  status: 'accepted' | 'dismissed';
  calendar_event_id: string | null;
}
/** Retain request_id on network retries. Failed analyses require a new request_id. */
export function analyzeMaterial(
  client: SupabaseClient<Database>,
  request: {
    request_id: string;
    material_id: string;
    context?: Partial<AnalysisContext>;
  },
) {
  return client.functions.invoke<AnalysisResult>('material-analysis', {
    body: { ...request, action: 'analyze' },
  });
}
export function getMaterialAnalysis(client: SupabaseClient<Database>, analysisId: string) {
  return client.functions.invoke<AnalysisResult>('material-analysis', {
    body: { action: 'result', analysis_id: analysisId },
  });
}
export function acceptAnalysisItem(
  client: SupabaseClient<Database>,
  analysisId: string,
  itemId: string,
  event: CalendarConfirmation,
) {
  return client.functions.invoke<AnalysisDecision>('material-analysis', {
    body: { action: 'accept', analysis_id: analysisId, item_id: itemId, event },
  });
}
export function dismissAnalysisItem(
  client: SupabaseClient<Database>,
  analysisId: string,
  itemId: string,
) {
  return client.functions.invoke<AnalysisDecision>('material-analysis', {
    body: { action: 'dismiss', analysis_id: analysisId, item_id: itemId },
  });
}
