import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export const {JSDOM}=process.env.RDA_TEST_MODULES?require(process.env.RDA_TEST_MODULES+'/jsdom'):require('jsdom');
