import { fetchData, getConfig, getGenerationKind } from "./common.js";
import { ArrayData, Channel, Config, Data, GenerationKind, Genre, Program, Programs, Video } from "./types.js";

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

  lines.push(`#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${channel.name}" tvg-logo="${decodeURIComponent(channel.logo)}" group-title="${group}",${channel.name}`);
  lines.push(`${channel.cmd.match(/[^http](http.*)/g)![0].trim()}`);

  return lines;
}

function videoToM3u(video: Video, group: string): string[] {
  const lines: string[] = [];

  lines.push(`#EXTINF:-1 tvg-id="" tvg-name="${video.name}" tvg-logo="${decodeURIComponent(video.screenshot_uri)}" group-title="${group}",${video.name}`);
  //lines.push(`${video.cmd.match(/[^http](http.*)/g)![0].trim()}`);
  lines.push(video.cmd);

  return lines;
}

// Load groups
const groups: string[] = splitLines(fs.readFileSync(GROUP_FILE,
  { encoding: 'utf8', flag: 'r' }));

const generationKind: GenerationKind = getGenerationKind();

fetchData<ArrayData<Genre>>('/server/load.php?' +
  (generationKind === 'iptv' ? 'type=itv&action=get_genres' : 'type=vod&action=get_categories')
)
  .then(genres => {

    const m3u: string[] = ['#EXTM3U'];

    var next = new Promise<any>((res, err) => {
      if (generationKind === "iptv") {
        fetchData<Data<Programs<Program>>>('/server/load.php?type=itv&action=get_all_channels')
          .then(allPrograms => {

            for (var program of allPrograms.js.data) {
              const channel: Channel = program as Channel;
              const genre: Genre = genres.js.find(r => r.id === channel.tv_genre_id)!;

              if (!!genre && !!genre.title && groups.includes(genre.title)) {
                m3u.push(...channelToM3u(channel, genre.title));
              }

            }

            res(null);
          });
      } else if (generationKind === "vod") {

        groups.map(group => {
          const genreVod: Genre = genres.js.find(r => r.title === group)!;
          return genreVod;
        }).reduce((accPrograms, nextGenre, i) => {
          return accPrograms.then(val => {
            return fetchVodItems(nextGenre, 1, m3u);
          });
        }, Promise.resolve(true))
          .then(() => {
            res(null);
          });
      }
    });

    next.then(() => {
      // Outputs m3u
      fs.writeFileSync(`${config.hostname}.m3u`, m3u
        .join('\r\n'));
    });

  });

function fetchVodItems(genre: Genre, page: number, m3u: string[]): Promise<boolean> {
  return new Promise<boolean>((res, err) => {

    fetchData<Data<Programs<Program>>>(`/server/load.php?type=vod&action=get_ordered_list&sortby=added&p=${page}&genre=${genre.id}`)
      .then(allPrograms => {

        console.info(`Fetched page ${page}/${Math.ceil(allPrograms.js.total_items / allPrograms.js.max_page_items)} of genre '${genre.title}'`);

        for (var program of allPrograms.js.data) {
          const video: Video = program as Video;
          m3u.push(...videoToM3u(video, genre.title));
        }

        if (allPrograms.js.data.length > 0 && page < 5) {
          res(fetchVodItems(genre, page + 1, m3u))
        } else {
          res(true);
        }
      });
  });
}