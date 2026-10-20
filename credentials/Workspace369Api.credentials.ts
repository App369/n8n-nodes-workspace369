import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

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
				'Create one in Workspace369 under Settings → AI connections → Personal access tokens',
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

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/tools/workspace_get_context',
			method: 'POST',
			body: {},
		},
	};
}
