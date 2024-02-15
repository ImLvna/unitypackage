import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
} from "fs";
import { copyFile, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { PassThrough } from "stream";
import * as tar from "tar-stream";
import { parse as yamlParse } from "yaml";
import { createGunzip, createGzip } from "zlib";

const tempdir = (name: string) => {
  return mkdtempSync(name);
};
const mkdir = (dir: string, recursive = false): string => {
  mkdirSync(dir, { recursive });
  return dir;
};

interface Meta {
  guid: string;
  folderAsset?: boolean;
}

export async function extractUnityPackage(
  unityPackage: string,
  output: string,
  overwrite = false
) {
  // Extract the gzip
  const tempDir = tempdir("unitypackage-extract-");

  const extract = tar.extract();

  extract.on(
    "entry",
    (header: tar.Headers, stream: PassThrough, next: () => void) => {
      const filePath = join(tempDir, header.name);
      if (header.type == "directory") mkdir(filePath, true);

      stream.on("data", (data: Buffer) => {
        if (header.type == "file") {
          if (!existsSync(dirname(filePath))) mkdir(dirname(filePath), true);
          appendFileSync(filePath, data);
        }
      });

      stream.on("end", () => {
        next();
      });

      stream.resume();
    }
  );

  createReadStream(unityPackage).pipe(createGunzip()).pipe(extract);

  await new Promise((resolve, reject) => {
    extract.on("finish", resolve);
    extract.on("error", reject);
  });

  // Map the extracted files to the output

  for await (const entry of readdirSync(tempDir)) {
    const pathName = await readFile(join(tempDir, entry, "pathname"), "utf8");
    const assetPath = join(output, pathName);

    const metaPath = join(tempDir, entry, "asset.meta");
    const metaString = await readFile(metaPath, "utf8");
    const meta: Meta = yamlParse(metaString);

    if (existsSync(assetPath) && !overwrite) continue;

    if (meta.folderAsset) {
      mkdir(assetPath, true);
    } else {
      if (!existsSync(dirname(assetPath))) {
        mkdir(dirname(assetPath), true);
      }
      await rename(join(tempDir, entry, "asset"), assetPath);
    }
    await rename(join(tempDir, entry, "asset.meta"), assetPath + ".meta");
  }

  await rm(tempDir, { recursive: true, force: true });
}

export async function createUnityPackage(
  projectDir: string,
  baseDir = "./",
  filesDir: string,
  output: string
) {
  return await createUnityPackageFromMetaFiles(
    projectDir,
    baseDir,
    readdirSync(join(projectDir, filesDir), {
      recursive: true,
      encoding: "utf8",
    })
      .filter((f) => f.endsWith(".meta"))
      .map((f) => join(filesDir, f)),
    output
  );
}

export async function createUnityPackageFromMetaFiles(
  projectDir: string,
  baseDir = "./",
  metaFiles: string[],
  output: string
) {
  const tempDir = tempdir("unitypackage-create-");

  // Map the meta files to the package
  for await (const metaFile of metaFiles) {
    const assetPath = metaFile.replace(/\.meta$/, "");
    const metaPath = join(projectDir, metaFile);

    const meta: Meta = yamlParse(await readFile(metaPath, "utf8"));

    const dir = mkdir(join(tempDir, meta.guid), true);

    if (!meta.folderAsset) {
      await copyFile(join(projectDir, assetPath), join(dir, "asset"));
    }
    await copyFile(metaPath, join(dir, "asset.meta"));

    await writeFile(join(dir, "pathname"), join(baseDir, assetPath));
  }

  // Create the tarball
  const pack = tar.pack();

  for await (const dir of readdirSync(tempDir)) {
    for await (const entry of readdirSync(join(tempDir, dir))) {
      const filePath = join(tempDir, dir, entry);
      const stream = createReadStream(filePath);
      const buffer = await new Promise<Buffer>((resolve) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
      });
      pack.entry({ name: join(dir, entry), type: "file" }, buffer);
    }
  }

  pack.finalize();

  const writeStream = createWriteStream(output);

  pack.pipe(createGzip()).pipe(writeStream);

  await new Promise((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });
  await rm(tempDir, { recursive: true, force: true });
}
