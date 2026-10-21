import { describe, expect, it } from 'vitest';

import { EVENTS } from '../nodes/Workspace369Trigger/events';
import { HOOKS_OFF_MESSAGE } from '../nodes/Workspace369Trigger/hooksApi';
import {
	computeSignature,
	isTimestampFresh,
	REPLAY_WINDOW_MS,
	verifySignature,
} from '../nodes/Workspace369Trigger/signature';
import { Workspace369Trigger } from '../nodes/Workspace369Trigger/Workspace369Trigger.node';
import { httpError, mockContext } from './helpers';

const trigger = new Workspace369Trigger();
const methods = trigger.webhookMethods.default;
const call = (ctx: unknown) => ({
	checkExists: () => methods.checkExists.call(ctx as never),
	create: () => methods.create.call(ctx as never),
	delete: () => methods.delete.call(ctx as never),
});
const reqOpts = (request: { mock: { calls: unknown[][] } }, n = 0) =>
	request.mock.calls[n][1] as { method: string; url: string; body?: unknown; qs?: unknown };

describe('event catalog', () => {
	it('has the 21 contract events with labels', () => {
		expect(EVENTS).toHaveLength(21);
		expect(EVENTS).toContainEqual({ name: 'New Request (Lead)', value: 'lead.created' });
		expect(EVENTS).toContainEqual({
			name: 'Contract Signer Completed',
			value: 'contract.recipient_completed',
		});
		expect(new Set(EVENTS.map((e) => e.value)).size).toBe(21);
	});
});

describe('trigger webhook methods', () => {
	const URL_ = 'https://n8n.example.com/webhook/abc/webhook';

	it('checkExists keeps a hook whose id, events and secret match', async () => {
		const { ctx, request, staticData } = mockContext({
			staticData: { hookId: 'h1', secret: 'whsec_test' },
			params: { events: ['invoice.paid', 'invoice.created'] },
			responses: [
				{ hooks: [{ id: 'h1', target_url: URL_, events: ['invoice.created', 'invoice.paid'] }] },
			],
		});
		expect(await call(ctx).checkExists()).toBe(true);
		const o = reqOpts(request);
		expect(o.method).toBe('GET');
		expect(o.url).toBe('https://api.example.com/v1/hooks');
		expect(o.qs).toEqual({ target_url: URL_ });
		expect(request.mock.calls).toHaveLength(1);
		expect(staticData.hookId).toBe('h1');
	});

	it('checkExists is false when nothing matches the exact url, and tolerates a bare array', async () => {
		const none = mockContext({ responses: [{ hooks: [] }] });
		expect(await call(none.ctx).checkExists()).toBe(false);
		const other = mockContext({
			staticData: { hookId: 'h2', secret: 'whsec_test' },
			responses: [[{ id: 'h2', target_url: 'https://other.example.com/hook', events: [] }]],
		});
		expect(await call(other.ctx).checkExists()).toBe(false);
		const bare = mockContext({
			staticData: { hookId: 'h2', secret: 'whsec_test' },
			responses: [[{ id: 'h2', target_url: URL_, events: [] }]],
		});
		expect(await call(bare.ctx).checkExists()).toBe(true);
	});

	it('checkExists replaces a hook stored under another id or with other events', async () => {
		const wrongId = mockContext({
			staticData: { hookId: 'old', secret: 'whsec_test' },
			responses: [{ hooks: [{ id: 'h9', target_url: URL_, events: [] }] }, {}],
		});
		expect(await call(wrongId.ctx).checkExists()).toBe(false);
		expect(reqOpts(wrongId.request, 1).url).toBe('https://api.example.com/v1/hooks/h9');
		expect(wrongId.staticData.secret).toBeUndefined();
		const changed = mockContext({
			staticData: { hookId: 'h1', secret: 'whsec_test' },
			params: { events: ['lead.created'] },
			responses: [{ hooks: [{ id: 'h1', target_url: URL_, events: ['invoice.paid'] }] }, {}],
		});
		expect(await call(changed.ctx).checkExists()).toBe(false);
		expect(reqOpts(changed.request, 1).method).toBe('DELETE');
	});

	it('create refuses a response without a signing secret', async () => {
		const { ctx } = mockContext({ responses: [{ id: 'h1', events: [], target_url: URL_ }] });
		await expect(call(ctx).create()).rejects.toThrow(/signing secret/);
	});

	it('create shows the API message when the hook cap is reached', async () => {
		const { ctx } = mockContext({
			responses: [httpError(409, 'This workspace already has 25 webhooks.')],
		});
		await expect(call(ctx).create()).rejects.toThrow(/already has 25 webhooks/);
	});

	it('checkExists deletes a matching hook that has no stored secret and returns false', async () => {
		const { ctx, request, staticData } = mockContext({
			staticData: { hookId: 'old' },
			responses: [
				{ hooks: [{ id: 'h9', target_url: 'https://n8n.example.com/webhook/abc/webhook' }] },
				{},
			],
		});
		expect(await call(ctx).checkExists()).toBe(false);
		expect(reqOpts(request, 1).method).toBe('DELETE');
		expect(reqOpts(request, 1).url).toBe('https://api.example.com/v1/hooks/h9');
		expect(staticData.hookId).toBeUndefined();
	});

	it('create posts target_url and events and stores id and secret', async () => {
		const { ctx, request, staticData } = mockContext({
			params: { events: ['invoice.paid', 'lead.created'] },
			responses: [{ id: 'h1', secret: 'whsec_test', events: [], target_url: 'x' }],
		});
		expect(await call(ctx).create()).toBe(true);
		const o = reqOpts(request);
		expect(o.method).toBe('POST');
		expect(o.url).toBe('https://api.example.com/v1/hooks');
		expect(o.body).toEqual({
			target_url: 'https://n8n.example.com/webhook/abc/webhook',
			events: ['invoice.paid', 'lead.created'],
		});
		expect(staticData).toMatchObject({ hookId: 'h1', secret: 'whsec_test' });
	});

	it('create refuses a non-public or http address before calling the API', async () => {
		for (const webhookUrl of ['http://n8n.example.com/w', 'https://localhost:5678/w']) {
			const { ctx, request } = mockContext({ params: { events: ['invoice.paid'] }, webhookUrl });
			await expect(call(ctx).create()).rejects.toThrow(/public https/);
			expect(request).not.toHaveBeenCalled();
		}
	});

	it('create explains when the hooks API is switched off (404)', async () => {
		const { ctx } = mockContext({
			params: { events: ['invoice.paid'] },
			responses: [httpError(404)],
		});
		await expect(call(ctx).create()).rejects.toThrow(HOOKS_OFF_MESSAGE);
	});

	it('delete removes the hook and clears static data', async () => {
		const { ctx, request, staticData } = mockContext({
			staticData: { hookId: 'h1', secret: 'whsec_test' },
			responses: [{}],
		});
		expect(await call(ctx).delete()).toBe(true);
		const o = reqOpts(request);
		expect(o.method).toBe('DELETE');
		expect(o.url).toBe('https://api.example.com/v1/hooks/h1');
		expect(staticData).toEqual({});
	});

	it('delete treats 404 as already gone', async () => {
		const { ctx, staticData } = mockContext({
			staticData: { hookId: 'h1', secret: 'whsec_test' },
			responses: [httpError(404)],
		});
		expect(await call(ctx).delete()).toBe(true);
		expect(staticData.hookId).toBeUndefined();
	});

	it('delete also removes another hook left for the same url', async () => {
		const url = 'https://n8n.example.com/webhook/abc/webhook';
		const { ctx, request, staticData } = mockContext({
			staticData: { hookId: 'h1', secret: 'whsec_test' },
			responses: [
				{},
				{
					hooks: [
						{ id: 'h1', target_url: url, events: ['invoice.paid'] },
						{ id: 'h2', target_url: url, events: ['invoice.paid'] },
						{ id: 'h3', target_url: `${url}/other`, events: ['invoice.paid'] },
					],
				},
				{},
			],
		});
		expect(await call(ctx).delete()).toBe(true);
		expect(
			request.mock.calls.map((_, n) => `${reqOpts(request, n).method} ${reqOpts(request, n).url}`),
		).toEqual([
			'DELETE https://api.example.com/v1/hooks/h1',
			'GET https://api.example.com/v1/hooks',
			'DELETE https://api.example.com/v1/hooks/h2',
		]);
		expect(staticData).toEqual({});
	});

	it('delete still deactivates when the leftover check fails, and logs it', async () => {
		const { ctx, staticData } = mockContext({
			staticData: { hookId: 'h1', secret: 'whsec_test' },
			responses: [httpError(404), httpError(404)],
		});
		expect(await call(ctx).delete()).toBe(true);
		expect(staticData).toEqual({});
		expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining(HOOKS_OFF_MESSAGE));
	});

	it('answers deliveries with an empty body', () => {
		expect(trigger.description.webhooks?.[0]).toMatchObject({ responseData: 'noData' });
	});

	it('the public URL help names N8N_WEBHOOK_URL', () => {
		const notice = trigger.description.properties.find((p) => p.name === 'publicUrlNotice');
		expect(notice?.displayName).toContain('N8N_WEBHOOK_URL');
	});

	it('delete still surfaces other errors', async () => {
		const { ctx } = mockContext({
			staticData: { hookId: 'h1' },
			responses: [httpError(500, 'Something broke.')],
		});
		await expect(call(ctx).delete()).rejects.toThrow('Something broke.');
	});
});

describe('signature verification', () => {
	const secret = 'whsec_test_secret';
	const body = JSON.stringify({ event_type: 'invoice.paid', entity_id: 'inv1', data: {} });
	const timestamp = String(Date.now());

	it('computes hex HMAC-SHA256 over body + timestamp', () => {
		expect(computeSignature(secret, body, timestamp)).toMatch(/^[0-9a-f]{64}$/);
		expect(
			verifySignature(secret, body, timestamp, computeSignature(secret, body, timestamp)),
		).toBe(true);
	});

	it('rejects a wrong signature, secret, body, timestamp or missing headers', () => {
		const good = computeSignature(secret, body, timestamp);
		expect(verifySignature(secret, body, timestamp, 'a'.repeat(64))).toBe(false);
		expect(verifySignature('whsec_other', body, timestamp, good)).toBe(false);
		expect(verifySignature(secret, body + ' ', timestamp, good)).toBe(false);
		expect(verifySignature(secret, body, '1', good)).toBe(false);
		expect(verifySignature(secret, body, undefined, good)).toBe(false);
		expect(verifySignature(secret, body, timestamp, undefined)).toBe(false);
		expect(verifySignature(secret, body, timestamp, 'short')).toBe(false);
	});

	const hook = (ctx: unknown) => trigger.webhook.call(ctx as never);

	it('webhook accepts a valid delivery and outputs the envelope', async () => {
		const { ctx, res } = mockContext({
			staticData: { secret },
			params: { events: ['invoice.paid'] },
			rawBody: body,
			body: JSON.parse(body),
			headers: {
				'x-webhook-timestamp': timestamp,
				'x-webhook-signature': computeSignature(secret, body, timestamp),
			},
		});
		const result = await hook(ctx);
		expect(res.status).not.toHaveBeenCalled();
		expect(result.workflowData?.[0][0].json).toMatchObject({ event_type: 'invoice.paid' });
	});

	it('webhook rejects a bad signature with 401 and does not run the workflow', async () => {
		const { ctx, res } = mockContext({
			staticData: { secret },
			params: { events: ['invoice.paid'] },
			rawBody: body,
			body: JSON.parse(body),
			headers: { 'x-webhook-timestamp': timestamp, 'x-webhook-signature': 'f'.repeat(64) },
		});
		const result = await hook(ctx);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(result.workflowData).toBeUndefined();
		expect(result.noWebhookResponse).toBe(true);
	});

	it('webhook rejects with 401 when no secret is stored', async () => {
		const { ctx, res } = mockContext({
			params: { events: [] },
			rawBody: body,
			body: JSON.parse(body),
			headers: {
				'x-webhook-timestamp': timestamp,
				'x-webhook-signature': computeSignature(secret, body, timestamp),
			},
		});
		const result = await hook(ctx);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(result.workflowData).toBeUndefined();
		expect(result.noWebhookResponse).toBe(true);
	});

	it('webhook rejects an old or future timestamp even with a valid signature', async () => {
		for (const offset of [-(REPLAY_WINDOW_MS + 1000), REPLAY_WINDOW_MS + 5000]) {
			const ts = String(Date.now() + offset);
			const { ctx, res } = mockContext({
				staticData: { secret },
				params: { events: [] },
				rawBody: body,
				body: JSON.parse(body),
				headers: {
					'x-webhook-timestamp': ts,
					'x-webhook-signature': computeSignature(secret, body, ts),
				},
			});
			const result = await hook(ctx);
			expect(res.status).toHaveBeenCalledWith(401);
			expect(result.workflowData).toBeUndefined();
		}
	});

	it('isTimestampFresh accepts within the window and rejects old, future and non-numbers', () => {
		const now = 1760000000000;
		expect(isTimestampFresh(String(now), now)).toBe(true);
		expect(isTimestampFresh(String(now - REPLAY_WINDOW_MS + 1000), now)).toBe(true);
		expect(isTimestampFresh(String(now + REPLAY_WINDOW_MS - 1000), now)).toBe(true);
		expect(isTimestampFresh(String(now - REPLAY_WINDOW_MS - 1), now)).toBe(false);
		expect(isTimestampFresh(String(now + REPLAY_WINDOW_MS + 1), now)).toBe(false);
		expect(isTimestampFresh('abc', now)).toBe(false);
		expect(isTimestampFresh('', now)).toBe(false);
		expect(isTimestampFresh(undefined, now)).toBe(false);
	});
});
