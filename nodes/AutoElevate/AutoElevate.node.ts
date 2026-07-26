import type {
	IDataObject,
	ICredentialDataDecryptedObject,
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchItems,
	INodeListSearchResult,
	INodeCredentialTestResult,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	autoElevateApiRequest,
	autoElevateApiRequestAllItems,
	createHmacAuthorization,
	getAutoElevateErrorDetails,
	type AutoElevateListResponse,
	unwrapLocator,
} from './GenericFunctions';
import { autoElevateProperties } from './descriptions';

type ListResource =
	| 'companies'
	| 'computers'
	| 'elevated-sessions'
	| 'elevation-requests'
	| 'locations';

function dateToEpoch(value: string): number | undefined {
	if (!value) return undefined;
	const epoch = Date.parse(value);
	return Number.isNaN(epoch) ? undefined : epoch;
}

function optionalLocator(context: IExecuteFunctions, name: string, index: number): string {
	try {
		return unwrapLocator(context.getNodeParameter(name, index, ''));
	} catch {
		return '';
	}
}

async function getList(
	context: IExecuteFunctions,
	itemIndex: number,
	endpoint: string,
	query: IDataObject,
	cursorPagination = false,
): Promise<IDataObject[]> {
	const returnAll = context.getNodeParameter('returnAll', itemIndex) as boolean;
	const limit = returnAll
		? Number.POSITIVE_INFINITY
		: (context.getNodeParameter('limit', itemIndex) as number);
	return autoElevateApiRequestAllItems.call(
		context,
		endpoint,
		query,
		cursorPagination,
		limit,
	);
}

async function searchResource(
	this: ILoadOptionsFunctions,
	resource: ListResource,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const take = 100;
	const skip = Math.max(0, Number.parseInt(paginationToken ?? '0', 10) || 0);
	const query: IDataObject = { take };
	query.skip = skip;
	if (resource === 'elevation-requests') query.approvalState = 'PENDING';
	const normalizedFilter = filter?.trim().toLowerCase();
	let items: IDataObject[];
	let hasMore = false;
	if (normalizedFilter) {
		items = await autoElevateApiRequestAllItems.call(
			this,
			`/api/v1/${resource}`,
			resource === 'elevation-requests' ? { approvalState: 'PENDING' } : {},
		);
	} else {
		const response = (await autoElevateApiRequest.call(
			this,
			'GET',
			`/api/v1/${resource}`,
			{},
			query,
		)) as unknown as AutoElevateListResponse;
		items = response.items ?? [];
		hasMore =
			(response.totalCount !== undefined && skip + take < response.totalCount) ||
			response.hasMore === true;
	}
	items = items.filter((item) => {
		if (!normalizedFilter) return true;
		return Object.values(item).some(
			(value) => typeof value === 'string' && value.toLowerCase().includes(normalizedFilter),
		);
	});
	const results: INodeListSearchItems[] = items.map((item) => {
		const id = String(item.id);
		let name = String(item.name ?? item.machineName ?? item.targetDescription ?? id);
		if (resource === 'elevated-sessions') {
			name = `${String(item.userName ?? 'Unknown user')} — ${String(item.status ?? '')} (${id})`;
		}
		if (resource === 'elevation-requests') {
			name = `${String(item.targetDescription ?? 'Elevation request')} — ${String(item.requestedBy ?? 'Unknown user')}`;
		}
		return { name, value: id };
	});
	return {
		results,
		...(hasMore ? { paginationToken: String(skip + take) } : {}),
	};
}

export class AutoElevate implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'AutoElevate',
		name: 'autoElevate',
		icon: {
			light: 'file:autoElevate.svg',
			dark: 'file:autoElevate.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Access inventory, security events, elevation requests, and usage in AutoElevate',
		defaults: { name: 'AutoElevate' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'autoElevateApi',
				required: true,
				testedBy: 'autoElevateApiCredentialTest',
			},
		],
		properties: [
			{
				displayName:
					'The AutoElevate Partner API is in beta and may change. This node sends the required beta acknowledgment with every request.',
				name: 'betaNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Audit Log', value: 'auditLog' },
					{ name: 'Company', value: 'company' },
					{ name: 'Computer', value: 'computer' },
					{ name: 'Elevated Session', value: 'elevatedSession' },
					{ name: 'Elevation Event', value: 'elevationEvent' },
					{ name: 'Elevation Request', value: 'elevationRequest' },
					{ name: 'Elevation Rule', value: 'elevationRule' },
					{ name: 'Location', value: 'location' },
					{ name: 'Usage', value: 'usage' },
				],
				default: 'elevationRequest',
			},
			...autoElevateProperties,
		],
	};

	methods = {
		credentialTest: {
			async autoElevateApiCredentialTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted<ICredentialDataDecryptedObject>,
			): Promise<INodeCredentialTestResult> {
				const credentials = credential.data;
				if (!credentials) {
					return { status: 'Error', message: 'AutoElevate credentials are incomplete' };
				}
				const url = `${String(credentials.baseUrl).replace(/\/+$/, '')}/api/v1/usage`;
				const headers: Record<string, string> = {
					Accept: 'application/json',
					'X-Acknowledgment': 'i-understand-this-is-beta-and-may-change',
				};
				if (credentials.authentication === 'hmac') {
					headers.Authorization = createHmacAuthorization(
						'GET',
						url,
						'',
						String(credentials.hmacToken),
						String(credentials.hmacKey),
						Date.now().toString(),
					);
				} else {
					headers.Authorization = `Bearer ${String(credentials.apiToken)}`;
				}

				try {
					const response = await fetch(url, { method: 'GET', headers });
					if (response.ok) return { status: 'OK', message: 'Connection successful' };
					const responseBody = (await response.json().catch(() => ({}))) as IDataObject;
					return {
						status: 'Error',
						message:
							typeof responseBody.message === 'string'
								? responseBody.message
								: `AutoElevate credential test failed with HTTP ${response.status}`,
					};
				} catch (error) {
					const details = getAutoElevateErrorDetails(error);
					return {
						status: 'Error',
						message: details.responseMessage ?? 'Unable to connect to AutoElevate',
					};
				}
			},
		},
		listSearch: {
			searchCompanies(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			) {
				return searchResource.call(this, 'companies', filter, paginationToken);
			},
			searchComputers(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			) {
				return searchResource.call(this, 'computers', filter, paginationToken);
			},
			searchElevatedSessions(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			) {
				return searchResource.call(this, 'elevated-sessions', filter, paginationToken);
			},
			searchElevationRequests(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			) {
				return searchResource.call(this, 'elevation-requests', filter, paginationToken);
			},
			searchLocations(
				this: ILoadOptionsFunctions,
				filter?: string,
				paginationToken?: string,
			) {
				return searchResource.call(this, 'locations', filter, paginationToken);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const inputItems = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < inputItems.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				let response: IDataObject | IDataObject[];

				if (resource === 'auditLog') {
					const query: IDataObject = {
						entityType: this.getNodeParameter('entityType', itemIndex, '') as string,
						action: this.getNodeParameter('auditAction', itemIndex, '') as string,
						start: dateToEpoch(this.getNodeParameter('start', itemIndex, '') as string),
						end: dateToEpoch(this.getNodeParameter('end', itemIndex, '') as string),
					};
					response = await getList(this, itemIndex, '/api/v1/audit-logs', query, true);
				} else if (resource === 'company') {
					if (operation === 'get') {
						const id = unwrapLocator(this.getNodeParameter('companyId', itemIndex));
						response = await autoElevateApiRequest.call(this, 'GET', `/api/v1/companies/${id}`);
					} else {
						response = await getList(this, itemIndex, '/api/v1/companies', {});
					}
				} else if (resource === 'computer') {
					if (operation === 'get') {
						const id = unwrapLocator(this.getNodeParameter('computerId', itemIndex));
						response = await autoElevateApiRequest.call(this, 'GET', `/api/v1/computers/${id}`);
					} else {
						response = await getList(this, itemIndex, '/api/v1/computers', {
							companyId: optionalLocator(this, 'companyId', itemIndex),
							locationId: optionalLocator(this, 'locationId', itemIndex),
						});
					}
				} else if (resource === 'elevatedSession') {
					if (operation === 'get') {
						const id = unwrapLocator(this.getNodeParameter('elevatedSessionId', itemIndex));
						response = await autoElevateApiRequest.call(
							this,
							'GET',
							`/api/v1/elevated-sessions/${id}`,
						);
					} else {
						response = await getList(this, itemIndex, '/api/v1/elevated-sessions', {
							companyId: optionalLocator(this, 'companyId', itemIndex),
							computerId: optionalLocator(this, 'computerId', itemIndex),
							status: this.getNodeParameter('status', itemIndex, '') as string,
						});
					}
				} else if (resource === 'elevationEvent') {
					response = await getList(this, itemIndex, '/api/v1/elevation-events', {
						start: dateToEpoch(this.getNodeParameter('start', itemIndex, '') as string),
						end: dateToEpoch(this.getNodeParameter('end', itemIndex, '') as string),
						companyId: optionalLocator(this, 'companyId', itemIndex),
					});
				} else if (resource === 'elevationRequest') {
					if (operation === 'get') {
						const id = unwrapLocator(this.getNodeParameter('elevationRequestId', itemIndex));
						response = await autoElevateApiRequest.call(
							this,
							'GET',
							`/api/v1/elevation-requests/${id}`,
						);
					} else if (operation === 'approve' || operation === 'deny') {
						const id = unwrapLocator(this.getNodeParameter('elevationRequestId', itemIndex));
						const createRule = this.getNodeParameter('createRule', itemIndex) as boolean;
						const body: IDataObject = { createRule };
						if (createRule) {
							body.ruleLevel = this.getNodeParameter('ruleLevel', itemIndex) as string;
						}
						if (operation === 'approve') {
							const elevationType = this.getNodeParameter(
								'elevationType',
								itemIndex,
								'',
							) as string;
							const duration = this.getNodeParameter(
								'durationInMinutes',
								itemIndex,
								0,
							) as number;
							if (elevationType) body.elevationType = elevationType;
							if (duration > 0) body.durationInMinutes = duration;
						}
						response = await autoElevateApiRequest.call(
							this,
							'POST',
							`/api/v1/elevation-requests/${id}/${operation}`,
							body,
						);
					} else {
						response = await getList(this, itemIndex, '/api/v1/elevation-requests', {
							start: dateToEpoch(this.getNodeParameter('start', itemIndex, '') as string),
							end: dateToEpoch(this.getNodeParameter('end', itemIndex, '') as string),
							companyId: optionalLocator(this, 'companyId', itemIndex),
							approvalState: this.getNodeParameter(
								'approvalState',
								itemIndex,
								'',
							) as string,
						});
					}
				} else if (resource === 'elevationRule') {
					response = await getList(this, itemIndex, '/api/v1/elevation-rules', {
						companyId: optionalLocator(this, 'companyId', itemIndex),
					});
				} else if (resource === 'location') {
					if (operation === 'get') {
						const id = unwrapLocator(this.getNodeParameter('locationId', itemIndex));
						response = await autoElevateApiRequest.call(this, 'GET', `/api/v1/locations/${id}`);
					} else {
						response = await getList(this, itemIndex, '/api/v1/locations', {
							companyId: optionalLocator(this, 'companyId', itemIndex),
						});
					}
				} else if (resource === 'usage') {
					response = await autoElevateApiRequest.call(this, 'GET', '/api/v1/usage');
				} else {
					throw new NodeOperationError(this.getNode(), `Unsupported resource: ${resource}`);
				}

				const output = Array.isArray(response) ? response : [response];
				returnData.push(
					...output.map((json) => ({
						json,
						pairedItem: { item: itemIndex },
					})),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					// The error is already normalized with n8n's node error classes.
					// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
					throw error;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
