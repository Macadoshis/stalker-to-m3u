import {
    BaseConfig,
    Config,
    Data,
    GenerationKind,
    generationKindNames,
    Genre,
    GenreSerie,
    GenreSeries,
    M3uResult,
    M3uResultStream,
    M3uTesterConfig,
    Programs,
    Serie,
    StreamTester
} from "./types.js";

import Ajv from "ajv";

import {
    catchError,
    defer,
    finalize,
    firstValueFrom,
    forkJoin,
    from,
    last,
    map,
    Observable,
    of,
    scan,
    switchMap,
    takeWhile,
    tap
} from 'rxjs';
import { Playlist } from "iptv-playlist-parser";
import { mergeMap } from "rxjs/operators";
import { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosStatic } from "axios";
import { AxiosRetry, IAxiosRetryConfig } from "axios-retry/dist/cjs";

// Override console methods to prepend the current datetime
['log', 'info', 'warn', 'error', 'debug'].forEach((method) => {
    const original = console[method as keyof Console];

    // @ts-ignore
    console[method as keyof Console] = (...args: any[]) => {
        const now = new Date();
        const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        // @ts-ignore
        original(`[${formattedDate}]`, ...args);
    };
});

const AXIOS_RETRY_COUNT: number = 3; // should be >= 1
if (!AXIOS_RETRY_COUNT || AXIOS_RETRY_COUNT <= 0) {
    throw new Error("Retry count should be set");
}

const FFMPEG_TESTER_DURATION_SECONDS: number = 5;

const TEST_STREAM_REQUEST_TIMEOUT: number = 10_000 * AXIOS_RETRY_COUNT;

const fs = require('fs');
const chalk = require('chalk');
const yargsParser = require('yargs-parser');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const path = require('path');
const parser = require('iptv-playlist-parser');
const ffmpeg = require('fluent-ffmpeg');

// Set FFmpeg binary path
ffmpeg.setFfmpegPath(path.resolve(__dirname, 'ffmpeg'));
ffmpeg.setFfprobePath(path.resolve(__dirname, 'ffprobe'));

export const randomDeviceId: () => string = () => Array.from({length: 64}, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))).join('');
export const randomSerialNumber: () => string = () => Array.from({length: 13}, () => "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))).join('');

export const READ_OPTIONS = {encoding: 'utf8', flag: 'r'};

export const GROUP_FILE: (kind: GenerationKind) => string
    = kind => `./groups-${kind}.txt`;

export function getConfig(): Readonly<Config> {
    const configData: string = fs.readFileSync('./config.json', READ_OPTIONS);

    let config: Config = JSON.parse(configData) as Config;

    // Validate JSON file
    const schema: any = require('./schemas/config.schema.json');
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
    if (config.testM3uFile === undefined) {
        config.testM3uFile = true;
    }
    if (config.outputDir === undefined) {
        config.outputDir = ".";
    }
    if (config.streamTester === undefined) {
        config.streamTester = "ffmpeg";
    }
    if (!fs.existsSync(config.outputDir)) {
        console.info(`Directory ${config.outputDir} not found.`);
        process.exit(1);
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

    if (typeof config.computeUrlLink !== "boolean") {
        config.computeUrlLink = config.computeUrlLink as any === "true";
    }
    if (typeof config.testM3uFile !== "boolean") {
        config.testM3uFile = config.testM3uFile as any === "true";
    }

    return config;
}

export function configureRetry(axiosRetry: AxiosRetry, axiosInstance: AxiosStatic | AxiosInstance, axiosRetryConfig?: IAxiosRetryConfig): void {

    axiosRetryConfig = axiosRetryConfig || {
        retries: AXIOS_RETRY_COUNT,
        retryDelay: (retryCount: number, error: AxiosError) => axiosRetry.exponentialDelay(retryCount, error, 500),
        retryCondition(error: AxiosError) {
            return axiosRetry.isNetworkOrIdempotentRequestError(error);
        },
        onRetry: (retryCount: number, error: AxiosError, requestConfig: AxiosRequestConfig) => {
            console.log(chalk.gray(`...Retrying ${requestConfig.url} [${retryCount}]`));
        },
        shouldResetTimeout: true
    };

    axiosRetry(axiosInstance, axiosRetryConfig);
}

export function getGenerationKind(): GenerationKind {
    const arg: unknown = process.argv[2] as unknown;
    if (typeof arg !== 'string' || !generationKindNames.includes(arg)) {
        throw new Error('Invalid generation type provided');
    }
    return (arg as GenerationKind);
}

const config: Config = getConfig();

configureRetry(axiosRetry, axios);

type Token = {
    token: string;
    date: Date;
}
const authTokenMap: Map<String, Token> = new Map<String, Token>();

function getUserAgent(cfg: BaseConfig): string {
    return cfg.userAgent ?? "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250";
}

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
            'User-Agent': getUserAgent(cfg),
            'X-User-Agent': getUserAgent(cfg),
            'Cookie': `mac=${cfg.mac}; stb_lang=en`,
        }, '', cfg))
        .pipe(
            map(data => data?.js?.token),
            switchMap((token: string) => {
                return from(fetchData<Data<any>>(`/server/load.php?type=stb&action=get_profile&hd=1&auth_second_step=0&num_banks=1&stb_type=&image_version=&hw_version=&not_valid_token=0&device_id=${cfg.deviceId1}&device_id2=${cfg.deviceId2}&signature=&sn=${cfg.serialNumber!}&ver=`, false,
                    {
                        'Accept': 'application/json',
                        'User-Agent': getUserAgent(cfg),
                        'X-User-Agent': getUserAgent(cfg),
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

/** HTTP timeout (ms) */
const HTTP_TIMEOUT: number = 10_000 * AXIOS_RETRY_COUNT;

export function fetchData<T>(path: string, ignoreError: boolean = false, headers: {
    [key: string]: string
} = {}, token: string = '', cfg: Config = config): Promise<T> {

    return new Promise<T>((resp, err) => {

        const completePath = (!!cfg.contextPath ? '/' + cfg.contextPath : '') + path;
        const absoluteUrl: string = `http://${cfg.hostname}:${cfg.port}/${completePath}`;

        const onError: (e: any) => void
            = (e) => {
            console.error(`Error at ${absoluteUrl} [${cfg.mac}] (ignore: ${ignoreError})`);
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
            .subscribe(
                {
                    next: (token) => {
                        // console.debug((!!config.contextPath ? '/' + config.contextPath : '') + path);
                        try {

                            if (!headersProvided) {
                                headers = {
                                    'Accept': 'application/json',
                                    'User-Agent': getUserAgent(cfg),
                                    'X-User-Agent': getUserAgent(cfg),
                                    'Cookie': `mac=${cfg.mac}; stb_lang=en`,
                                    'SN': cfg.serialNumber!
                                };
                                if (!!token) {
                                    headers['Authorization'] = `Bearer ${token}`;
                                }
                            }

                            const controller = new AbortController();
                            const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT);

                            const req: Observable<AxiosResponse<T>> = defer(() => {
                                    return from(axios.get(absoluteUrl, {
                                        method: 'GET',
                                        headers: headers,
                                        signal: controller.signal, // Cancels if it exceeds HTTP_TIMEOUT
                                        timeout: HTTP_TIMEOUT, // Avoid hanging requests
                                        maxRedirects: 10
                                    })) as Observable<AxiosResponse<T>>;
                                }
                            );

                            req.pipe(
                                map(res => {
                                    if (res.status !== 200) {
                                        console.error(`Did not get an OK from the server (${absoluteUrl} [${cfg.mac}]). Code: ${res.statusText}`);
                                        err();
                                    } else {
                                        try {
                                            resp(!!res.data ? res.data : {} as T);
                                        } catch (e) {
                                            //console.error(`Wrong JSON data received: '${data}'`);
                                            //console.debug(data);
                                            err(e);
                                        }
                                    }
                                    return {};
                                }),
                                catchError(error => {
                                    handleRequestError(error, `HTTP failed for ${absoluteUrl}`);
                                    onError(error);
                                    return of();
                                }),
                                finalize(() => {
                                    clearTimeout(timeout);
                                })
                            ).subscribe();

                        } catch (e) {
                            onError(e);
                        }
                    },
                    error: onError
                }
            );
    });
}

function fetchSeriesItems(genre: Genre, page: number, series: Serie[], maxPage?: number): Promise<boolean> {
    return new Promise<boolean>((res, err) => {

        fetchData<Data<Programs<Serie>>>(`/server/load.php?type=series&action=get_ordered_list&sortby=added&p=${page}&category=${genre.id}`, true)
            .then(allPrograms => {

                if (!allPrograms?.js || !allPrograms.js.data) {
                    console.error(`Error fetching page ${page} of genre '${genre.title}'`);
                    if (maxPage && page + 1 <= maxPage) {
                        res(fetchSeriesItems(genre, page + 1, series, maxPage));
                    } else {
                        res(true);
                    }
                } else if (allPrograms.js.data.length > 0) {
                    const maxPage: number = Math.ceil(allPrograms.js.total_items / allPrograms.js.max_page_items);
                    console.info(`Fetched page ${page}/${maxPage} of genre '${genre.title}'`);

                    for (var serie of allPrograms.js.data) {
                        series.push(serie);
                    }

                    if (allPrograms.js.data && allPrograms.js.data.length > 0) {
                        res(fetchSeriesItems(genre, page + 1, series, maxPage));
                    } else {
                        res(true);
                    }
                } else {
                    // Last page reached
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
                                map(x => {
                                    return <GenreSeries>{genre: genre, series: series[genre.id]};
                                })
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
export function checkStream(url: string, config: Pick<Config, 'streamTester' | 'userAgent'>): Promise<boolean> {

    const streamTester: StreamTester = config.streamTester !== undefined ? config.streamTester : 'ffmpeg';

    console.log(`...Checking stream [${streamTester}]: ${url}`);

    if (!url) {
        return Promise.resolve(false);
    }

    if (streamTester === "http") {
        // HTTP stream tester
        return checkStreamHttp(url, getUserAgent(config));
    } else if (streamTester === "ffmpeg") {
        // FFMPEG stream tester
        return checkStreamFfmpeg(url);
    } else {
        throw new Error(`Stream tester "${streamTester}" not supported`);
    }
}

function checkStreamHttp(url: string, userAgent: string): Promise<boolean> {

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_STREAM_REQUEST_TIMEOUT);

    try {
        // Fetch the stream
        const streamResponse: Observable<any> = from(axios.get(url, {
            headers: {
                'User-Agent': userAgent,
                'Accept': 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain'
            },
            responseType: 'arraybuffer', // Handle binary data
            signal: controller.signal, // Cancels if it exceeds TEST_STREAM_REQUEST_TIMEOUT
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
function handleRequestError(error: any, context: string): void {
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

/**
 * Log current config.
 *
 * @param config
 * @param indent
 */
export function logConfig<T extends object>(config: T, indent: string = ''): void {
    if (!indent) {
        console.log(chalk.gray('Running with active configuration:'));
        console.log('-----------------\n');
    }
    Object.entries(config).forEach(([key, value]) => {
        if (key === '_') {
            return
        }

        if (typeof value !== 'object') {
            if (Array.isArray(config) && (typeof value !== 'object')) {
                console.log(chalk.blueBright(`${indent}${chalk.keyword('orange')(value)}`));
            } else {
                console.log(chalk.blueBright(`${indent}"${chalk.bold(key)}": ${chalk.keyword('orange')(value)}`));
            }
        } else {
            console.log(chalk.blueBright(`${indent}"${chalk.bold(key)}":`));
            logConfig(value, indent + '  ');
        }
    });
    if (!indent) {
        console.log('-----------------\n');
    }
}

export function checkM3u(m3uFile: string, cfg: M3uTesterConfig): Observable<M3uResult> {

    const m3uResult: M3uResult = {
        status: true,
        file: m3uFile,
        failedStreams: [] as M3uResultStream[],
        succeededStreams: [] as M3uResultStream[]
    } as M3uResult;

    const playlist: Playlist = parser.parse(fs.readFileSync(m3uFile, READ_OPTIONS));

    // Update max values according to number of items (do not test channels separator likely starting with '#')
    cfg = {...cfg};
    if (cfg.minSuccess > 0) {
        cfg.minSuccess = Math.min(cfg.minSuccess, playlist.items.filter(f => !f.name.startsWith('#')).length);
    }
    if (cfg.maxFailures > 0) {
        cfg.maxFailures = Math.min(cfg.maxFailures, playlist.items.filter(f => !f.name.startsWith('#')).length);
    }

    // Shuffle items randomly to avoid starting the test with the first channel often being a "fake" channel separator
    playlist.items = shuffleItems(playlist.items);

    if (playlist.items.length === 0) {
        return of({...m3uResult, status: false});
    } else {
        return of(playlist.items)
            .pipe(
                tap(x => console.info(chalk.gray(`...Testing ${m3uFile} (${x.length} channels)`))),
                mergeMap(items => items),
                // Process items sequentially
                mergeMap((item) => checkStream(item.url as string, cfg)
                    .then(s => Promise.resolve<M3uResultStream & { success?: boolean }>({
                        success: s,
                        name: item.name,
                        url: item.url
                    })), 1),
                scan((acc, result) => {
                    const success = result.success;
                    delete result["success"];
                    if (success) {
                        acc.succeededStreams = [...acc.succeededStreams, result];
                    } else {
                        acc.failedStreams = [...acc.failedStreams, result];
                    }
                    return acc;
                }, m3uResult),
                takeWhile(acc => {
                    if (cfg.minSuccess < 0) {
                        // Test against failures only
                        return acc.failedStreams.length < cfg.maxFailures;
                    }
                    if (cfg.maxFailures < 0) {
                        // Test against successes only
                        return acc.succeededStreams.length < cfg.minSuccess;
                    }
                    return acc.succeededStreams.length < cfg.minSuccess && acc.failedStreams.length <= cfg.maxFailures;
                }, true), // Stop when limits are reached
                last(),
                map(acc => {
                    let status: boolean;
                    if (cfg.minSuccess < 0) {
                        // Test against failures only
                        status = acc.failedStreams.length < cfg.maxFailures;
                    } else {
                        // Test against successes only
                        status = acc.succeededStreams.length >= cfg.minSuccess;
                    }

                    return {...acc, status: status};
                })
            )
    }
}

function shuffleItems<T>(array: T[]): T[] {
    const shuffled = [...array]; // Create a copy to keep original array intact
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

export function getRGBFromPercentage(value: number): [number, number, number] {
    // Ensure the input is within bounds
    const percentage = Math.max(0, Math.min(100, value));

    // Calculate red and green components based on the percentage
    const red = Math.round((100 - percentage) * 255 / 100); // Decreases as percentage increases
    const green = Math.round(percentage * 255 / 100);       // Increases as percentage increases

    // Blue is always 0 in this gradient
    const blue = 0;

    return [red, green, blue];
}