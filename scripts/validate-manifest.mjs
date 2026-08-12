import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const webtaskJson = JSON.parse(await readFile(new URL("../webtask.json", import.meta.url)));

assert.deepEqual(packageJson["auth0-extension"], webtaskJson, "package.json and webtask.json must contain the same extension manifest");
assert.equal(packageJson["auth0-extension"].type, "application", "extension type must be application");
assert.equal(packageJson["auth0-extension"].initialUrlPath, "/", "extension must expose a landing route");
