export interface Config {
    hostname: string;
    contextPath?: string;
    port: number;
    deviceId: string;
    mac: string;
    tvgIdPreFill?: boolean;
    computeUrlLink?: boolean;
    vodMaxPagePerGenre?: number;
}

export type GenerationKind = 'iptv' | 'vod';
export const generationKindNames = ['iptv', 'vod'] as string[];
export type GenerationKindType = typeof generationKindNames[number];

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
}

export interface Programs<T> {
    total_items: number;
    max_page_items: number;
    data: T[];
}

export interface M3ULine {
    header: string;
    command?: string;
    url?: string;
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