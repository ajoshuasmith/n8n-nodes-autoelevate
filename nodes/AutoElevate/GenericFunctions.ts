import { createHash, createHmac } from 'node:crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

const ACKNOWLEDGMENT = 'i-understand-this-is-beta-and-may-change';
const EMPTY_BODY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface AutoElevateListResponse {
	items: IDataObject[];
	totalCount?: number;
	nextCursor?: string | null;
	hasMore?: boolean;
}

type AutoElevateContext = IExecuteFunctions | ILoadOptionsFunctions;
type UnknownRecord = Record<string, unknown>;

export interface AutoElevateErrorDetails {
	statusCode: number;
	responseBody: JsonObject;
	responseMessage?: string;
	retryAfter?: string;
}

function buildUrl(baseUrl: string, endpoint: string, query: IDataObject): string {
	const url = new URL(endpoint, `${baseUrl.replace(/\/+$/, '')}/`);
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined && value !== null && value !== '') {
			url.searchParams.set(key, String(value));
		}
	}
	return url.toString();
}

export function createHmacAuthorization(
	method: string,
	url: string,
	serializedBody: string,
	token: string,
	hmacKey: string,
	timestamp: string,
): string {
	const bodyHash = serializedBody
		? createHash('sha256').update(serializedBody).digest('hex')
		: EMPTY_BODY_HASH;
	const stringToSign = ['AE-HMAC-SHA256', method.toUpperCase(), url, bodyHash, timestamp].join(
		'\n',
	);
	const signature = createHmac('sha256', hmacKey).update(stringToSign).digest('hex');
	return (
		`AE-HMAC-SHA256 token=${token},bodyHash=${bodyHash},` +
		`ts=${timestamp},sig=${signature}`
	);
}

function asRecord(value: unknown): UnknownRecord {
	return value !== null && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function getHeader(headers: unknown, name: string): string | undefined {
	const headerRecord = asRecord(headers);
	const directValue = headerRecord[name] ?? headerRecord[name.toLowerCase()];
	if (directValue !== undefined) return String(directValue);
	const get = headerRecord.get;
	if (typeof get === 'function') {
		// Must be invoked with the header object as `this`. Axios' AxiosHeaders.get
		// does Object.keys(this) internally, so an unbound call throws TypeError and
		// takes down the whole error handler.
		const value = (get as (this: unknown, headerName: string) => unknown).call(
			headerRecord,
			name,
		);
		return value === undefined || value === null ? undefined : String(value);
	}
	return undefined;
}

export function getAutoElevateErrorDetails(error: unknown): AutoElevateErrorDetails {
	const errorRecord = asRecord(error);
	const response = asRecord(errorRecord.response);
	const responseBodyValue = response.data ?? response.body ?? errorRecord;
	const responseBody = asRecord(responseBodyValue) as JsonObject;
	const responseMessageValue = responseBody.message ?? errorRecord.message;
	return {
		statusCode: Number(response.status ?? errorRecord.statusCode ?? errorRecord.httpCode ?? 0),
		responseBody,
		...(responseMessageValue ? { responseMessage: String(responseMessageValue) } : {}),
		...(getHeader(response.headers, 'retry-after')
			? { retryAfter: getHeader(response.headers, 'retry-after') }
			: {}),
	};
}

export function parseRetryAfterMs(value: string | undefined, now = Date.now()): number {
	if (!value) return 1000;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const retryAt = Date.parse(value);
	if (!Number.isNaN(retryAt)) return Math.max(0, retryAt - now);
	return 1000;
}

export function unwrapLocator(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value && typeof value === 'object' && 'value' in value) {
		return String((value as { value: unknown }).value);
	}
	return String(value ?? '');
}

export async function autoElevateApiRequest(
	this: AutoElevateContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body: IDataObject = {},
	query: IDataObject = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials('autoElevateApi');
	const url = buildUrl(String(credentials.baseUrl), endpoint, query);
	const hasBody = Object.keys(body).length > 0;
	const serializedBody = hasBody ? JSON.stringify(body) : '';
	for (let attempt = 0; attempt <= 2; attempt++) {
		const headers: Record<string, string> = {
			Accept: 'application/json',
			'X-Acknowledgment': ACKNOWLEDGMENT,
		};
		if (hasBody) headers['Content-Type'] = 'application/json';
		if (credentials.authentication === 'hmac') {
			headers.Authorization = createHmacAuthorization(
				method,
				url,
				serializedBody,
				String(credentials.hmacToken),
				String(credentials.hmacKey),
				Date.now().toString(),
			);
		} else {
			headers.Authorization = `Bearer ${String(credentials.apiToken)}`;
		}

		const options: IHttpRequestOptions = { method, url, headers, json: true };
		if (hasBody) options.body = serializedBody;

		try {
			// AutoElevate's HMAC scheme signs the exact URL and body bytes, which
			// cannot be expressed with n8n's declarative credential authentication.
			// eslint-disable-next-line @n8n/community-nodes/no-http-request-with-manual-auth
			return (await this.helpers.httpRequest(options)) as IDataObject;
		} catch (error) {
			const details = getAutoElevateErrorDetails(error);
			if (details.statusCode === 429 && attempt < 2) {
				await sleep(parseRetryAfterMs(details.retryAfter));
				continue;
			}
			const messages: Record<number, string> = {
				400: 'AutoElevate rejected the request. Check the supplied fields and beta acknowledgment.',
				401: 'AutoElevate authentication failed. Check the API key and authentication scheme.',
				403: 'The API key does not have permission for this AutoElevate operation.',
				404: 'The requested AutoElevate record was not found or is outside this partner account.',
				429: 'AutoElevate rate limit reached after two retries.',
			};
			throw new NodeApiError(this.getNode(), details.responseBody, {
				message:
					details.responseMessage ??
					messages[details.statusCode] ??
					'AutoElevate API request failed',
				description: messages[details.statusCode],
			});
		}
	}

	throw new NodeApiError(this.getNode(), {}, { message: 'AutoElevate API request failed' });
}

export async function autoElevateApiRequestAllItems(
	this: AutoElevateContext,
	endpoint: string,
	query: IDataObject = {},
	cursorPagination = false,
	maxItems = Number.POSITIVE_INFINITY,
): Promise<IDataObject[]> {
	const results: IDataObject[] = [];
	let skip = 0;
	let cursor: string | undefined;

	while (results.length < maxItems) {
		const take = Math.min(200, maxItems - results.length);
		const pageQuery: IDataObject = { ...query, take };
		if (cursorPagination) {
			if (cursor) pageQuery.cursor = cursor;
		} else {
			pageQuery.skip = skip;
		}

		const response = (await autoElevateApiRequest.call(
			this,
			'GET',
			endpoint,
			{},
			pageQuery,
		)) as unknown as AutoElevateListResponse;
		const pageItems = Array.isArray(response.items) ? response.items : [];
		results.push(...pageItems);

		if (cursorPagination) {
			if (!response.hasMore || !response.nextCursor || pageItems.length === 0) break;
			cursor = response.nextCursor;
		} else {
			if (
				pageItems.length < take ||
				(response.totalCount !== undefined && results.length >= response.totalCount)
			) {
				break;
			}
			skip += pageItems.length;
		}
	}

	return results.slice(0, maxItems);
}

export const autoElevateConstants = {
	acknowledgment: ACKNOWLEDGMENT,
	emptyBodyHash: EMPTY_BODY_HASH,
};
