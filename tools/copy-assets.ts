import fs from 'node:fs/promises';
import path from 'node:path';
// execSync will be removed as we replace cp -R
// import { execSync } from 'child_process';

async function copyAssets(srcBaseDir: string, destBaseDir: string): Promise<void> {
  console.log(`Starting asset copy from ${srcBaseDir} to ${destBaseDir}`);

  // 1. Copy thumbnail.png
  const srcThumbnailPath = path.resolve(srcBaseDir, 'thumbnail.png');
  const destThumbnailPath = path.resolve(destBaseDir, 'thumbnail.png');
  try {
    await fs.access(srcThumbnailPath);
    await fs.copyFile(srcThumbnailPath, destThumbnailPath);
    console.log(`  Copied thumbnail.png to ${destThumbnailPath}`);
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(`  thumbnail.png not found in ${srcBaseDir}, skipping.`);
    }
    else {
      console.warn(`  Warning: Could not copy thumbnail.png: ${(error as Error).message}`);
    }
  }

  // 2. Copy standard subfolders
  const standardSubfolders = ['locale', 'scenarios', 'campaigns', 'tutorials', 'migrations'];
  for (const subfolder of standardSubfolders) {
    const srcSubfolderPath = path.resolve(srcBaseDir, subfolder);
    const destSubfolderPath = path.resolve(destBaseDir, subfolder);
    try {
      // Check if source directory exists and is a directory
      const stats = await fs.stat(srcSubfolderPath);
      if (stats.isDirectory()) {
        console.log(`  Copying directory ${subfolder} from ${srcSubfolderPath} to ${destSubfolderPath}...`);
        // fs.cp will create the destination directory if it doesn't exist.
        await fs.cp(srcSubfolderPath, destSubfolderPath, { recursive: true, force: true });
        console.log(`    Successfully copied ${subfolder}.`);
      }
      else {
        console.log(`  Path ${srcSubfolderPath} exists but is not a directory, skipping.`);
      }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log(`  Subfolder ./${subfolder} not found in ${srcBaseDir}, skipping.`);
      }
      else {
        console.warn(`  Warning: Could not process or copy subfolder ${srcBaseDir}/${subfolder}: ${(error as Error).message}`);
      }
    }
  }
  console.log(`Finished copying assets.`);
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: pnpm vite-node tools/copy-assets.ts <sourceBaseDir> <destinationBaseDir>');
    console.error('Example: pnpm vite-node tools/copy-assets.ts ./src ./dist');
    process.exit(1);
  }
  const srcDirArg = path.resolve(args[0]);
  const destDirArg = path.resolve(args[1]);

  try {
    await fs.mkdir(destDirArg, { recursive: true }); // Ensure base destination directory exists
    await copyAssets(srcDirArg, destDirArg);
  }
  catch (error) {
    console.error('Error during asset copying:', error);
    process.exit(1);
  }
}

run();
