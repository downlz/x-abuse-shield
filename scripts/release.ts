// Builds the downloads for a GitHub release into .output/release/:
//
//   x-abuse-shield-<version>-chrome.zip   Chrome / Brave: unzip, then "Load unpacked"
//   x-abuse-shield-<version>.crx          the same, packed and signed (installs only where policy allows off-store extensions)
//   x-abuse-shield-<version>.xpi          Firefox, unsigned: a temporary add-on, or permanent in Developer Edition / Nightly
//   SHA256SUMS.txt
//
//   npm run model:build   (once)
//   npm run release       the model is downloaded on first use from HOSTED_MODEL_URL (~7 MB downloads)
//   npm run release -- --bundled   the model ships inside every download (~240 MB)
//
// Before building, it checks that the host serves exactly the files in public/models, to browsers.
//
// The .crx is signed with the private key at CRX_KEY (default ~/.x-abuse-shield/crx-key.pem), created on the
// first run. Keep it safe and out of the repository: it fixes the extension's id, so later versions must be
// signed with the same key.
import { execFileSync, execSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import puppeteer from 'puppeteer';
import { BUNDLED_MODEL_DIR, BUNDLED_MODEL_FILE, HOSTED_MODEL_URL, LITE_MODEL_ID, MODEL_ID } from '../src/adapters/inference/model';

const root = join(import.meta.dirname, '..');
const output = join(root, '.output');
const releaseDir = join(output, 'release');
const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string };
const keyPath = process.env.CRX_KEY ?? join(homedir(), '.x-abuse-shield', 'crx-key.pem');
const bundled = process.argv.includes('--bundled');
const modelUrl = process.env.WXT_MODEL_URL ?? HOSTED_MODEL_URL;
const modelDir = join(root, 'public', BUNDLED_MODEL_DIR, MODEL_ID);
// Hosted builds load the phone model from the same host (wxt.config.ts), so it must be built and hosted too.
const liteDir = join(root, 'public', BUNDLED_MODEL_DIR, LITE_MODEL_ID);

if (!existsSync(join(modelDir, BUNDLED_MODEL_FILE))) throw new Error('Run `npm run model:build` first.');
if (!existsSync(join(liteDir, BUNDLED_MODEL_FILE))) throw new Error('Run `npm run model:trim` first: it builds the phone model.');
if (!bundled) await checkHost();

// wxt zip builds, then zips each browser's folder with manifest.json at the root.
const env = bundled
  ? { ...process.env, WXT_BUNDLE_MODEL: 'true', WXT_MODEL_URL: '' }
  : { ...process.env, WXT_BUNDLE_MODEL: 'false', WXT_MODEL_URL: modelUrl };
execSync('npx wxt zip', { cwd: root, stdio: 'inherit', env });
execSync('npx wxt zip -b firefox', { cwd: root, stdio: 'inherit', env });

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
const files = {
  chromeZip: join(releaseDir, `${name}-${version}-chrome.zip`),
  crx: join(releaseDir, `${name}-${version}.crx`),
  xpi: join(releaseDir, `${name}-${version}.xpi`),
};
copyFileSync(join(output, `${name}-${version}-chrome.zip`), files.chromeZip);
// An .xpi is a zip with manifest.json at the root.
copyFileSync(join(output, `${name}-${version}-firefox.zip`), files.xpi);

// Chrome packs and signs a .crx from the build folder: <folder>.crx, plus <folder>.pem when it makes a new key.
const chrome = await puppeteer.executablePath();
const extensionDir = join(output, 'chrome-mv3');
const profile = mkdtempSync(join(tmpdir(), 'xas-pack-'));
const newKey = !existsSync(keyPath);
execFileSync(chrome, [
  `--pack-extension=${extensionDir}`,
  ...(newKey ? [] : [`--pack-extension-key=${keyPath}`]),
  `--user-data-dir=${profile}`,
  '--no-message-box',
]);
rmSync(profile, { recursive: true, force: true });
if (newKey) {
  mkdirSync(dirname(keyPath), { recursive: true });
  renameSync(`${extensionDir}.pem`, keyPath);
  console.log(`New signing key: ${keyPath} — back it up; later versions must use it.`);
}
renameSync(`${extensionDir}.crx`, files.crx);
if (readFileSync(files.crx).subarray(0, 4).toString() !== 'Cr24') throw new Error('Chrome did not produce a valid .crx');

// The id Chrome gives the .crx: the first 128 bits of the public key's SHA-256, written with the letters a–p.
const publicKey = createPublicKey(readFileSync(keyPath)).export({ type: 'spki', format: 'der' });
const extensionId = [...createHash('sha256').update(publicKey).digest('hex').slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('');

const sums = Object.values(files).map((file) => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${basename(file)}`);
writeFileSync(join(releaseDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);

console.log(`\n${name} ${version} → .output/release/ (.crx id ${extensionId}; model ${bundled ? 'included' : `from ${modelUrl}`})`);
for (const line of sums) console.log(`  ${line}`);

/**
 * Every model file must be on the host, byte for byte, and readable from an extension page (CORS):
 * a release that can't fetch its model would only fail on users' machines.
 */
async function checkHost(): Promise<void> {
  if (!modelUrl.endsWith('/')) throw new Error(`The model URL must end with "/": ${modelUrl}`);
  for (const [id, dir] of [[MODEL_ID, modelDir], [LITE_MODEL_ID, liteDir]] as const) for (const file of readdirSync(dir)) {
    const local = readFileSync(join(dir, file));
    const url = `${modelUrl}${id}/${file}`;
    const response = await fetch(url, { headers: { origin: 'chrome-extension://release-check' } });
    if (!response.ok) throw new Error(`The model host doesn't serve ${file} (${response.status}): ${url}`);
    if (!response.headers.get('access-control-allow-origin')) throw new Error(`The model host doesn't allow browsers to fetch ${file} (no CORS header)`);
    const remote = Buffer.from(await response.arrayBuffer());
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    if (hash(remote) !== hash(local)) throw new Error(`${id}/${file} on the model host differs from public/models (${remote.length} vs ${statSync(join(dir, file)).size} bytes)`);
    console.log(`Model host: ${id}/${file} matches`);
  }
}
