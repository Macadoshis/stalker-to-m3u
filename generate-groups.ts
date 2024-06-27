import { fetchData, getGenerationKind } from "./common.js";
import { ArrayData, GenerationKind, Genre } from "./types.js";

const http = require('http');
const fs = require('fs');

const generationKind: GenerationKind = getGenerationKind();

fetchData<ArrayData<Genre>>('/portal.php?'
  + (generationKind === 'iptv' ? 'type=itv&action=get_genres' : 'type=vod&action=get_categories'))
  .then(r => {
    fs.writeFileSync("groups.txt", r.js
      .map(t => t.title)
      .filter(t => t !== 'All')
      .join('\r\n'));
  });