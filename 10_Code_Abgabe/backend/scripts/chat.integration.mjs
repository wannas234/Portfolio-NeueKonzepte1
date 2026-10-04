import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { cliEnvironment, root } from './environment.mjs';

// Real overlapping PostgreSQL transactions, without calling either AI provider.
for (const scoped of [false, true]) {
  test(`Chat admission serializes retries, enforces limits and fences expired workers (scoped=${scoped})`, () =>
    runChatAdmission(scoped));
}

async function runChatAdmission(scoped) {
  const status = spawnSync(`${root}node_modules/.bin/supabase`, ['status', '-o', 'json'], {
    cwd: root,
    env: cliEnvironment(),
    encoding: 'utf8',
  });
  assert.equal(status.status, 0, 'Local Supabase must be running');
  const { API_URL: url, SERVICE_ROLE_KEY: key, ANON_KEY: publicKey } = JSON.parse(status.stdout);
  assert.equal(new URL(url).hostname, '127.0.0.1');
  assert.ok(key);
  async function request(path, body, method = 'POST', token = key) {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        Prefer: 'return=representation',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }
  async function ok(path, body, method = 'POST', token = key) {
    const response = await request(path, body, method, token);
    assert.ok(
      response.status >= 200 && response.status < 300,
      `Local operation failed: ${JSON.stringify(response.data)}`,
    );
    return response.data;
  }
  const user = await ok('/auth/v1/admin/users', {
    email: `chat-${randomUUID()}@example.com`,
    password: 'Local-chat-test-123!',
    email_confirm: true,
  });
  const other = await ok('/auth/v1/admin/users', {
    email: `chat-${randomUUID()}@example.com`,
    password: 'Local-chat-test-123!',
    email_confirm: true,
  });
  try {
    const session = await ok('/auth/v1/token?grant_type=password', {
      email: user.email,
      password: 'Local-chat-test-123!',
    });
    const foreignSession = await ok('/auth/v1/token?grant_type=password', {
      email: other.email,
      password: 'Local-chat-test-123!',
    });
    const [course] = await ok('/rest/v1/courses', {
      owner_id: user.id,
      title: 'Chat integration',
    });
    const materials = scoped
      ? await ok('/rest/v1/materials', [
          { course_id: course.id, created_by: user.id, type: 'source_document', title: 'First' },
          { course_id: course.id, created_by: user.id, type: 'source_document', title: 'Second' },
        ])
      : [];
    const scopeArgs = scoped ? { p_material_ids: materials.map((m) => m.id) } : {};
    const conversations = await ok(
      '/rest/v1/chat_conversations',
      Array.from({ length: 3 }, () => ({ course_id: course.id })),
    );
    const conversationId = conversations[0].id;
    const requestId = randomUUID();
    const base = {
      ...scopeArgs,
      p_user_id: user.id,
      p_conversation_id: conversationId,
      p_request_id: requestId,
      p_question: 'Frage',
      p_provider: 'gemini',
      p_model: 'test-model',
      p_questions_per_minute: 6,
      p_concurrent_responses: 1,
    };
    const reserve = (overrides = {}) =>
      ok('/rest/v1/rpc/reserve_chat_request', { ...base, ...overrides });
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        reserve(
          scoped && i % 2
            ? { p_material_ids: [materials[1].id, materials[0].id, materials[1].id] }
            : {},
        ),
      ),
    );
    assert.equal(
      outcomes.filter((result) => result.lease_token).length,
      1,
      'Exactly one concurrent retry owns the lease',
    );
    assert.equal(outcomes.filter((result) => result.code === 'REQUEST_IN_PROGRESS').length, 7);
    const token = outcomes.find((result) => result.lease_token).lease_token;
    assert.equal((await reserve({ p_question: 'Andere Frage' })).code, 'REQUEST_ID_CONFLICT');
    if (scoped)
      assert.equal(
        (await reserve({ p_material_ids: [materials[0].id] })).code,
        'REQUEST_ID_CONFLICT',
      );
    assert.equal((await reserve({ p_request_id: randomUUID() })).code, 'CONVERSATION_BUSY');
    assert.equal(
      (await reserve({ p_conversation_id: conversations[1].id, p_request_id: randomUUID() })).code,
      'CONCURRENCY_LIMIT',
    );
    const denied = await request(
      '/rest/v1/rpc/reserve_chat_request',
      base,
      'POST',
      session.access_token,
    );
    assert.equal(denied.status, 403, 'User cannot choose limits or reserve directly');
    const projection =
      '/rest/v1/chat_requests?select=conversation_id,request_id,status,attempts,error_code,stage,lease_until,updated_at';
    assert.equal((await ok(projection, undefined, 'GET', session.access_token)).length, 1);
    assert.deepEqual(await ok(projection, undefined, 'GET', foreignSession.access_token), []);
    assert.equal(
      (
        await request(
          '/rest/v1/chat_requests?select=lease_token',
          undefined,
          'GET',
          session.access_token,
        )
      ).status,
      403,
    );
    const finish = (leaseToken, overrides = {}) =>
      request('/rest/v1/rpc/complete_chat_request', {
        p_user_id: user.id,
        p_conversation_id: conversationId,
        p_request_id: requestId,
        p_lease_token: leaseToken,
        p_question: 'Frage',
        p_answer: 'Keine passenden Belege.',
        p_model: 'resolved-gemini',
        p_input_tokens: 10,
        p_output_tokens: 5,
        p_sources: [],
        ...overrides,
      });
    assert.equal((await finish(randomUUID())).data.message, 'REQUEST_LEASE_EXPIRED');
    // Expire the lease through the trusted local test client, then retry.
    await ok(
      `/rest/v1/chat_requests?conversation_id=eq.${conversationId}`,
      { lease_until: new Date(Date.now() - 1000).toISOString() },
      'PATCH',
    );
    await ok(
      `/rest/v1/chat_execution_leases?lease_token=eq.${token}`,
      { lease_until: new Date(Date.now() - 1000).toISOString() },
      'PATCH',
    );
    assert.equal((await finish(token)).data.message, 'REQUEST_LEASE_EXPIRED');
    const retry = await reserve();
    assert.ok(retry.lease_token && retry.lease_token !== token);
    assert.equal((await finish(token)).data.message, 'REQUEST_LEASE_EXPIRED');
    assert.equal(
      await ok('/rest/v1/rpc/fail_chat_request', {
        p_conversation_id: conversationId,
        p_request_id: requestId,
        p_lease_token: token,
        p_error_code: 'CHAT_UNAVAILABLE',
        p_stage: 'answer',
      }),
      false,
    );
    assert.equal(
      (await finish(retry.lease_token, { p_user_id: other.id })).data.message,
      'CONVERSATION_NOT_FOUND',
    );
    const completed = await finish(retry.lease_token);
    assert.equal(completed.status, 200);
    const answer = completed.data.messages[1];
    assert.equal(answer.helpful, null);
    assert.equal(answer.helpful_at, null);
    const ratingPath = `/rest/v1/chat_messages?id=eq.${answer.id}&select=id,helpful,helpful_at`;
    const [rated] = await ok(ratingPath, { helpful: true }, 'PATCH', session.access_token);
    assert.equal(rated.id, answer.id);
    assert.equal(rated.helpful, true);
    assert.ok(Number.isFinite(Date.parse(rated.helpful_at)));
    assert.deepEqual(
      await ok(ratingPath, { helpful: true }, 'PATCH', session.access_token),
      [rated],
      'Retrying identical feedback preserves its timestamp',
    );
    const restored = await ok(
      '/rest/v1/rpc/chat_exchange',
      {
        p_conversation_id: conversationId,
        p_request_id: requestId,
        ...scopeArgs,
      },
      'POST',
      session.access_token,
    );
    assert.equal(restored.messages[1].helpful, true);
    assert.equal(restored.messages[1].helpful_at, rated.helpful_at);
    for (const [id, accessToken] of [
      [answer.id, foreignSession.access_token],
      [completed.data.messages[0].id, session.access_token],
      [randomUUID(), session.access_token],
    ]) {
      assert.deepEqual(
        await ok(
          `/rest/v1/chat_messages?id=eq.${id}&select=id,helpful,helpful_at`,
          { helpful: false },
          'PATCH',
          accessToken,
        ),
        [],
        'Foreign, user and missing messages return no matching row',
      );
    }
    assert.equal(
      (
        await request(
          ratingPath,
          { helpful: false, content: 'Changed' },
          'PATCH',
          session.access_token,
        )
      ).status,
      403,
    );
    const [negative] = await ok(ratingPath, { helpful: false }, 'PATCH', session.access_token);
    assert.equal(negative.helpful, false);
    const [withdrawn] = await ok(ratingPath, { helpful: null }, 'PATCH', session.access_token);
    assert.equal(withdrawn.helpful, null);
    assert.equal(withdrawn.helpful_at, null);

    assert.deepEqual(
      completed.data.messages.map((message) => message.seq),
      [1, 2],
    );
    assert.equal(completed.data.messages[1].provider, 'gemini');
    assert.equal(completed.data.messages[1].input_tokens, 10);
    assert.deepEqual(
      (await reserve()).exchange,
      completed.data,
      'Replay returns the committed answer',
    );
    const secondId = randomUUID();
    const second = await reserve({ p_request_id: secondId });
    assert.ok(second.lease_token);
    assert.equal(
      await ok('/rest/v1/rpc/fail_chat_request', {
        p_conversation_id: conversationId,
        p_request_id: secondId,
        p_lease_token: second.lease_token,
        p_error_code: 'REQUEST_CANCELLED',
        p_stage: 'answer',
        p_cancelled: true,
      }),
      true,
    );
    assert.ok(
      (await reserve({ p_request_id: secondId })).lease_token,
      'Cancelled requests can retry',
    );
    const live = await ok(
      `/rest/v1/chat_requests?conversation_id=eq.${conversationId}&request_id=eq.${secondId}`,
      undefined,
      'GET',
    );
    await ok('/rest/v1/rpc/fail_chat_request', {
      p_conversation_id: conversationId,
      p_request_id: secondId,
      p_lease_token: live[0].lease_token,
      p_error_code: 'INVALID_CITATION',
      p_stage: 'citations',
    });
    // Four attempts used; reducing the configured threshold exercises rolling limits.
    const limited = await reserve({ p_request_id: randomUUID(), p_questions_per_minute: 4 });
    assert.equal(limited.code, 'RATE_LIMITED');
    assert.ok(limited.retry_after_seconds > 0 && limited.retry_after_seconds <= 60);
    await ok(`/rest/v1/chat_conversations?id=eq.${conversationId}`, undefined, 'DELETE');
    assert.equal(
      (
        await reserve({
          p_conversation_id: conversations[1].id,
          p_request_id: randomUUID(),
          p_questions_per_minute: 4,
        })
      ).code,
      'RATE_LIMITED',
      'Deleting chats cannot reset admission',
    );
    // Different conversations racing for the last user slot share an admission lock.
    const races = await Promise.all(
      conversations.slice(1).map((c) =>
        reserve({
          p_conversation_id: c.id,
          p_request_id: randomUUID(),
          p_questions_per_minute: 10,
        }),
      ),
    );
    assert.equal(races.filter((r) => r.lease_token).length, 1);
    assert.equal(races.filter((r) => r.code === 'CONCURRENCY_LIMIT').length, 1);
    const winnerIndex = races.findIndex((r) => r.lease_token);
    await ok(
      `/rest/v1/chat_conversations?id=eq.${conversations[winnerIndex + 1].id}`,
      undefined,
      'DELETE',
    );
    assert.equal(
      (
        await reserve({
          p_conversation_id: conversations[winnerIndex === 0 ? 2 : 1].id,
          p_request_id: randomUUID(),
          p_questions_per_minute: 10,
        })
      ).code,
      'CONCURRENCY_LIMIT',
      'Deleting the active conversation does not free the provider execution slot',
    );
    await ok('/rest/v1/rpc/fail_chat_request', {
      p_conversation_id: conversations[winnerIndex + 1].id,
      p_request_id: randomUUID(),
      p_lease_token: races[winnerIndex].lease_token,
      p_error_code: 'CONVERSATION_NOT_FOUND',
      p_stage: 'persist',
    });
    assert.ok(
      (
        await reserve({
          p_conversation_id: conversations[winnerIndex === 0 ? 2 : 1].id,
          p_request_id: randomUUID(),
          p_questions_per_minute: 10,
        })
      ).lease_token,
    );
  } finally {
    await ok(`/auth/v1/admin/users/${user.id}`, undefined, 'DELETE');
    await ok(`/auth/v1/admin/users/${other.id}`, undefined, 'DELETE');
  }
}
