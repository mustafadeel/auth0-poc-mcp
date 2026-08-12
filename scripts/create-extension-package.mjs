import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourcePackage = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
const extensionPackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  description: sourcePackage.description,
  main: sourcePackage.main,
  keywords: sourcePackage.keywords,
  author: sourcePackage.author,
  repository: sourcePackage.repository,
  engines: sourcePackage.engines,
  license: sourcePackage.license,
  "auth0-extension": sourcePackage["auth0-extension"],
};

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/package.json", import.meta.url), `${JSON.stringify(extensionPackage, null, 2)}\n`);
