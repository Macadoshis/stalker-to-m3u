export interface BaseConfig {
    streamTester?: StreamTester;
    userAgent?: string;
}

export interface Config extends BaseConfig {
    hostname: string;
    contextPath?: string;
    port: number;
    mac: string;
    outputDir?: string;
    deviceId1?: string;
    deviceId2?: string;
    serialNumber?: string;
    tvgIdPreFill?: boolean;
    tokenCacheDuration?: number;
    delayBetweenUrlGeneration?: number;
    computeUrlLink?: boolean;
    maxNumberOfChannelsToTest?: number;
    vodMaxPagePerGenre?: number;
    vodIncludeRating?: boolean;
    vodOrdering?: VodOrdering;
    testM3uFile?: boolean
}

export type VodOrdering = 'none' | 'rating' | 'alphabetic';
export type StreamTester = 'http' | 'ffmpeg';

export type GenerationKind = 'iptv' | 'vod' | 'series';
export const generationKindNames = ['iptv', 'vod', 'series'] as string[];

export interface Data<T> {
    js: T;
}

export interface ArrayData<T> {
    js: T[];
}

export interface Genre {
    id: string;
    title: string;
    number: number;
    alias: string
}

export interface Program {
    id: string;
    name: string;
    cmd: string;
}

export interface Channel extends Program {
    logo: string;
    tv_genre_id: string;
}

export interface Video extends Program {
    screenshot_uri: string;
    category_id: string;
    time: number;
    rating_imdb: string;
}

export interface Serie extends Program {
    screenshot_uri: string;
    category_id: string;
    series: Array<number>;
}

export interface Programs<T extends Program> {
    total_items: number;
    max_page_items: number;
    data: T[];
}

export interface M3ULine {
    header: string;
    title: string;
    name: string;
    command?: string;
    url?: string;
    testResult?: boolean;
    episode?: number;
    data?: any;
}

export class M3U {
    private readonly _m3uLines: M3ULine[];

    constructor(m3uLines: M3ULine[] = []) {
        this._m3uLines = m3uLines;
    }

    print(config: Config): string {
        const ret: string[] = ['#EXTM3U'];
        this._m3uLines.forEach(m3uLine => {
            if (!config.computeUrlLink || !!m3uLine.url) {
                ret.push(...[m3uLine.header, (m3uLine.url ?? m3uLine.command)!]);
            }
        });
        return ret.join('\r\n');
    }
}


export class GenreSerie {
    readonly genre: Genre;
    readonly serie: Serie;

    constructor(genre: Genre, serie: Serie) {
        this.genre = genre;
        this.serie = serie;
    }

    toString(): string {
        return this.genre.title + " / " + this.serie.name;
    }
}

export type GenreSeries = { genre: Genre, series: Serie[] };

export interface M3uTesterConfig extends BaseConfig {
    m3uLocation: string;
    maxFailures: number;
    minSuccess: number;
    renameOnFailure?: boolean;
    renamePrefix?: string;
    threadsCount?: number
}

export interface M3uResultStream {
    name: string;
    url: string;
}

export interface M3uResult {
    file: string;
    status: boolean;
    failedStreams: M3uResultStream[];
    succeededStreams: M3uResultStream[];
}

export type UrlConfig = Pick<Omit<Config, 'mac'>, 'hostname' | 'port' | 'contextPath'> & Partial<Pick<Config, 'mac'>>;