import type {
	ICredentialDataDecryptedObject,
	Icon,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

const HTTPS_ONLY_MESSAGE = 'The Workspace369 base URL must start with https://';

export class Workspace369Api implements ICredentialType {
	name = 'workspace369Api';

	displayName = 'Workspace369 API';

	icon: Icon = {
		light: 'file:../icons/workspace369.svg',
		dark: 'file:../icons/workspace369.dark.svg',
	};

	documentationUrl = 'https://github.com/App369/n8n-nodes-workspace369#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key (Personal Access Token)',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create one in Workspace369 under Settings → AI connections → Personal access tokens. Tick the workspace:read scope: the connection test needs it and uses 1 Token.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://mcp.workspace369.com',
			required: true,
			description:
				'Must start with https://. Only change this if Workspace369 support gave you a different address',
		},
	];

	/**
	 * Adds the Bearer header, but only to https requests, so a mistyped or
	 * plain-http base URL never carries the token in clear text. The connection
	 * test runs on the nodes (testedBy), which check the base URL the same way.
	 */
	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const base = String(credentials.baseUrl || 'https://mcp.workspace369.com').trim();
		const url = String(requestOptions.url ?? '');
		const target = /^[a-z][a-z0-9+.-]*:/i.test(url)
			? url
			: `${requestOptions.baseURL ?? base}${url}`;
		if (!/^https:\/\//i.test(base) || !/^https:\/\//i.test(target)) {
			throw new Error(HTTPS_ONLY_MESSAGE);
		}
		return {
			...requestOptions,
			headers: {
				...requestOptions.headers,
				Authorization: `Bearer ${String(credentials.apiKey ?? '')}`,
			},
		};
	}
}
