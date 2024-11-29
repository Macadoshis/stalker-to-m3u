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

const randomDeviceId: string = Array.from({length: 32}, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))).join('');

export function getConfig(): Readonly<Config> {
    const configData: string = fs.readFileSync('./config.json',
        {encoding: 'utf8', flag: 'r'});
    let config: Config = JSON.parse(configData) as Config;
    if (!config.deviceId) {
        // console.log(`Using generated devideId: ${randomDeviceId}`);
        config.deviceId = randomDeviceId;
    }

    // Override with command line additional arguments
    const args = yargsParser(process.argv.slice(3));
    config = {...config, ...args};

    // console.info(config);

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

export function fetchData<T>(path: string, ignoreError: boolean = false): Promise<T> {
    return new Promise<T>((resp, err) => {
        //console.debug((!!config.contextPath ? '/' + config.contextPath : '') + path);
        try {
            var req = http.get({
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
                    console.error(`Did not get an OK from the server (${path}). Code: ${res.statusCode}`);
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

                res.on('end', () => {
                    //console.log('No more data in response.');
                });
            }, (err: any) => {
                if (!!ignoreError) {
                    console.error(err);
                    resp(<T>{});
                } else {
                    err(err);
                }
            });

            req.end();

        } catch (e) {
            if (!!ignoreError) {
                resp(<T>{});
            } else {
                throw e;
            }
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
