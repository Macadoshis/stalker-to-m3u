import Ajv from "ajv";
import { getGenerationKind, GROUP_FILE, logConfig, READ_OPTIONS } from '../common';
import { BaseConfig, GenerationKind, UrlConfig } from '../types';
import { catchError, forkJoin, from, of } from 'rxjs';
import { concatMap, mergeMap } from "rxjs/operators";
import * as process from "process";
import { createPartFromText, createPartFromUri, GoogleGenAI } from '@google/genai';
import { spawn } from 'child_process';

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const yargsParser = require('yargs-parser');

const SUCCEEDED_FILE: string = './tools/succeeded.json';

interface GeneratorConfig extends BaseConfig {
    geminiAiKey: string;
    geminiAiModel: string;
    outputDir?: string;
    languages?: string[];
    maxOutputs?: number;
    shuffle?: boolean;
    host?: string;
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

const MAX_OUTPUTS_MSG = 'MAX_OUTPUTS';

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
        config.geminiAiModel = 'gemini-2.5-flash';
    }
    if (config.streamTester === undefined) {
        config.streamTester = "ffmpeg";
    }
    if (config.outputDir === undefined) {
        config.outputDir = ".";
    }
    if (config.maxOutputs === undefined) {
        config.maxOutputs = -1;
    }
    if (!fs.existsSync(config.outputDir)) {
        console.info(`Directory ${config.outputDir} not found.`);
        process.exit(1);
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

/** Quota exceeded pointer (to stop the process) */
let aiQuotaExceeded: boolean = false;

if (!fs.existsSync(SUCCEEDED_FILE)) {
    console.error(chalk.red(`${SUCCEEDED_FILE} file does not exist`));
}

const succeeded: UrlConfig[] = (JSON.parse(fs.readFileSync(SUCCEEDED_FILE, READ_OPTIONS)) as UrlConfig[])
    .filter(x => {
        if (!!config.host) {
            return x.hostname === config.host;
        }
        return true;
    });

function getGeminiPrompt(): string {
    let prompt: string = '';

    switch (generationKind) {
        case 'iptv':
            prompt += `Filter the IPTV groups that ONLY match the following countries (or regions): [${config.iptv!.countries.join(', ')}]. Do not consider ANY others.`;
            if (config.iptv!.excludedGroups && config.iptv!.excludedGroups.length > 0) {
                prompt += ` Exclude following IPTV groups from the results: [${config.iptv!.excludedGroups.join(', ')}].`;
            }
            break;
        case "vod":
            prompt += `Filter the VOD groups that correspond to following categories: [${config.vod!.includedCategories.join(', ')}].`;
            if (config.vod!.excludedCategories && config.vod!.excludedCategories.length > 0) {
                prompt += ` Exclude following VOD groups from the results: [${config.vod!.excludedCategories.join(', ')}].`;
            }
            break;
        case "series":
            prompt += `Filter the SERIES groups of following series, tv shows or categories of tv shows: [${config.series!.includedSeries.join(', ')}].`;
            if (config.series!.excludedSeries && config.series!.excludedSeries.length > 0) {
                prompt += ` Exclude following series, tv shows or categories of tv shows from the results: [${config.series!.excludedSeries.join(', ')}].`;
            }
            break;
    }

    if (config.languages && config.languages.length > 0) {
        prompt += `\n\nInclude only groups for following languages: [${config.languages.join(', ')}].`;
    }

    return prompt;
}

console.log(chalk.gray(`Gemini AI prompt:\n`));
console.log(chalk.gray('-----------------\n'));
console.log(chalk.gray(`${getFullPrompt(getGeminiPrompt())}\n`));
console.log(chalk.gray('-----------------\n'));

let nbProcessed: number = 0;
let nbOutputs: number = 0;

if (!!config.host) {
    const m3uFileName: string = `${config.outputDir}/${generationKind}-${config.host}.m3u`;
    fs.rmSync(m3uFileName, {force: true});
    console.info(chalk.keyword('orange')(`File ${m3uFileName} deleted.`));
}

forkJoin(succeeded
    .sort(() => !!config.shuffle ? Math.random() - 0.5 : 0)
    .map(r => of(r)))
    .pipe(
        concatMap(succ => {
                return succ;
            }
        ),
        mergeMap((succ: UrlConfig) => {

            console.info(chalk.bgGreen.black.bold(`[ PROCESSING ] ${++nbProcessed} / ${succeeded.length}`));

            // Skip if max outputs is reached
            if (config.maxOutputs! > 0 && nbOutputs >= config.maxOutputs!) {
                console.info(`Max number of outputs reached: ${config.maxOutputs}.`)
                throw new RangeError(MAX_OUTPUTS_MSG);
            }

            // Skip of AI quota exceeded
            if (aiQuotaExceeded) {
                console.info(`Max AI quota exceeded.`)
                throw new RangeError(`Max AI quota exceeded.`);
            }

            // Skip if target file exists
            if (fs.existsSync(`${config.outputDir}/${generationKind}-${succ.hostname}.m3u`)) {
                console.info(chalk.keyword('orange')(`File already exists. Skipping generation for ${succ.hostname} [${succ.mac}].`));
                return of(true);
            }

            // Run groups generation
            if (fs.existsSync(GROUP_FILE(generationKind))) {
                fs.rmSync(GROUP_FILE(generationKind));
            }
            const child = spawn('npm', ['run', 'groups', `-- ${generationKind}`,
                    `--hostname=${succ.hostname}`, `--port=${succ.port}`, `--mac=${succ.mac}`,
                    `--contextPath=${succ.contextPath ?? ''}`, `--streamTester=${config.streamTester}`,
                    `--outputDir=${config.outputDir}`],
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
                    child.on('error', (err: Error) => {
                        console.log(`Script exited with error: ${err}`);
                        reject(false);
                    });
                }).then(() => {
                    // Call AI to filter groups.txt content
                    const groups: string[] = fs.readFileSync(GROUP_FILE(generationKind), READ_OPTIONS)
                        .split('\n')
                        .map((line: string) => line.trim())
                        .filter((line: string) => line.length > 0);
                    if (!groups || groups.length === 0) {
                        return Promise.resolve(false);
                    }
                    console.log('\u27A1 Original groups:', groups)
                    return askGemini(getGeminiPrompt())
                        .then(filtered => {
                            console.log('\u1FA84 Filtered groups:', filtered);

                            filtered = filtered.filter(group => {
                                if (!groups.includes(group)) {
                                    console.warn(chalk.keyword('orange')(`Excluding filtered group "${group}". Wrong matching result computed by Gemini AI.`));
                                    return false;
                                }
                                return true;
                            });

                            fs.writeFileSync(GROUP_FILE(generationKind), filtered.join('\n'), null, 2);
                            return filtered.length > 0;
                        });
                }).then((res) => {

                    if (!res) {
                        console.warn(chalk.keyword('orange')(`No matching group found !`));
                        return false;
                    } else {
                        const child = spawn('npm', ['run', 'm3u', `-- ${generationKind}`,
                                `--hostname=${succ.hostname}`, `--port=${succ.port}`, `--mac=${succ.mac}`,
                                `--contextPath=${succ.contextPath ?? ''}`, `--streamTester=${config.streamTester}`,
                                `--outputDir=${config.outputDir}`, '--testM3uFile=true'],
                            {
                                stdio: 'inherit',
                                shell: true,
                            }
                        );
                        return new Promise<boolean>((resolve, reject) => {
                            child.on('exit', (code: number) => {
                                console.log(`Script exited with code ${code}`);
                                if (code === 0) {
                                    nbOutputs++;
                                    resolve(true);
                                } else {
                                    console.error(`Error generating m3u of ${JSON.stringify(succ)}:`)
                                    reject(false);
                                }
                            });
                            child.on('error', (err: Error) => {
                                console.log(`Script exited with error: ${err}`);
                                reject(false);
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
            if (!(err instanceof RangeError)) {
                console.error('Unexpected error occurred:', err);
            }
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

function getFullPrompt(prompt: string): string {
    return `- SYSTEM INSTRUCTION:
You are an IPTV data extraction tool. Your ONLY output must be a valid JSON array of strings. 
No conversational text, no explanations, no reasoning, and no markdown formatting outside of the JSON block.
- FORMAT: JSON array of strings. 
- CONSTRAINT: Use exact strings from the file. No modifications. No preamble.
Attached text file is the list of groups (one per line).

- ANSWER INSTRUCTION:
Provide the matches in attached file in JSON array format. Keep as given each group from attached file (one group per line). Only filter the rows matching the prompt. Do not edit, modify or add a line from attached groups. Please read proof your filtered matches to be sure each is indeed a row in attached file without any modification.
Filter the attached IPTV list (one per line).

- USER PROMPT:
${prompt}
`;
}

export async function askGemini(prompt: string): Promise<string[]> {

    const ai = new GoogleGenAI({apiKey: config.geminiAiKey});

    console.info(chalk.gray(`Asking Gemini AI to filter ${path.basename(GROUP_FILE(generationKind))} file...`));

    try {
        // Upload groups file to gemini
        const groupsFile = await ai.files.upload({
            file: GROUP_FILE(generationKind),
            config: {mimeType: "text/plain"},
        });

        // Ask gemini with prompt and attached groups file
        const result = await ai.models.generateContent({
            model: config.geminiAiModel,
            contents: [
                {
                    role: "user",
                    parts: [
                        createPartFromUri(groupsFile.uri!, groupsFile.mimeType!),
                        createPartFromText(getFullPrompt(prompt)),
                    ]
                }
            ],
            config: {
                thinkingConfig: {
                    // thinkingLevel: "low",  // (for GEMINI-3 only) Options: 'minimal', 'low', 'medium', 'high'
                    includeThoughts: false,    // Optional: returns the 'thoughts' in response
                    thinkingBudget: 0
                },
                temperature: 0,
                responseMimeType: "application/json"
            }
        });

        if (!result || !result.text) {
            throw new Error(`(${result.modelVersion}) No response received. ${result.codeExecutionResult} ${result.responseId}`);
        }
        if (result.text!.startsWith("```json") && result.text!.endsWith("```")) {
            return JSON.parse(result.text!.substring("```json".length, result.text!.length - "```".length).trim());
        } else if (result.text!.startsWith("[") && result.text!.endsWith("]")) {
            return JSON.parse(result.text);
        } else {
            try {
                return JSON.parse(result.text);
            } catch (e) {
                throw new Error(`(${result.modelVersion}) Unexpected response format:|${result?.text}` || result?.data + '|');
            }
        }
    } catch (err: any) {
        console.error('Error calling Gemini:', err.response?.data || err.message);
        if (err.response?.data?.error?.code === 429
            || err.message?.includes('429')
            || err.message?.includes('RESOURCE_EXHAUSTED')
            || err.status === 429) {
            // Quota exceeded
            aiQuotaExceeded = true;
        }
        throw new Error('Error from Gemini');
    }
}
