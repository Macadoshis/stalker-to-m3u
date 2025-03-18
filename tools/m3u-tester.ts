import {StreamTester} from "../types";
import {checkStream, logConfig, READ_OPTIONS} from "../common";
import Ajv from "ajv";
import {basename, dirname, extname, join} from "path";
import {forkJoin, last, map, Observable, of, scan, takeWhile, tap} from "rxjs";
import {mergeMap} from "rxjs/operators";
import {Playlist} from "iptv-playlist-parser";

export interface M3uTesterConfig {
    m3uLocation: string;
    maxFailures: number;
    minSuccess: number;
    renameOnFailure?: boolean;
    renamePrefix?: string;
    streamTester?: StreamTester;
}

interface M3uResultStream {
    name: string;
    url: string;
}

interface M3uResult {
    file: string;
    status: boolean;
    failedStreams: M3uResultStream[];
    succeededStreams: M3uResultStream[];
}

const fs = require('fs');
const chalk = require('chalk');
const parser = require('iptv-playlist-parser');
const yargsParser = require('yargs-parser');

const config: M3uTesterConfig = getConfig();
logConfig(config);

export function getConfig(): Readonly<M3uTesterConfig> {
    const configData: string = fs.readFileSync('./tools/m3u-tester-config.json', READ_OPTIONS);
    let config: M3uTesterConfig = JSON.parse(configData) as M3uTesterConfig;

    // Validate JSON file
    const schema: any = require('./schemas/m3u-tester-config.schema.json');
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    if (!validate(config)) {
        console.error(chalk.red('\"tools/m3u-tester-config.json\" file is not valid. Please correct following errors:\r\n' + chalk.bold(JSON.stringify(validate.errors, null, 2))));
        process.exit(1);
    }

    // Fill in default values if unset

    if (config.streamTester === undefined) {
        config.streamTester = "http";
    }
    if (!config.renamePrefix) {
        config.renamePrefix = "UNHEALTHY_";
    }
    config.maxFailures = config.maxFailures ?? 1;
    config.minSuccess = config.minSuccess ?? 1;
    config.renameOnFailure = config.renameOnFailure === undefined ? false : config.renameOnFailure;

    // Override with command line additional arguments
    const args = yargsParser(process.argv.slice(2));
    config = {...config, ...args};

    return config;
}

if (!fs.existsSync(config.m3uLocation)) {
    console.error(chalk.red(`Provided location "${config.m3uLocation}" does not exist as a file or directory`));
    process.exit(1);
}

export function checkM3u(m3uFile: string, cfg: M3uTesterConfig = config): Observable<M3uResult> {

    const m3uResult: M3uResult = {
        status: true,
        file: m3uFile,
        failedStreams: [] as M3uResultStream[],
        succeededStreams: [] as M3uResultStream[]
    } as M3uResult;

    const playlist: Playlist = parser.parse(fs.readFileSync(m3uFile, READ_OPTIONS));

    // Update max values according to number of items
    if (cfg.minSuccess > 0) {
        cfg.minSuccess = Math.min(cfg.minSuccess, playlist.items.length);
    }
    if (cfg.maxFailures > 0) {
        cfg.maxFailures = Math.min(cfg.maxFailures, playlist.items.length);
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
                        m3uResult.succeededStreams = [...m3uResult.succeededStreams, result];
                    } else {
                        m3uResult.failedStreams = [...m3uResult.failedStreams, result];
                    }
                    return m3uResult;
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
                    return acc.succeededStreams.length < cfg.minSuccess && acc.failedStreams.length < cfg.maxFailures;
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

                    return {...m3uResult, status: status};
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

let runner: Observable<M3uResult[]> = of();

if (fs.statSync(config.m3uLocation).isDirectory()) {
    // M3U directory provided
    const files = fs.readdirSync(config.m3uLocation) as string[];
    const m3uFiles: string[] = files.filter(file => extname(file) === '.m3u').map(file => join(config.m3uLocation, file));

    runner = forkJoin(m3uFiles.map(file => checkM3u(file)));
} else if (fs.statSync(config.m3uLocation).isFile()) {
    // M3U file provided
    runner = checkM3u(config.m3uLocation).pipe(
        map(result => [result])
    );
}

runner.subscribe(results => {
    results.forEach(result => {
        if (result.status) {
            console.log(chalk.green(`File ${chalk.bold(result.file)} is HEALTHY (success: ${result.succeededStreams.length}, failures: ${result.failedStreams.length})`));
        } else {
            console.log(chalk.red(`File ${chalk.bold(result.file)} is UNHEALTHY (success: ${result.succeededStreams.length}, failures: ${result.failedStreams.length})`));
            if (config.renameOnFailure) {
                fs.renameSync(result.file, join(dirname(result.file), config.renamePrefix + basename(result.file)));
            }
        }
    });
});
