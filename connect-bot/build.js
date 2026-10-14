/* Builds connect4-bot.html: app.html with the bot (connect-ai.js) and its opening book
   (connect-book.js) put inside, so the whole thing is one file you can double-click.
   Usage: node connect-bot/build.js */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const book = read('connect-book.js'), ai = read('connect-ai.js');
for (const [name, src] of [['connect-book.js', book], ['connect-ai.js', ai]]) {
  if (/<\/script/i.test(src)) throw new Error(name + ' contains "</script", which would end the inline block');
}
const html = read('app.html').replace('/*BOOK*/', () => book).replace('/*AI*/', () => ai);
fs.writeFileSync(path.join(dir, 'connect4-bot.html'), html);
console.log(`connect-bot/connect4-bot.html (${(html.length / 1024).toFixed(1)} KB)`);
