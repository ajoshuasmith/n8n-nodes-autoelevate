import type { INodeProperties } from 'n8n-workflow';
import { getAndListOperations, idLocator, paginationFields } from './Common';
import { webhookEvents } from './WebhookEvents';

function operations(resource: string, actions: [string, string, string][]): INodeProperties {
	return {
		...getAndListOperations(resource),
		options: actions.map(([name, value, action]) => ({ name, value, action })),
	};
}

function fields(
	resource: string,
	operation: string[],
	name: string,
	options: INodeProperties[],
): INodeProperties {
	return {
		displayName: name === 'updateFields' ? 'Update Fields' : 'Additional Fields',
		name,
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: [resource], operation } },
		options,
	};
}

function text(displayName: string, name: string, description?: string): INodeProperties {
	return {
		displayName,
		name,
		type: 'string',
		default: '',
		...(description ? { description } : {}),
	};
}

function toggle(displayName: string, name: string, description: string): INodeProperties {
	return { displayName, name, type: 'boolean', default: false, description };
}

function locator(displayName: string, name: string, search: string): INodeProperties {
	const field = idLocator('', displayName, name, search);
	delete field.displayOptions;
	return field;
}

const userOperations: [string, string, string][] = [
	['Create', 'create', 'Create a user'],
	['Delete', 'delete', 'Delete a user'],
	['Get', 'get', 'Get a user'],
	['Get Many', 'getMany', 'Get many users'],
	['Update', 'update', 'Update a user'],
];

const companyAccessType: INodeProperties = {
	displayName: 'Company Access',
	name: 'companyAccessType',
	type: 'options',
	default: 'none',
	options: [
		{ name: 'All Companies', value: 'all' },
		{ name: 'All Except Selected Companies', value: 'most' },
		{ name: 'No Companies', value: 'none' },
		{ name: 'Selected Companies Only', value: 'some' },
	],
	description:
		'Replaces the complete company access setting. Selected companies are required for allow-lists and deny-lists.',
};

const eventSubscriptions: INodeProperties = {
	displayName: 'Events',
	name: 'eventSubscriptions',
	type: 'multiOptions',
	default: [],
	options: webhookEvents.map((event) => ({ name: event, value: event })),
	description: 'Event types to receive. User events require a webhook scoped to all companies.',
};

const webhookFormat: INodeProperties = {
	displayName: 'Format',
	name: 'format',
	type: 'options',
	default: 'native',
	options: [
		{ name: 'Native (Signed JSON)', value: 'native' },
		{ name: 'Slack Incoming Webhook', value: 'slack-incoming-webhook' },
		{ name: 'Teams Incoming Webhook', value: 'teams-incoming-webhook' },
	],
};

export const computerOperations = operations('computer', [
	['Delete', 'delete', 'Delete a computer and uninstall its agent'],
	['Get', 'get', 'Get a computer'],
	['Get Many', 'getMany', 'Get many computers'],
	['Set Elevation Mode', 'setElevationMode', 'Set a computer elevation mode'],
	['Set Technician Mode', 'setTechnicianMode', 'Turn technician mode on or off'],
]);

export const ruleOperations = operations('elevationRule', [
	['Delete', 'delete', 'Delete an elevation rule'],
	['Get', 'get', 'Get an elevation rule'],
	['Get Many', 'getMany', 'Get many elevation rules'],
	['Update', 'update', 'Update an elevation rule'],
]);

export const managementProperties: INodeProperties[] = [
	{
		displayName:
			'Computer changes apply at the next agent check-in. An accepted response does not confirm completion. Technician mode is attributed to the API token owner.',
		name: 'computerActionNotice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: {
				resource: ['computer'],
				operation: ['setElevationMode', 'setTechnicianMode', 'delete'],
			},
		},
	},
	{
		displayName: 'Elevation Mode',
		name: 'mode',
		type: 'options',
		default: 'inherit',
		options: [
			{ name: 'Audit', value: 'audit' },
			{ name: 'Inherit', value: 'inherit' },
			{ name: 'Live', value: 'live' },
			{ name: 'Policy', value: 'policy' },
		],
		description:
			'Inherit clears the computer override and restores the location, company or MSP setting',
		displayOptions: {
			show: { resource: ['computer'], operation: ['setElevationMode'] },
		},
	},
	{
		...toggle('Enabled', 'enabled', 'Whether to turn technician mode on. Windows only.'),
		displayOptions: {
			show: { resource: ['computer'], operation: ['setTechnicianMode'] },
		},
	},
	// Keep destructive actions explicit even when expressions provide the operation.
	...['computer', 'elevationRule', 'user', 'webhook'].map(
		(resource): INodeProperties => ({
			...toggle(
				'Confirm Deletion',
				'confirmDeletion',
				'Whether to delete the selected record. Deleting a computer also queues agent uninstall.',
			),
			displayOptions: { show: { resource: [resource], operation: ['delete'] } },
		}),
	),
	idLocator('elevationRule', 'Elevation Rule', 'elevationRuleId', 'searchElevationRules', [
		'get',
		'update',
		'delete',
	]),
	fields('elevationRule', ['update'], 'updateFields', [
		toggle('Approved', 'approved', 'Whether matching events are automatically approved'),
		{
			displayName: 'Elevation Type',
			name: 'elevationType',
			type: 'options',
			default: 'admin',
			options: [
				{ name: 'Admin', value: 'admin' },
				{ name: 'User', value: 'user' },
			],
		},
		text('Friendly Name', 'friendlyName', 'Leave empty to clear the friendly name'),
		{
			displayName: 'Identification Criteria (JSON)',
			name: 'identificationCriteria',
			type: 'json',
			default: '',
			description:
				'Opaque match criteria. Supply the same object structure returned by Get; the API does not publish its shape.',
		},
		text('Notes', 'notes', 'Leave empty to clear the notes'),
		toggle(
			'Treat as Audit Mode',
			'shouldIgnore',
			'Whether matching events are treated as audit mode without prompting to elevate',
		),
	]),

	operations('user', userOperations),
	idLocator('user', 'User', 'userId', 'searchUsers', ['get', 'update', 'delete']),
	...paginationFields('user'),
	...[
		text('First Name', 'firstName'),
		text('Email', 'email'),
		locator('Role', 'roleId', 'searchRoles'),
	].map(
		(field): INodeProperties => ({
			...field,
			required: true,
			displayOptions: { show: { resource: ['user'], operation: ['create'] } },
		}),
	),
	fields('user', ['create'], 'additionalFields', [
		text('Last Name', 'lastName'),
		{
			...toggle(
				'Send Invitation Email',
				'sendInvitationEmail',
				'Whether to email a link for setting the initial password',
			),
			default: true,
		},
		toggle(
			'Technician Mode Ticketing',
			'technicianModeTicketingEnabled',
			'Whether the user may use technician-mode ticketing',
		),
	]),
	fields('user', ['update'], 'updateFields', [
		text('First Name', 'firstName'),
		text('Last Name', 'lastName'),
		locator('Role', 'roleId', 'searchRoles'),
		toggle(
			'Technician Mode Ticketing',
			'technicianModeTicketingEnabled',
			'Whether the user may use technician-mode ticketing',
		),
	]),
	{
		...companyAccessType,
		displayOptions: { show: { resource: ['user'], operation: ['create'] } },
	},
	{
		...companyAccessType,
		default: '',
		options: [{ name: 'Leave Unchanged', value: '' }, ...(companyAccessType.options ?? [])],
		displayOptions: { show: { resource: ['user'], operation: ['update'] } },
	},
	{
		displayName: 'Companies',
		name: 'companies',
		type: 'fixedCollection',
		default: {},
		typeOptions: { multipleValues: true },
		placeholder: 'Add Company',
		displayOptions: {
			show: {
				resource: ['user'],
				operation: ['create', 'update'],
				companyAccessType: ['some', 'most'],
			},
		},
		options: [
			{
				displayName: 'Company',
				name: 'company',
				values: [locator('Company', 'companyId', 'searchCompanies')],
			},
		],
	},
	getAndListOperations('role'),
	idLocator('role', 'Role', 'roleId', 'searchRoles'),

	operations('webhook', [
		['Create', 'create', 'Create a webhook'],
		['Delete', 'delete', 'Delete a webhook'],
		['Get', 'get', 'Get a webhook'],
		['Get Delivery Logs', 'getDeliveryLogs', 'Get webhook delivery logs'],
		['Get Many', 'getMany', 'Get many webhooks'],
		['Test', 'test', 'Send a test webhook delivery'],
		['Update', 'update', 'Update a webhook'],
	]),
	idLocator('webhook', 'Webhook', 'webhookId', 'searchWebhooks', [
		'get',
		'update',
		'delete',
		'getDeliveryLogs',
		'test',
	]),
	...paginationFields('webhook'),
	...[
		text('Name', 'name'),
		text('URL', 'url', 'Full HTTPS delivery URL, including its path'),
		eventSubscriptions,
	].map(
		(field): INodeProperties => ({
			...field,
			required: true,
			displayOptions: {
				show: { resource: ['webhook'], operation: ['create'] },
			},
		}),
	),
	fields('webhook', ['create'], 'additionalFields', [
		{
			...locator('Company', 'companyId', 'searchCompanies'),
			required: false,
			description: 'Leave empty for all companies',
		},
		webhookFormat,
	]),
	fields('webhook', ['update'], 'updateFields', [
		{
			...locator('Company', 'companyId', 'searchCompanies'),
			required: false,
			description:
				'Leave empty to scope to all companies. Omit this field to keep the current scope.',
		},
		toggle('Enabled', 'enabled', 'Whether webhook deliveries are enabled'),
		eventSubscriptions,
		webhookFormat,
		text('Name', 'name'),
		text(
			'URL',
			'url',
			'Full HTTPS delivery URL. Omit to keep the stored URL; Get returns only its origin.',
		),
	]),
	{
		displayName:
			'Creation returns the signing secret once. Store it securely. Native JSON deliveries are signed; Teams and Slack deliveries are unsigned.',
		name: 'webhookSecretNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['webhook'], operation: ['create'] } },
	},
];
