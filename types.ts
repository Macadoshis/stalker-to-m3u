export interface Config {
    hostname: string;
    port: number;
    deviceId: string;
    mac: string;
    tvgIdPreFill?: boolean;
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
}

export interface Programs<T> {
    total_items: number;
    data: T[];
}