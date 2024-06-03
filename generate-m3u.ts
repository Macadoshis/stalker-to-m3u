import { fetchData, getConfig } from "./common.js";
import { ArrayData, Channel, Channels, Config, Data, Genre } from "./types.js";

type Tvg = Readonly<Record<string, string[]>>;

const http = require('http');
const fs = require('fs');

const GROUP_FILE: string = './groups.txt';

if (!fs.existsSync(GROUP_FILE)) {
  console.error(`File ${GROUP_FILE} does not exist.`);
  process.exit(1);
}

const config: Config = getConfig();

const tvgData: Tvg = JSON.parse(fs.readFileSync('./tvg.json',
  { encoding: 'utf8', flag: 'r' })) as Tvg;

function splitLines(lines: string): string[] {
  return lines.split(/\r\n|\r|\n/);
}

function getTvgId(channel: Channel): string {
  let tvgId: string = '';

  for (const iterator of Object.entries(tvgData)) {
    if (!!iterator[1].find(term => channel.name.toLocaleLowerCase()
      .includes(term.toLocaleLowerCase()))) {
      tvgId = iterator[0];
    }
  }

  return tvgId;
}

function channelToM3u(channel: Channel, group: string): string[] {
  const lines: string[] = [];

  const tvgId: string = !!config.tvgIdPreFill ? getTvgId(channel) : '';

  lines.push(`#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${channel.name}" tvg-logo="${channel.logo}" group-title="${group}",${channel.name}`);
  lines.push(`${channel.cmd.match(/[^http](http.*)/g)![0].trim()}`);

  return lines;
}

// Load groups
const groups: string[] = splitLines(fs.readFileSync(GROUP_FILE,
  { encoding: 'utf8', flag: 'r' }));

fetchData<ArrayData<Genre>>('/server/load.php?type=itv&action=get_genres')
  .then(genres => {
    fetchData<Data<Channels>>('/server/load.php?type=itv&action=get_all_channels')
      .then(allChannels => {

        const m3u: string[] = ['#EXTM3U'];

        for (var channel of allChannels.js.data) {
          const genre: Genre = genres.js.find(r => r.id === channel.tv_genre_id)!;

          if (!!genre && !!genre.title && groups.includes(genre.title)) {
            m3u.push(...channelToM3u(channel, genre.title));
          }
        }

        // Outputs m3u
        fs.writeFileSync(`${config.hostname}.m3u`, m3u
          .join('\r\n'));
      });
  });

