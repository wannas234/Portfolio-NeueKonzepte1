import assert from "node:assert/strict";
import { test } from "node:test";
import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  BillingError,
  billingErrorMessage,
  describeBilling,
  describeProCard,
  hasProAccess,
  loadOwnSubscription,
  parseStripeRedirect,
  PRO_PRICE_LABEL,
  requestStripeRedirect,
  waitForProAccess,
} from "./billing.ts";

const sub = (status, extra = {}) => ({
  status,
  currentPeriodEnd: "2027-01-15T08:00:00.000Z",
  cancelAtPeriodEnd: false,
  hasStripeSubscription: true,
  ...extra,
});

test("Pro-Zugriff gibt es ausschließlich bei den DB-Status active und trialing", () => {
  assert.equal(hasProAccess(sub("active")), true);
  assert.equal(hasProAccess(sub("trialing")), true);
  for (const status of ["past_due", "unpaid", "paused", "incomplete", "incomplete_expired", "canceled", "irgendwas", ""]) {
    assert.equal(hasProAccess(sub(status)), false, status);
  }
  assert.equal(hasProAccess(null), false);
});

test("Ansicht: ohne Abo oder mit Platzhalter wird der Abschluss angeboten, sonst nicht", () => {
  for (const none of [null, sub("incomplete", { hasStripeSubscription: false, currentPeriodEnd: null })]) {
    const view = describeBilling(none);
    assert.equal(view.canSubscribe, true);
    assert.equal(view.canManage, false);
    assert.equal(view.tone, "none");
  }
  for (const ended of ["canceled", "incomplete_expired"]) {
    const view = describeBilling(sub(ended));
    assert.equal(view.canSubscribe, true, ended);
    assert.equal(view.canManage, false, ended);
    assert.equal(view.tone, "ended");
  }
});

test("Ansicht: active und trialing bieten nur die Verwaltung an, nie einen zweiten Abschluss", () => {
  for (const status of ["active", "trialing"]) {
    const view = describeBilling(sub(status));
    assert.equal(view.canSubscribe, false, status);
    assert.equal(view.canManage, true, status);
    assert.equal(view.manageLabel, "Abo verwalten");
    assert.equal(view.tone, "pro");
  }
});

test("Ansicht: Zahlungsprobleme führen ins Portal statt in einen zweiten Abschluss und schalten Pro nicht frei", () => {
  for (const status of ["past_due", "unpaid", "paused", "incomplete"]) {
    const view = describeBilling(sub(status));
    assert.equal(view.canSubscribe, false, status);
    assert.equal(view.canManage, true, status);
    assert.equal(hasProAccess(sub(status)), false, status);
  }
  assert.equal(describeBilling(sub("past_due")).manageLabel, "Zahlungsdaten aktualisieren");
  assert.equal(describeBilling(sub("incomplete")).tone, "pending");
});

test("Ansicht: unbekannte Status schalten nie Pro frei und bieten keinen Abschluss an", () => {
  const view = describeBilling(sub("neuer_status"));
  assert.equal(view.canSubscribe, false);
  assert.equal(hasProAccess(sub("neuer_status")), false);
  assert.equal(describeBilling(sub("neuer_status", { hasStripeSubscription: false })).canManage, false);
});

test("Ansicht: Verlängerung und Kündigung zum Periodenende werden mit deutschem Datum erklärt", () => {
  assert.match(describeBilling(sub("active")).detail, /verlängert sich am 15\. Januar 2027/);
  const cancelling = describeBilling(sub("active", { cancelAtPeriodEnd: true }));
  assert.match(cancelling.detail, /gekündigt und läuft am 15\. Januar 2027 aus/);
  assert.equal(cancelling.canManage, true);
  assert.match(describeBilling(sub("trialing")).detail, /Testphase endet am 15\. Januar 2027/);
  assert.doesNotMatch(describeBilling(sub("active", { currentPeriodEnd: "kaputt" })).detail, /Invalid|NaN/);
  assert.doesNotMatch(describeBilling(sub("active", { currentPeriodEnd: null })).detail, /null|undefined/);
});

test("Weiterleitungen werden nur zu den erwarteten Stripe-Seiten befolgt", () => {
  const good = "https://checkout.stripe.com/c/pay/cs_test_123#frag";
  assert.equal(parseStripeRedirect("checkout", good), good);
  assert.equal(parseStripeRedirect("portal", "https://billing.stripe.com/p/session/test_1"), "https://billing.stripe.com/p/session/test_1");
  for (const bad of [
    "http://checkout.stripe.com/c/pay/x",
    "https://checkout.stripe.com.evil.example/c/pay/x",
    "https://evil.example/https://checkout.stripe.com",
    "https://user:pass@checkout.stripe.com/c/pay/x",
    "https://billing.stripe.com/p/session/x", // Portal-URL für den Checkout
    "javascript:alert(1)",
    "//checkout.stripe.com/x",
    "/billing",
    "",
    null,
    undefined,
    42,
    { url: good },
  ]) {
    assert.throws(() => parseStripeRedirect("checkout", bad), (error) => error instanceof BillingError && error.code === "INVALID_RESPONSE", String(bad));
  }
  assert.throws(() => parseStripeRedirect("portal", good), BillingError, "Checkout-URL für das Portal");
});

function clientWith(invoke, session = { access_token: "user-jwt" }) {
  return { auth: { getSession: async () => ({ data: { session }, error: null }) }, functions: { invoke } };
}
const httpError = (status, body) =>
  new FunctionsHttpError(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

test("Checkout und Portal rufen die richtige Function mit dem Nutzer-JWT auf", async () => {
  const calls = [];
  const client = clientWith(async (name, options) => {
    calls.push({ name, options });
    return { data: { url: name === "create-checkout-session" ? "https://checkout.stripe.com/c/pay/cs_1" : "https://billing.stripe.com/p/session/s_1" }, error: null };
  });
  assert.equal(await requestStripeRedirect(client, "checkout"), "https://checkout.stripe.com/c/pay/cs_1");
  assert.equal(await requestStripeRedirect(client, "portal"), "https://billing.stripe.com/p/session/s_1");
  assert.deepEqual(calls.map((call) => call.name), ["create-checkout-session", "create-portal-session"]);
  for (const call of calls) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers.Authorization, "Bearer user-jwt");
  }
  // Preis, Nutzer und Customer bestimmt das Backend. Der Checkout sendet ausschließlich
  // die Widerrufs-Zustimmung, das Portal weiterhin gar nichts.
  assert.deepEqual(Object.keys(calls[0].options.body), ["waiver_accepted"]);
  assert.equal("body" in calls[1].options, false);
});

test("die Widerrufs-Zustimmung wird nur gesendet, wenn sie wirklich gesetzt wurde", async () => {
  const bodies = [];
  const client = clientWith(async (_name, options) => {
    bodies.push(options.body);
    return { data: { url: "https://checkout.stripe.com/c/pay/cs_1" }, error: null };
  });
  await requestStripeRedirect(client, "checkout");
  await requestStripeRedirect(client, "checkout", {});
  await requestStripeRedirect(client, "checkout", { waiverAccepted: false });
  await requestStripeRedirect(client, "checkout", { waiverAccepted: true });
  // Nur ein ausdrückliches true darf als Zustimmung beim Backend ankommen.
  assert.deepEqual(bodies.map((body) => body.waiver_accepted), [false, false, false, true]);
});

test("ohne Session wird kein Function-Aufruf gemacht", async () => {
  let called = false;
  const client = clientWith(async () => { called = true; return { data: null, error: null }; }, null);
  await assert.rejects(requestStripeRedirect(client, "checkout"), (error) => error.code === "UNAUTHENTICATED");
  assert.equal(called, false);
});

test("Fehler der Functions werden auf feste Codes abgebildet, ohne Backend-Texte durchzureichen", async () => {
  const cases = [
    [httpError(401, { code: "UNAUTHORIZED_NO_AUTH_HEADER", message: "geheim" }), "UNAUTHENTICATED"],
    [httpError(401, { error: { code: "UNAUTHENTICATED" } }), "UNAUTHENTICATED"],
    [httpError(409, { error: { code: "ALREADY_SUBSCRIBED" } }), "ALREADY_SUBSCRIBED"],
    [httpError(404, { error: { code: "NO_SUBSCRIPTION" } }), "NO_SUBSCRIPTION"],
    [httpError(502, { error: { code: "STRIPE_ERROR" } }), "UNAVAILABLE"],
    [httpError(500, { error: { code: "CONFIGURATION_ERROR" } }), "UNAVAILABLE"],
    [httpError(500, "<html>kein json</html>"), "UNAVAILABLE"],
    [new Error("relay"), "NETWORK_ERROR"],
  ];
  for (const [error, code] of cases) {
    const client = clientWith(async () => ({ data: null, error }));
    await assert.rejects(requestStripeRedirect(client, "checkout"), (thrown) => thrown.code === code, code);
  }
  const throwing = clientWith(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(requestStripeRedirect(throwing, "portal"), (thrown) => thrown.code === "NETWORK_ERROR");
});

test("eine manipulierte Antwort-URL wird nicht befolgt", async () => {
  for (const data of [{ url: "https://evil.example/pay" }, { url: "javascript:alert(1)" }, {}, null]) {
    const client = clientWith(async () => ({ data, error: null }));
    await assert.rejects(requestStripeRedirect(client, "checkout"), (thrown) => thrown.code === "INVALID_RESPONSE");
  }
});

test("Fehlermeldungen für Nutzer sind deutsch und enthalten keine Technikdetails", () => {
  for (const code of ["ALREADY_SUBSCRIBED", "NO_SUBSCRIPTION", "UNAVAILABLE", "NETWORK_ERROR", "INVALID_RESPONSE", "LOAD_FAILED"]) {
    const message = billingErrorMessage(new BillingError(code), "checkout");
    assert.match(message, /[a-zäöü]/);
    assert.doesNotMatch(message, /stripe_|sk_|price_|cus_|sub_|Error|UNAVAILABLE|INVALID/);
  }
  assert.match(billingErrorMessage(new Error("x"), "portal"), /Verbindung/);
});

function readClient(result) {
  const calls = [];
  const query = {
    select: (columns) => { calls.push({ select: columns }); return query; },
    maybeSingle: async () => result,
  };
  return { calls, client: { from: (table) => { calls.push({ from: table }); return query; } } };
}

test("der eigene Abo-Stand wird aus subscriptions gelesen und ohne Stripe-IDs abgebildet", async () => {
  const { client, calls } = readClient({
    data: { status: "active", current_period_end: "2027-01-15T08:00:00.000Z", cancel_at_period_end: true, stripe_subscription_id: "sub_123" },
    error: null,
  });
  const result = await loadOwnSubscription(client);
  assert.deepEqual(result, { status: "active", currentPeriodEnd: "2027-01-15T08:00:00.000Z", cancelAtPeriodEnd: true, hasStripeSubscription: true });
  assert.equal(calls[0].from, "subscriptions");
  assert.doesNotMatch(calls[1].select, /stripe_customer_id|price_id/);
  assert.equal(JSON.stringify(result).includes("sub_123"), false);
});

test("keine Zeile ergibt null, der Platzhalter ohne Stripe-Subscription wird erkannt, Lesefehler werden gemeldet", async () => {
  assert.equal(await loadOwnSubscription(readClient({ data: null, error: null }).client), null);
  const placeholder = await loadOwnSubscription(
    readClient({ data: { status: "incomplete", current_period_end: null, cancel_at_period_end: false, stripe_subscription_id: null }, error: null }).client,
  );
  assert.equal(placeholder.hasStripeSubscription, false);
  await assert.rejects(loadOwnSubscription(readClient({ data: null, error: { message: "rls detail" } }).client), (error) => error.code === "LOAD_FAILED" && !/rls detail/.test(error.message));
});

const noWait = async () => {};

test("die Erfolgsseite wartet auf den Webhook und schaltet Pro nur über den gelesenen Status frei", async () => {
  const states = [null, sub("incomplete", { hasStripeSubscription: false }), sub("incomplete"), sub("active")];
  let calls = 0;
  const result = await waitForProAccess(async () => states[calls++], { sleep: noWait, maxAttempts: 10 });
  assert.equal(result.state, "pro");
  assert.equal(calls, 4);
});

test("kommt der Webhook nicht, endet das Warten mit einem Zeitüberschreitungs-Zustand statt mit Pro", async () => {
  let calls = 0;
  const result = await waitForProAccess(async () => { calls++; return sub("incomplete"); }, { sleep: noWait, maxAttempts: 5 });
  assert.equal(calls, 5);
  assert.equal(result.state, "timeout");
  assert.equal(hasProAccess(result.subscription), false);
  const none = await waitForProAccess(async () => null, { sleep: noWait, maxAttempts: 2 });
  assert.deepEqual(none, { state: "timeout", subscription: null });
});

test("vorübergehende Lesefehler werden überbrückt, dauerhafte als Fehler gemeldet", async () => {
  let calls = 0;
  const recovered = await waitForProAccess(async () => {
    calls++;
    if (calls < 3) throw new BillingError("LOAD_FAILED");
    return sub("trialing");
  }, { sleep: noWait, maxAttempts: 5 });
  assert.equal(recovered.state, "pro");
  const failed = await waitForProAccess(async () => { throw new BillingError("LOAD_FAILED"); }, { sleep: noWait, maxAttempts: 3 });
  assert.deepEqual(failed, { state: "error" });
});

test("beim Verlassen der Seite wird das Warten abgebrochen und die Pause zwischen Versuchen eingehalten", async () => {
  let cancelled = false;
  let calls = 0;
  const result = await waitForProAccess(async () => { calls++; cancelled = true; return sub("incomplete"); }, {
    sleep: noWait,
    maxAttempts: 10,
    isCancelled: () => cancelled,
  });
  assert.deepEqual(result, { state: "cancelled" });
  assert.equal(calls, 1);

  const sleeps = [];
  await waitForProAccess(async () => sub("incomplete"), { sleep: async (ms) => { sleeps.push(ms); }, intervalMs: 1500, maxAttempts: 3 });
  assert.deepEqual(sleeps, [1500, 1500], "kein Warten nach dem letzten Versuch");
});

test("der angezeigte Preis lautet 6,99 € / Monat", () => {
  assert.equal(PRO_PRICE_LABEL, "6,99 € / Monat");
});

test("Profil-Karte: ohne Pro gibt es einen kurzen Hinweis mit Preis und Link zum Angebot", () => {
  for (const none of [null, sub("incomplete", { hasStripeSubscription: false }), sub("canceled"), sub("incomplete_expired")]) {
    const card = describeProCard(none);
    assert.equal(card.pro, false);
    assert.equal(card.status, "Aktuell Kein Pro-Abo");
    assert.match(card.text, /6,99 € \/ Monat/);
    assert.equal(card.linkLabel, "UniVerse Pro ansehen");
  }
});

test("Profil-Karte: active und trialing zeigen Pro aktiv und führen zur Verwaltung", () => {
  const active = describeProCard(sub("active"));
  assert.deepEqual([active.pro, active.status, active.linkLabel], [true, "Pro aktiv", "Abo verwalten"]);
  assert.match(active.text, /verlängert sich am 15\. Januar 2027/);
  const trial = describeProCard(sub("trialing"));
  assert.deepEqual([trial.pro, trial.status], [true, "Pro aktiv · Testphase"]);
});

test("Profil-Karte: Zahlungsprobleme zeigen nie Pro und führen zur Klärung statt zu einem zweiten Checkout", () => {
  for (const status of ["past_due", "unpaid", "paused", "incomplete"]) {
    const card = describeProCard(sub(status));
    assert.equal(card.pro, false, status);
    assert.doesNotMatch(card.status, /Pro aktiv/, status);
    assert.doesNotMatch(card.linkLabel, /abonnieren|ansehen/, status);
    assert.notEqual(card.status, "Kein Pro", status);
  }
  assert.equal(describeProCard(sub("past_due")).linkLabel, "Zahlungsdaten aktualisieren");
  // Unbekannter Status ohne Subscription: kein Pro, Link zur Abo-Seite.
  const unknown = describeProCard(sub("neuer_status", { hasStripeSubscription: false }));
  assert.equal(unknown.pro, false);
  assert.equal(unknown.linkLabel, "Zur Abo-Seite");
});

test("Profil-Karte: ein nicht lesbarer Status zeigt einen Hinweis, nie Pro", () => {
  const card = describeProCard(sub("active"), true);
  assert.equal(card.pro, false);
  assert.equal(card.status, "Status nicht verfügbar");
  assert.equal(card.linkLabel, "Zur Abo-Seite");
});
