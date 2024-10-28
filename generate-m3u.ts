import { fetchData, getConfig, getGenerationKind } from "./common.js";
import { ArrayData, Channel, Config, Data, GenerationKind, Genre, M3U, M3ULine, Program, Programs, Video } from "./types.js";

type Tvg = Readonly<Record<string, string[]>>;

const http = require('follow-redirects').http;
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
  const lines: M3ULine = <M3ULine><any>{ program: channel };
  lines.program = channel;

  const tvgId: string = !!config.tvgIdPreFill ? getTvgId(channel) : '';

  lines.header = `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${channel.name}" tvg-logo="${decodeURI(channel.logo)}" group-title="TV - ${group}",${channel.name}`;
  lines.command = decodeURI(channel.cmd);

  return lines;
}

function videoToM3u(video: Video, group: string): M3ULine {
  const lines: M3ULine = <M3ULine><any>{ program: video };

  lines.header = `#EXTINF:${video.time * 60} tvg-id="" tvg-name="${video.name}" tvg-logo="${decodeURI(video.screenshot_uri)}" group-title="VOD - ${group}",${video.name}`;
  lines.command = decodeURI(video.cmd);

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

    const m3u: M3ULine[] = [];

    var next = new Promise<any>((res, err) => {
      if (generationKind === "iptv") {
        fetchData<Data<Programs<Program>>>('/server/load.php?type=itv&action=get_all_channels')
          .then(allPrograms => {

            for (var program of allPrograms.js.data) {
              const channel: Channel = program as Channel;
              const genre: Genre = genres.js.find(r => r.id === channel.tv_genre_id)!;

              if (!!genre && !!genre.title && groups.includes(genre.title)) {
                m3u.push(channelToM3u(channel, genre.title));
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

            console.info(`Testing ${maxNumberOfChannelsToTest} channels randomly... : ${testM3u.map(m => m.program.name).join(', ')}`);

            testM3u.reduce((acc, next, idx) => {

              return acc.then(() => {

                return resolveUrlLink(next).then(() => {

                  return new Promise<void>((resp, err) => {

                    // Test stream URL
                    var req = http.get(next.url, (resHttp: any) => {

                      if (resHttp.statusCode !== 200) {
                        console.error(`Did not resolve stream ${next.url} of channel ${next.program.name}. Code: ${resHttp.statusCode}`);
                        resHttp.resume();
                        next.testResult = false;
                      } else {
                        //console.debug(`Resolved successfully stream ${next.url} of channel ${next.program.name}.`);
                        next.testResult = true;
                      }

                      resp();
                    }, (errHttp: any) => {
                      next.testResult = false;
                      resp();
                    });

                    req.end();
                  });
                });
              });
            }, Promise.resolve())
              .then(() => {
                const nbTestedOk: number = testM3u.filter(r => !!r.testResult).length;
                console.info(`${nbTestedOk}/${maxNumberOfChannelsToTest} streams were tested successfully`);
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
            console.error("Aborting M3U generation");
            process.exit(1);
          }
        });

      });

    }).then(() => {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);

      // Outputs m3u
      const filename: string = `${generationKind}-${config.hostname}.m3u`;
      console.info(`Creating file ${filename}`);
      fs.writeFileSync(`${generationKind}-${config.hostname}.m3u`, new M3U(m3u).print(config));
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
  } else if (generationKind === 'vod') {
    type = 'vod';
  } else {
    type = '';
  }

  return new Promise<void>((res, err) => {

    fetchData<Data<{ cmd: string }>>(`/server/load.php?type=${type}&action=create_link&cmd=${encodeURI(m3uLine.command!)}&series=&forced_storage=undefined&disable_ad=0&download=0&JsHttpRequest=1-xml`, true)
      .then(urlLink => {
        if (urlLink?.js?.cmd) {
          m3uLine.url = decodeURI(urlLink.js.cmd.match(/[^http]?(http.*)/g)![0].trim());
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
  });
}

function fetchVodItems(genre: Genre, page: number, m3u: M3ULine[]): Promise<boolean> {
  return new Promise<boolean>((res, err) => {

    fetchData<Data<Programs<Program>>>(`/server/load.php?type=vod&action=get_ordered_list&sortby=added&p=${page}&genre=${genre.id}`, true)
      .then(allPrograms => {

        if (!allPrograms?.js) {
          console.error(`Error fetching page ${page} of genre '${genre.title}'`);
          res(fetchVodItems(genre, page + 1, m3u));
        }

        console.info(`Fetched page ${page}/${Math.ceil(allPrograms.js.total_items / allPrograms.js.max_page_items)} of genre '${genre.title}'`);

        for (var program of allPrograms.js.data) {
          const video: Video = program as Video;
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

function printProgress(idx: number, total: number): void {
  if (Math.ceil((idx - 1) / total * 100) !== Math.ceil(idx / total * 100)) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`...progress: ${Math.ceil(idx * 100 / total)}%`);
  }
}