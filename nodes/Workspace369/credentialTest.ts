import type {
	ICredentialDataDecryptedObject,
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	INodeCredentialTestResult,
} from 'n8n-workflow';

import { DEFAULT_BASE_URL, getStatusCode, HTTPS_ONLY_MESSAGE } from './GenericFunctions';

export const CREDENTIAL_TEST_NAME = 'workspace369ApiTest';

interface ApiError {
	code?: string;
	message?: string;
	details?: { required_scope?: string };
}

/** The base URL to test against, or undefined when it isn't https. */
export function testBaseUrl(data: ICredentialDataDecryptedObject | undefined): string | undefined {
	const base = String(data?.baseUrl || DEFAULT_BASE_URL).trim();
	if (!/^https:\/\//i.test(base)) return undefined;
	return base.replace(/\/+$/, '');
}

function apiError(error: unknown): ApiError | undefined {
	const e = error as { response?: { body?: unknown }; error?: unknown };
	for (const candidate of [e?.response?.body, e?.error]) {
		let body = candidate;
		if (typeof body === 'string') {
			try {
				body = JSON.parse(body);
			} catch {
				continue;
			}
		}
		const inner = (body as { error?: ApiError } | undefined)?.error;
		if (inner && typeof inner === 'object') return inner;
	}
	return undefined;
}

/** Turn a failed connection test into a sentence that says what to fix. */
export function describeTestFailure(error: unknown): string {
	const api = apiError(error);
	const status = getStatusCode(error);
	const code = api?.code;
	const message = api?.message?.trim();

	if (code === 'insufficient_scope') {
		const scope = api?.details?.required_scope || 'workspace:read';
		return `${message || 'This token is missing a scope.'} Edit the token in Workspace369 (Settings → AI connections → Personal access tokens) and tick ${scope}; the connection test needs it.`;
	}
	if (code === 'plan_required') {
		return message || 'The Workspace369 API needs the Specialist plan or higher.';
	}
	if (code === 'usage_exhausted' || status === 402) {
		return `${message || 'This workspace is out of Tokens.'} The connection test uses 1 Token.`;
	}
	if (message) return message;
	if (status === 401) {
		return "Workspace369 didn't accept this API key. Check it's copied in full and hasn't been revoked.";
	}
	if (status === 403) {
		return 'Workspace369 refused this token. Check it has the workspace:read scope and the workspace is on the Specialist plan or higher.';
	}
	if (status) return `Workspace369 answered HTTP ${status}.`;
	return (error as Error)?.message || 'Could not reach Workspace369.';
}

/**
 * The credential test. It runs on the node (testedBy) instead of the credential
 * so it can refuse a non-https base URL before the token is sent, and report
 * the API's own reason (missing scope, plan, Tokens) instead of a bare status.
 */
export async function workspace369ApiTest(
	this: ICredentialTestFunctions,
	credential: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
	const baseUrl = testBaseUrl(credential.data);
	if (!baseUrl) return { status: 'Error', message: HTTPS_ONLY_MESSAGE };
	try {
		// The credential-test context only offers the legacy request helper.
		// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions
		await this.helpers.request({
			method: 'POST',
			uri: `${baseUrl}/v1/tools/workspace_get_context`,
			headers: { Authorization: `Bearer ${String(credential.data?.apiKey ?? '')}` },
			body: {},
			json: true,
		});
	} catch (error) {
		return { status: 'Error', message: describeTestFailure(error) };
	}
	return { status: 'OK', message: 'Connection successful' };
}
