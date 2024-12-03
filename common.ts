import {
    Config,
    Data,
    GenerationKind,
    generationKindNames,
    Genre,
    GenreSerie,
    GenreSeries,
    Programs,
    Serie
} from "./types.js";

import {firstValueFrom, forkJoin, from, map} from 'rxjs';

const version: string = require('./package.json').version;

const http = require('http');
const fs = require('fs');

const yargsParser = require('yargs-parser');

export const randomDeviceId: string = Array.from({length: 32}, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))).join('');

export const READ_OPTIONS = {encoding: 'utf8', flag: 'r'};

export function getConfig(): Readonly<Config> {
    const configData: string = fs.readFileSync('./config.json', READ_OPTIONS);
    let config: Config = JSON.parse(configData) as Config;
    if (!config.deviceId) {
        // console.log(`Using generated devideId: ${randomDeviceId}`);
        config.deviceId = randomDeviceId;
    }

    // Override with command line additional arguments
    const args = yargsParser(process.argv.slice(3));
    config = {...config, ...args};

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

export function fetchData<T>(path: string, ignoreError: boolean = false, cfg: Config = config): Promise<T> {

    return new Promise<T>((resp, err) => {

        const completePath = (!!cfg.contextPath ? '/' + cfg.contextPath : '') + path;

        const onError: (e: any) => void
            = (e) => {
            console.error(`Error at http://${cfg.hostname}:${cfg.port}${completePath} [${cfg.mac}]`, e);
            if (ignoreError) {
                resp(<T>{});
            } else {
                err(e);
            }
        };

        // console.debug((!!config.contextPath ? '/' + config.contextPath : '') + path);
        try {
            const req = http.get({
                hostname: cfg.hostname,
                port: cfg.port,
                path: completePath,
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': `stalker-to-m3u/${version}`,
                    'Authorization': `Bearer ${cfg.deviceId}`,
                    'Cookie': `mac=${cfg.mac}; stb_lang=en; timezone=Europe/Kiev`
                }
            }, (res: any) => {

                if (res.statusCode !== 200) {
                    console.error(`Did not get an OK from the server (http://${cfg.hostname}:${cfg.port}${completePath} [${cfg.mac}]). Code: ${res.statusCode}`);
                    res.resume();
                    err();
                }

                let data = '';

                res.on('data', (chunk: any) => {
                    data += chunk;
                });

                res.on('close', () => {
                    // console.debug(`Retrieved data (${data.length} bytes)`);
                    try {
                        resp(JSON.parse(!!data ? data : '{}'));
                    } catch (e) {
                        //console.error(e);
                        //console.debug(data);
                        err(e);
                    }
                });

                res.on('error', (e: NodeJS.ErrnoException) => {
                    console.error(`Response stream error: ${e?.message}`);
                    onError(e);
                });

                res.on('end', () => {
                    //console.log('No more data in response.');
                });
            }, (e: any) => {
                onError(e);
            });

            // Catch errors on the request
            req.on('error', (e: NodeJS.ErrnoException) => {
                if (e.code === 'ECONNRESET') {
                    console.error('Connection was reset by the remote host.');
                } else {
                    console.error(`Request error: ${e.message}`);
                }

                onError(e);
            });

            req.end();

        } catch (e) {
            onError(e);
        }
    });
}

function fetchSeriesItems(genre: Genre, page: number, series: Serie[]): Promise<boolean> {
    return new Promise<boolean>((res, err) => {

        fetchData<Data<Programs<Serie>>>(`/server/load.php?type=series&action=get_ordered_list&sortby=added&p=${page}&category=${genre.id}`, true)
            .then(allPrograms => {

                if (!allPrograms?.js) {
                    console.error(`Error fetching page ${page} of genre '${genre.title}'`);
                    res(fetchSeriesItems(genre, page + 1, series));
                }

                if (!!allPrograms.js.data && allPrograms.js.data.length > 0) {
                    console.info(`Fetched page ${page}/${Math.ceil(allPrograms.js.total_items / allPrograms.js.max_page_items)} of genre '${genre.title}'`);
                }

                for (var serie of allPrograms.js.data) {
                    series.push(serie);
                }

                if (allPrograms.js.data.length > 0) {
                    res(fetchSeriesItems(genre, page + 1, series));
                } else {
                    res(true);
                }
            }, err => {
                console.error(`Error fetching genre '${genre.title}'`);
                res(true);
            });
    });
}

export function fetchSeries(genres: Array<Genre>): Promise<GenreSerie[]> {
    const series: { [id: string]: Serie[] } = {};
    return firstValueFrom(
        forkJoin(
            genres.filter(genre => isFinite(parseInt(genre.id)))
                .map(genre => {
                        series[genre.id] = [];
                        return from(fetchSeriesItems(genre, 1, series[genre.id]))
                            .pipe(
                                map(x => <GenreSeries>{genre: genre, series: series[genre.id]})
                            );
                    }
                )
        ).pipe(
            map(r => {
                const genreSeries: GenreSerie[] = [];
                r.forEach(x => {
                    x.series.forEach(s => {
                        genreSeries.push(new GenreSerie(x.genre, s))
                    });
                });
                return genreSeries;
            })
        )
    );
}

export function splitLines(lines: string): string[] {
    return lines.split(/\r\n|\r|\n/);
}