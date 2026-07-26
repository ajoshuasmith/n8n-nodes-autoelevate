import type { INodeProperties } from 'n8n-workflow';
import {
	companyFilter,
	dateRangeFields,
	getAndListOperations,
	idLocator,
	paginationFields,
} from './Common';

const getManyOnly = (resource: string, action: string): INodeProperties => ({
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: [resource] } },
	options: [{ name: 'Get Many', value: 'getMany', action }],
	default: 'getMany',
});

export const autoElevateProperties: INodeProperties[] = [
	getManyOnly('auditLog', 'Get many audit log entries'),
	...dateRangeFields('auditLog'),
	{
		displayName: 'Entity Type',
		name: 'entityType',
		type: 'options',
		default: '',
		options: [
			{ name: 'All', value: '' },
			{ name: 'Settings', value: 'settings' },
			{ name: 'Users', value: 'users' },
		],
		displayOptions: { show: { resource: ['auditLog'], operation: ['getMany'] } },
	},
	{
		displayName: 'Action',
		name: 'auditAction',
		type: 'options',
		default: '',
		options: [
			{ name: 'All', value: '' },
			{ name: 'Created', value: 'created' },
			{ name: 'Updated', value: 'updated' },
			{ name: 'Deleted', value: 'deleted' },
		],
		displayOptions: { show: { resource: ['auditLog'], operation: ['getMany'] } },
	},
	...paginationFields('auditLog'),

	getAndListOperations('company'),
	idLocator('company', 'Company', 'companyId', 'searchCompanies'),
	...paginationFields('company'),

	getAndListOperations('computer'),
	idLocator('computer', 'Computer', 'computerId', 'searchComputers'),
	companyFilter('computer'),
	{
		displayName: 'Location',
		name: 'locationId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		displayOptions: { show: { resource: ['computer'], operation: ['getMany'] } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchLocations', searchable: true },
			},
			{ displayName: 'By ID', name: 'id', type: 'string' },
		],
	},
	...paginationFields('computer'),

	getAndListOperations('elevatedSession'),
	idLocator(
		'elevatedSession',
		'Elevated Session',
		'elevatedSessionId',
		'searchElevatedSessions',
	),
	companyFilter('elevatedSession'),
	{
		displayName: 'Computer',
		name: 'computerId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		displayOptions: { show: { resource: ['elevatedSession'], operation: ['getMany'] } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchComputers', searchable: true },
			},
			{ displayName: 'By ID', name: 'id', type: 'string' },
		],
	},
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		default: '',
		options: [
			{ name: 'All', value: '' },
			{ name: 'Active', value: 'active' },
			{ name: 'Inactive', value: 'inactive' },
		],
		displayOptions: { show: { resource: ['elevatedSession'], operation: ['getMany'] } },
	},
	...paginationFields('elevatedSession'),

	getManyOnly('elevationEvent', 'Get many elevation events'),
	...dateRangeFields('elevationEvent'),
	companyFilter('elevationEvent'),
	...paginationFields('elevationEvent'),

	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['elevationRequest'] } },
		options: [
			{ name: 'Approve', value: 'approve', action: 'Approve an elevation request' },
			{ name: 'Deny', value: 'deny', action: 'Deny an elevation request' },
			{ name: 'Get', value: 'get', action: 'Get an elevation request' },
			{ name: 'Get Many', value: 'getMany', action: 'Get many elevation requests' },
		],
		default: 'getMany',
	},
	idLocator(
		'elevationRequest',
		'Elevation Request',
		'elevationRequestId',
		'searchElevationRequests',
		['get', 'approve', 'deny'],
	),
	...dateRangeFields('elevationRequest'),
	companyFilter('elevationRequest'),
	{
		displayName: 'Approval State',
		name: 'approvalState',
		type: 'options',
		default: '',
		options: [
			{ name: 'All', value: '' },
			{ name: 'Approved', value: 'APPROVED' },
			{ name: 'Denied', value: 'DENIED' },
			{ name: 'Pending', value: 'PENDING' },
		],
		displayOptions: { show: { resource: ['elevationRequest'], operation: ['getMany'] } },
	},
	{
		displayName: 'Elevation Type',
		name: 'elevationType',
		type: 'options',
		default: '',
		options: [
			{ name: 'Use Request Default', value: '' },
			{ name: 'Admin', value: 'admin' },
			{ name: 'User', value: 'user' },
		],
		displayOptions: { show: { resource: ['elevationRequest'], operation: ['approve'] } },
	},
	{
		displayName: 'Duration (Minutes)',
		name: 'durationInMinutes',
		type: 'number',
		default: 0,
		typeOptions: { minValue: 0 },
		description: 'For session requests. Leave at 0 to use the request default.',
		displayOptions: { show: { resource: ['elevationRequest'], operation: ['approve'] } },
	},
	{
		displayName: 'Create Rule',
		name: 'createRule',
		type: 'boolean',
		default: false,
		description: 'Whether to create a matching auto-approval or auto-denial rule',
		displayOptions: {
			show: { resource: ['elevationRequest'], operation: ['approve', 'deny'] },
		},
	},
	{
		displayName: 'Rule Level',
		name: 'ruleLevel',
		type: 'options',
		default: 'computer',
		required: true,
		options: [
			{ name: 'Company', value: 'company' },
			{ name: 'Computer', value: 'computer' },
			{ name: 'Location', value: 'location' },
			{ name: 'MSP', value: 'msp' },
		],
		displayOptions: {
			show: {
				resource: ['elevationRequest'],
				operation: ['approve', 'deny'],
				createRule: [true],
			},
		},
	},
	...paginationFields('elevationRequest'),

	getManyOnly('elevationRule', 'Get many elevation rules'),
	companyFilter('elevationRule'),
	...paginationFields('elevationRule'),

	getAndListOperations('location'),
	idLocator('location', 'Location', 'locationId', 'searchLocations'),
	companyFilter('location'),
	...paginationFields('location'),

	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['usage'] } },
		options: [{ name: 'Get', value: 'get', action: 'Get partner usage data' }],
		default: 'get',
	},
];
