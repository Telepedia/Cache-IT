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
	get isLoggedIn(): boolean {
		for (const cookieName of this.env.NO_CACHE_COOKIES) {
			if (this.cookies[cookieName]) {
				return true;
			}
		}
		return false;
	}

	get shouldBypassCache(): boolean {
		if (INELIGIBLE_QUERY_PARAMS.some( ( key) => this.url.searchParams.has( key ) ) ) {
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
		if ( pathname === "/index.php" ) {
			const title = this.url.searchParams.get( "title" );
			if ( title ) {
				let [ ns, articleTitle ] = title.split(":");
				if ( articleTitle === "" ) return;
				else if ( !articleTitle ) {
					articleTitle = ns;
					ns = "";
				}
				this.url.pathname = `/wiki/${ns ? `${ns}:` : ""}${articleTitle}`;
				this.url.searchParams.delete( "title" );
				this.req = new Request( this.url.toString(), this.req );
			}
		}
	}

	/**
	 * Fetch the page from the origin and decide whether we cache it
	 * @returns
	 */
	async fetch() {
		this.normaliseUrl();
		const bypassCache = this.shouldBypassCache;
		let request = this.req;
		if ( !bypassCache ) {
			request = new Request( this.req, {
				cf: {
					cacheEverything: true
				}
			} );
		}
		const response = await fetch( request );
		const modifiableResponse = new Response(response.body, response);
		if ( !bypassCache ) {
			modifiableResponse.headers.set(
				"Cache-Control",
				"private, must-revalidate, max-age=0, stale-while-revalidate=90"
			);
		}
		return new MediaWikiResponse(modifiableResponse);
	}
}
