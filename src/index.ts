import { MediaWikiRequest } from "./MediaWikiRequest";
import { log } from "./logger";

const DOMAIN_REDIRECTS: Record<string, { newDomain: string; pathPrefix?: string }> = {
    'latelierdessorciers.telepedia.net': {
        newDomain: 'witchhatatelier.telepedia.net',
        pathPrefix: '/fr'
    },
	'elatelierdesombrerosdemago.telepedia.net': {
		newDomain: 'witchhatatelier.telepedia.net',
		pathPrefix: '/es'
	},
	'atelierspiczastychkapeluszy.telepedia.net': {
		newDomain: 'witchhatatelier.telepedia.net',
		pathPrefix: '/pl'
	}
};

// Check if we need to redirect this domain from its old url to the new
// language path variant
function checkDomainRedirect(request: Request): Response | null {
    const url = new URL(request.url);
    const redirect = DOMAIN_REDIRECTS[url.hostname];
    
    if (redirect) {
        const newUrl = new URL(url.href);
        newUrl.hostname = redirect.newDomain;
        
        if (redirect.pathPrefix) {
            newUrl.pathname = redirect.pathPrefix + url.pathname;
        }
        
        return Response.redirect(newUrl.toString(), 301);
    }
    
    return null;
}

export default {
	async fetch( req, env, ctx ): Promise<Response> {
		ctx.passThroughOnException();

		const redirect = checkDomainRedirect(req);
		
        if (redirect) {
            return redirect;
        }

		const request = new MediaWikiRequest( req, env );

		const response = await request.fetch().catch( err => {
			log({
				event: 'origin_fetch_error',
				error: err
			});

			return err instanceof Error ? err : new Error( `Unknown error: ${err}` );
		});

		if ( response instanceof Error ) {
			throw response;
		}

		const cacheStatus = response.res.headers.get( "cf-cache-status" );

		log({
			event: 'origin_response',
			status: response.res.status,
			ok: response.res.ok,
			originRequestId: response.res.headers.get( "x-request-id" ),
			cacheStatus
		});

		if ( !request.shouldCache || !response.res.ok ) {

			log({
				event: 'ineligible_for_cache',
				cookies: Object.keys(request.cookies),
				path: request.url.pathname,
				qs: [...request.url.searchParams.entries()],
			  });
		
			  return response.res;
		}

		return response.res;
	}
} satisfies ExportedHandler<Env>;