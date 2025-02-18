import {
    Config,
    Data,
    GenerationKind,
    generationKindNames,
    Genre,
    GenreSerie,
    GenreSeries,
    Programs,
    Serie,
    StreamTester
} from "./types.js";

import Ajv from "ajv";

import {catchError, finalize, firstValueFrom, forkJoin, from, map, Observable, of, switchMap, tap} from 'rxjs';

const FFMPEG_TESTER_DURATION_SECONDS: number = 5;

const version: string = require('./package.json').version;

const TEST_STREAM_REQUEST_TIMEOUT: number = 10000;

const http = require('follow-redirects').http;
const fs = require('fs');
const chalk = require('chalk');
const yargsParser = require('yargs-parser');
const axios = require('axios');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const {spawn} = require('child_process');

// Set FFmpeg binary path
ffmpeg.setFfmpegPath(path.resolve(__dirname, 'ffmpeg'));
ffmpeg.setFfprobePath(path.resolve(__dirname, 'ffprobe'));

export const randomDeviceId: () => string = () => Array.from({length: 64}, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))).join('');
export const randomSerialNumber: () => string = () => Array.from({length: 13}, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))).join('');

export const READ_OPTIONS = {encoding: 'utf8', flag: 'r'};

export function getConfig(): Readonly<Config> {
    const configData: string = fs.readFileSync('./config.json', READ_OPTIONS);

    let config: Config = JSON.parse(configData) as Config;

    // Validate JSON file
    const schema: any = require('./config.schema.json');
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    if (!validate(config)) {
        console.error(chalk.red('\"config.json\" file is not valid. Please correct following errors:\r\n' + chalk.bold(JSON.stringify(validate.errors, null, 2))));
        process.exit(1);
    }

    // Fill in default values if unset

    if (config.computeUrlLink === undefined) {
        config.computeUrlLink = true;
    }

    if (!config.deviceId1) {
        config.deviceId1 = randomDeviceId();
        // console.log(`Using deviceId1: ${config.deviceId1}`);
    }
    if (!config.deviceId2) {
        config.deviceId2 = config.deviceId1 ?? randomDeviceId();
        // console.log(`Using deviceId2: ${config.deviceId2}`);
    }
    if (!config.serialNumber) {
        config.serialNumber = randomSerialNumber();
        // console.log(`Using serialNumber: ${config.serialNumber}`);
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

type Token = {
    token: string;
    date: Date;
}
const authTokenMap: Map<String, Token> = new Map<String, Token>();

function getToken(refresh: boolean = false, cfg: Config = config): Observable<string> {
    const tokenKey: string = cfg.hostname + cfg.port + cfg.contextPath + cfg.mac;
    const tokenCacheDuration = config.tokenCacheDuration ?? 300;

    if (!refresh && authTokenMap.has(tokenKey)) {

        const diffSeconds: number = Math.abs((new Date().getTime() - authTokenMap.get(tokenKey)!.date.getTime()) / 1000);
        if (diffSeconds > tokenCacheDuration) {
            // console.debug(chalk.blueBright(`Removed cached token for http://${cfg.hostname}:${cfg.port}${cfg.contextPath ? '/' + cfg.contextPath : ''} [${cfg.mac}]`));
            authTokenMap.delete(tokenKey);
        } else {
            // Get token from map if found
            return of(authTokenMap.get(tokenKey)!.token);
        }
    }

    // Fetch a new token
    return from(fetchData<Data<{ token: string }>>('/server/load.php?type=stb&action=handshake', false,
        {
            'Accept': 'application/json',
            'User-Agent': `stalker-to-m3u/${version}`,
            'X-User-Agent': `stalker-to-m3u/${version}`,
            'Cookie': `mac=${cfg.mac}; stb_lang=en`,
        }, '', cfg))
        .pipe(
            map(data => data?.js?.token),
            switchMap((token: string) => {
                return from(fetchData<Data<any>>(`/server/load.php?type=stb&action=get_profile&hd=1&auth_second_step=0&num_banks=1&stb_type=&image_version=&hw_version=&not_valid_token=0&device_id=${cfg.deviceId1}&device_id2=${cfg.deviceId2}&signature=&sn=${cfg.serialNumber!}&ver=`, false,
                    {
                        'Accept': 'application/json',
                        'User-Agent': `stalker-to-m3u/${version}`,
                        'X-User-Agent': `stalker-to-m3u/${version}`,
                        'Cookie': `mac=${cfg.mac}; stb_lang=en`,
                        'Authorization': `Bearer ${token}`,
                        'SN': cfg.serialNumber!
                    }, '', cfg)).pipe(
                    map(x => token),
                    tap(x => {
                        console.debug(chalk.blueBright(`Fetched token for http://${cfg.hostname}:${cfg.port}${cfg.contextPath ? '/' + cfg.contextPath : ''} [${cfg.mac}] (renewed in ${tokenCacheDuration} seconds)`));
                        return authTokenMap.set(tokenKey, {token: token, date: new Date()});
                    })
                )
            })
        );
}

export function fetchData<T>(path: string, ignoreError: boolean = false, headers: {
    [key: string]: string
} = {}, token: string = '', cfg: Config = config): Promise<T> {

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

        let token$: Observable<string>;
        const headersProvided: boolean = Object.keys(headers).length !== 0;
        if (!headersProvided) {
            token$ = getToken(false, cfg);
        } else {
            token$ = of(token);
        }

        token$
            .subscribe((token) => {
                // console.debug((!!config.contextPath ? '/' + config.contextPath : '') + path);
                try {

                    if (!headersProvided) {
                        headers = {
                            'Accept': 'application/json',
                            'User-Agent': `stalker-to-m3u/${version}`,
                            'X-User-Agent': `stalker-to-m3u/${version}`,
                            'Cookie': `mac=${cfg.mac}; stb_lang=en`,
                            'SN': cfg.serialNumber!
                        };
                        if (!!token) {
                            headers['Authorization'] = `Bearer ${token}`;
                        }
                    }

                    const req = http.get({
                        hostname: cfg.hostname,
                        port: cfg.port,
                        path: completePath,
                        method: 'GET',
                        headers: headers
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
                                //console.error(`Wrong JSON data received: '${data}'`);
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
            }, onError);
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

/**
 * Check if a stream is accessible by:
 * 1. Fetching the stream.
 * 2. Extracting and testing the first media segment.
 * 3. Handling network errors and edge cases.
 *
 * @param {string} url - The stream from m3u URL.
 * @param {Config} config - The stream tester mode.
 * @returns {Promise<boolean>} - True if the stream is accessible, false otherwise.
 */
export function checkStream(url: string, config: Pick<Config, 'streamTester'>): Promise<boolean> {

    const streamTester: StreamTester = config.streamTester !== undefined ? config.streamTester : 'http';

    console.log(`...Checking stream [${streamTester}]: ${url}`);

    if (streamTester === "http") {
        // HTTP stream tester
        return checkStreamHttp(url);
    } else if (streamTester === "ffmpeg") {
        // FFMPEG stream tester
        return checkStreamFfmpeg(url);
    } else {
        throw new Error(`Stream tester "${streamTester}" not supported`);
    }
}

function checkStreamHttp(url: string): Promise<boolean> {

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_STREAM_REQUEST_TIMEOUT);

    try {
        // Fetch the stream
        const streamResponse: Observable<any> = from(axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0', // Mimic real browser behavior
                'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain'
            },
            responseType: 'arraybuffer', // Handle binary data
            signal: controller.signal, // Cancels if it exceeds REQUEST_TIMEOUT
            timeout: TEST_STREAM_REQUEST_TIMEOUT, // Avoid hanging requests
            maxRedirects: 5, // Follow up to 5 redirects
            validateStatus: (status: number) => status < 400 // Consider only 2xx and 3xx as valid
        }));

        return streamResponse
            .pipe(
                map(r => {
                    if (r && r.status === 200) {
                        console.log(chalk.greenBright(`Stream is accessible and playable.`));
                        return true;
                    }

                    console.error(`Segment request failed: HTTP ${r?.status}`);
                    return false;
                }),
                catchError(error => {
                    handleRequestError(error, `Stream test failed for ${url}`);
                    return of(false);
                }),
                finalize(() => {
                    clearTimeout(timeout);
                })
            ).toPromise() as Promise<boolean>;
    } catch (err) {
        clearTimeout(timeout);
        handleRequestError(err, `Stream test failed`);
        return Promise.resolve(false);
    }
}


function checkStreamFfmpeg(url: string): Promise<boolean> {

    return new Promise<boolean>((resolve) => {

        let timeout: any | undefined = undefined;

        let command = ffmpeg(url, {
            logger: {
                debug: (m: any) => console.debug(m),
                info: (m: any) => console.info(m),
                warn: (m: any) => console.warn(m),
                error: (m: any) => console.error(m)
            }
        })
            .withNoAudio()
            .inputOptions(`-t ${FFMPEG_TESTER_DURATION_SECONDS}`) // Read stream for N seconds
            .outputOptions('-f null')
            .output('null')
            .on("start", (cmd: string) => {
                // console.debug(`▶️  Running FFmpeg: ${cmd}`);
            })
            .on("error", (err: any, stdout: any, stderr: any) => {
                clearTimeout(timeout);
                console.error(chalk.redBright(`❌  Stream failed: ${err.message}`));
                // console.debug(`📜 FFmpeg stdout: ${stdout}`);
                // console.debug(`📜 FFmpeg stderr: ${stderr}`);

                // Stream is unreachable
                resolve(false);
            })
            .on("end", () => {
                clearTimeout(timeout);
                console.log(chalk.greenBright(`Stream is accessible and playable.`));
                // Stream is accessible
                resolve(true);
            });
        command.run();

        // Kill ffmpeg after timeout reached (if not ended yet)
        timeout = setTimeout(function () {
            command.on('error', function () {
                console.log(`Ffmpeg for ${url} has been killed (timeout of ${TEST_STREAM_REQUEST_TIMEOUT} ms reached)`);
            });

            command.kill();
            resolve(false);
        }, TEST_STREAM_REQUEST_TIMEOUT);
    });
}


/**
 * Handle different types of request errors.
 *
 * @param {Error} error - The Axios or Node.js error object.
 * @param {string} context - Custom error message context.
 */
function handleRequestError(error: any, context: string) {
    if (error.response) {
        console.error(`${context}: Server responded with HTTP ${error.response.status}`);
    } else if (error.request) {
        console.error(`${context}: No response received (Possible timeout or network issue)`);
    } else if (axios.isCancel(error)) {
        console.error(`Request aborted due to timeout`);
    } else {
        console.error(`${context}: Request setup failed - ${error.message}`);
    }

    if (error.code) {
        switch (error.code) {
            case 'ECONNRESET':
                console.error(`${context}: Connection was forcibly closed by the server (ECONNRESET)`);
                break;
            case 'ETIMEDOUT':
                console.error(`${context}: Request timed out (ETIMEDOUT)`);
                break;
            case 'ECONNABORTED':
                console.error(`${context}: Response timeout exceeded (ECONNABORTED)`);
                break;
            case 'EHOSTUNREACH':
                console.error(`${context}: Host unreachable (EHOSTUNREACH)`);
                break;
            case 'ENOTFOUND':
                console.error(`${context}: Domain or server not found (ENOTFOUND)`);
                break;
            case 'ECONNREFUSED':
                console.error(`${context}: Connection refused by the server (ECONNREFUSED)`);
                break;
            default:
                console.error(`${context}: Network error (${error.code})`);
                break;
        }
    }
}