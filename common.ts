import { Config, GenerationKind, generationKindNames } from "./types.js";

const version: string = require('./package.json').version;

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

const config: Config = getConfig();

export function fetchData<T>(path: string): Promise<T> {
    return new Promise<T>((resp, err) => {
        //console.debug((!!config.contextPath ? '/' + config.contextPath : '') + path);
        http.get({
            hostname: config.hostname,
            port: config.port,
            path: (!!config.contextPath ? '/' + config.contextPath : '') + path,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': `stalker-to-m3u/${version}`,
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
                //console.debug(`Retrieved data (${data.length} bytes)`);
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