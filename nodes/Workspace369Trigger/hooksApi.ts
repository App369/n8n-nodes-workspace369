/**
 * Every call to the Workspace369 REST hooks API lives in this file, so the
 * request and response shapes can be adjusted in one place.
 *
 * Shapes (Workspace369-API #772):
 *   POST   /v1/hooks            { target_url, events } -> { id, events, target_url, secret }
 *   GET    /v1/hooks?target_url=  -> { hooks: [{ id, events, target_url }] } (or a bare array)
 *   DELETE /v1/hooks/{id}       -> 204 (404 means already gone)
 */
import type { IDataObject, IHookFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { asNodeError, getStatusCode, workspace369Request } from '../Workspace369/GenericFunctions';

export const HOOKS_OFF_MESSAGE = "Instant triggers aren't switched on for Workspace369 yet.";
export const PUBLIC_URL_MESSAGE =
	'Workspace369 can only send events to a public https address. Make n8n reachable over https (for example by setting the N8N_WEBHOOK_URL environment variable) and try again.';

export interface HookRecord {
	id: string;
	events?: string[];
	target_url?: string;
	secret?: string;
}

export function assertPublicHttps(context: IHookFunctions, url: string): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new NodeOperationError(context.getNode(), PUBLIC_URL_MESSAGE);
	}
	const host = parsed.hostname;
	const isLocal =
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host === '::1' ||
		/^127\./.test(host) ||
		/^10\./.test(host) ||
		/^192\.168\./.test(host) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(host);
	if (parsed.protocol !== 'https:' || isLocal) {
		throw new NodeOperationError(context.getNode(), PUBLIC_URL_MESSAGE);
	}
}

async function hooksRequest(
	context: IHookFunctions,
	method: 'GET' | 'POST' | 'DELETE',
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	try {
		return await workspace369Request.call(context, method, path, body, qs);
	} catch (error) {
		if (method !== 'DELETE' && getStatusCode(error) === 404) {
			throw new NodeOperationError(context.getNode(), HOOKS_OFF_MESSAGE);
		}
		throw asNodeError(context.getNode(), error);
	}
}

/** Every hook registered for exactly this target URL. */
export async function listHooks(context: IHookFunctions, targetUrl: string): Promise<HookRecord[]> {
	const response = await hooksRequest(context, 'GET', '/v1/hooks', undefined, {
		target_url: targetUrl,
	});
	const list = (Array.isArray(response) ? response : (response.hooks ?? [])) as HookRecord[];
	return list.filter((hook) => hook.target_url === targetUrl);
}

export async function findHook(
	context: IHookFunctions,
	targetUrl: string,
): Promise<HookRecord | undefined> {
	return (await listHooks(context, targetUrl))[0];
}

export async function createHook(
	context: IHookFunctions,
	targetUrl: string,
	events: string[],
): Promise<HookRecord> {
	assertPublicHttps(context, targetUrl);
	const response = await hooksRequest(context, 'POST', '/v1/hooks', {
		target_url: targetUrl,
		events,
	});
	const hook = response as unknown as HookRecord;
	if (!hook.id || !hook.secret) {
		throw new NodeOperationError(
			context.getNode(),
			'Workspace369 did not return a signing secret for this trigger, so its events could not be checked. Try activating the workflow again.',
		);
	}
	return hook;
}

/** Deletes a hook. Returns true when it is gone (including when it was already gone). */
export async function deleteHook(context: IHookFunctions, id: string): Promise<boolean> {
	try {
		await hooksRequest(context, 'DELETE', `/v1/hooks/${encodeURIComponent(id)}`);
		return true;
	} catch (error) {
		if (getStatusCode(error) === 404) return true;
		throw asNodeError(context.getNode(), error);
	}
}
