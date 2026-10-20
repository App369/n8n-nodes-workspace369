import { describe, expect, it } from 'vitest';

import { Workspace369 } from '../nodes/Workspace369/Workspace369.node';
import { httpError, mockContext } from './helpers';

const node = new Workspace369();
const run = (ctx: unknown) => node.execute.call(ctx as never);

function opts(request: ReturnType<typeof mockContext>['request'], call = 0) {
	return (request.mock.calls[call] as unknown[])[1] as {
		method: string;
		url: string;
		body?: Record<string, unknown>;
	};
}

describe('Workspace369 node', () => {
	it('has no Request → Create operation', () => {
		const props = node.description.properties;
		const requestOps = props.find(
			(p) => p.name === 'operation' && p.displayOptions?.show?.resource?.[0] === 'request',
		);
		const values = (requestOps?.options as Array<{ value: string }>).map((o) => o.value);
		expect(values).toEqual(['get', 'search']);
	});

	it('Client → Create posts only filled fields and unwraps the client', async () => {
		const { ctx, request } = mockContext({
			params: {
				resource: 'client',
				operation: 'create',
				name: 'Acme Studio',
				additionalFields: { email: 'hello@example.com', phone: '', lifecycle_stage: 'prospect' },
			},
			responses: [{ client: { id: 'c1', name: 'Acme Studio' }, deduped: false }],
		});
		const [out] = await run(ctx);
		const o = opts(request);
		expect(o.method).toBe('POST');
		expect(o.url).toBe('https://api.example.com/v1/tools/clients_create');
		expect(o.body).toEqual({
			name: 'Acme Studio',
			email: 'hello@example.com',
			lifecycle_stage: 'prospect',
		});
		expect(out).toHaveLength(1);
		expect(out[0].json).toEqual({ id: 'c1', name: 'Acme Studio', deduped: false });
		expect(request.mock.calls[0][0]).toBe('workspace369Api');
	});

	it('passes a held_for_approval body through as is', async () => {
		const held = { held_for_approval: true, approval_id: 'ap_test' };
		const { ctx } = mockContext({
			params: {
				resource: 'client',
				operation: 'create',
				name: 'Acme Studio',
				additionalFields: {},
			},
			responses: [held],
		});
		const [out] = await run(ctx);
		expect(out[0].json).toEqual(held);
	});

	it('Client → Search sends filters, splits tags and returns one item per client', async () => {
		const { ctx, request } = mockContext({
			params: {
				resource: 'client',
				operation: 'search',
				returnAll: false,
				limit: 2,
				filters: { query: 'acme', tags: 'vip, new ', stage: '' },
			},
			responses: [{ clients: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] }],
		});
		const [out] = await run(ctx);
		expect(opts(request).url).toMatch(/clients_search$/);
		expect(opts(request).body).toEqual({ query: 'acme', tags: ['vip', 'new'], limit: 2 });
		expect(out.map((i) => i.json.id)).toEqual(['c1', 'c2']);
	});

	it('pages with nextCursor when Return All is on', async () => {
		const { ctx, request } = mockContext({
			params: { resource: 'client', operation: 'search', returnAll: true, filters: {} },
			responses: [
				{ clients: [{ id: 'c1' }], nextCursor: 'cur1' },
				{ clients: [{ id: 'c2' }], nextCursor: 'cur2' },
				{ clients: [{ id: 'c3' }] },
			],
		});
		const [out] = await run(ctx);
		expect(request).toHaveBeenCalledTimes(3);
		expect(opts(request, 0).body).toEqual({ limit: 100 });
		expect(opts(request, 1).body).toEqual({ limit: 100, cursor: 'cur1' });
		expect(opts(request, 2).body).toEqual({ limit: 100, cursor: 'cur2' });
		expect(out.map((i) => i.json.id)).toEqual(['c1', 'c2', 'c3']);
	});

	it('stops paging once the limit is reached', async () => {
		const { ctx, request } = mockContext({
			params: { resource: 'invoice', operation: 'list', returnAll: false, limit: 150, filters: {} },
			responses: [
				{ invoices: Array.from({ length: 100 }, (_, i) => ({ id: `i${i}` })), nextCursor: 'n' },
				{ invoices: Array.from({ length: 100 }, (_, i) => ({ id: `j${i}` })), nextCursor: 'm' },
			],
		});
		const [out] = await run(ctx);
		expect(request).toHaveBeenCalledTimes(2);
		expect(opts(request, 1).body).toEqual({ limit: 50, cursor: 'n' });
		expect(out).toHaveLength(150);
	});

	it('Request → Search and Get', async () => {
		const search = mockContext({
			params: {
				resource: 'request',
				operation: 'search',
				returnAll: false,
				limit: 10,
				filters: { status: 'new', form_id: 'f1' },
			},
			responses: [{ requests: [{ id: 'r1' }] }],
		});
		const [s] = await run(search.ctx);
		expect(opts(search.request).url).toMatch(/requests_search$/);
		expect(opts(search.request).body).toEqual({ status: 'new', form_id: 'f1', limit: 10 });
		expect(s[0].json.id).toBe('r1');

		const get = mockContext({
			params: { resource: 'request', operation: 'get', requestId: 'r1' },
			responses: [{ request: { id: 'r1', name: 'Jo' } }],
		});
		const [g] = await run(get.ctx);
		expect(opts(get.request).url).toMatch(/requests_get$/);
		expect(opts(get.request).body).toEqual({ id: 'r1' });
		expect(g[0].json).toEqual({ id: 'r1', name: 'Jo' });
	});

	it('Request → Get fails when the request is not found', async () => {
		const { ctx } = mockContext({
			params: { resource: 'request', operation: 'get', requestId: 'nope' },
			responses: [{ request: null }],
		});
		await expect(run(ctx)).rejects.toThrow('Request not found');
	});

	it('Invoice → List sends filters including false booleans', async () => {
		const { ctx, request } = mockContext({
			params: {
				resource: 'invoice',
				operation: 'list',
				returnAll: false,
				limit: 5,
				filters: { status: 'Paid', clientId: 'c1', include_archived: false },
			},
			responses: [{ invoices: [{ id: 'inv1' }, { id: 'inv2' }] }],
		});
		const [out] = await run(ctx);
		expect(opts(request).url).toMatch(/invoices_search$/);
		expect(opts(request).body).toEqual({
			status: 'Paid',
			clientId: 'c1',
			include_archived: false,
			limit: 5,
		});
		expect(out).toHaveLength(2);
	});

	it('Invoice → Get by id and by number, and null means not found', async () => {
		const byId = mockContext({
			params: { resource: 'invoice', operation: 'get', lookupBy: 'id', invoiceId: 'inv1' },
			responses: [{ invoice: { id: 'inv1', line_items: [] } }],
		});
		const [a] = await run(byId.ctx);
		expect(opts(byId.request).body).toEqual({ id: 'inv1' });
		expect(a[0].json.id).toBe('inv1');

		const byNumber = mockContext({
			params: {
				resource: 'invoice',
				operation: 'get',
				lookupBy: 'invoice_number',
				invoiceNumber: '26-6',
			},
			responses: [{ invoice: { id: 'inv1' } }],
		});
		await run(byNumber.ctx);
		expect(opts(byNumber.request).body).toEqual({ invoice_number: '26-6' });

		const missing = mockContext({
			params: { resource: 'invoice', operation: 'get', lookupBy: 'id', invoiceId: 'x' },
			responses: [{ invoice: null }],
		});
		await expect(run(missing.ctx)).rejects.toThrow('Invoice not found');
	});

	it('Calendar Event → Create omits empty fields and splits assignees', async () => {
		const { ctx, request } = mockContext({
			params: {
				resource: 'calendarEvent',
				operation: 'create',
				title: 'Kickoff call',
				starts_at: '2026-11-02T10:00:00.000Z',
				additionalFields: {
					description: '',
					reminders: ['15_minutes_before'],
					is_all_day: false,
					assigned_user_ids: 'u1, u2',
					recurrence_count: 4,
				},
			},
			responses: [{ event: { id: 'e1', title: 'Kickoff call' }, deduped: false }],
		});
		const [out] = await run(ctx);
		expect(opts(request).url).toMatch(/calendar_create_event$/);
		expect(opts(request).body).toEqual({
			title: 'Kickoff call',
			starts_at: '2026-11-02T10:00:00.000Z',
			reminders: ['15_minutes_before'],
			is_all_day: false,
			assigned_user_ids: ['u1', 'u2'],
			recurrence_count: 4,
		});
		expect(out[0].json).toEqual({ id: 'e1', title: 'Kickoff call', deduped: false });
	});

	it('Calendar Event date fields are plain strings with ISO help text', () => {
		const props = node.description.properties;
		const starts = props.find((p) => p.name === 'starts_at');
		expect(starts?.type).toBe('string');
		expect(starts?.description).toContain('For an all-day event use YYYY-MM-DD.');
		const extra = props.find(
			(p) =>
				p.name === 'additionalFields' && p.displayOptions?.show?.resource?.[0] === 'calendarEvent',
		);
		const fields = (extra?.options ?? []) as Array<{
			name: string;
			type: string;
			description?: string;
		}>;
		expect(fields.find((f) => f.name === 'ends_at')?.type).toBe('string');
		const rec = fields.find((f) => f.name === 'recurrence_end_date');
		expect(rec?.type).toBe('string');
		expect(rec?.description).toBe('YYYY-MM-DD');
	});

	it('Return All stops when the API repeats a cursor', async () => {
		const { ctx, request } = mockContext({
			params: { resource: 'client', operation: 'search', returnAll: true, filters: {} },
			responses: [
				{ clients: [{ id: 'a' }], nextCursor: 'c1' },
				{ clients: [{ id: 'b' }], nextCursor: 'c1' },
				{ clients: [{ id: 'never' }] },
			],
		});
		const [out] = await run(ctx);
		expect(request).toHaveBeenCalledTimes(2);
		expect(out.map((i) => i.json.id)).toEqual(['a', 'b']);
	});

	it('refuses a non-https base URL before any request', async () => {
		const { ctx, request } = mockContext({
			params: { resource: 'client', operation: 'create', name: 'A', additionalFields: {} },
			baseUrl: 'http://api.example.com',
		});
		await expect(run(ctx)).rejects.toThrow('must start with https://');
		expect(request).not.toHaveBeenCalled();
	});

	it('maps API errors to NodeApiError with the API message', async () => {
		const { ctx } = mockContext({
			params: { resource: 'client', operation: 'create', name: 'A', additionalFields: {} },
			responses: [httpError(403, 'Your plan does not include the API.')],
		});
		await expect(run(ctx)).rejects.toMatchObject({
			name: 'NodeApiError',
			message: 'Your plan does not include the API.',
		});
	});

	it('supports continueOnFail', async () => {
		const { ctx } = mockContext({
			continueOnFail: true,
			params: { resource: 'client', operation: 'create', name: 'A', additionalFields: {} },
			responses: [httpError(402, 'You are out of Tokens.')],
		});
		const [out] = await run(ctx);
		expect(out[0].json.error).toBe('You are out of Tokens.');
	});
});
