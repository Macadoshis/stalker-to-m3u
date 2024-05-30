import { fetchData, getConfig } from "./common.js";
import { ArrayData, Channel, Channels, Config, Data, Genre } from "./types.js";

const http = require('http');
const fs = require('fs');

const GROUP_FILE: string = './groups.txt';

if (!fs.existsSync(GROUP_FILE)) {
  console.error(`File ${GROUP_FILE} does not exist.`);
  process.exit(1);
}

function splitLines(lines: string): string[] {
  return lines.split(/\r\n|\r|\n/);
}

function channelToM3u(channel: Channel, group: string): string[] {
  const lines: string[] = [];

  // TODO: fetc tvgId
  const tvgId: string = '';

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
        //console.info(allChannels.js.data[0]);

        const m3u: string[] = ['#EXTM3U'];

        for (var channel of allChannels.js.data) {
          const genre: Genre = genres.js.find(r => r.id === channel.tv_genre_id)!;

          if (groups.includes(genre.title)) {
            m3u.push(...channelToM3u(channel, genre.title));
          }
        }

        // Outputs m3u
        const config: Config = getConfig();
        fs.writeFileSync(`${config.hostname}.m3u`, m3u
          .join('\r\n'));
      });
  });

