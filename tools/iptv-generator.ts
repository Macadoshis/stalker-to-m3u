import Ajv from "ajv";
import { getGenerationKind, GROUP_FILE, logConfig, READ_OPTIONS } from '../common';
import { BaseConfig, GenerationKind, UrlConfig } from '../types';
import { catchError, forkJoin, from, of } from 'rxjs';
import { concatMap, mergeMap } from "rxjs/operators";
import * as process from "process";

import { spawn } from 'child_process';

const axios = require('axios');
const fs = require('fs');
const chalk = require('chalk');
const yargsParser = require('yargs-parser');

const SUCCEEDED_FILE: string = './tools/succeeded.json';

interface GeneratorConfig extends BaseConfig {
    geminiAiKey: string;
    geminiAiModel: string;
    languages?: string[];
    iptv?: IptvGeneratorConfig;
    vod?: VodGeneratorConfig;
    series?: SeriesGeneratorConfig;
}

interface IptvGeneratorConfig {
    countries: string[];
    excludedGroups?: string[];
}

interface VodGeneratorConfig {
    includedCategories: string[];
    excludedCategories?: string[];
}

interface SeriesGeneratorConfig {
    includedSeries: string[];
    excludedSeries?: string[];
}

const generationKind: GenerationKind = getGenerationKind();

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
    if (!config.geminiAiModel) {
        config.geminiAiModel = 'gemini-2.0-flash';
    }
    if (config.streamTester === undefined) {
        config.streamTester = "http";
    }

    switch (generationKind) {
        case "iptv":
            if (!config.iptv) {
                throw new Error('"iptv" config must be set');
            }
            break;
        case "vod":
            if (!config.vod) {
                throw new Error('"vod" config must be set');
            }
            break;
        case "series":
            if (!config.series) {
                throw new Error('"series" config must be set');
            }
            break;
    }

    // Override with command line additional arguments
    const args = yargsParser(process.argv.slice(2));
    config = {...config, ...args};

    return config;
}

const config: GeneratorConfig = getConfig();
logConfig(config);

/** Start time */
const startTime = process.hrtime();

const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiAiModel}:generateContent?key=${config.geminiAiKey}`;

if (!fs.existsSync(SUCCEEDED_FILE)) {
    console.error(chalk.red(`${SUCCEEDED_FILE} file does not exist`));
}

const succeeded: UrlConfig[] = JSON.parse(fs.readFileSync(SUCCEEDED_FILE, READ_OPTIONS)) as UrlConfig[];

function getGeminiPrompt(): string {
    let prompt: string = '';

    switch (generationKind) {
        case 'iptv':
            prompt += `Filter the IPTV groups that correspond to following countries: ${config.iptv!.countries.join(', ')}.`;
            if (config.iptv!.excludedGroups && config.iptv!.excludedGroups.length > 0) {
                prompt += ` But exclude following IPTV groups: ${config.iptv!.excludedGroups.join(', ')}.`;
            }
            break;
        case "vod":
            prompt += `Filter the VOD groups that correspond to following categories: ${config.vod!.includedCategories.join(', ')}.`;
            if (config.vod!.excludedCategories && config.vod!.excludedCategories.length > 0) {
                prompt += ` But exclude following VOD groups: ${config.vod!.excludedCategories.join(', ')}.`;
            }
            break;
        case "series":
            prompt += `Filter the SERIES groups of following series, tv shows or categories of tv shows: ${config.series!.includedSeries.join(', ')}.`;
            if (config.series!.excludedSeries && config.series!.excludedSeries.length > 0) {
                prompt += ` But exclude following series, tv shows or categories of tv shows: ${config.series!.excludedSeries.join(', ')}.`;
            }
            break;
    }

    if (config.languages && config.languages.length > 0) {
        prompt += ` Also only consider results of following languages: ${config.languages.join(', ')}.`;
    }

    return prompt;
}

console.log(chalk.gray(`Gemini prompt:\n`));
console.log(chalk.gray('-----------------\n'));
console.log(chalk.gray(`${getFullPrompt(getGeminiPrompt(), ['Example group 1', 'Example group 2'])}\n`));
console.log(chalk.gray('-----------------\n'));

forkJoin(succeeded.map(r => of(r)))
    .pipe(
        concatMap(succ => {
                return succ;
            }
        ),
        mergeMap((succ: UrlConfig) => {

            // Run groups generation
            if (fs.existsSync(GROUP_FILE)) {
                fs.rmSync(GROUP_FILE);
            }
            const child = spawn('npm', ['run', 'groups', `-- ${generationKind}`,
                    `--hostname=${succ.hostname}`, `--port=${succ.port}`, `--mac=${succ.mac}`,
                    `--streamTester=${config.streamTester}`],
                {
                    stdio: 'inherit',
                    shell: true,
                }
            );

            return from(new Promise<boolean>((resolve, reject) => {
                    child.on('exit', (code: number) => {
                        console.log(`Script exited with code ${code}`);
                        if (code === 0) {
                            resolve(true);
                        } else {
                            console.error(`Error generating group of ${JSON.stringify(succ)}:`)
                            reject(false);
                        }
                    });
                }).then(() => {
                    // Call AI to filter groups.txt content
                    const groups: string[] = fs.readFileSync(GROUP_FILE, READ_OPTIONS)
                        .split('\n')
                        .map((line: string) => line.trim())
                        .filter((line: string) => line.length > 0);
                    if (!groups || groups.length === 0) {
                        return Promise.resolve(false);
                    }
                    return askGemini(getGeminiPrompt(), groups)
                        .then(filtered => {
                            console.log('Original groups:', groups)
                            console.log('Filtered groups:', filtered);
                            fs.writeFileSync(GROUP_FILE, filtered.join('\n'), null, 2);
                            return filtered.length > 0;
                        });
                }).then((res) => {

                    if (!res) {
                        console.warn(`No group found !`);
                        return false;
                    } else {
                        const child = spawn('npm', ['run', 'm3u', `-- ${generationKind}`,
                                `--hostname=${succ.hostname}`, `--port=${succ.port}`, `--mac=${succ.mac}`,
                                `--streamTester=${config.streamTester}`],
                            {
                                stdio: 'inherit',
                                shell: true,
                            }
                        );
                        return new Promise<boolean>((resolve, reject) => {
                            child.on('exit', (code: number) => {
                                console.log(`Script exited with code ${code}`);
                                if (code === 0) {
                                    resolve(true);
                                } else {
                                    console.error(`Error generating m3u of ${JSON.stringify(succ)}:`)
                                    reject(false);
                                }
                            });
                        });
                    }
                })
            ).pipe(
                catchError((err) => {
                    // Resolve to handle next iteration
                    return of(false);
                })
            );
        }, 1),
        catchError((err) => {
            console.error('Unexpected error occurred:', err);
            return of(false);
        })
    )
    .subscribe({
        error: err => console.error('UNEXPECTED ERROR:', err),
        complete: () => {

            const endTime = process.hrtime(startTime);

            // Calculate total execution time
            const durationInSeconds = endTime[0];

            console.debug(chalk.bold(`[COMPLETE] All entries processed. Execution time: ${durationInSeconds} seconds.`))
        }
    });

function getFullPrompt(prompt: string, groups: string[]): string {
    return `You are an IPTV filtering assistant.\n\n${prompt}\n\nHere is the list of groups:\n${groups.map(group => `'${group}'`).join(',\n')}\n\nProvide the valid matches in JSON array format, without any surrounding code blocks. Keep as is each given group, do not modify groups or add new groups.`;
}

export async function askGemini(prompt: string, groups: string[]): Promise<string[]> {

    const body = {
        contents: [{
            parts: [{text: getFullPrompt(prompt, groups)}]
        }]
    };

    try {
        const response = await axios.post(GEMINI_API_URL, body, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = response.data?.candidates?.[0]?.content?.parts?.[0]?.text.trim();
        if (!result) {
            throw new Error(`No response received. ${response.status} ${response.statusText}`);
        }
        if (result.startsWith("```json") && result.endsWith("```")) {
            return JSON.parse(result.substring("```json".length, result.length - "```".length).trim());
        } else if (result.startsWith("[") && result.endsWith("]")) {
            return JSON.parse(result);
        }
        throw new Error('Unexpected response format:|' + result + '|');
    } catch (err: any) {
        console.error('Error calling Gemini:', err.response?.data || err.message);
        throw new Error('Error from Gemini');
    }
}