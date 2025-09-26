import {
    checkM3u,
    checkStream,
    fetchData,
    fetchSeries,
    getConfig,
    getGenerationKind,
    getRGBFromPercentage,
    GROUP_FILE,
    logConfig,
    READ_OPTIONS,
    splitLines
} from "./common";
import {
    ArrayData,
    Channel,
    Config,
    Data,
    GenerationKind,
    Genre,
    M3U,
    M3ULine,
    M3uTesterConfig,
    Programs,
    Serie,
    Video,
    VodOrdering
} from "./types";

import { iswitch } from 'iswitch';
import { firstValueFrom } from "rxjs";

type Tvg = Readonly<Record<string, string[]>>;

// Start time
const startTime = process.hrtime();

const fs = require('fs');
const chalk = require('chalk');

const generationKind: GenerationKind = getGenerationKind();

if (!fs.existsSync(GROUP_FILE(generationKind))) {
    console.error(`File ${GROUP_FILE(generationKind)} does not exist.`);
    process.exit(1);
}

const config: Config = getConfig();
logConfig(config);

const tvgData: Tvg = JSON.parse(fs.readFileSync('./tvg.json',
    READ_OPTIONS)) as Tvg;

function removeAccent(str: string): string {
    return str.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function getTvgId(channel: Channel): string {
    let tvgId: string = '';

    for (const iterator of Object.entries(tvgData)) {
        if (!!iterator[1].find(term => removeAccent(channel.name.toLocaleLowerCase())
            .includes(removeAccent(term.toLocaleLowerCase())))) {
            tvgId = iterator[0];
            break;
        }
    }

    return tvgId;
}

function channelToM3u(channel: Channel, group: string): M3ULine {
    const lines: M3ULine = <M3ULine>{};

    const tvgId: string = !!config.tvgIdPreFill ? getTvgId(channel) : '';

    lines.title = `TV - ${group}`;
    lines.name = channel.name
        // Special characters such as "-" and "," mess with the rendering of names
        .replaceAll(",", "")
        .replaceAll(" - ", "-");
    lines.header = `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${lines.name}" tvg-logo="${decodeURI(channel.logo)}" group-title="${lines.title}",${lines.name}`;
    lines.command = decodeURI(channel.cmd);

    return lines;
}

function videoToM3u(video: Video, group: string): M3ULine {
    const ratingUnknown: string = 'N/A';

    const lines: M3ULine = <M3ULine>{};
    lines.title = `VOD - ${group}`;
    lines.name = video.name
        // Special characters such as "-" and "," mess with the rendering of names
        .replaceAll(",", "")
        .replaceAll(" - ", "-");
    const rating: string = (config.vodIncludeRating !== undefined ? config.vodIncludeRating : true)
    && video.rating_imdb
    && video.rating_imdb !== ratingUnknown
        ? `(${video.rating_imdb}) ` : '';
    lines.header = `#EXTINF:${video.time * 60} tvg-id="" tvg-name="${lines.name}" tvg-logo="${decodeURI(video.screenshot_uri)}" group-title="${lines.title}",${rating}${lines.name}`;
    lines.command = decodeURI(video.cmd);
    if (video.rating_imdb && video.rating_imdb !== ratingUnknown) {
        lines.data = isFinite(parseFloat(video.rating_imdb)) ? parseFloat(video.rating_imdb) : undefined;
    }


    return lines;
}

function serieToM3u(serie: Serie, season: Serie, group: string): M3ULine[] {
    const linesArray: M3ULine[] = [];
    season.series.forEach(episode => {
        const lines: M3ULine = <M3ULine>{};

        lines.title = `SERIE - ${serie.name}`;
        lines.name = `${season.name} E${String(episode).padStart(2, '0')}`;
        lines.header = `#EXTINF:-1 tvg-id="" tvg-name="${season.name} - E${String(episode).padStart(2, '0')}" tvg-logo="${decodeURI(season.screenshot_uri)}" group-title="${lines.title}",${lines.name}`;
        lines.command = decodeURI(season.cmd);
        lines.episode = episode;

        linesArray.push(lines);
    });

    return linesArray;
}

// Load groups
const groups: string[] = splitLines(fs.readFileSync(GROUP_FILE(generationKind), READ_OPTIONS));

fetchData<ArrayData<Genre>>('/server/load.php?' +
    iswitch(generationKind, ['iptv', () => 'type=itv&action=get_genres'],
        ['vod', () => 'type=vod&action=get_categories'],
        ['series', () => 'type=series&action=get_categories'])
).then(genresData => Promise.resolve(genresData.js))
    .then(genres => {

        const m3u: M3ULine[] = [];

        const next = new Promise<any>((res, err) => {
            if (generationKind === "iptv") {
                fetchData<Data<Programs<Channel>>>('/server/load.php?type=itv&action=get_all_channels')
                    .then(allPrograms => {

                        allPrograms.js.data = allPrograms.js.data ?? [];

                        for (const channel of allPrograms.js.data) {
                            const genre: Genre = genres.find(r => r.id === channel.tv_genre_id)!;

                            if (!!genre && !!genre.title && groups.includes(genre.title)) {
                                m3u.push(channelToM3u(channel, genre.title));
                            }

                        }

                        res(null);
                    });
            } else if (generationKind === "vod") {

                groups
                    .filter(group => group && group.trim().length > 0)
                    .map(group => {
                        return genres.find(r => r.title === group)!;
                    }).reduce((accPrograms, nextGenre, i) => {
                    return accPrograms.then(val => {
                        return fetchVodItems(nextGenre, 1, m3u);
                    });
                }, Promise.resolve(true))
                    .then(() => {
                        res(null);
                    });
            } else if (generationKind === "series") {
                // Filter genres
                genres = genres
                    .filter(genre => {
                        return groups.some(group => group.startsWith(genre.title));
                    });

                fetchSeries(genres).then(genreSeries => {
                    groups
                        .filter(group => group && group.trim().length > 0)
                        .map(group => {
                            const genreSerie = genreSeries.find(r => r.toString() === group)!;
                            if (!genreSerie) {
                                console.error(chalk.red(`No matching group for "${group}"`));
                            }
                            return genreSerie;
                        })
                        .reduce((accPrograms, nextGenre, i) => {
                            if (!nextGenre) {
                                return Promise.resolve(false);
                            }
                            return accPrograms.then(val => {
                                return fetchSeasonItems(nextGenre.serie, 1, m3u);
                            });
                        }, Promise.resolve(true))
                        .then(() => {
                            res(null);
                        });
                });
            }
        });

        next.then(() => {
            if (generationKind === 'vod' || generationKind === 'series') {

                // Default sorting is alphabetic
                let sorting: (a: M3ULine, b: M3ULine) => number
                    = (a, b) => {
                    return a.title.localeCompare(b.title)
                        || a.name.localeCompare(b.name);
                };

                const vodOrdering: VodOrdering = config.vodOrdering ?? 'alphabetic';
                if (generationKind === 'vod') {
                    switch (vodOrdering) {
                        case "none":
                            sorting = (a, b) => a.title.localeCompare(b.title);
                            break;
                        case "rating":
                            sorting = (a, b) => {
                                const getRatingValue: (data: Pick<M3ULine, 'data'>) => number
                                    = (data) => data !== undefined ? data as number : 0;
                                return a.title.localeCompare(b.title)
                                    || getRatingValue(b.data) - getRatingValue(a.data)
                                    || a.name.localeCompare(b.name);
                            };
                    }
                }

                // Order alphabetically
                m3u.sort(sorting);
            }

            if (!config.computeUrlLink) {
                return Promise.resolve();
            }

            console.info('Generating url links');
            return new Promise<void>((res, err) => {

                const maxNumberOfChannelsToTest: number = config.maxNumberOfChannelsToTest !== 0 ? (config.maxNumberOfChannelsToTest ?? 5) : config.maxNumberOfChannelsToTest;

                new Promise<boolean>((r, e) => {
                    if (maxNumberOfChannelsToTest !== 0) {
                        let testM3u: M3ULine[] = [...m3u];
                        shuffleArray(testM3u);
                        testM3u = testM3u.slice(0, Math.min(maxNumberOfChannelsToTest, m3u.length));

                        console.info(`Testing ${maxNumberOfChannelsToTest} channels randomly... : ${testM3u.map(m => '"' + m.title + " - " + m.name + '"').join(', ')}`);

                        testM3u.reduce((acc, next, idx) => {

                            return acc.then(() => {

                                return resolveUrlLink(next).then(() => {

                                    return new Promise<void>((resp, err) => {
                                        // Test stream URL
                                        checkStream(next.url!, config)
                                            .then(
                                                res => {
                                                    next.testResult = res;
                                                },
                                                err => {
                                                    next.testResult = false;
                                                }
                                            )
                                            .finally(() => {
                                                resp();
                                            });
                                    });
                                });
                            });
                        }, Promise.resolve())
                            .then(() => {
                                const nbTestedOk: number = testM3u.filter(r => !!r.testResult).length;
                                const color: string = nbTestedOk > 0 ? 'green' : 'red';
                                console.info(chalk[color](`${nbTestedOk}/${testM3u.length} streams were tested successfully`));
                                // if at least 1 was responding, it's ok to continue with this portal
                                r(nbTestedOk > 0);
                            });

                    } else {
                        r(true);
                    }
                }).then((testedOk: boolean) => {
                    if (testedOk) {
                        res(m3u.reduce((acc, next, idx) => {
                            return acc.then(() => {
                                return resolveUrlLink(next).then(() => {
                                    printProgress(idx, m3u.length);
                                });
                            });
                        }, Promise.resolve()));
                    } else {
                        console.error(chalk.rgb(255, 165, 0)("Aborting M3U generation"));
                        process.exit(1);
                    }
                });

            });

        }).then(() => {
            if (process.stdout.isTTY) {
                process.stdout.clearLine(0);
                process.stdout.cursorTo(0);
            }

            // Outputs m3u
            const filename: string = `${generationKind}-${config.hostname}.m3u`;
            console.info(chalk.bold(`Creating file ${filename}`));
            fs.writeFileSync(config.outputDir + '/' + filename, new M3U(m3u).print(config));

            // Test m3u file
            if (config.testM3uFile) {
                return firstValueFrom(checkM3u(config.outputDir + '/' + filename, <M3uTesterConfig>{
                        minSuccess: 1,
                        maxFailures: 25,
                        renameOnFailure: true,
                        renamePrefix: 'UNHEALTHY_',
                        streamTester: config.streamTester
                    }
                )).then(x => {
                    if (x.status) {
                        console.info(chalk.bold.greenBright(`M3U file has been tested successfully (success: ${x.succeededStreams.length}, failures: ${x.failedStreams.length})`));
                        return true;
                    } else {
                        console.info(chalk.bold.redBright(`M3U file has been tested unsuccessfully (success: ${x.succeededStreams.length}, failures: ${x.failedStreams.length})`));
                        return false;
                    }
                });
            } else {
                return Promise.resolve(true);
            }
        }).then((result: boolean) => {
            const endTime = process.hrtime(startTime);

            // Calculate total execution time
            const durationInSeconds = endTime[0];

            console.log(`Execution time: ${durationInSeconds} seconds`);

            if (!result) {
                process.exit(1);
            }
        });
    });

function shuffleArray<T>(array: T[]): void {
    for (var i = array.length - 1; i >= 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
}

function resolveUrlLink(m3uLine: M3ULine): Promise<void> {

    let type: string;
    if (generationKind === 'iptv') {
        type = 'itv';
    } else if (generationKind === 'vod' || generationKind === 'series') {
        type = 'vod';
    } else {
        type = '';
    }

    return new Promise<void>(function (res, err) {

        fetchData<Data<{
            cmd: string
        }>>(`/server/load.php?type=${type}&action=create_link&cmd=${encodeURI(m3uLine.command!)}&series=${m3uLine.episode ?? ''}&forced_storage=undefined&disable_ad=0&download=0&JsHttpRequest=1-xml`, true)
            .then(urlLink => {
                if (urlLink?.js?.cmd) {
                    try {
                        m3uLine.url = decodeURI(urlLink.js.cmd.match(/[^http]?(http.*)/g)![0].trim());
                    } catch (e) {
                        console.error(`Error reading media URL for '${m3uLine.header} of ${urlLink.js.cmd}'`);
                        m3uLine.url = undefined;
                    }
                } else {
                    console.error(`Error fetching media URL for '${m3uLine.header}'`);
                    m3uLine.url = undefined;
                }
                res();
            }, err => {
                console.error(`Error generating stream url for entry '${m3uLine.header}'`, err);
                m3uLine.url = undefined;
                res();
            });
    }).then(x => new Promise<void>((resolve) => {
        setTimeout(() => {
            resolve();
        }, config.delayBetweenUrlGeneration ?? 0);
    }));
}

function fetchVodItems(genre: Genre, page: number, m3u: M3ULine[]): Promise<boolean> {
    return new Promise<boolean>((res, err) => {

        fetchData<Data<Programs<Video>>>(`/server/load.php?type=vod&action=get_ordered_list&sortby=added&p=${page}&genre=${genre.id}`, true)
            .then(allPrograms => {

                if (!allPrograms?.js) {
                    console.error(`Error fetching page ${page} of genre '${genre.title}'`);
                    res(fetchVodItems(genre, page + 1, m3u));
                }

                if (!!allPrograms.js.data && allPrograms.js.data.length > 0) {
                    console.info(`Fetched page ${page}/${Math.ceil(allPrograms.js.total_items / allPrograms.js.max_page_items)} of genre '${genre.title}'`);
                }

                for (const video of allPrograms.js.data) {
                    m3u.push(videoToM3u(video, genre.title));
                }

                if (allPrograms.js.data.length > 0 && page < (config.vodMaxPagePerGenre ?? 2)) {
                    res(fetchVodItems(genre, page + 1, m3u));
                } else {
                    res(true);
                }
            });
    });
}

function fetchSeasonItems(serie: Serie, page: number, m3u: M3ULine[]): Promise<boolean> {
    return new Promise<boolean>((res, err) => {

        fetchData<Data<Programs<Serie>>>(`/server/load.php?type=series&action=get_ordered_list&movie_id=${encodeURIComponent(serie.id)}&p=${page}&sortby=added`, true)
            .then(allPrograms => {

                if (!allPrograms?.js) {
                    console.error(`Error fetching page ${page} of serie '${serie.name}'`);
                    res(fetchSeasonItems(serie, page + 1, m3u));
                }

                if (!!allPrograms.js.data && allPrograms.js.data.length > 0) {
                    console.info(`Fetched page ${page}/${Math.ceil(allPrograms.js.total_items / allPrograms.js.max_page_items)} of serie '${serie.name}'`);
                }

                for (const season of allPrograms.js.data) {
                    m3u.push(...serieToM3u(serie, season, serie.name));
                }

                if (allPrograms.js.data.length > 0) {
                    res(fetchSeasonItems(serie, page + 1, m3u));
                } else {
                    res(true);
                }
            });
    });
}

function printProgress(idx: number, total: number): void {
    if (Math.ceil((idx - 1) / total * 100) !== Math.ceil(idx / total * 100)) {
        if (process.stdout.isTTY) {
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
        }
        const percentage = Math.ceil(idx * 100 / total);
        const rgbFromPercentage: [number, number, number] = getRGBFromPercentage(percentage);
        if (process.stdout.isTTY) {
            process.stdout.write(
                chalk.rgb(rgbFromPercentage[0], rgbFromPercentage[1], rgbFromPercentage[2])(`...generating (${percentage}%)`));
        } else {
            console.info(`...generating (${percentage}%)`);
        }
    }
}