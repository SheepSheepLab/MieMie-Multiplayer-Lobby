import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const hubSource = process.env.MIEMIE_HUB_SOURCE || '../MieMie-Hub';
const {createExtensionPackageManager, validateExtensionPackageMetadata, validateExtensionPackage} =
  await import(pathToFileURL(resolve(hubSource, 'src/extension-packages.js')));
const metadataName = 'MieMie-Extension-update.json';
const metadataBytes = await readFile('dist/' + metadataName);
const metadata = JSON.parse(metadataBytes);
const bytes = await readFile('dist/' + metadata.asset.name);
const script = JSON.parse(bytes);
const {productId, scriptId, version} = metadata;
const repository = metadata.manifest.repository;
const github = repository.replace('github.com/', 'api.github.com/repos/');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value));

function fixture(metadata, metadataBytes, bytes, id) {
  const asset = (assetId, name, content) => ({
    id: assetId, name, state: 'uploaded', size: content.length, digest: 'sha256:' + digest(content),
    url: github + '/releases/assets/' + assetId,
    browser_download_url: repository + '/releases/download/' + metadata.tag + '/' + name,
  });
  const assets = [asset(id * 10 + 1, metadata.asset.name, bytes), asset(id * 10 + 2, metadataName, metadataBytes)];
  return {release: {id, tag_name: metadata.tag, draft: false, prerelease: true, assets}, bytes, metadataBytes};
}

const current = fixture(metadata, metadataBytes, bytes, 10);
assert.deepEqual(validateExtensionPackageMetadata(metadata, repository, current.release), metadata);
assert.deepEqual(await validateExtensionPackage(bytes, metadata, webcrypto), script);
await assert.rejects(validateExtensionPackage(bytes, {...metadata, contentSha256: '0'.repeat(64)}, webcrypto),
  error => error.code === 'content-hash');

// A synthetic newer package exercises the update direction. Only dist's
// current build is the release candidate.
const [major, minor, patch] = version.split('.').map(Number);
const nextVersion = [major, minor, patch + 1].join('.');
const nextName = metadata.asset.name.replace(version, nextVersion);
const nextScript = {...script, name: script.name.replace(version, nextVersion), content: script.content.replaceAll(version, nextVersion)};
const nextBytes = encode(nextScript);
const nextMetadata = {
  ...metadata, version: nextVersion, tag: 'v' + nextVersion,
  manifest: {...metadata.manifest, version: nextVersion},
  asset: {name: nextName, size: nextBytes.length, sha256: digest(nextBytes)},
  contentSha256: digest(nextScript.content),
};
const next = fixture(nextMetadata, encode(nextMetadata), nextBytes, 20);
const response = (data, url) => Object.defineProperty(new Response(data), 'url', {value: url});
const unrelated = {...script, id: 'unrelated-script', name: 'Independent script', content: 'void 0;'};
let trees = [unrelated], releases = [current], corrupt = true;
const manager = createExtensionPackageManager({
  crypto: webcrypto,
  getScriptTrees: () => structuredClone(trees),
  updateScriptTreesWith(update, scope) {
    assert.deepEqual(scope, {type: 'global'});
    trees = update(structuredClone(trees));
    return structuredClone(trees);
  },
  readSavedScript: async id => structuredClone(trees.find(node => node.id === id) ?? null),
  backup: async () => {},
  confirmUninstall: () => true,
  async fetch(url) {
    if (url === github) return response(encode({full_name: new URL(repository).pathname.slice(1), private: false}), url);
    if (url.startsWith(github + '/releases?')) return response(encode(releases.map(item => item.release)), url);
    for (const item of releases) {
      const {release} = item;
      if (url === github + '/releases/' + release.id || url === github + '/releases/tags/' + release.tag_name) {
        return response(encode(release), url);
      }
      if (url === release.assets[0].url) {
        const asset = Buffer.from(item.bytes);
        if (corrupt) asset[asset.length - 1] ^= 1;
        return response(asset, url);
      }
      if (url === release.assets[1].url) return response(item.metadataBytes, url);
    }
    throw Error('Unexpected test request: ' + url);
  },
});
try {
  const candidate = await manager.inspect(repository);
  assert.equal(candidate.installable, true);
  await assert.rejects(manager.install(candidate));
  assert.deepEqual(trees, [unrelated]);
  corrupt = false;
  const installed = await manager.install(candidate);
  assert.equal(installed.ok, true);
  assert.equal(installed.version, version);
  assert.notEqual(installed.instanceId, scriptId);
  assert.equal((await manager.listInstalled())[0].id, productId);
  assert.equal(trees[1].content, script.content);
  trees[1].data = {userDraft: 'keep'};
  releases = [next, current];
  const updated = await manager.update(productId);
  assert.equal(updated.version, nextVersion);
  assert.equal(updated.instanceId, installed.instanceId);
  assert.deepEqual(trees[1].data, {userDraft: 'keep'});
  assert.equal(trees[1].content, nextScript.content);
  assert.equal((await manager.uninstall(productId)).physical, true);
  assert.deepEqual(trees, [unrelated]);
} finally {
  manager.dispose();
}
console.log('PASS Hub Managed Package: released bytes, tamper refusal, install, update retaining instance/data, physical uninstall');
