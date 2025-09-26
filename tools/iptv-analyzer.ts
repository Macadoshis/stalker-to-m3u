import Ajv from "ajv";
import { forkJoin, from, last, Observable, of, tap } from 'rxjs';
import { catchError, concatMap, defaultIfEmpty, filter, map, mergeMap, toArray } from 'rxjs/operators';
import {
    checkStream,
    configureRetry,
    fetchData,
    getRGBFromPercentage,
    logConfig,
    randomDeviceId,
    randomSerialNumber,
    READ_OPTIONS,
    splitLines
} from '../common';

import { Mutex } from 'async-mutex';
import { ArrayData, BaseConfig, Channel, Config, Data, Genre, Programs, UrlConfig } from '../types';
import { sha1 } from "object-hash";
import { ReadStream } from "node:fs";
import { fromPromise } from "rxjs/internal/observable/innerFrom";

const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const fs = require('fs');
const chalk = require('chalk');
const yargsParser = require('yargs-parser');
const JSONStream = require('JSONStream');

const mutex = new Mutex();

interface FetchContent {
    url: string;
    body?: string;
    error?: string;
}

type UrlToMacMap = Map<string, Set<string>>;
type UrlAndMac = { url: string; mac: string; };

interface AnalyzerConfig extends BaseConfig {
    cache?: boolean;
    groupsToTest?: number;
    channelsToTest?: number;
    retestSuccess?: boolean;
    threadsCount?: number;
}

const SOURCES_FILE: string = './tools/sources.txt';
const SUCCEEDED_FILE: string = './tools/succeeded.json';
const FAILED_FILE: string = './tools/failed.json';

/** Number of items to store in cache before tailing in output files */
const NB_ITEMS_TO_TAIL = 10;

if (!fs.existsSync(SOURCES_FILE)) {
    console.error(chalk.red.bold(`File ${SOURCES_FILE} does not exist. Creating file...`));
    fs.writeFileSync(SOURCES_FILE, '# List all URLs to fetch here, one per line. Use \'#\' or \';\' to comment.')
}

const sources: string[] = splitLines(fs.readFileSync(SOURCES_FILE, READ_OPTIONS));

const succeeded: UrlConfig[] = [];
const failed: UrlAndMac[] = [];

const config: AnalyzerConfig = getConfig();
logConfig(config);

configureRetry(axiosRetry, axios);

/** Start time */
const startTime = process.hrtime();

/** Total number of items processed */
let totalProcessed = 0;


/** Number of items processed (progression numerator) */
let proceeding = 0;

/** Number of items to process (progression denominator) */
let proceedingCount = 0;

/** SHA1 cache of successed url and mac (stored shorten to SHA1 for memory issues) */
const cacheSuccessUrlAndMac: Set<String> = new Set<String>();

/** SHA1 cache of failed url and mac (stored shorten to SHA1 for memory issues) */
const cacheFailedUrlAndMac: Set<String> = new Set<String>();

function readFileAsync<T>(data: T[], file: string, res: () => void, rej: (reason?: any) => void): void {
    const stream: ReadStream = fs.createReadStream(file, READ_OPTIONS);
    stream.pipe(JSONStream.parse('*'))
        .on('data', (item: T) => {
            data.push(item);
        })
        .on('end', () => {
            // console.debug(`Finished processing file ${file}`);
        })
        .on('close', () => {
            res();
        })
        .on('error', (err: any) => {
            console.error('An error occurred:', err);
            rej();
        });
}

async function initFiles(): Promise<void> {
    await new Promise<void>((res, rej) => {
        // Create input and output files
        if (!!config.cache) {
            if (!config.retestSuccess && fs.existsSync(SUCCEEDED_FILE)) {
                succeeded.push(...JSON.parse(fs.readFileSync(SUCCEEDED_FILE, READ_OPTIONS)) as UrlConfig[]);
            }
            if (fs.existsSync(FAILED_FILE)) {
                readFileAsync(failed, FAILED_FILE, res, rej);
            }
        } else {
            // Clear files
            fs.writeFileSync(SUCCEEDED_FILE, JSON.stringify([], null, 2));
            fs.writeFileSync(FAILED_FILE, JSON.stringify([], null, 2));
            res();
        }
    });
    totalProcessed = succeeded.length + failed.length;
    // Fill cache of processed items
    succeeded.forEach((element) => {
        cacheSuccessUrlAndMac.add(sha1(element));
    });
    failed.forEach((element_1) => {
        cacheFailedUrlAndMac.add(sha1(element_1));
    });
    console.info(chalk.blackBright(`Loaded cache of ${cacheSuccessUrlAndMac.size} success and ${cacheFailedUrlAndMac.size} failed entries`));
    // Empty lists
    succeeded.splice(0);
    failed.splice(0);
}

function getConfig(): Readonly<AnalyzerConfig> {
    const configData: string = fs.readFileSync('./tools/analyzer-config.json', READ_OPTIONS);
    let config: AnalyzerConfig = JSON.parse(configData) as AnalyzerConfig;

    // Validate JSON file
    const schema: any = require('./schemas/analyzer-config.schema.json');
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    if (!validate(config)) {
        console.error(chalk.red('\"tools/analyzer-config.json\" file is not valid. Please correct following errors:\r\n' + chalk.bold(JSON.stringify(validate.errors, null, 2))));
        process.exit(1);
    }

    // Fill in default values if unset

    if (config.cache === undefined) {
        config.cache = false;
    }
    if (config.streamTester === undefined) {
        config.streamTester = "ffmpeg";
    }
    if (config.retestSuccess === undefined) {
        config.retestSuccess = false;
    }
    if (config.threadsCount === undefined) {
        // Number of threads for analyze process
        config.threadsCount = 10;
    }
    config.groupsToTest = config.groupsToTest ?? 1;
    config.channelsToTest = config.channelsToTest ?? 1;

    // Override with command line additional arguments
    const args = yargsParser(process.argv.slice(2));
    config = {...config, ...args};

    if (typeof config.cache !== "boolean") {
        config.cache = config.cache as any === "true";
    }
    if (typeof config.retestSuccess !== "boolean") {
        config.retestSuccess = config.retestSuccess as any === "true";
    }

    return config;
}

function fetchUrl(url: string): Observable<FetchContent> {
    if (url.startsWith('file:///')) {
        return of(({
            url,
            body: fs.readFileSync(url.replace('file:///', ''), READ_OPTIONS),
        }));
    } else {
        return from(axios.get(url))
            .pipe(
                map(response => ({
                    url,
                    body: (<any>response).data as string,
                })),
                catchError(error => {
                    console.error(`Error fetching ${url}:`, error.message);
                    return of(
                        <FetchContent>{
                            url,
                            error: error.message,
                        },
                    );
                })
            );
    }
}

/** Load sources urls */
function fetchAllUrls(urls: string[]): void {

    if (config.retestSuccess) {
        urls.push(`file:///${SUCCEEDED_FILE}`);
    }

    const requests = urls
        .filter(url => url.trim().length > 0)
        .filter(url => !url.startsWith('#') && !url.startsWith(';'))
        .map(url => fetchUrl(url));
    forkJoin(requests)
        .pipe(
            map((results: FetchContent[]) => {

                const urls: UrlToMacMap = new Map();

                results.forEach(result => {

                    console.log(`Analyzing URL ${result.url} (${result.body ? result.body.length : 0} bytes)`);

                    if (result.body) {
                        const urlsAndMacs: UrlToMacMap = extractUrlsAndMacs(result.body);
                        urlsAndMacs.forEach((value, key) => {
                            if (!urls.has(key)) {
                                urls.set(key, new Set());
                            }
                            urls.set(key, new Set([...urls.get(key)!, ...value]));
                        });
                    }
                });

                return urls;
            }),
            concatMap(urls => {
                    const items: UrlAndMac[] = [];

                    if (config.retestSuccess) {

                        const succeededToReplay: UrlConfig[] = [];
                        succeededToReplay.push(...JSON.parse(fs.readFileSync(SUCCEEDED_FILE, READ_OPTIONS)) as UrlConfig[])

                        succeededToReplay.forEach((value) => {
                            const url: string = `http://${value.hostname}:${value.port}${value.contextPath ? '/' + value.contextPath : ''}/c/`;
                            items.push({url, mac: value.mac!});
                        });

                        // Clear success file
                        fs.writeFileSync(SUCCEEDED_FILE, JSON.stringify([], null, 2));
                    }

                    urls.forEach((macs, url) => {
                        macs.forEach(mac => {
                            const urlAndMac: UrlAndMac = {url, mac};

                            proceedingCount++;

                            if (cacheFailedUrlAndMac.has(sha1(urlAndMac))) {
                                console.info(chalk.red(`${urlAndMac.url} [${urlAndMac.mac}] is cached from failed streams.`));
                                return;
                            }
                            if (cacheSuccessUrlAndMac.has(sha1({...extractUrlParts(urlAndMac.url), mac: urlAndMac.mac}))) {
                                console.info(chalk.green(`${urlAndMac.url} [${urlAndMac.mac}] is cached from succeeded streams.`));
                                return;
                            }

                            items.push(urlAndMac);
                        });
                    });

                    return items;
                }
            ),
            mergeMap(urlAndMac => {

                console.info(chalk.bold(chalk.blue(`...Testing ${urlAndMac.url} with ${chalk.red(urlAndMac.mac)}`)));

                const cfg: Config = {
                    ...extractUrlParts(urlAndMac.url),
                    mac: urlAndMac.mac,
                    deviceId1: randomDeviceId(),
                    deviceId2: randomDeviceId(),
                    serialNumber: randomSerialNumber(),
                    streamTester: config.streamTester,
                    userAgent: config.userAgent
                };
                return from(
                    fetchData<ArrayData<Genre>>('/server/load.php?type=itv&action=get_genres', false, {}, '', cfg)
                ).pipe(
                    map(x => x?.js),
                    mergeMap(genres => genres),
                    filter(genre => genre.title !== 'All' && genre.title.toLowerCase().indexOf('adult') < 0),
                    toArray(),
                    map(arr => {
                        // Shuffle and take N random genres
                        return arr.sort(() => Math.random() - 0.5).slice(0, config.groupsToTest ?? 1);
                    }),
                    // Fetch all channels of each genre
                    concatMap(genres => forkJoin(
                            genres.map(genre => {
                                return from(fetchData<Data<Programs<Channel>>>('/server/load.php?type=itv&action=get_all_channels', false, {}, '', cfg)
                                    .then(allPrograms => {

                                        const channels: Channel[] = [];

                                        for (const channel of (allPrograms.js.data ?? [])) {
                                            if (genre.id === channel.tv_genre_id) {
                                                channels.push(channel);
                                            }
                                        }

                                        console.info(chalk.gray(`Fetched ${channels.length} channels of group "${genre.title}" for ${chalk.blue(urlAndMac.url)} with ${chalk.red(urlAndMac.mac)}`))
                                        return Promise.resolve(channels);
                                    }));
                            })
                        ).pipe(
                            defaultIfEmpty(<Channel[][]>[]),
                            map(results => results.flat()),
                            // (do not test channels separator likely starting with '#')
                            map(channels => {
                                return channels.filter(f => !f.name.startsWith('#')).sort(() => Math.random() - 0.5).slice(0, Math.min(config.channelsToTest ?? 1, channels.length));
                            })
                        )
                    ),
                    mergeMap(channels => forkJoin(
                            channels.map(channel => {
                                return from(fetchData<Data<{
                                        cmd: string
                                    }>>(`/server/load.php?type=itv&action=create_link&cmd=${encodeURI(channel.cmd)}&series=&forced_storage=undefined&disable_ad=0&download=0&JsHttpRequest=1-xml`, true, {}, '', cfg)
                                        .then(urlLink => {
                                            let url: string | undefined = '';
                                            if (urlLink?.js?.cmd) {
                                                url = decodeURI(urlLink.js.cmd.match(/[^http]?(http.*)/g)![0].trim());
                                            } else {
                                                console.error(`Error fetching media URL of channel "${channel.name}" for ${chalk.blue(urlAndMac.url)} with ${chalk.red(urlAndMac.mac)}"`);
                                                url = undefined;
                                            }
                                            return Promise.resolve(url);
                                        }, err => {
                                            console.error(`Error generating stream url of channel "${channel.name}" for ${chalk.blue(urlAndMac.url)} with ${chalk.red(urlAndMac.mac)}"`);
                                            return Promise.resolve(undefined);
                                        })
                                )
                            })
                        ).pipe(
                            defaultIfEmpty(<(string | undefined)[]>[]),
                            map(results => results.flat())
                        )
                    ),
                    mergeMap(urls => {
                        return forkJoin(
                            urls.filter(url => !!url)
                                .map(url => url!)
                                .map(url => new Promise<boolean>((resp, err) => {

                                        // Test stream URL
                                        checkStream(url!, cfg)
                                            .then(
                                                res => {
                                                    resp(res);
                                                },
                                                err => {
                                                    resp(false);
                                                }
                                            );
                                    }
                                ))
                        ).pipe(
                            defaultIfEmpty(<boolean[]>[])
                        );
                    }),
                    mergeMap(fetched => {

                        // If there is at least one success, the source is considered trustful
                        if (fetched.some(r => !!r)) {
                            const item: UrlConfig = {
                                ...extractUrlParts(urlAndMac.url),
                                mac: urlAndMac.mac
                            };
                            console.info(chalk.bgGreen.black.bold(`[ FOUND ] ${JSON.stringify(item)}`));
                            succeeded.push(item);
                            cacheSuccessUrlAndMac.add(sha1(item));
                        } else {
                            failed.push(urlAndMac);
                            cacheFailedUrlAndMac.add(sha1(urlAndMac));
                        }

                        proceeding++;

                        return fromPromise(mutex.runExclusive(() => {
                            totalProcessed++;
                            return outputFiles();
                        })).pipe(
                            map(x => {
                            })
                        );
                    }),
                    //map((r: boolean[]) => of({})),
                    //defaultIfEmpty({}),
                    catchError(err => {

                        proceeding++;

                        // console.warn(`CatchError ${JSON.stringify(urlAndMac)}`);

                        failed.push(urlAndMac);
                        cacheFailedUrlAndMac.add(sha1(urlAndMac));

                        return fromPromise(mutex.runExclusive(() => {
                            totalProcessed++;
                            return outputFiles();
                        })).pipe(
                            map(x => {
                            })
                        );
                    })
                );
            }, config.threadsCount),
            defaultIfEmpty({})
        )
        .pipe(
            last(),
            mergeMap(r => {
                // Output all remaining processed items
                return outputFiles(true);
            }),
            mergeMap(r => {
                const endTime = process.hrtime(startTime);

                // Calculate total execution time
                const durationInSeconds = endTime[0];

                console.debug(chalk.bold(`[COMPLETE] All entries processed. Execution time: ${durationInSeconds} seconds.`));

                // Order file content
                succeeded.splice(0);
                succeeded.push(...JSON.parse(fs.readFileSync(SUCCEEDED_FILE, READ_OPTIONS)) as UrlConfig[]);

                return fromPromise(new Promise<void>((res, rej) => {
                    failed.splice(0);
                    readFileAsync(failed, FAILED_FILE, res, rej);
                })).pipe(
                    tap(() => {
                        succeeded.sort((a, b) => {
                            return a.hostname.localeCompare(b.hostname)
                                || (a.contextPath ?? '').localeCompare((b.contextPath ?? ''))
                                || a.port - b.port
                                || (a.mac ?? '').localeCompare((b.mac ?? ''))
                        });
                        failed.sort((a, b) => {
                            return a.url.localeCompare(b.url)
                                || a.mac.localeCompare(b.mac);
                        });
                    }),
                    map(x => {
                    })
                );
            })
        )
        .subscribe({
            error: err => console.error('UNEXPECTED ERROR:', err),
            complete: () => {
                // Output files (ordered)
                fs.writeFileSync(SUCCEEDED_FILE, JSON.stringify(succeeded, null, 2));
                fs.writeFileSync(FAILED_FILE, JSON.stringify(failed, null, 2));
            },
        });
}

async function outputFiles(force: boolean = false): Promise<void> {
    if (force || totalProcessed % NB_ITEMS_TO_TAIL === 0) {
        const succeededToWrite: UrlConfig[] = [];
        const failedToWrite: UrlAndMac[] = [];
        await new Promise<void>((res, rej) => {
            // Writes progression to output files (for performance issues the in-memory list should remain as short as possible)

            if (fs.existsSync(SUCCEEDED_FILE)) {
                succeededToWrite.push(...JSON.parse(fs.readFileSync(SUCCEEDED_FILE, READ_OPTIONS)) as UrlConfig[]);
            }
            succeededToWrite.push(...succeeded);
            if (fs.existsSync(FAILED_FILE)) {
                readFileAsync(failedToWrite, FAILED_FILE, res, rej);
            }
        });
        failedToWrite.push(...failed);

        const progress: number = Math.floor(force ? 100 : proceeding / proceedingCount * 100);
        const rgbFromPercentage: [number, number, number] = getRGBFromPercentage(progress);
        console.info(chalk.blackBright(`Adding to output files... ${succeeded.length} success and ${failed.length} failed entries (${chalk.rgb(rgbFromPercentage[0], rgbFromPercentage[1], rgbFromPercentage[2])(progress + '%')})`));

        fs.writeFileSync(SUCCEEDED_FILE, JSON.stringify(succeededToWrite, null, 2));
        fs.writeFileSync(FAILED_FILE, JSON.stringify(failedToWrite, null, 2));

        // Clear lists
        succeeded.splice(0);
        failed.splice(0);

        if (global.gc) {
            global.gc(); // Forces garbage collection
        } else {
            // console.warn('Garbage collection is not exposed. Run with --expose-gc.');
        }
    } else {
        return Promise.resolve();
    }
}

function extractUrlParts(url: string): UrlConfig {
    const regex: RegExp = /^http:\/\/([^:/]+)(?::(\d+))?(?:\/([^/]+))?\/c\/?$/;
    const match: RegExpMatchArray | null = url.match(regex);
    if (!match) {
        throw Error('Invalid url ' + url);
    }

    const domain: string = match[1];
    const port: number = parseInt(match[2] || '80');
    const context: string | undefined = match[3] || undefined;

    const result: UrlConfig = {hostname: domain, port};
    if (!!context) {
        result.contextPath = context;
    }
    return result;
}

function extractUrlsAndMacs(text: string): UrlToMacMap {
    // Regexp for URL and MACs
    const urlRegex = /http:\/\/[^\s^"]+?\/c\/?/g;
    const macRegex = /([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}/g;

    // Look for all URLs and their index
    const urlsWithIndices: { url: string; startIndex: number }[] = [];
    let match: RegExpExecArray | null;

    while ((match = urlRegex.exec(text)) !== null) {
        urlsWithIndices.push({url: match[0], startIndex: match.index});
    }

    const urlToMacMap: UrlToMacMap = new Map();

    // Loop into all found URLs
    for (let i = 0; i < urlsWithIndices.length; i++) {
        const currentUrl = urlsWithIndices[i].url;
        const startIndex = urlsWithIndices[i].startIndex;

        // Determinate search zone for MACs
        const endIndex =
            i + 1 < urlsWithIndices.length
                ? urlsWithIndices[i + 1].startIndex
                : text.length;

        const relevantText = text.slice(startIndex + currentUrl.length, endIndex);

        // Extract MACs from results (explicitly converted to string[])
        const macs = relevantText.match(macRegex)?.slice() || [];

        // Verify if URL is already present in map
        if (!urlToMacMap.has(currentUrl)) {
            urlToMacMap.set(currentUrl, new Set());
        }

        // Add MACs to te url into the map
        const macList = urlToMacMap.get(currentUrl);
        if (macList) {
            macs.forEach(mac => macList.add(mac));
        }
    }

    return urlToMacMap;
}

// Run main process
(async () => {
    await initFiles();
    fetchAllUrls(sources);
})();

