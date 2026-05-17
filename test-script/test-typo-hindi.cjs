// Quick test: load LibreOffice Hindi dictionary via typo-js and check sample words.
const fs = require('fs');
const path = require('path');
const https = require('https');
const Typo = require(path.join(__dirname, '..', 'frontend', 'node_modules', 'typo-js', 'typo.js'));

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve, reject);
      }
      let buf = [];
      res.on('data', (d) => buf.push(d));
      res.on('end', () => resolve(Buffer.concat(buf).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  console.log('Fetching Hindi dictionary...');
  const aff = await fetchText('https://raw.githubusercontent.com/LibreOffice/dictionaries/master/hi_IN/hi_IN.aff');
  const dic = await fetchText('https://raw.githubusercontent.com/LibreOffice/dictionaries/master/hi_IN/hi_IN.dic');
  console.log('aff starts with:', JSON.stringify(aff.slice(0, 20)));
  console.log('aff.startsWith("SET"):', aff.startsWith('SET'));
  console.log('dic first line:', dic.split(/\r?\n/)[0]);
  console.log('aff length:', aff.length, 'dic length:', dic.length);
  // Try without BOM stripping
  console.log('\n--- WITHOUT BOM stripping ---');
  const typo1 = new Typo('hi_IN', aff, dic);
  console.log('loaded:', typo1.loaded);
  console.log('flags:', Object.keys(typo1.flags).slice(0, 20));
  console.log('rules count:', Object.keys(typo1.rules).length);
  const wordsInDict = ['ढूंढेगा', 'स्किम्ड', 'ऑपर्च्युनिटी'];
  for (const w of wordsInDict) {
    try { console.log(w, '=>', typo1.check(w)); } catch (e) { console.log(w, '=> ERROR:', e); }
  }
  const commonWords = ['नमस्ते', 'मेरा', 'नाम', 'है', 'भारत'];
  for (const w of commonWords) {
    try { console.log(w, '=>', typo1.check(w)); } catch (e) { console.log(w, '=> ERROR:', e); }
  }
  // Strip BOM
  console.log('\n--- WITH BOM stripping ---');
  const affNoBom = aff.replace(/^﻿/, '');
  const dicNoBom = dic.replace(/^﻿/, '');
  const typo2 = new Typo('hi_IN', affNoBom, dicNoBom);
  console.log('loaded:', typo2.loaded);
  console.log('rules count:', Object.keys(typo2.rules).length);
  for (const w of wordsInDict) {
    try { console.log(w, '=>', typo2.check(w)); } catch (e) { console.log(w, '=> ERROR:', e); }
  }
  for (const w of commonWords) {
    try { console.log(w, '=>', typo2.check(w)); } catch (e) { console.log(w, '=> ERROR:', e); }
  }
})();
