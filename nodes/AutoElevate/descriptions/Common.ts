import type { INodeProperties } from 'n8n-workflow';

export const listOperation: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	options: [{ name: 'Get Many', value: 'getMany', action: 'Get many records' }],
	default: 'getMany',
};

export function getAndListOperations(resource: string): INodeProperties {
	return {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [resource] } },
		options: [
			{ name: 'Get', value: 'get', action: `Get a ${resource}` },
			{ name: 'Get Many', value: 'getMany', action: `Get many ${resource}s` },
		],
		default: 'getMany',
	};
}

export function idLocator(
	resource: string,
	displayName: string,
	name: string,
	searchListMethod: string,
	operations: string[] = ['get'],
): INodeProperties {
	return {
		displayName,
		name,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		displayOptions: { show: { resource: [resource], operation: operations } },
		description:
			'Select from the list or enter a UUID. Searching scans all API pages because AutoElevate does not expose a server-side search parameter.',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod, searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
							errorMessage: 'Enter a valid UUID',
						},
					},
				],
			},
		],
	};
}

export function companyFilter(resource: string): INodeProperties {
	return {
		displayName: 'Company',
		name: 'companyId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		displayOptions: { show: { resource: [resource], operation: ['getMany'] } },
		description: 'Optionally scope results to one managed company',
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchCompanies', searchable: true },
			},
			{ displayName: 'By ID', name: 'id', type: 'string' },
		],
	};
}

export function paginationFields(resource: string): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			displayOptions: { show: { resource: [resource], operation: ['getMany'] } },
			description: 'Whether to return all results or only up to a given limit',
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: { minValue: 1, maxValue: 10000 },
			displayOptions: {
				show: { resource: [resource], operation: ['getMany'], returnAll: [false] },
			},
			description: 'Max number of results to return',
		},
	];
}

export const dateRangeFields = (resource: string): INodeProperties[] => [
	{
		displayName: 'Start',
		name: 'start',
		type: 'dateTime',
		default: '',
		displayOptions: { show: { resource: [resource], operation: ['getMany'] } },
		description: 'Inclusive start of the date range',
	},
	{
		displayName: 'End',
		name: 'end',
		type: 'dateTime',
		default: '',
		displayOptions: { show: { resource: [resource], operation: ['getMany'] } },
		description: 'Inclusive end of the date range',
	},
];
