import { RemasterScreen } from './screens/remaster-screen.js';

const build = document.querySelector('meta[name="app-build"]')?.content || '';
const catalogURL = new URL('./catalog.json', import.meta.url).href;
const versionURL = new URL('../../version.json', import.meta.url).href;

const screen = new RemasterScreen({ build, catalogURL, versionURL });
await screen.mount();
