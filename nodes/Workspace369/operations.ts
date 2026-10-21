import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { callTool } from './GenericFunctions';

const MAX_PAGE = 100;

type Fn = IExecuteFunctions;

function csv(value: unknown): string[] {
	return String(value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Fetch one or all pages of a search tool and return the records. */
export async function searchAll(
	this: Fn,
	tool: string,
	key: string,
	filters: IDataObject,
	itemIndex: number,
): Promise<IDataObject[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = returnAll ? Infinity : (this.getNodeParameter('limit', itemIndex, 50) as number);
	const records: IDataObject[] = [];
	let cursor: string | undefined;
	const usedCursors = new Set<string>();
	do {
		const pageSize = Math.min(MAX_PAGE, limit - records.length);
		const response = await callTool.call(this, tool, {
			...filters,
			limit: pageSize,
			cursor,
		});
		const page = (response[key] as IDataObject[] | undefined) ?? [];
		records.push(...page);
		cursor = (response.nextCursor as string | undefined) || undefined;
		// Stop if the API hands back a cursor we already used, so we never loop forever.
		if (cursor) {
			if (usedCursors.has(cursor)) break;
			usedCursors.add(cursor);
		}
	} while (cursor && records.length < limit);
	return records.slice(0, limit);
}

function toItems(records: IDataObject[], itemIndex: number): INodeExecutionData[] {
	return records.map((json) => ({ json, pairedItem: { item: itemIndex } }));
}

/**
 * A held action (202) comes back as `{ held_for_approval: true, ... }` and is passed through as is.
 * Creates return the flat record with `deduped` alongside (`withDeduped`).
 */
function unwrap(
	response: IDataObject,
	key: string,
	itemIndex: number,
	withDeduped = false,
): INodeExecutionData[] {
	let record: IDataObject;
	if (response.held_for_approval) {
		record = response;
	} else {
		record = (response[key] as IDataObject) ?? response;
		if (withDeduped && response[key] !== undefined && response.deduped !== undefined) {
			record = { ...record, deduped: response.deduped };
		}
	}
	return [{ json: record, pairedItem: { item: itemIndex } }];
}

export async function runOperation(
	this: Fn,
	resource: string,
	operation: string,
	i: number,
): Promise<INodeExecutionData[]> {
	const p = <T>(name: string, fallback?: unknown) => this.getNodeParameter(name, i, fallback) as T;

	if (resource === 'client' && operation === 'create') {
		const extra = p<IDataObject>('additionalFields', {});
		const response = await callTool.call(this, 'clients_create', {
			name: p<string>('name'),
			...extra,
		});
		return unwrap(response, 'client', i, true);
	}

	if (resource === 'client' && operation === 'search') {
		const filters = { ...p<IDataObject>('filters', {}) };
		if (filters.tags !== undefined) filters.tags = csv(filters.tags);
		return toItems(await searchAll.call(this, 'clients_search', 'clients', filters, i), i);
	}

	if (resource === 'request' && operation === 'search') {
		const filters = p<IDataObject>('filters', {});
		return toItems(await searchAll.call(this, 'requests_search', 'requests', filters, i), i);
	}

	if (resource === 'request' && operation === 'get') {
		const response = await callTool.call(this, 'requests_get', { id: p<string>('requestId') });
		if (!response.request) {
			throw new NodeOperationError(this.getNode(), 'Request not found', { itemIndex: i });
		}
		return unwrap(response, 'request', i);
	}

	if (resource === 'invoice' && operation === 'list') {
		const filters = p<IDataObject>('filters', {});
		return toItems(await searchAll.call(this, 'invoices_search', 'invoices', filters, i), i);
	}

	if (resource === 'invoice' && operation === 'get') {
		const lookupBy = p<string>('lookupBy', 'id');
		const body =
			lookupBy === 'invoice_number'
				? { invoice_number: p<string>('invoiceNumber') }
				: { id: p<string>('invoiceId') };
		const response = await callTool.call(this, 'invoices_get', body);
		if (!response.invoice) {
			throw new NodeOperationError(this.getNode(), 'Invoice not found', { itemIndex: i });
		}
		return unwrap(response, 'invoice', i);
	}

	if (resource === 'calendarEvent' && operation === 'create') {
		const extra = { ...p<IDataObject>('additionalFields', {}) };
		const unassigned = extra.unassigned === true;
		delete extra.unassigned;
		if (extra.assigned_user_ids !== undefined)
			extra.assigned_user_ids = csv(extra.assigned_user_ids);
		if (unassigned && (extra.assigned_user_ids as string[] | undefined)?.length) {
			throw new NodeOperationError(
				this.getNode(),
				'Choose either Assigned User IDs or Leave Unassigned, not both',
				{ itemIndex: i },
			);
		}
		// An empty assignee list leaves the event unassigned; leaving the field out
		// assigns it to the token's owner. omitEmpty would drop [], so send it as is.
		const response = await callTool.call(
			this,
			'calendar_create_event',
			{ title: p<string>('title'), starts_at: p<string>('starts_at'), ...extra },
			unassigned ? { assigned_user_ids: [] } : {},
		);
		return unwrap(response, 'event', i, true);
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation "${operation}" is not supported for "${resource}"`,
		{ itemIndex: i },
	);
}
