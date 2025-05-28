import { M3uResult, M3uTesterConfig } from "../types";
import { checkM3u, logConfig, READ_OPTIONS } from "../common";
import Ajv from "ajv";
import { basename, dirname, extname, join } from "path";
import { from, last, map, Observable, of, scan } from "rxjs";
import { mergeMap } from "rxjs/operators";
import * as process from "process";

const fs = require('fs');
const chalk = require('chalk');
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
        config.streamTester = "ffmpeg";
    }
    if (!config.renamePrefix) {
        config.renamePrefix = "UNHEALTHY_";
    }
    config.maxFailures = config.maxFailures ?? 1;
    config.minSuccess = config.minSuccess ?? 1;
    config.threadsCount = config.threadsCount ?? 1;
    config.renameOnFailure = config.renameOnFailure === undefined ? false : config.renameOnFailure;

    // Override with command line additional arguments
    const args = yargsParser(process.argv.slice(2));
    config = {...config, ...args};

    if (typeof config.renameOnFailure !== "boolean") {
        config.renameOnFailure = config.renameOnFailure as any === "true";
    }

    return config;
}

if (!fs.existsSync(config.m3uLocation)) {
    console.error(chalk.red(`Provided location "${config.m3uLocation}" does not exist as a file or directory`));
    process.exit(1);
}


let runner: Observable<M3uResult[]> = of();

if (fs.statSync(config.m3uLocation).isDirectory()) {
    // M3U directory provided
    const files = fs.readdirSync(config.m3uLocation) as string[];
    const m3uFiles: string[] = files.filter(file => extname(file) === '.m3u').map(file => join(config.m3uLocation, file));

    if (m3uFiles.length === 0) {
        console.warn('No files found.');
        process.exit(0);
    }

    runner = from(m3uFiles)
        .pipe(
            mergeMap(file => checkM3u(file, config), config.threadsCount),
            scan((acc, result) => {
                return [...acc, result];
            }, [] as M3uResult[]),
            last()
        );
} else if (fs.statSync(config.m3uLocation).isFile()) {
    // M3U file provided
    runner = checkM3u(config.m3uLocation, config).pipe(
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

    if (!results.map(x => x.status).some(r => r)) {
        if (results.length === 1) {
            console.error(`File was not successful`);
        } else {
            console.error(`At least one file was not successful`);
        }
        process.exit(1);
    }
});
