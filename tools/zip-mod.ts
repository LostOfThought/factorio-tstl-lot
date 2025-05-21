import { createWriteStream } from 'node:fs'; // Use fs.createWriteStream for the archive output
import fs from 'node:fs/promises';
import path from 'node:path';

import archiver from 'archiver';

async function zipMod(folderToZipPath: string, modName: string, modVersion: string, releasesOutputDir: string): Promise<void> {
  console.log(`Preparing to zip folder: ${folderToZipPath} as ${modName} v${modVersion} using archiver`);

  const zipFileName = `${modName}_${modVersion}.zip`;
  const absoluteReleasesDir = path.resolve(releasesOutputDir);
  const absoluteZipFilePath = path.resolve(absoluteReleasesDir, zipFileName);

  try {
    await fs.mkdir(absoluteReleasesDir, { recursive: true });
    console.log(`Ensured releases directory exists at ${absoluteReleasesDir}`);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      console.error(`Error creating releases directory ${absoluteReleasesDir}:`, error);
      throw error;
    }
  }

  try {
    await fs.unlink(absoluteZipFilePath);
    console.log(`Removed existing zip file: ${absoluteZipFilePath}`);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Error removing existing zip file ${absoluteZipFilePath}:`, error);
      throw error;
    }
  }

  console.log(`Creating zip file: ${absoluteZipFilePath} from folder ${folderToZipPath}`);

  const output = createWriteStream(absoluteZipFilePath);
  const archive = archiver('zip', {
    zlib: { level: 9 }, // Sets the compression level.
  });

  return new Promise<void>((resolve, reject) => {
    output.on('close', () => {
      console.log(`Successfully created zip: ${absoluteZipFilePath}`);
      console.log(archive.pointer() + ' total bytes written.');
      resolve();
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('Archiver warning:', err);
      }
      else {
        reject(err);
      }
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // The `folderToZipPath` contains the `modName_version-hash` folder.
    // We want this `modName_version-hash` folder to be the root inside the zip.
    // So we add the directory `folderToZipPath` itself, but make its contents appear at the root of the archive.
    // No, Factorio expects modName_version to be the folder *inside* the zip.
    // The `folderToZipPath` IS the `modName_version-hash` folder.
    // We need to zip this folder *such that it becomes the root entry in the zip*.
    // `archive.directory(sourceDir, destPathInZip)`
    // If folderToZipPath = /path/to/temp_zip_staging/my-mod_1.0.0-abcdef
    // and we want my-mod_1.0.0-abcdef to be the root folder in the zip,
    // then we should use directory(folderToZipPath, path.basename(folderToZipPath))
    // No, the Factorio wiki implies the folder *inside* the zip has no naming restrictions.
    // The orchestrator created temp_zip_staging/modName_version-hash/
    // And then copied ./dist contents into it.
    // The zip-mod.ts is called with folderToZipPath = temp_zip_staging/modName_version-hash/
    // We want the *contents* of this folder to be zipped under a root folder that IS modName_version-hash

    // Correct approach for archiver:
    // To make `modName_version-hash` the root folder in the zip, containing all files:
    archive.directory(folderToZipPath, path.basename(folderToZipPath));

    archive.finalize();
  });
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: pnpm vite-node tools/zip-mod.ts <path_to_folder_to_zip> <modName> <modVersion> <releasesOutputDir>');
    console.error('Example: pnpm vite-node tools/zip-mod.ts ./temp_build_for_zip/my-mod_1.0.0-abcdef my-mod 1.0.0 ./releases');
    process.exit(1);
  }
  const folderToZipPathArg = path.resolve(args[0]);
  const modNameArg = args[1];
  const modVersionArg = args[2];
  const releasesOutputDirArg = path.resolve(args[3]);

  try {
    await zipMod(folderToZipPathArg, modNameArg, modVersionArg, releasesOutputDirArg);
  }
  catch (error) {
    console.error('Error during mod zipping:', error);
    process.exit(1);
  }
}

run();
