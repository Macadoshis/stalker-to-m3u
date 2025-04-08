import Ajv from "ajv";
import { forkJoin, from, Observable, of } from 'rxjs';
import { catchError, concatMap, defaultIfEmpty, filter, map, mergeMap, tap, toArray } from 'rxjs/operators';
import {
    checkStream,
    fetchData,
    logConfig,
    randomDeviceId,
    randomSerialNumber,
    READ_OPTIONS,
    splitLines
} from '../common';
import { Mutex } from 'async-mutex';
import { ArrayData, BaseConfig, Channel, Config, Data, Genre, Programs } from '../types';

const axios = require('axios');
const fs = require('fs');
const chalk = require('chalk');
const yargsParser = require('yargs-parser');

const mutex = new Mutex();

interface FetchContent {
    url: string;
    body?: string;
    error?: string;
}

type UrlToMacMap = Map<string, Set<string>>;
type UrlAndMac = { url: string; mac: string; };
type UrlConfig = Pick<Omit<Config, 'mac'>, 'hostname' | 'port' | 'contextPath'> & Partial<Pick<Config, 'mac'>>;

interface AnalyzerConfig extends BaseConfig {
    cache?: boolean;
    groupsToTest?: number;
    channelsToTest?: number;
    retestSuccess?: boolean;
}

const SOURCES_FILE: string = './tools/sources.txt';
const SUCCEEDED_FILE: string = './tools/succeeded.json';
const FAILED_FILE: string = './tools/failed.json';

if (!fs.existsSync(SOURCES_FILE)) {
    console.error(chalk.red.bold(`File ${SOURCES_FILE} does not exist. Creating file...`));
    fs.writeFileSync(SOURCES_FILE, '# List all URLs to fetch here, one per line. Use \'#\' or \';\' to comment.')
}

const sources: string[] = splitLines(fs.readFileSync(SOURCES_FILE, READ_OPTIONS));

const succeeded: UrlConfig[] = [];
const failed: UrlAndMac[] = [];

const config: AnalyzerConfig = getConfig();
logConfig(config);

// Start time
const startTime = process.hrtime();

// Create input and output files
if (!!config.cache) {
    if (fs.existsSync(SUCCEEDED_FILE)) {
        succeeded.push(...JSON.parse(fs.readFileSync(SUCCEEDED_FILE, READ_OPTIONS)) as UrlConfig[]);
    }
    if (fs.existsSync(FAILED_FILE)) {
        failed.push(...JSON.parse(fs.readFileSync(FAILED_FILE, READ_OPTIONS)) as UrlAndMac[])
    }
} else {
    // Clear files
    fs.writeFileSync(SUCCEEDED_FILE, JSON.stringify([], null, 2));
    fs.writeFileSync(FAILED_FILE, JSON.stringify([], null, 2));
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
        config.streamTester = "http";
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

/** Number of threads for analyze process */
const NB_THREADS = 50;

let totalProcessed = 0;

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
                            urls.set(key, new Set([ ...urls.get(key)!, ...value ]));
                        });
                    }
                });

                return urls;
            }),
            concatMap(urls => {
                    const items: UrlAndMac[] = [];
                    urls.forEach((macs, url) => {
                        macs.forEach(mac => {
                            items.push(({url, mac}));
                        });
                    });
                    return items;
                }
            ),
            mergeMap(urlAndMac => {

                console.info(chalk.bold(chalk.blue(`...Testing ${urlAndMac.url} with ${chalk.red(urlAndMac.mac)}`)));

                if (config.cache && failed.some(u => {
                    return urlAndMac.url === u.url
                        && urlAndMac.mac === u.mac;
                })) {
                    console.info(chalk.red(`${urlAndMac.url} [${urlAndMac.mac}] is cached from failed streams.`));
                    return of();
                }
                if (config.cache && succeeded.some(u => {
                    const extract = extractUrlParts(urlAndMac.url);
                    return urlAndMac.mac === u.mac
                        && extract.port === u.port
                        && extract.contextPath === u.contextPath
                        && extract.hostname === u.hostname;
                })) {
                    console.info(chalk.green(`${urlAndMac.url} [${urlAndMac.mac}] is cached from succeeded streams.`));
                    return of();
                }

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
                    fetchData<ArrayData<Genre>>('/server/load.php?type=itv&action=get_genres', true, {}, '', cfg)
                ).pipe(
                    map(x => x?.js),
                    mergeMap(genres => genres),
                    filter(genre => genre.title !== 'All' && genre.title.toLowerCase().indexOf('adult') < 0),
                    toArray(),
                    map(arr => {
                        // Shuffle and take N random genres
                        return arr.sort(() => Math.random() - 0.5).slice(0, config.groupsToTest ?? 1);
                    }),
                    // Fetch all channels of each genres
                    concatMap(genres => forkJoin(
                            genres.map(genre => {
                                return from(fetchData<Data<Programs<Channel>>>('/server/load.php?type=itv&action=get_all_channels', true, {}, '', cfg)
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
                            defaultIfEmpty([]),
                            map(results => results.flat()),
                            // (do not test channels separator likely starting with '#')
                            map(channels => channels.filter(f => !f.name.startsWith('#')).sort(() => Math.random() - 0.5).slice(0, config.channelsToTest ?? 1))
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
                            defaultIfEmpty([]),
                            map(results => results.flat())
                        )
                    ),
                    mergeMap(urls => {
                        return forkJoin(
                            urls.filter(url => !!url)
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
                            defaultIfEmpty([])
                        );
                    }),
                    tap(fetched => {

                        // If there is at least one success, the source is considered trustful
                        if (fetched.some(r => !!r)) {
                            const item: UrlConfig = {
                                ...extractUrlParts(urlAndMac.url),
                                mac: urlAndMac.mac
                            };
                            console.info(chalk.bgGreen.black.bold(`[ FOUND ] ${JSON.stringify(item)}`));
                            succeeded.push(item);
                        } else {
                            failed.push(urlAndMac);
                        }

                        mutex.runExclusive(() => {
                            totalProcessed++;
                            outputFiles();
                        });

                        if (global.gc) {
                            global.gc(); // Forces garbage collection
                        } else {
                            // console.warn('Garbage collection is not exposed. Run with --expose-gc.');
                        }
                    }),
                    catchError(err => {

                        mutex.runExclusive(() => {
                            totalProcessed++;
                            outputFiles();
                        });

                        failed.push(urlAndMac);
                        return of([]);
                    })
                );
            }, NB_THREADS),
        )
        .subscribe({
            error: err => console.error('Error:', err),
            complete: () => {

                const endTime = process.hrtime(startTime);

                // Calculate total execution time
                const durationInSeconds = endTime[0];

                console.debug(chalk.bold(`[COMPLETE] All entries processed. Execution time: ${durationInSeconds} seconds.`));

                if (!config.cache) {
                    // Writes progression to output files (for performance issues the in-memory list should remain as short as possible)
                    const succeededToWrite: UrlConfig[] = [];
                    const failedToWrite: UrlAndMac[] = [];
                    if (fs.existsSync(SUCCEEDED_FILE)) {
                        succeededToWrite.push(...JSON.parse(fs.readFileSync(SUCCEEDED_FILE, READ_OPTIONS)) as UrlConfig[]);
                    }
                    succeededToWrite.push(...succeeded);
                    if (fs.existsSync(FAILED_FILE)) {
                        failedToWrite.push(...JSON.parse(fs.readFileSync(FAILED_FILE, READ_OPTIONS)) as UrlAndMac[]);
                    }
                    failedToWrite.push(...failed);

                    fs.writeFileSync(SUCCEEDED_FILE, JSON.stringify(succeededToWrite, null, 2));
                    fs.writeFileSync(FAILED_FILE, JSON.stringify(failedToWrite, null, 2));
                } else {
                    // Output files
                    fs.writeFileSync(SUCCEEDED_FILE, JSON.stringify(succeeded, null, 2));
                    fs.writeFileSync(FAILED_FILE, JSON.stringify(failed, null, 2));
                }

                // Order file content
                succeeded.splice(0);
                succeeded.push(...JSON.parse(fs.readFileSync(SUCCEEDED_FILE, READ_OPTIONS)) as UrlConfig[]);

                failed.splice(0);
                failed.push(...JSON.parse(fs.readFileSync(FAILED_FILE, READ_OPTIONS)) as UrlAndMac[])

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
                // Output files
                fs.writeFileSync(SUCCEEDED_FILE, JSON.stringify(succeeded, null, 2));
                fs.writeFileSync(FAILED_FILE, JSON.stringify(failed, null, 2));
            },
        });
}

function outputFiles(): void {
    if (!config.cache && totalProcessed % 50 === 0) {
        // Writes progression to output files (for performance issues the in-memory list should remain as short as possible)
        const succeededToWrite: UrlConfig[] = [];
        const failedToWrite: UrlAndMac[] = [];
        if (fs.existsSync(SUCCEEDED_FILE)) {
            succeededToWrite.push(...JSON.parse(fs.readFileSync(SUCCEEDED_FILE, READ_OPTIONS)) as UrlConfig[]);
        }
        succeededToWrite.push(...succeeded);
        if (fs.existsSync(FAILED_FILE)) {
            failedToWrite.push(...JSON.parse(fs.readFileSync(FAILED_FILE, READ_OPTIONS)) as UrlAndMac[]);
        }
        failedToWrite.push(...failed);

        fs.writeFileSync(SUCCEEDED_FILE, JSON.stringify(succeededToWrite, null, 2));
        fs.writeFileSync(FAILED_FILE, JSON.stringify(failedToWrite, null, 2));

        // Clears list
        succeeded.splice(0);
        failed.splice(0);
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

    return {hostname: domain, port, contextPath: context};
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
fetchAllUrls(sources);
