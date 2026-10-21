import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { CREDENTIAL_TEST_NAME, workspace369ApiTest } from '../Workspace369/credentialTest';
import { EVENTS } from './events';
import type { HookRecord } from './hooksApi';
import { createHook, deleteHook, findHook, listHooks } from './hooksApi';
import { isTimestampFresh, verifySignature } from './signature';

export class Workspace369Trigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Workspace369 Trigger',
		name: 'workspace369Trigger',
		icon: { light: 'file:workspace369.svg', dark: 'file:workspace369.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Start a workflow instantly when something happens in Workspace369',
		defaults: {
			name: 'Workspace369 Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'workspace369Api', required: true, testedBy: 'workspace369ApiTest' }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				// Answer deliveries with an empty 200; Workspace369 only checks for 2xx.
				responseData: 'noData',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Workspace369 sends events to your n8n webhook address, so n8n must be reachable at a public https URL. On a self-hosted n8n, set the N8N_WEBHOOK_URL environment variable. Older n8n versions use WEBHOOK_URL.',
				name: 'publicUrlNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: EVENTS,
				default: [],
				description: 'Which events should start this workflow',
			},
		],
	};

	methods = {
		credentialTest: { [CREDENTIAL_TEST_NAME]: workspace369ApiTest },
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const hook = await findHook(this, webhookUrl);
				if (!hook) return false;
				const staticData = this.getWorkflowStaticData('node');
				const wanted = [...(this.getNodeParameter('events', []) as string[])].sort();
				const current = [...(hook.events ?? [])].sort();
				const sameEvents =
					wanted.length === current.length && wanted.every((event, i) => event === current[i]);
				if (!staticData.secret || staticData.hookId !== hook.id || !sameEvents) {
					// We can't check this hook's signatures (no secret for it), or its
					// events changed. Remove it so create() registers a fresh one; this
					// also keeps stale hooks from counting against the workspace's cap.
					await deleteHook(this, hook.id);
					delete staticData.hookId;
					delete staticData.secret;
					return false;
				}
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events', []) as string[];
				const hook = await createHook(this, webhookUrl, events);
				const staticData = this.getWorkflowStaticData('node');
				staticData.hookId = hook.id;
				staticData.secret = hook.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const id = staticData.hookId as string | undefined;
				if (id) {
					await deleteHook(this, id);
				}
				delete staticData.hookId;
				delete staticData.secret;
				// A crash between creating a hook and saving its id can leave a second
				// hook for this URL. It would keep delivering (and failing the signature
				// check) and count against the cap, so remove any others too.
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				let others: HookRecord[] = [];
				try {
					others = (await listHooks(this, webhookUrl)).filter((hook) => hook.id !== id);
				} catch (error) {
					// Listing is only a clean-up; it must not stop the workflow from deactivating.
					this.logger.warn(
						`Workspace369 Trigger: could not check for leftover hooks: ${(error as Error).message}`,
					);
				}
				for (const hook of others) {
					await deleteHook(this, hook.id);
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const staticData = this.getWorkflowStaticData('node');
		const secret = staticData.secret as string | undefined;
		const req = this.getRequestObject();

		const reject = (message: string): IWebhookResponseData => {
			this.getResponseObject().status(401).json({ error: message });
			return { noWebhookResponse: true };
		};

		// Fail closed: no stored secret means we cannot verify, so we do not run.
		if (!secret) return reject('No signing secret');

		const rawBody = req.rawBody ? req.rawBody.toString('utf8') : undefined;
		const timestamp = this.getHeaderData()['x-webhook-timestamp'] as string | undefined;
		const signature = this.getHeaderData()['x-webhook-signature'] as string | undefined;
		if (rawBody === undefined || !verifySignature(secret, rawBody, timestamp, signature)) {
			return reject('Invalid signature');
		}
		if (!isTimestampFresh(timestamp)) return reject('Stale timestamp');

		const envelope = this.getBodyData() as IDataObject;
		const events = this.getNodeParameter('events', []) as string[];
		if (
			events.length > 0 &&
			typeof envelope.event_type === 'string' &&
			!events.includes(envelope.event_type)
		) {
			return { webhookResponse: 'ignored' };
		}

		return { workflowData: [this.helpers.returnJsonArray(envelope)] };
	}
}
