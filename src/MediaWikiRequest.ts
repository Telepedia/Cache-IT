import { parse } from 'cookie';
import { MediaWikiResponse } from './MediaWikiResponse';

const INELIGIBLE_QUERY_PARAMS = ['action', 'veaction', 'diff', 'curid', 'oldid', 'debug', 'redirect'];

export class MediaWikiRequest {
	private req: Request;
	private env: Env;
	public readonly cookies: Record<string, string | undefined> = {};
	public readonly url: URL;

	constructor(req: Request, env: Env) {
		this.req = req;
		this.env = env;

		const cookieHeader = this.req.headers.get('Cookie');

		if (cookieHeader) {
			this.cookies = parse(cookieHeader);
		}

		this.url = new URL(this.req.url);
	}

	/**
	 * Checks if the user has a session cookie.
     * This pretty fucked but seems to work?!
	 */
	private get isLoggedIn(): boolean {
		for (const cookieName of this.env.NO_CACHE_COOKIES) {
			if (this.cookies[cookieName]) {
				return true;
			}
		}
		return false;
	}

	/**
	 * See if we can cache this page type
	 */
	private get isCacheablePageType(): boolean {
		// For static files, always try to cache them.
		if (this.url.hostname.startsWith('static.')) {
			return true;
		}

		if (INELIGIBLE_QUERY_PARAMS.some((key) => this.url.searchParams.has(key))) {
			return false;
		}

		// This request looks like an anonymous page view.
        // It's eligible to be checked whether we can cache it
        // this requires a trip to the origin to check what cache control
        // header MediaWiki sent, but its a one-shot pony as it will be cached
        // if MediaWiki deemed eligible.
		return true;
	}

	/**
	 * Normalise some stuff in the URL to improve cache hit ratio.
	 * @returns
	 */
	private normalizeUrl(): void {
		const pathname = this.url.pathname;

		if (pathname === '/index.php') {
			const title = this.url.searchParams.get('title');

			if (title) {
				let [ns, articleTitle] = title.split(':');

				if (articleTitle === '') {
					return; // invalid so don't normalise
				} else if (!articleTitle) {
					articleTitle = ns;
					ns = '';
				}

				this.url.pathname = `/wiki/${ns ? `${ns}:` : ''}${articleTitle}`;
				this.url.search = '';
				this.req = new Request(this.url.toString(), this.req);
			}
		}
	}

	/**
	 * Fetch the page from the origin and decide whether we cache it
	 * @returns
	 */
	async fetch(): Promise<MediaWikiResponse> {
		const isStaticFile = this.url.hostname.startsWith('static.');

		this.normalizeUrl();

		const loggedIn = this.isLoggedIn;

		if (loggedIn) {
			const fetchOptions: any = {
				cf: {
					cacheEverything: false,
					cacheTtl: -1,
				},
			};
			const res = await fetch(this.req, fetchOptions);
			return new MediaWikiResponse(res);
		}

		if (!this.isCacheablePageType) {
			const fetchOptions: any = {
				cf: {
					cacheEverything: false,
					cacheTtl: -1,
				},
			};
			const res = await fetch(this.req, fetchOptions);
			return new MediaWikiResponse(res);
		}

		const cache = caches.default;
		const cacheKeyRequest = new Request(this.req.url);

		const cachedResponse = await cache.match(cacheKeyRequest);
		if (cachedResponse) {
			return new MediaWikiResponse(cachedResponse);
		}

		const fetchOptions: any = {
			cf: {
				cacheEverything: false,
				cacheTtl: -1,
			},
		};

		const res = await fetch(this.req, fetchOptions);
		const status = res.status;

		let shouldStore = false;
		let cacheTtl: number | undefined;

		if (status === 404) {
			shouldStore = true;
			cacheTtl = this.env.MISSING_TTL;
		} else if (status === 200) {
			shouldStore = true;
			if (isStaticFile) {
				cacheTtl = this.env.IMAGE_TTL;
			}
		} else if (status >= 300 && status <= 399) {
			shouldStore = false;
		} else if (status === 410 || (status >= 500 && status <= 599)) {
			shouldStore = false;
		}

		if (shouldStore) {
			const responseToCache = res.clone();

			if (cacheTtl !== undefined) {
				const newHeaders = new Headers(responseToCache.headers);
				newHeaders.set('Cache-Control', `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`);

				const cachedResponse = new Response(responseToCache.body, {
					status: responseToCache.status,
					statusText: responseToCache.statusText,
					headers: newHeaders,
				});

				await cache.put(cacheKeyRequest, cachedResponse);
			} else {
				await cache.put(cacheKeyRequest, responseToCache);
			}
		}

		return new MediaWikiResponse(res);
	}
}
