import { Config, GenerationKind, generationKindNames } from "./types.js";

const http = require('http');
const fs = require('fs');

export function getConfig(): Readonly<Config> {
    const configData: string = fs.readFileSync('./config.json',
        { encoding: 'utf8', flag: 'r' });
    const config: Config = JSON.parse(configData) as Config;
    return config;
}

export function getGenerationKind(): GenerationKind {
    const arg: unknown = process.argv[2] as unknown;
    if (typeof arg !== 'string' || !generationKindNames.includes(arg)) {
        throw new Error('Invalid generation type provided');
    }
    return (arg as GenerationKind);
}

export function fetchData<T>(path: string): Promise<T> {
    return new Promise<T>((resp, err) => {
        const config: Config = getConfig();
        http.get({
            hostname: config.hostname,
            port: config.port,
            path: path,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'stalker-to-m3u/1.0.0',
                'Authorization': `Bearer ${config.deviceId}`,
                'Cookie': `mac=${config.mac}; stb_lang=en; timezone=Europe/Kiev`
            }
        }, (res: any) => {
            if (res.statusCode !== 200) {
                console.error(`Did not get an OK from the server. Code: ${res.statusCode}`);
                res.resume();
                err();
            }

            let data = '';

            res.on('data', (chunk: any) => {
                data += chunk;
            });

            res.on('close', () => {
                console.debug('Retrieved data');
                try {
                    resp(JSON.parse(data));
                } catch (e) {
                    console.error(e);
                    console.debug(data);
                    err(e);
                }

            });
        });
    });
}