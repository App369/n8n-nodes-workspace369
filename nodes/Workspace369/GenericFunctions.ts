import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'workspace369Api';
export const DEFAULT_BASE_URL = 'https://mcp.workspace369.com';

type Context = IExecuteFunctions | IHookFunctions;

/** Remove undefined, null, empty strings and empty arrays so only filled fields are sent. */
export function omitEmpty(input: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(input)) {
		if (value === undefined || value === null || value === '') continue;
		if (Array.isArray(value) && value.length === 0) continue;
		out[key] = value;
	}
	return out;
}

/** Pull the API's `error.message` out of the different shapes n8n errors can have. */
export function extractApiMessage(error: unknown): string | undefined {
	const e = error as {
		message?: string;
		response?: { body?: unknown };
		context?: { data?: unknown };
		cause?: { response?: { body?: unknown }; body?: unknown };
		error?: unknown;
	};
	const candidates = [
		e?.response?.body,
		e?.context?.data,
		e?.cause?.response?.body,
		e?.cause?.body,
		e?.error,
	];
	for (const candidate of candidates) {
		let body = candidate;
		if (typeof body === 'string') {
			try {
				body = JSON.parse(body);
			} catch {
				continue;
			}
		}
		const message = (body as { error?: { message?: unknown } } | undefined)?.error?.message;
		if (typeof message === 'string' && message) return message;
	}
	return undefined;
}

export function getStatusCode(error: unknown): number | undefined {
	const e = error as {
		httpCode?: string | number;
		statusCode?: number;
		response?: { status?: number; statusCode?: number };
		cause?: { httpCode?: string | number; statusCode?: number };
	};
	const raw =
		e?.httpCode ??
		e?.statusCode ??
		e?.response?.status ??
		e?.response?.statusCode ??
		e?.cause?.httpCode ??
		e?.cause?.statusCode;
	const n = Number(raw);
	return Number.isFinite(n) ? n : undefined;
}

export const HTTPS_ONLY_MESSAGE = 'The Workspace369 base URL must start with https://';

export async function getBaseUrl(context: Context): Promise<string> {
	const credentials = await context.getCredentials(CREDENTIAL_NAME);
	const base = String(credentials.baseUrl || DEFAULT_BASE_URL).trim();
	if (!/^https:\/\//i.test(base)) {
		throw new NodeOperationError(context.getNode(), HTTPS_ONLY_MESSAGE);
	}
	return base.replace(/\/+$/, '');
}

/** One authenticated request. Errors become NodeApiError carrying the API's own message. */
export async function workspace369Request(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	const baseUrl = await getBaseUrl(this);
	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${path}`,
		json: true,
	};
	if (body !== undefined) options.body = body;
	if (qs !== undefined) options.qs = qs;
	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			options,
		);
		return (response ?? {}) as IDataObject;
	} catch (error) {
		const message = extractApiMessage(error);
		throw new NodeApiError(this.getNode(), error as JsonObject, message ? { message } : undefined);
	}
}

/** POST /v1/tools/{name} with only the filled fields, plus `exact` fields sent as they are. */
export async function callTool(
	this: Context,
	tool: string,
	body: IDataObject = {},
	exact: IDataObject = {},
): Promise<IDataObject> {
	return await workspace369Request.call(this, 'POST', `/v1/tools/${tool}`, {
		...omitEmpty(body),
		...exact,
	});
}

/** Make sure what gets thrown is a NodeApiError or NodeOperationError. */
export function asNodeError(
	node: INode,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) return error;
	return new NodeOperationError(node, error as Error, { itemIndex });
}
