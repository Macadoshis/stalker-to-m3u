import { fetchData } from "./common.js";
import { ArrayData, Genre } from "./types.js";

const http = require('http');
const fs = require('fs');

fetchData<ArrayData<Genre>>('/server/load.php?type=itv&action=get_genres')
  .then(r => {
    //console.info(r.js);
    fs.writeFileSync("groups.txt", r.js
      .map(t => t.title)
      .filter(t => t !== 'All')
      .join('\r\n'));
  });