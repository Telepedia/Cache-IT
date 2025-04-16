import { MediaWikiRequest } from "./MediaWikiRequest";
import { log } from "./logger";

export default {
	async fetch( req, env, ctx ): Promise<Response> {
		ctx.passThroughOnException();

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