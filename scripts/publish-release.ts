// Publishes .output/release/ (from `npm run release`) as this version's GitHub release, with the notes
// file as its description and the SHA-256 checksums appended.
//
//   npm run release:publish -- --notes docs/releases/v<version>.md [--draft]
//
// Tags the current commit v<version>, so commit and push first. Needs a GitHub token that can write to the
// repository: GITHUB_TOKEN, or else the credential git already uses for github.com (Git Credential Manager).
// Running it again uploads whatever files a failed run left out.
import { execFileSync } from 'node:child_process';
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:https';
import { extname, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const releaseDir = join(root, '.output', 'release');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const tag = `v${version}`;
const notesIndex = process.argv.indexOf('--notes');
const notesPath = notesIndex > 0 ? process.argv[notesIndex + 1] : undefined;
const draft = process.argv.includes('--draft');
if (!notesPath) throw new Error('Pass --notes <release notes .md>');

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const [, owner, repo] = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(git('remote', 'get-url', 'origin')) ?? [];
if (!owner || !repo) throw new Error('origin is not a GitHub repository');
const commit = git('rev-parse', 'HEAD');
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Commit your changes first: the release is tagged at the current commit.');
if (!git('branch', '-r', '--contains', commit)) throw new Error('Push the current commit first.');

const files = readdirSync(releaseDir).sort();
const sums = readFileSync(join(releaseDir, 'SHA256SUMS.txt'), 'utf8').trim();
if (!files.some((file) => file.includes(version))) throw new Error(`.output/release/ isn't version ${version}: run npm run release`);

const token = process.env.GITHUB_TOKEN ?? gitCredential();

interface Release {
  id: number;
  tag_name: string;
  html_url: string;
  assets: { id: number; name: string; state: string; size: number }[];
}

const releases = (await api('GET', `/repos/${owner}/${repo}/releases?per_page=100`)) as Release[];
let release = releases.find((r) => r.tag_name === tag);
const body = `${readFileSync(join(root, notesPath), 'utf8').trim()}\n\n## SHA-256 checksums\n\n\`\`\`\n${sums}\n\`\`\`\n`;
if (release) {
  console.log(`Release ${tag} exists; uploading missing files.`);
} else {
  release = (await api('POST', `/repos/${owner}/${repo}/releases`, {
    tag_name: tag,
    target_commitish: commit,
    name: `X Abuse Shield ${version}`,
    body,
    draft,
    make_latest: draft ? undefined : 'true',
  })) as Release;
  console.log(`Created ${draft ? 'draft ' : ''}release ${tag} at ${commit.slice(0, 7)}.`);
}

for (const file of files) {
  const existing = release.assets.find((asset) => asset.name === file);
  if (existing?.state === 'uploaded') continue;
  // A half-finished upload from an earlier run blocks the name.
  if (existing) await api('DELETE', `/repos/${owner}/${repo}/releases/assets/${existing.id}`);
  await upload(release.id, join(releaseDir, file));
}

const final = (await api('GET', `/repos/${owner}/${repo}/releases/${release.id}`)) as Release;
console.log(`\n${final.html_url}`);
for (const asset of final.assets) console.log(`  ${asset.name}  ${(asset.size / 1e6).toFixed(1)} MB  ${asset.state}`);

async function api(method: string, path: string, json?: unknown): Promise<unknown> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(json ? { 'content-type': 'application/json' } : {}),
    },
    body: json ? JSON.stringify(json) : undefined,
  });
  if (!response.ok) throw new Error(`GitHub ${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

/** Streams the file to GitHub's upload host (fetch would buffer ~240 MB and can time out on slow links). */
function upload(releaseId: number, path: string): Promise<void> {
  const name = path.split(/[\\/]/).pop()!;
  const size = statSync(path).size;
  const type = { '.zip': 'application/zip', '.crx': 'application/x-chrome-extension', '.xpi': 'application/x-xpinstall' }[extname(name)] ?? 'text/plain';
  return new Promise((resolve, reject) => {
    const req = request(
      `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': type,
          'content-length': size,
          'user-agent': 'x-abuse-shield-release',
        },
      },
      (response) => {
        let text = '';
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () =>
          response.statusCode === 201 ? resolve() : reject(new Error(`Upload of ${name} failed: ${response.statusCode} ${text}`)),
        );
      },
    );
    req.on('error', reject);
    let sent = 0;
    let logged = 0;
    const started = Date.now();
    createReadStream(path)
      .on('data', (chunk) => {
        sent += chunk.length;
        const percent = Math.floor((sent / size) * 100);
        if (percent >= logged + 20 || sent === size) {
          logged = percent;
          console.log(`  ${name}: ${percent}% (${Math.round((Date.now() - started) / 1000)} s)`);
        }
      })
      .pipe(req);
  });
}

/** The token git uses for github.com, without ever prompting (GITHUB_TOKEN takes precedence). */
function gitCredential(): string {
  const output = execFileSync('git', ['credential', 'fill'], {
    cwd: root,
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    env: { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' },
  });
  const password = /^password=(.+)$/m.exec(output)?.[1];
  if (!password) throw new Error('No GitHub credential found: set GITHUB_TOKEN to a token that can write to the repository.');
  return password;
}
