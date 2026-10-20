import { vi } from 'vitest';

export const FAKE_CREDENTIALS = {
	apiKey: 'test_token_not_real',
	baseUrl: 'https://api.example.com/',
};

export interface MockOptions {
	params?: Record<string, unknown>;
	responses?: unknown[];
	continueOnFail?: boolean;
	staticData?: Record<string, unknown>;
	webhookUrl?: string;
	headers?: Record<string, string>;
	rawBody?: string;
	body?: Record<string, unknown>;
	baseUrl?: string;
}

/** A minimal stand-in for IExecuteFunctions / IHookFunctions / IWebhookFunctions. */
export function mockContext(options: MockOptions = {}) {
	const responses = [...(options.responses ?? [])];
	const request = vi.fn(async () => {
		const next = responses.shift();
		if (next instanceof Error) throw next;
		return next ?? {};
	});
	const staticData = options.staticData ?? {};
	const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
	const ctx = {
		helpers: {
			httpRequestWithAuthentication: request,
			returnJsonArray: (d: unknown) => [{ json: d }],
		},
		getCredentials: vi.fn(async () => ({
			...FAKE_CREDENTIALS,
			...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
		})),
		getNode: () => ({
			name: 'Workspace369',
			type: 'n8n-nodes-workspace369.workspace369',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
			id: 'n1',
		}),
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name: string, _i?: unknown, fallback?: unknown) => {
			const params = options.params ?? {};
			return name in params ? params[name] : fallback;
		},
		continueOnFail: () => options.continueOnFail ?? false,
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => options.webhookUrl ?? 'https://n8n.example.com/webhook/abc/webhook',
		getRequestObject: () => ({
			rawBody: options.rawBody === undefined ? undefined : Buffer.from(options.rawBody),
		}),
		getHeaderData: () => options.headers ?? {},
		getBodyData: () => options.body ?? {},
		getResponseObject: () => res,
	};
	return { ctx, request, staticData, res };
}

export function httpError(status: number, message?: string): Error {
	const err = new Error(message ?? `Request failed with status code ${status}`) as Error & {
		httpCode: string;
		response: { body: unknown };
	};
	err.httpCode = String(status);
	err.response = {
		body: message ? { error: { code: 'x', message, details: {} } } : {},
	};
	return err;
}
