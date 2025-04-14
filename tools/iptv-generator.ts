import Ajv from "ajv";
import { logConfig, READ_OPTIONS } from '../common';
import { BaseConfig, UrlConfig } from '../types';
import { forkJoin, of } from 'rxjs';
import { concatMap, mergeMap } from "rxjs/operators";

const axios = require('axios');
const fs = require('fs');
const chalk = require('chalk');
const yargsParser = require('yargs-parser');

const SUCCEEDED_FILE: string = './tools/succeeded.json';

interface GeneratorConfig extends BaseConfig {
    openAiKey: string;
    countries: string[];
}

function getConfig(): Readonly<GeneratorConfig> {
    const configData: string = fs.readFileSync('./tools/generator-config.json', READ_OPTIONS);
    let config: GeneratorConfig = JSON.parse(configData) as GeneratorConfig;

    // Validate JSON file
    const schema: any = require('./schemas/generator-config.schema.json');
    const ajv = new Ajv();
    const validate = ajv.compile(schema);
    if (!validate(config)) {
        console.error(chalk.red('\"tools/generator-config.json\" file is not valid. Please correct following errors:\r\n' + chalk.bold(JSON.stringify(validate.errors, null, 2))));
        process.exit(1);
    }

    // Fill in default values if unset

    // Override with command line additional arguments
    const args = yargsParser(process.argv.slice(2));
    config = {...config, ...args};

    return config;
}

const config: GeneratorConfig = getConfig();
logConfig(config);

if (!fs.existsSync(SUCCEEDED_FILE)) {
    console.error(chalk.red(`${SUCCEEDED_FILE} file does not exist`));
}

const succeeded: UrlConfig[] = JSON.parse(fs.readFileSync(SUCCEEDED_FILE, READ_OPTIONS)) as UrlConfig[];

forkJoin(succeeded.map(r => of(r)))
    .pipe(
        concatMap(succ => {
                return succ;
            }
        ),
        mergeMap((succ: UrlConfig) => {
            console.info(succ);
            return of({});
        }, 3)
    )
    .subscribe({
        error: err => console.error('UNEXPECTED ERROR:', err),
        complete: () => {
            console.info("End");
        }
    });