export interface Config {
    hostname: string;
    port: number;
    deviceId: string;
    mac: string;
}

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

export interface Channel {
    id: string;
    name: string;
    cmd: string;
    logo: string;
    tv_genre_id: string
}

export interface Channels {
    total_items: number;
    data: Channel[];
}