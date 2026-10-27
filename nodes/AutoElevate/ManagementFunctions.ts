import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import {
	autoElevateApiRequest,
	autoElevateApiRequestAllItems,
	unwrapLocator,
} from './GenericFunctions';

export async function executeManagement(
	context: IExecuteFunctions,
	index: number,
	resource: string,
	operation: string,
): Promise<IDataObject | IDataObject[]> {
	const parameter = (name: string, fallback: unknown = '') =>
		context.getNodeParameter(name, index, fallback);
	const fail = (message: string): never => {
		throw new NodeOperationError(context.getNode(), message, {
			itemIndex: index,
		});
	};
	const id = (name: string): string => {
		const value = unwrapLocator(parameter(name));
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
			fail(`${name} must be a UUID`);
		return value;
	};
	const request = (
		method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
		path: string,
		body: IDataObject = {},
	) => autoElevateApiRequest.call(context, method, path, body);
	const list = (path: string) =>
		autoElevateApiRequestAllItems.call(
			context,
			path,
			{},
			false,
			parameter('returnAll', false) ? Number.POSITIVE_INFINITY : Number(parameter('limit', 50)),
		);
	const selectedFields = (name: string, allowed: string[]): IDataObject => {
		const value = parameter(name, {}) as IDataObject;
		if (!value || typeof value !== 'object' || Array.isArray(value))
			fail(`${name} must be an object`);
		for (const key of Object.keys(value))
			if (!allowed.includes(key)) fail(`Unsupported field: ${key}`);
		return { ...value };
	};
	if (operation === 'delete' && parameter('confirmDeletion', false) !== true)
		fail('Enable Confirm Deletion to delete this record');

	if (resource === 'computer') {
		const path = `/api/v1/computers/${id('computerId')}`;
		if (operation === 'delete') return request('DELETE', path);
		if (operation === 'setTechnicianMode')
			return request('POST', `${path}/technician-mode`, {
				enabled: parameter('enabled', false) as boolean,
			});
		if (operation === 'setElevationMode')
			return request('POST', `${path}/elevation-mode`, {
				mode: parameter('mode') as string,
			});
	}
	if (resource === 'elevationEvent' && operation === 'get')
		return request('GET', `/api/v1/elevation-events/${id('elevationEventId')}`);
	if (resource === 'elevationRule') {
		const path = `/api/v1/elevation-rules/${id('elevationRuleId')}`;
		if (operation === 'get') return request('GET', path);
		if (operation === 'delete') return request('DELETE', path);
		if (operation === 'update') {
			const body = selectedFields('updateFields', [
				'approved',
				'elevationType',
				'shouldIgnore',
				'friendlyName',
				'notes',
				'identificationCriteria',
			]);
			for (const key of ['friendlyName', 'notes']) if (body[key] === '') body[key] = null;
			if (body.identificationCriteria !== undefined) {
				let criteria: unknown = body.identificationCriteria;
				if (typeof criteria === 'string') {
					try {
						criteria = JSON.parse(criteria);
					} catch {
						fail('Identification Criteria must be valid JSON');
					}
				}
				if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria))
					fail('Identification Criteria must be a JSON object');
				body.identificationCriteria = criteria as IDataObject;
			}
			if (Object.keys(body).length === 0) fail('Select at least one field to update');
			return request('PATCH', path, body);
		}
	}
	if (resource === 'role') {
		if (operation === 'get') return request('GET', `/api/v1/roles/${id('roleId')}`);
		if (operation === 'getMany') {
			const response = await request('GET', '/api/v1/roles');
			return response.items as IDataObject[];
		}
	}
	if (resource === 'user') {
		if (operation === 'getMany') return list('/api/v1/users');
		if (operation === 'get') return request('GET', `/api/v1/users/${id('userId')}`);
		if (operation === 'delete') return request('DELETE', `/api/v1/users/${id('userId')}`);
		if (operation === 'create' || operation === 'update') {
			const body =
				operation === 'create'
					? {
							...selectedFields('additionalFields', [
								'lastName',
								'technicianModeTicketingEnabled',
								'sendInvitationEmail',
							]),
							firstName: parameter('firstName') as string,
							email: parameter('email') as string,
							roleId: id('roleId'),
						}
					: selectedFields('updateFields', [
							'firstName',
							'lastName',
							'roleId',
							'technicianModeTicketingEnabled',
						]);
			if (body.roleId !== undefined) {
				body.roleId = unwrapLocator(body.roleId);
				if (!body.roleId) fail('Select a role');
			}
			const accessType = parameter(
				'companyAccessType',
				operation === 'create' ? 'none' : '',
			) as string;
			if (accessType) {
				if (!['all', 'none', 'some', 'most'].includes(accessType))
					fail('Unsupported company access type');
				const access: IDataObject = { type: accessType };
				if (accessType === 'some' || accessType === 'most') {
					const companies = parameter('companies', {}) as {
						company?: { companyId: unknown }[];
					};
					const ids = (companies.company ?? []).map((company) => unwrapLocator(company.companyId));
					if (!ids.length || ids.some((value) => !value))
						fail('Select at least one company for this access type');
					access.companyIds = [...new Set(ids)];
				}
				body.companyAccess = access;
			}
			if (Object.keys(body).length === 0) fail('Select at least one field to update');
			return operation === 'create'
				? request('POST', '/api/v1/users', body)
				: request('PATCH', `/api/v1/users/${id('userId')}`, body);
		}
	}
	if (resource === 'webhook') {
		if (operation === 'getMany') return list('/api/v1/webhooks');
		if (operation === 'create' || operation === 'update') {
			const body =
				operation === 'create'
					? {
							...selectedFields('additionalFields', ['format', 'companyId']),
							name: parameter('name') as string,
							url: parameter('url') as string,
							eventSubscriptions: parameter('eventSubscriptions', []) as string[],
						}
					: selectedFields('updateFields', [
							'name',
							'url',
							'eventSubscriptions',
							'format',
							'enabled',
							'companyId',
						]);
			if (body.companyId !== undefined) {
				const companyId = unwrapLocator(body.companyId);
				if (companyId) body.companyId = companyId;
				else if (operation === 'update') body.companyId = null;
				else delete body.companyId;
			}
			if (
				body.eventSubscriptions !== undefined &&
				(!Array.isArray(body.eventSubscriptions) || !body.eventSubscriptions.length)
			)
				fail('Select at least one webhook event');
			if (
				body.companyId &&
				(body.eventSubscriptions as string[] | undefined)?.some((event) =>
					event.startsWith('user.'),
				)
			)
				fail('User events require a webhook scoped to all companies');
			if (body.url !== undefined) {
				try {
					if (new URL(String(body.url)).protocol !== 'https:') fail('Webhook URL must use HTTPS');
				} catch {
					fail('Webhook URL must be a valid HTTPS URL');
				}
			}
			if (Object.keys(body).length === 0) fail('Select at least one field to update');
			return operation === 'create'
				? request('POST', '/api/v1/webhooks', body)
				: request('PATCH', `/api/v1/webhooks/${id('webhookId')}`, body);
		}
		const path = `/api/v1/webhooks/${id('webhookId')}`;
		if (operation === 'get') return request('GET', path);
		if (operation === 'delete') return request('DELETE', path);
		if (operation === 'test') return request('POST', `${path}/test`);
		if (operation === 'getDeliveryLogs') {
			const response = await request('GET', `${path}/delivery-logs`);
			return response.deliveryLogs as IDataObject[];
		}
	}
	return fail(`Unsupported operation: ${resource}.${operation}`);
}
