import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getGitShortHash, getGitDirtySuffix } from './git-utils';

const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

// Helper to log the very first message, starting the initial group in GA
function logInitialMessage(titleForGA: string, messageForNonGA: string) {
  if (isGitHubActions) {
    console.log(`::group::${titleForGA}`);
  }
  else {
    console.log(messageForNonGA);
  }
}

// Helper to start a new section, ending the previous group and starting a new one
function startSection(titleForGA: string, titleForNonGA?: string) {
  const currentNonGaTitle = titleForNonGA || titleForGA;
  if (isGitHubActions) {
    console.log('::endgroup::'); // End the previous group (initial or a summary group)
    console.log(`::group::${titleForGA}`);
  }
  else {
    console.log(`\\n${currentNonGaTitle}`); // Add a newline for separation
  }
}

// Helper to log a summary message. In GA, it ends the current main group,
// then starts and immediately ends a new group for the summary itself.
function logSummary(summaryTitle: string) {
  if (isGitHubActions) {
    console.log('::endgroup::'); // End the current main section's group
    console.log(`::group::${summaryTitle}`); // Start a group for the summary
    console.log('::endgroup::'); // Immediately end the summary group
  }
  else {
    console.log(`${summaryTitle}\\n`);
  }
}

// Helper to get current version and name from package.json
async function getCurrentPackageJsonInfo(packageJsonPath: string): Promise<{ version: string; name: string }> {
  const content = await fs.readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(content);
  return { version: parsed.version, name: parsed.name };
}

async function main() {
  try {
    logInitialMessage('--- Initializing Packaging Process ---', String.raw`Starting unified mod packaging process (orchestrator)...\n`);

    const isCiBuildArg = process.argv.includes('--ci-build');
    let isReleaseModeArg = process.argv.includes('--release');

    if (isCiBuildArg && isReleaseModeArg) {
      console.warn('Warning: --ci-build and --release flags were both specified. --ci-build takes precedence; --release actions will be skipped.');
      isReleaseModeArg = false;
    }

    if (isCiBuildArg) {
      console.log('CI Build Mode: Version determination will use existing package.json; Git operations by this orchestrator are skipped (handled by manage-version.ts internally if not --ci-build).');
    }
    if (isReleaseModeArg) {
      console.log('Release Mode Active: Versioning, git commit/push, and tagging will be attempted by manage-version.ts if applicable.');
    }

    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const initialDistDir = 'dist';
    const releasesDir = 'releases';
    const srcDir = 'src';

    const { version: initialVersionFromFile } = await getCurrentPackageJsonInfo(packageJsonPath);

    startSection('--- 1. Managing Version ---');
    const manageVersionToolPath = path.resolve(__dirname, 'manage-version.ts');
    const manageVersionArgs = [manageVersionToolPath, packageJsonPath];
    if (isCiBuildArg) manageVersionArgs.push('--ci-build');
    if (isReleaseModeArg) manageVersionArgs.push('--release');
    console.log(`Executing (placeholder for direct call): pnpm vite-node ${manageVersionArgs.join(' ')}`);
    const manageVersionResult = spawnSync('pnpm', ['vite-node', ...manageVersionArgs], { encoding: 'utf-8', shell: false });
    if (manageVersionResult.error) throw manageVersionResult.error;
    if (manageVersionResult.status !== 0) {
      throw new Error(`manage-version.ts failed with status ${manageVersionResult.status}:\n${manageVersionResult.stderr}`);
    }
    const manageVersionOutput = manageVersionResult.stdout.trim();
    const versionLines = manageVersionOutput.split('\n');
    const finalModVersion = versionLines.at(-1).trim();

    if (!finalModVersion || finalModVersion.includes('ERROR')) {
      throw new Error(`manage-version.ts failed or did not output a valid version. Output: ${manageVersionOutput}`);
    }
    console.log(`Version determined/set by manage-version.ts: ${finalModVersion}`);

    const { version: versionAfterManage } = await getCurrentPackageJsonInfo(packageJsonPath);
    const packageJsonWasEffectivelyUpdatedByManageVersion = initialVersionFromFile !== versionAfterManage && versionAfterManage === finalModVersion;

    if (packageJsonWasEffectivelyUpdatedByManageVersion) {
      console.log(`package.json was updated by manage-version.ts from ${initialVersionFromFile} to ${versionAfterManage}.`);
    }
    else {
      console.log(`package.json version (${versionAfterManage}) was not changed by manage-version.ts or already matched the target version.`);
    }
    logSummary('--- Version Management Complete ---');

    startSection(
      '--- 2. Cleaning and Preparing Build Directory ---',
      `--- 2. Cleaning and Preparing Build Directory (${initialDistDir}) ---`,
    );
    try {
      const distPath = path.resolve(process.cwd(), initialDistDir);
      console.log(`Attempting to remove directory: ${distPath}`);
      await fs.rm(distPath, { recursive: true, force: true });
      console.log(`Successfully removed directory: ${distPath} (if it existed).`);
      await fs.mkdir(distPath, { recursive: true });
      console.log(`Successfully ensured directory: ${distPath} exists.`);
    }
    catch (error) {
      console.error(`Error cleaning or creating directory ${initialDistDir}:`, error);
      throw error;
    }
    logSummary('--- Build Directory Prepared ---');

    startSection('--- 3. Building Lua Files (compiling TypeScript) ---');
    console.log(`Executing: pnpm run build:all`);
    const buildResult = spawnSync('pnpm', ['run', 'build:all'], { stdio: 'inherit', shell: false });
    if (buildResult.error) {
      throw buildResult.error;
    }
    if (buildResult.status !== 0) {
      throw new Error(`'pnpm run build:all' failed with status ${buildResult.status}`);
    }
    logSummary('--- Lua Compilation Complete ---');

    startSection('--- 4. Generating info.json ---');
    const genInfoToolPath = path.resolve(__dirname, 'generate-info-json.ts');
    const genInfoArgs = [genInfoToolPath, packageJsonPath, path.resolve(process.cwd(), initialDistDir)];
    console.log(`Executing (placeholder for direct call): pnpm vite-node ${genInfoArgs.join(' ')}`);
    const genInfoResult = spawnSync('pnpm', ['vite-node', ...genInfoArgs], { stdio: 'inherit', shell: false });
    if (genInfoResult.error) throw genInfoResult.error;
    if (genInfoResult.status !== 0) throw new Error(`generate-info-json.ts failed with status ${genInfoResult.status}`);
    logSummary('--- info.json Generation Complete ---');

    startSection('--- 5. Generating changelog.txt ---');
    const genChangelogToolPath = path.resolve(__dirname, 'generate-changelog-txt.ts');
    const genChangelogArgs = [
      genChangelogToolPath,
      finalModVersion,
      String(packageJsonWasEffectivelyUpdatedByManageVersion),
      path.resolve(process.cwd(), initialDistDir),
    ];
    console.log(`Executing (placeholder for direct call): pnpm vite-node ${genChangelogArgs.join(' ')}`);
    const genChangelogResult = spawnSync('pnpm', ['vite-node', ...genChangelogArgs], { stdio: 'inherit', shell: false });
    if (genChangelogResult.error) throw genChangelogResult.error;
    if (genChangelogResult.status !== 0) throw new Error(`generate-changelog-txt.ts failed with status ${genChangelogResult.status}`);
    logSummary('--- changelog.txt Generation Complete ---');

    startSection('--- 6. Copying Assets ---');
    const copyAssetsToolPath = path.resolve(__dirname, 'copy-assets.ts');
    const copyAssetsArgs = [copyAssetsToolPath, srcDir, path.resolve(process.cwd(), initialDistDir)];
    console.log(`Executing (placeholder for direct call): pnpm vite-node ${copyAssetsArgs.join(' ')}`);
    const copyAssetsResult = spawnSync('pnpm', ['vite-node', ...copyAssetsArgs], { stdio: 'inherit', shell: false });
    if (copyAssetsResult.error) throw copyAssetsResult.error;
    if (copyAssetsResult.status !== 0) throw new Error(`copy-assets.ts failed with status ${copyAssetsResult.status}`);
    logSummary('--- Asset Copying Complete ---');

    startSection('--- 7. Zipping Mod ---');
    const { name: currentModName } = await getCurrentPackageJsonInfo(packageJsonPath);
    const shortHash = getGitShortHash();
    const dirtySuffix = getGitDirtySuffix();

    const dynamicBuildFolderName = `${currentModName}_${finalModVersion}-${shortHash}${dirtySuffix}`;
    const tempZipSourceParentDir = path.resolve(process.cwd(), 'temp_zip_staging');
    const tempDynamicFolderPath = path.resolve(tempZipSourceParentDir, dynamicBuildFolderName);

    try {
      await fs.rm(tempZipSourceParentDir, { recursive: true, force: true });
      await fs.mkdir(tempDynamicFolderPath, { recursive: true });

      console.log(`Staging built mod into: ${tempDynamicFolderPath}`);
      const sourceDistPath = path.resolve(process.cwd(), initialDistDir);
      const distContents = await fs.readdir(sourceDistPath);
      for (const item of distContents) {
        const srcItemPath = path.resolve(sourceDistPath, item);
        const destItemPath = path.resolve(tempDynamicFolderPath, item);
        await fs.cp(srcItemPath, destItemPath, { recursive: true, force: true });
      }
      console.log(`Copied contents of ./${initialDistDir} to ${tempDynamicFolderPath}`);

      const zipModToolPath = path.resolve(__dirname, 'zip-mod.ts');
      const zipModArgs = [
        zipModToolPath,
        tempDynamicFolderPath,
        currentModName,
        finalModVersion,
        releasesDir,
      ];
      console.log(`Executing (placeholder for direct call): pnpm vite-node ${zipModArgs.join(' ')}`);
      const zipModResult = spawnSync('pnpm', ['vite-node', ...zipModArgs], { stdio: 'inherit', shell: false });
      if (zipModResult.error) throw zipModResult.error;
      if (zipModResult.status !== 0) throw new Error(`zip-mod.ts failed with status ${zipModResult.status}`);
    }
    finally {
      console.log(`Cleaning up temporary staging directory: ${tempZipSourceParentDir}`);
      await fs.rm(tempZipSourceParentDir, { recursive: true, force: true });
    }
    logSummary('--- Mod Zipping Complete ---');

    // Start a new group for final outputs if in GitHub Actions
    if (isGitHubActions) {
      console.log('::group::--- Packaging Summary and Artifact Info ---');
    }

    console.log(`Successfully packaged mod ${currentModName} v${finalModVersion}`);
    console.log(`Output should be in the ./${releasesDir} directory.`);

    if (isGitHubActions) {
      const zipFileName = `${currentModName}_${finalModVersion}.zip`;
      const zipFilePath = `.${path.sep}${path.join(releasesDir, zipFileName)}`;
      console.log(`Setting GITHUB_OUTPUT MOD_ZIP_NAME=${zipFileName}`);
      console.log(`Setting GITHUB_OUTPUT MOD_ZIP_PATH_ON_RUNNER=${zipFilePath}`);

      // Use GITHUB_OUTPUT environment file for setting outputs
      if (process.env.GITHUB_OUTPUT) {
        try {
          await fs.appendFile(process.env.GITHUB_OUTPUT, `MOD_ZIP_NAME=${zipFileName}\n`);
          await fs.appendFile(process.env.GITHUB_OUTPUT, `MOD_ZIP_PATH_ON_RUNNER=${zipFilePath}\n`);
        }
        catch (error) {
          console.error('Failed to write to GITHUB_OUTPUT file:', error);
          // Fallback or error handling if needed, though the action might fail anyway if GITHUB_OUTPUT is not writable
        }
      }
      else {
        console.warn('GITHUB_OUTPUT environment variable not found. Cannot set outputs for subsequent steps.');
      }
      console.log('::endgroup::'); // End the "Packaging Summary" group
    }
  }
  catch (error) {
    if (isGitHubActions) {
      console.log('::endgroup::'); // End any open group before error logging
      console.log('::group::--- Error During Packaging ---');
    }
    console.error(String.raw`\nError during orchestrated packaging process:`, error instanceof Error ? error.message : error);
    if (error instanceof Error && 'status' in error) {
      console.error(`Command failed with status: ${(error as any).status}`);
      console.error(`Stderr: ${(error as any).stderr?.toString()}`);
    }
    if (isGitHubActions) {
      console.log('::endgroup::'); // End the error group
    }
    process.exit(1);
  }
}

main();
