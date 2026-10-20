import { describe, expect, it } from 'vitest';

import { Workspace369Api } from '../credentials/Workspace369Api.credentials';

describe('Workspace369Api credential', () => {
	const cred = new Workspace369Api();

	it('has the expected name and fields', () => {
		expect(cred.name).toBe('workspace369Api');
		const apiKey = cred.properties.find((p) => p.name === 'apiKey');
		expect(apiKey?.typeOptions?.password).toBe(true);
		expect(apiKey?.displayName).toBe('API Key (Personal Access Token)');
		const baseUrl = cred.properties.find((p) => p.name === 'baseUrl');
		expect(baseUrl?.default).toBe('https://mcp.workspace369.com');
		expect(baseUrl?.description).toContain('https://');
	});

	it('authenticates with a Bearer header', () => {
		expect(cred.authenticate).toEqual({
			type: 'generic',
			properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
		});
	});

	it('tests the connection with workspace_get_context', () => {
		expect(cred.test.request).toMatchObject({
			method: 'POST',
			url: '/v1/tools/workspace_get_context',
			body: {},
			baseURL: '={{$credentials.baseUrl}}',
		});
	});
});
