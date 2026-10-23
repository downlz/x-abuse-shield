// Builds the downloads for a GitHub release into .output/release/:
//
//   x-abuse-shield-<version>-chrome.zip   Chrome / Brave: unzip, then "Load unpacked"
//   x-abuse-shield-<version>.crx          the same, packed and signed (installs only where policy allows off-store extensions)
//   x-abuse-shield-<version>.xpi          Firefox, unsigned: a temporary add-on, or permanent in Developer Edition / Nightly
//   SHA256SUMS.txt
//
//   npm run model:build   (once; the model ships inside every download)
//   npm run release
//
// The .crx is signed with the private key at CRX_KEY (default ~/.x-abuse-shield/crx-key.pem), created on the
// first run. Keep it safe and out of the repository: it fixes the extension's id, so later versions must be
// signed with the same key.
import { execFileSync, execSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import puppeteer from 'puppeteer';
import { BUNDLED_MODEL_DIR, BUNDLED_MODEL_FILE, MODEL_ID } from '../src/adapters/inference/model';

const root = join(import.meta.dirname, '..');
const output = join(root, '.output');
const releaseDir = join(output, 'release');
const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string };
const keyPath = process.env.CRX_KEY ?? join(homedir(), '.x-abuse-shield', 'crx-key.pem');

if (!existsSync(join(root, 'public', BUNDLED_MODEL_DIR, MODEL_ID, BUNDLED_MODEL_FILE)) || process.env.WXT_BUNDLE_MODEL === 'false') {
  throw new Error('Release downloads ship the model: run `npm run model:build` first (and unset WXT_BUNDLE_MODEL).');
}

// wxt zip builds, then zips each browser's folder with manifest.json at the root.
execSync('npx wxt zip', { cwd: root, stdio: 'inherit' });
execSync('npx wxt zip -b firefox', { cwd: root, stdio: 'inherit' });

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

console.log(`\n${name} ${version} → .output/release/ (.crx id ${extensionId})`);
for (const line of sums) console.log(`  ${line}`);
