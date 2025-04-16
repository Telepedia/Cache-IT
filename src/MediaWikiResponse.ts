export class MediaWikiResponse {
    private _res: Response;

    constructor( res: Response ) {
        this._res = res;
    }

    public get res(): Response {
        return this._res;
    }
}