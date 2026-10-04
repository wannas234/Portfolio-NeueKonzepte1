import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { SEED_USER } from "./helpers";

// Real local storage/RPCs; the job transport is controlled here to avoid paid AI calls.
// The real HTTP handlers + worker are separately covered by backend test:quizzes.
test("generate, reload, autosave, resume and reopen quiz results", async ({
  page,
  context,
}) => {
  const url = process.env.E2E_SUPABASE_URL!;
  const service = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  test.skip(
    !service,
    "Local service key required to prepare an indexed test document",
  );
  const admin = createClient(url, service!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const owner = createClient(url, process.env.E2E_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auth = await owner.auth.signInWithPassword(SEED_USER);
  expect(auth.error).toBeNull();
  const created = await owner
    .from("courses")
    .insert({ owner_id: auth.data.user!.id, title: "Quiz browser fixture" })
    .select("id")
    .single();
  expect(created.error).toBeNull();
  const courseId = created.data!.id;
  try {
    const upload = await owner.rpc("prepare_file_upload", {
      p_course_id: courseId,
      p_upload_key: crypto.randomUUID(),
      p_filename: "quiz.txt",
      p_mime: "text/plain",
      p_size: 10,
    });
    expect(upload.error).toBeNull();
    const file = await admin
      .from("files")
      .select("id")
      .eq("course_id", courseId)
      .single();
    expect(file.error).toBeNull();
    const complete = await admin.rpc("complete_file_upload", {
      p_file_id: file.data!.id,
      p_owner_id: auth.data.user!.id,
    });
    expect(complete.error).toBeNull();
    const materialId = complete.data.material_id,
      documentId = complete.data.source_document.id;
    const claim = await admin.rpc("claim_document_processing", {
      p_document_id: documentId,
    });
    expect(claim.error).toBeNull();
    const extracted = await admin.rpc("finish_document_processing", {
      p_document_id: documentId,
      p_lease_token: claim.data.lease_token,
      p_text: "X ist B.",
      p_pages: [{ page: 1, text: "X ist B." }],
    });
    expect(extracted.error).toBeNull();
    const indexing = await admin.rpc("claim_document_indexing", {
      p_document_id: documentId,
    });
    expect(indexing.error).toBeNull();
    const indexed = await admin.rpc("finish_document_indexing_batch", {
      p_document_id: documentId,
      p_lease_token: indexing.data.lease_token,
      p_total_chunks: 1,
      p_embedding_provider: "gemini",
      p_embedding_model: "gemini-embedding-2",
      p_embedding_dimensions: 1536,
      p_chunks: [
        {
          chunk_index: 0,
          content: "X ist B.",
          page_number: 1,
          metadata: {},
          embedding: Array(1536).fill(0.1),
        },
      ],
    });
    expect(indexed.error).toBeNull();
    const chunk = await admin
      .from("document_chunks")
      .select("id")
      .eq("document_id", documentId)
      .single();
    expect(chunk.error).toBeNull();
    let quota = false;
    const requestIds: string[] = [];
    let job: Record<string, unknown> | null = null;
    let quizId: string | null = null;
    await context.route("**/functions/v1/quizzes", async (route) => {
      const body = route.request().postDataJSON();
      expect(body.source_material_id).toBe(materialId);
      if (body.action === "generate") {
        requestIds.push(body.request_id);
        if (quota) {
          await route.fulfill({
            status: 429,
            json: { error: { code: "QUOTA_EXCEEDED" } },
          });
          return;
        }
      }
      if (body.action === "generate")
        job = {
          id: crypto.randomUUID(),
          status: "queued",
          phase: "analyze",
          requested_count: 5,
          generated_count: 0,
          quiz_id: null,
          error_code: null,
          analyzed: 0,
          total: 1,
        };
      await route.fulfill({
        json: body.action === "list" ? (job ? [job] : []) : job,
      });
    });
    await page.goto(`/courses/${courseId}/documents/${file.data!.id}`);
    await page.getByRole("tab", { name: "Tests", exact: true }).click();
    await page
      .getByRole("button", { name: "Test erstellen", exact: true })
      .click();
    await page.getByRole("button", { name: "Erstellen", exact: true }).click();
    await expect(page.getByText("Läuft im Hintergrund")).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "Tests", exact: true }).click();
    await expect(page.getByText("Läuft im Hintergrund")).toBeVisible();
    const saved = await owner.rpc("save_learning_quiz", {
      p_source_material: materialId,
      p_title: "Quiz browser result",
      p_request_id: crypto.randomUUID(),
      p_questions: [
        {
          question: "Was ist X?",
          options: ["A", "B", "C", "D"],
          correctIndex: 1,
          explanation: "X ist B.",
          source_chunk_ids: [chunk.data!.id],
        },
      ],
    });
    expect(saved.error).toBeNull();
    quizId = saved.data.quiz_id;
    job = { ...job!, status: "completed", generated_count: 1, quiz_id: quizId };
    await expect(
      page.getByText("1 von bis zu 5 Fragen erstellt"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Neuer Versuch" }).click();
    await page.getByRole("radio", { name: "B", exact: true }).click();
    await expect(page.getByText("Alle Antworten gespeichert.")).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "Tests", exact: true }).click();
    await page.getByRole("button", { name: /Versuch fortsetzen/ }).click();
    await expect(
      page.getByRole("radio", { name: "B", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Auswerten", exact: true }).click();
    await expect(page.getByText("1 von 1 richtig")).toBeVisible();
    await expect(
      page.getByText("X ist B.", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Seite 1/ })).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "Tests", exact: true }).click();
    await page.getByRole("button", { name: "Ergebnis ansehen: 1/1" }).click();
    await expect(page.getByText("1 von 1 richtig")).toBeVisible();
    await page.getByRole("button", { name: "Zurück zur Übersicht" }).click();
    await page.getByRole("button", { name: "Neuer Versuch" }).click();
    const second = await context.newPage();
    await second.goto(`/courses/${courseId}/documents/${file.data!.id}`);
    await second.getByRole("tab", { name: "Tests", exact: true }).click();
    await second.getByRole("button", { name: /Versuch fortsetzen/ }).click();
    await page.getByRole("radio", { name: "A", exact: true }).click();
    await expect(page.getByText("Alle Antworten gespeichert.")).toBeVisible();
    await second.getByRole("radio", { name: "B", exact: true }).click();
    await expect(
      second.getByText(/Dieser Versuch wurde in einem anderen Tab geändert/),
    ).toBeVisible();
    await second
      .getByRole("button", { name: /Gespeicherten Stand übernehmen/ })
      .click();
    await expect(
      second.getByRole("radio", { name: "A", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await second.close();
    await page
      .getByRole("button", { name: "Zur Übersicht", exact: true })
      .click();
    quota = true;
    await page
      .getByRole("button", { name: "Test erstellen", exact: true })
      .click();
    await page.getByRole("button", { name: "Erstellen", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Quiz-Kontingent" })).toContainText("Quiz-Kontingent");
    await page
      .getByRole("button", { name: "Anfrage erneut versuchen" })
      .click();
    await expect(page.getByRole("alert").filter({ hasText: "Quiz-Kontingent" })).toContainText("Quiz-Kontingent");
    expect(requestIds.at(-1)).toBe(requestIds.at(-2));
  } finally {
    await owner.from("courses").delete().eq("id", courseId);
    await owner.auth.signOut();
  }
});
