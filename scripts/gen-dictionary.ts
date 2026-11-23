import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { dictionaryMarkdown } from '../src/lib/export/dictionary';
writeFileSync(path.join(__dirname, '..', 'docs', 'DATA_DICTIONARY.md'), dictionaryMarkdown());
console.log('docs/DATA_DICTIONARY.md written');
