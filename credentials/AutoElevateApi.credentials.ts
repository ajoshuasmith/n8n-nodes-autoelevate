import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class AutoElevateApi implements ICredentialType {
	name = 'autoElevateApi';

	displayName = 'AutoElevate Partner API';

	icon = 'file:../nodes/AutoElevate/autoElevate.svg' as const;

	documentationUrl = 'https://partner-api-docs.autoelevate.com/';

	properties: INodeProperties[] = [
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'options',
			options: [
				{
					name: 'API Token (AE-BEARER)',
					value: 'bearer',
				},
				{
					name: 'HMAC (AE-HMAC-SHA256)',
					value: 'hmac',
				},
			],
			default: 'bearer',
		},
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authentication: ['bearer'] } },
			description: 'The aeb_ token shown when an AE-BEARER API key is created',
		},
		{
			displayName: 'HMAC Token',
			name: 'hmacToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authentication: ['hmac'] } },
			description: 'The aeh_ wire token shown when an AE-HMAC-SHA256 API key is created',
		},
		{
			displayName: 'HMAC Signing Key',
			name: 'hmacKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authentication: ['hmac'] } },
			description: 'The separate signing key shown once when the HMAC API key is created',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://partner-api.autoelevate.com',
			required: true,
			description: 'Partner API base URL. Change only when AutoElevate provides another environment.',
		},
	];

}
