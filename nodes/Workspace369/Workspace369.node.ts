import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { properties } from './descriptions';
import { asNodeError } from './GenericFunctions';
import { runOperation } from './operations';

export class Workspace369 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Workspace369',
		name: 'workspace369',
		icon: { light: 'file:workspace369.svg', dark: 'file:workspace369.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Manage clients, requests, invoices and calendar events in Workspace369',
		defaults: {
			name: 'Workspace369',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'workspace369Api', required: true }],
		properties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				returnData.push(...(await runOperation.call(this, resource, operation, i)));
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw asNodeError(this.getNode(), error, i);
			}
		}

		return [returnData];
	}
}
