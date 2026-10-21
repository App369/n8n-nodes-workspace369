import { describe, expect, it, vi } from 'vitest';

import { Workspace369Api } from '../credentials/Workspace369Api.credentials';
import {
	CREDENTIAL_TEST_NAME,
	describeTestFailure,
	workspace369ApiTest,
} from '../nodes/Workspace369/credentialTest';
import { HTTPS_ONLY_MESSAGE } from '../nodes/Workspace369/GenericFunctions';
import { Workspace369 } from '../nodes/Workspace369/Workspace369.node';
import { Workspace369Trigger } from '../nodes/Workspace369Trigger/Workspace369Trigger.node';

/** An error shaped like the one n8n's legacy request helper throws for a 4xx. */
function legacyError(status: number, error?: Record<string, unknown>) {
	return Object.assign(new Error(`${status} - ${JSON.stringify({ error })}`), {
		statusCode: status,
		response: { statusCode: status, body: error ? { error } : undefined },
	});
}

function runTest(
	data: Record<string, unknown>,
	outcome: unknown = { workspace: { name: 'Acme' } },
) {
	const request = vi.fn(async () => {
		if (outcome instanceof Error) throw outcome;
		return outcome;
	});
	const ctx = { helpers: { request }, logger: {} };
	const result = workspace369ApiTest.call(ctx as never, {
		id: 'c1',
		name: 'Workspace369',
		type: 'workspace369Api',
		data,
	});
	return { result, request };
}

describe('Workspace369Api credential', () => {
	const cred = new Workspace369Api();
	const good = { apiKey: 'test_token_not_real', baseUrl: 'https://api.example.com/' };

	it('has the expected name and fields', () => {
		expect(cred.name).toBe('workspace369Api');
		const apiKey = cred.properties.find((p) => p.name === 'apiKey');
		expect(apiKey?.typeOptions?.password).toBe(true);
		expect(apiKey?.displayName).toBe('API Key (Personal Access Token)');
		expect(apiKey?.description).toContain('workspace:read');
		const baseUrl = cred.properties.find((p) => p.name === 'baseUrl');
		expect(baseUrl?.default).toBe('https://mcp.workspace369.com');
		expect(baseUrl?.description).toContain('https://');
	});

	it('adds the Bearer header to https requests', async () => {
		const out = await cred.authenticate(good, {
			url: 'https://api.example.com/v1/tools/clients_search',
			headers: { Accept: 'application/json' },
		});
		expect(out.headers).toEqual({
			Accept: 'application/json',
			Authorization: 'Bearer test_token_not_real',
		});
	});

	it('refuses to attach the token to a plain http base URL or request', async () => {
		await expect(
			cred.authenticate(
				{ ...good, baseUrl: 'http://api.example.com' },
				{
					url: 'http://api.example.com/v1/tools/clients_search',
				},
			),
		).rejects.toThrow(HTTPS_ONLY_MESSAGE);
		await expect(
			cred.authenticate(good, { url: 'http://api.example.com/v1/tools/clients_search' }),
		).rejects.toThrow(HTTPS_ONLY_MESSAGE);
		await expect(
			cred.authenticate(
				{ ...good, baseUrl: 'http://api.example.com' },
				{
					baseURL: 'http://api.example.com',
					url: '/v1/tools/workspace_get_context',
				},
			),
		).rejects.toThrow(HTTPS_ONLY_MESSAGE);
	});

	it('is tested by both nodes, not by a declarative request', () => {
		expect((cred as { test?: unknown }).test).toBeUndefined();
		for (const node of [new Workspace369(), new Workspace369Trigger()]) {
			expect(node.description.credentials).toEqual([
				{ name: 'workspace369Api', required: true, testedBy: CREDENTIAL_TEST_NAME },
			]);
			expect(node.methods.credentialTest[CREDENTIAL_TEST_NAME]).toBe(workspace369ApiTest);
		}
	});
});

describe('credential test', () => {
	const good = { apiKey: 'test_token_not_real', baseUrl: 'https://api.example.com/' };

	it('calls workspace_get_context over https with the token', async () => {
		const { result, request } = runTest(good);
		expect(await result).toEqual({ status: 'OK', message: 'Connection successful' });
		expect(request).toHaveBeenCalledWith({
			method: 'POST',
			uri: 'https://api.example.com/v1/tools/workspace_get_context',
			headers: { Authorization: 'Bearer test_token_not_real' },
			body: {},
			json: true,
		});
	});

	it('refuses a non-https base URL without sending anything', async () => {
		for (const baseUrl of ['http://api.example.com', 'api.example.com', 'ftp://api.example.com']) {
			const { result, request } = runTest({ ...good, baseUrl });
			expect(await result).toEqual({ status: 'Error', message: HTTPS_ONLY_MESSAGE });
			expect(request).not.toHaveBeenCalled();
		}
	});

	it('says which scope is missing', async () => {
		const { result } = runTest(
			good,
			legacyError(403, {
				code: 'insufficient_scope',
				message: 'This token does not have the workspace:read scope.',
				details: { required_scope: 'workspace:read' },
			}),
		);
		const out = await result;
		expect(out.status).toBe('Error');
		expect(out.message).toContain('This token does not have the workspace:read scope.');
		expect(out.message).toContain('tick workspace:read');
	});

	it('passes the plan message through', async () => {
		const { result } = runTest(
			good,
			legacyError(403, {
				code: 'plan_required',
				message: 'The Workspace369 API needs the Specialist plan.',
			}),
		);
		expect((await result).message).toBe('The Workspace369 API needs the Specialist plan.');
	});

	it('explains an empty Token balance', async () => {
		const { result } = runTest(
			good,
			legacyError(402, { code: 'usage_exhausted', message: 'Out of Tokens.' }),
		);
		expect((await result).message).toBe('Out of Tokens. The connection test uses 1 Token.');
	});

	it('falls back to plain sentences when the body has no API error', () => {
		expect(describeTestFailure(legacyError(401))).toContain("didn't accept this API key");
		expect(describeTestFailure(legacyError(403))).toContain('workspace:read');
		expect(describeTestFailure(legacyError(402))).toContain('1 Token');
		expect(describeTestFailure(new Error('getaddrinfo ENOTFOUND api.example.com'))).toBe(
			'getaddrinfo ENOTFOUND api.example.com',
		);
	});

	it('reads an API error from a JSON string body', () => {
		const err = Object.assign(new Error('401'), {
			statusCode: 401,
			error: JSON.stringify({ error: { code: 'unauthorized', message: 'Invalid token.' } }),
		});
		expect(describeTestFailure(err)).toBe('Invalid token.');
	});
});
