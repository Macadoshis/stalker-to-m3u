import { fetchData, fetchSeries, getConfig, getGenerationKind, GROUP_FILE, logConfig } from "./common";
import { ArrayData, GenerationKind, Genre } from "./types";
import { iswitch } from 'iswitch';

const fs = require('fs');
const chalk = require('chalk');

const generationKind: GenerationKind = getGenerationKind();
logConfig(getConfig());

fetchData<ArrayData<Genre>>('/server/load.php?'
    + iswitch(generationKind, ['iptv', () => 'type=itv&action=get_genres'],
        ['vod', () => 'type=vod&action=get_categories'],
        ['series', () => 'type=series&action=get_categories']))
    .then(r => {

        if (generationKind === 'series') {
            // Look for movies for each category
            fetchSeries(r.js).then(genreSeries => {
                fs.writeFileSync(GROUP_FILE, genreSeries
                    .map(t => t.toString())
                    .filter(t => t !== 'All')
                    .join('\r\n'));
            });
        } else {
            fs.writeFileSync(GROUP_FILE, (r.js ?? [])
                .map(t => t.title)
                .filter(t => t !== 'All')
                .join('\r\n'));
        }
    }, err => {
        process.exit(1);
    })
    .then(() => {
        console.info(chalk.bold(`File ${GROUP_FILE} successfully created`));
    });