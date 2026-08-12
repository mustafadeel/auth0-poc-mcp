import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const webtaskJson = JSON.parse(await readFile(new URL("../webtask.json", import.meta.url)));

for (const key of ["name", "version", "description", "author", "keywords"]) {
  assert.ok(webtaskJson[key], `webtask.json must define ${key}`);
}
assert.equal(packageJson["auth0-extension"].type, "application", "extension type must be application");
assert.equal(packageJson["auth0-extension"].initialUrlPath, "/", "extension must expose a landing route");
assert.equal(webtaskJson.runtime, "node22", "extension must use the Node 22 runtime");
assert.deepEqual(
  packageJson["auth0-extension"].secrets,
  webtaskJson.secrets,
  "package.json and webtask.json must expose the same settings",
);
