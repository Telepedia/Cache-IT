import { parse } from 'cookie';
import { MediaWikiResponse } from './MediaWikiResponse';

const INELIGIBLE_QUERY_PARAMS = ['action', 'veaction', 'diff', 'curid', 'oldid', 'debug', 'redirect'];
const MOBILE_UA_REGEX =
	/mobi|240x240|240x320|320x320|alcatel|android|audiovox|bada|benq|blackberry|cdm-|compal-|docomo|ericsson|hiptop|htc[-_]|huawei|ipod|kddi-|kindle|meego|midp|mitsu|mmp\/|mot-|motor|ngm_|nintendo|opera.m|palm|panasonic|philips|phone|playstation|portalmmm|sagem-|samsung|sanyo|sec-|semc-browser|sendo|sharp|silk|softbank|symbian|teleca|up.browser|vodafone|webos/i;

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
	get isLoggedIn(): boolean {
		for (const cookieName of this.env.NO_CACHE_COOKIES) {
			if (this.cookies[cookieName]) {
				return true;
			}
		}
		return false;
	}

	get shouldBypassCache(): boolean {
		if (INELIGIBLE_QUERY_PARAMS.some((key) => this.url.searchParams.has(key))) {
			return true;
		}
		return this.isLoggedIn;
	}

	/**
	 * Normalise some stuff in the URL to improve cache hit ratio.
	 * @returns
	 */
	normaliseUrl() {
		const pathname = this.url.pathname;
		if (pathname === '/index.php') {
			const title = this.url.searchParams.get('title');
			if (title) {
				let [ns, articleTitle] = title.split(':');
				if (articleTitle === '') return;
				else if (!articleTitle) {
					articleTitle = ns;
					ns = '';
				}
				this.url.pathname = `/wiki/${ns ? `${ns}:` : ''}${articleTitle}`;
				this.url.searchParams.delete('title');
				this.req = new Request(this.url.toString(), this.req);
			}
		}
	}

	/**
	 * Fetch the page from the origin and decide whether we cache it
	 * @returns
	 */
	async fetch() {
		this.normaliseUrl();
		this.url.searchParams.delete('tpMobile');
		const bypassCache = this.shouldBypassCache;
		const ua = this.req.headers.get('user-agent') || '';
		const accept = this.req.headers.get('accept') || '';
		const mobileAction = this.url.searchParams.get('mobileaction');
		const useFormat = this.url.searchParams.get('useformat');
		const cookieStr = this.req.headers.get('Cookie') || '';
		const hasMobileCookie = cookieStr.includes('mf_useformat=true');
		const hasDesktopCookie = cookieStr.includes('stopMobileRedirect=true');
		const forceMobile = mobileAction === 'toggle_view_mobile' || useFormat === 'mobile';
		const forceDesktop = mobileAction === 'toggle_view_desktop' || useFormat === 'desktop' || hasDesktopCookie;
		const isSamsungTv = /SMART-TV.*SamsungBrowser/.test(ua);
		const isMobileUA = (MOBILE_UA_REGEX.test(ua) || accept.includes('vnd.wap.wml')) && !isSamsungTv;
		let isMobile = false;
		if (forceMobile || (!forceDesktop && (hasMobileCookie || isMobileUA))) {
			isMobile = true;
		}
		this.url.searchParams.delete('mobileaction');
		this.url.searchParams.delete('useformat');
		if (mobileAction === 'toggle_view_mobile' || mobileAction === 'toggle_view_desktop') {
			const expires = new Date(Date.now() + 2592e6).toUTCString();
			const domain = this.url.hostname;
			const response = new Response(null, {
				status: 302,
				headers: {
					Location: this.url.toString(),
					'Cache-Control': 'no-cache',
				},
			});
			if (mobileAction === 'toggle_view_mobile') {
				response.headers.append(
					'Set-Cookie',
					`stopMobileRedirect=deleted; expires=Thu, 01-Jan-1970 00:00:01 GMT; path=/; domain=.${domain}; secure; HttpOnly`,
				);
				response.headers.append('Set-Cookie', `mf_useformat=true; expires=${expires}; path=/; domain=.${domain}; secure; HttpOnly`);
			} else if (mobileAction === 'toggle_view_desktop') {
				response.headers.append('Set-Cookie', `stopMobileRedirect=true; expires=${expires}; path=/; domain=.${domain}; secure; HttpOnly`);
				response.headers.append(
					'Set-Cookie',
					`mf_useformat=deleted; expires=Thu, 01-Jan-1970 00:00:01 GMT; path=/; domain=.${domain}; secure; HttpOnly`,
				);
			}
			return new MediaWikiResponse(response);
		}
		const cacheUrl = new URL(this.url.toString());
		if (isMobile && cacheUrl.searchParams.get('action') !== 'raw') {
			cacheUrl.searchParams.set('tpMobile', '1');
		}
		const headers = new Headers(this.req.headers);
		let cookieHeader = headers.get('Cookie') || '';
		cookieHeader = cookieHeader.replace(/;?\s*mf_useformat=true/g, '');
		cookieHeader = cookieHeader.replace(/;?\s*stopMobileRedirect=true/g, '');
		if (isMobile) {
			cookieHeader = 'mf_useformat=true; ' + cookieHeader;
		} else {
			cookieHeader = 'stopMobileRedirect=true; ' + cookieHeader;
		}
		cookieHeader = cookieHeader.replace(/;\s*;/g, ';').trim();
		headers.set('Cookie', cookieHeader);
		let request = new Request(cacheUrl.toString(), {
			headers,
			method: this.req.method,
			body: this.req.body,
			redirect: this.req.redirect,
		});
		if (!bypassCache) {
			request = new Request(request, {
				cf: {
					cacheEverything: true,
				},
			});
		}
		const response = await fetch(request);
		const modifiableResponse = new Response(response.body, response);
		if (!bypassCache) {
			modifiableResponse.headers.set('Cache-Control', 'private, must-revalidate, max-age=0, stale-while-revalidate=90');
		}
		return new MediaWikiResponse(modifiableResponse);
	}
}
