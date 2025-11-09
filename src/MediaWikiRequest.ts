import { parse } from 'cookie';
import { MediaWikiResponse } from './MediaWikiResponse';

const INELIGIBLE_QUERY_PARAMS = [
    'action',
    'veaction',
    'diff',
    'curid',
    'oldid',
    'debug',
    'redirect'
];

export class MediaWikiRequest {
    private req: Request;
    private env: Env;
    public readonly cookies: Record<string, string | undefined> = {};
    public readonly url: URL;

    constructor( req: Request, env: Env ) {
        this.req = req;
        this.env = env;

        const cookieHeader = this.req.headers.get( 'Cookie' );

        if ( cookieHeader ) {
            this.cookies = parse( cookieHeader );
        }

        this.url = new URL( this.req.url );
    }

    /**
     * Try to see if we can cache this page. This is purely an optimisation of kind
     * since we know beforehand that some requests should be cached or not. It is intended to check
     * common cases like a session cookie etc. 
     * MediaWiki is ultimately the decider, and we respect the cahce control header emitted
     */
    private get canTryCache(): boolean {
        // For static files, always try to cache them.
        if (this.url.hostname.startsWith('static.')) {
            return true;
        }

        // don't cache if a session cookie is present
        for ( const cookieName of this.env.NO_CACHE_COOKIES ) {
            if ( this.cookies[ cookieName ] ) {
                return false;
            }
        }

        if ( INELIGIBLE_QUERY_PARAMS.some( key => this.url.searchParams.has( key) ) ) {
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

        // Only normalize /index.php if it's not an action URL
        if ( pathname === '/index.php' ) {
            const title = this.url.searchParams.get( 'title' );

            if ( title ) {
                let [ ns, articleTitle ] = title.split( ':' );

                if ( articleTitle === '' ) {
                    return; // invalid so don't normalise
                } else if ( !articleTitle ) {
                    articleTitle = ns;
                    ns = '';
                }

                this.url.pathname = `/wiki/${ ns ? `${ns}:` : ""}${articleTitle}`;
                this.url.search = "";
                this.req = new Request( this.url.toString(), this.req );
            }
        }
    }


    /**
     * Fetch the page from the origin and decide whether we cache it
     * @returns
     */
    async fetch(): Promise<MediaWikiResponse> {
        const fetchOptions: any = { cf: {} };
        const isStaticFile = this.url.hostname.startsWith('static.');

        if ( this.canTryCache ) {
            // This request is eligible for caching.
            // Normalise the URL to improve cache HIT ratio.
            this.normalizeUrl();

            fetchOptions.cf = {
                // Tell CF to cache this is it is eligible; MediaWiki will ultimately
                // decide
                cacheEverything: true,
                cacheTtlByStatus: {
                    '200': isStaticFile ? this.env.IMAGE_TTL : this.env.PAGE_TTL,
                    '300-399': -1,
                    '404': this.env.MISSING_TTL,
                    '410': -1, // Telepedia shows a 410 error for a missing wiki, don't cache
                    '500-599': -1,
                },
            };
        } 
        else {
            // This request is not eligible for caching (e.g., logged in).
            // bypass
            fetchOptions.cf = {
                cacheEverything: false
            };
        }
    
        const res = await fetch( this.req, fetchOptions );
        return new MediaWikiResponse( res );
    }
}