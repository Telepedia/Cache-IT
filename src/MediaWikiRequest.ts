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

interface Article {
    ns: string;
    title: string;
}

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

    extractArticle( title: string | null): Article | null {
        if ( !title ) {
            return {
                ns: '',
                title: 'Main_Page'
            }
        }

        let [ ns, articleTitle ] = title.split( ':' );

        if ( articleTitle === '' ) {
            return null;
        } else if ( !articleTitle ) {
            articleTitle = ns;
            ns = '';
        }

        return {
            ns, title: articleTitle
        }
    }

    get targetArticle(): Article | null {
        if ( this.url.pathname === '/index.php' ) {
            const title = this.url.searchParams.get( 'title' );
            return this.extractArticle( title );
        } else if ( this.url.pathname === '/' ) {
            return {
                ns: '',
                title: 'Main_Page'
            };
        } else if ( this.url.pathname.startsWith( '/wiki/' ) ) {
            return this.extractArticle( this.url.pathname.slice( 6) );
        }
        return null;
    }

    get shouldCache(): boolean {
        
        // explicitly pass api.php and rest.php through cache
        if (this.url.pathname === '/api.php' || this.url.pathname === '/rest.php') {
            return false;
        }

        for ( const cookieName of this.env.NO_CACHE_COOKIES ) {
            if ( this.cookies[ cookieName ] ) {
                return false;
            }
        }

        const article = this.targetArticle;
        if ( !article ) {
            return false;
        }

        if ( INELIGIBLE_QUERY_PARAMS.some( key => this.url.searchParams.has( key) ) ) {
            return false;
        }

        // since we allow wikis to create custom namespaces, or alternatively, an extension may add a namespace
        // we cannot account for setting namespaces that CAN be cached, we must do the inverse and list all of the
        // namespaces that SHOULD NOT be cahced instead.
        const noCacheNamespaces: string[] = this.env.NAMESPACES_INELIGIBLE_FOR_CACHE;
        if ( noCacheNamespaces.includes( article.ns ) ) {
            return false;
        }

        return true;
    }

    async fetch(): Promise<MediaWikiResponse> {
	    const targetArticle = this.targetArticle;
	    
	    // Check if this is a static file domain, this avoids the ugly regex we had previously where
		// file description pages et al would be cached?!
	    const isStaticFile = this.url.hostname.startsWith('static.');
	    
	    if ( this.shouldCache && targetArticle && this.url.pathname === '/index.php' ) {
	        const { ns, title } = targetArticle;
	        this.url.pathname = `/wiki/${ ns ? `${ns}:` : ""}${title}`;
	        this.url.search = "";
	        this.req = new Request( this.url.toString(), this.req );
	    }
	
	    const fetchOptions: any = { cf: {} };
	    
	    if ( this.shouldCache ) {
	        fetchOptions.cf = {
	            cacheTtlByStatus: {
	                '200': this.env.PAGE_TTL,
	                '300-399': -1,
	                '404': this.env.MISSING_TTL,
	                '410': -1, // Telepedia shows a 410 error for a missing wiki, don't cache
	                '500-599': -1,
	            },
	            cacheEverything: true
	        };
	    } 
	    // For static files, cache them regardless of login state
	    else if ( isStaticFile ) {
	        fetchOptions.cf = {
	            cacheTtlByStatus: {
	                '200': this.env.IMAGE_TTL,
	                '404': this.env.MISSING_TTL,
	                '500-599': -1,
	            },
	            cacheEverything: true
	        };
	    } 
	    else {
	        fetchOptions.cf = {
	            cacheEverything: false
	        };
	    }
	
	    const res = await fetch( this.req, fetchOptions );
	    return new MediaWikiResponse( res );
	}
}
