import { readdir, readFile, writeFile, mkdir, cp } from "node:fs/promises";
import path from "node:path";
await mkdir("notices", { recursive: true });
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
let inventory =
  "# Dependency licenses\n\nGenerated from the pinned dependencies. Full available license texts are in the adjacent folders.\n\n## JavaScript runtime\n\n";
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location || entry.dev) continue;
  const name = location.replace(/^.*node_modules\//, "");
  inventory += `- ${name} ${entry.version}: ${entry.license || "See package notices"}\n`;
  const files = await readdir(location).catch(() => []);
  for (const file of files.filter((f) =>
    /^(licen[sc]e|copying|notice)([.-]|$)/i.test(f),
  )) {
    const target = path.join(
      "notices",
      "javascript",
      name.replaceAll("/", "_"),
    );
    await mkdir(target, { recursive: true });
    await cp(path.join(location, file), path.join(target, file), {
      recursive: true,
    });
  }
}
inventory += "\n## Rust dependencies (Windows build)\n\n";
const cargoHome =
  process.env.CARGO_HOME || path.join(process.env.USERPROFILE || "", ".cargo");
const source = path.join(cargoHome, "registry", "src");
for (const registry of await readdir(source).catch(() => []))
  for (const name of await readdir(path.join(source, registry))) {
    const crate = path.join(source, registry, name);
    const manifest = await readFile(
      path.join(crate, "Cargo.toml"),
      "utf8",
    ).catch(() => "");
    const license = manifest.match(/^license\s*=\s*"([^"]+)"/m)?.[1];
    inventory += `- ${name}: ${license || "See crate notices"}\n`;
    for (const file of (await readdir(crate)).filter((f) =>
      /^(licen[sc]e|copying|notice)([.-]|$)/i.test(f),
    )) {
      const target = path.join("notices", "rust", name);
      await mkdir(target, { recursive: true });
      await cp(path.join(crate, file), path.join(target, file), {
        recursive: true,
      });
    }
  }
await writeFile("notices/DEPENDENCIES.md", inventory);
console.log(
  "Generated runtime dependency inventory and preserved license texts.",
);
