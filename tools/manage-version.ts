import fs from 'node:fs/promises';
import path from 'node:path';

// Import necessary functions from the refactored git-utils.ts
import {
  getGitCommandOutput,
  getGitDirtySuffix,
  gitAdd,
  gitCommit,
  gitPush,
  gitCreateTag,
  gitPushTag,
  gitDeleteLocalTag,
  getLocalTagCommit, // For checking if tag exists and points to HEAD
  getCurrentCommitHash, // For getting HEAD commit
} from './git-utils'; // Assuming git-utils.ts is in the same directory

// --- Git Helper Functions (subset from package-mod.ts) ---
// Removed local getGitCommandOutput and getGitDirtySuffix as they are now imported

function findBaseCommitForVersionSeries(majorMinorPrefix: string): string | null {
  // console.log(`Searching for base commit for version series starting with: ${majorMinorPrefix}`);
  try {
    const commitsTouchingPackageJsonOutput = getGitCommandOutput('git', ['log', '--pretty=format:%H', '--follow', '--', 'package.json']);
    const commitsTouchingPackageJson = commitsTouchingPackageJsonOutput.split('\n').filter(Boolean);
    if (commitsTouchingPackageJsonOutput.startsWith('ERROR_') || !commitsTouchingPackageJson || commitsTouchingPackageJson.length === 0) return null;

    for (const commitHash of commitsTouchingPackageJson) {
      const versionAtCommitStr = getGitCommandOutput('git', ['show', `${commitHash}:package.json`]);
      let versionAtCommit: string | null = null;
      if (versionAtCommitStr && !versionAtCommitStr.startsWith('ERROR_')) {
        try { versionAtCommit = JSON.parse(versionAtCommitStr).version; }
        catch { /* ignore */ }
      }
      if (!versionAtCommit || typeof versionAtCommit !== 'string') continue;

      if (versionAtCommit.startsWith(majorMinorPrefix)) {
        const parentHashesOutput = getGitCommandOutput('git', ['rev-parse', `${commitHash}^`]);
        const parentHashes = parentHashesOutput.split('\n').filter(Boolean);
        const parentHash = (!parentHashesOutput.startsWith('ERROR_') && parentHashes.length > 0) ? parentHashes[0] : null;

        let versionAtParent: string | null = null;
        if (parentHash) {
          const versionAtParentStr = getGitCommandOutput('git', ['show', `${parentHash}:package.json`]);
          if (versionAtParentStr && !versionAtParentStr.startsWith('ERROR_')) {
            try { versionAtParent = JSON.parse(versionAtParentStr).version; }
            catch { /* ignore */ }
          }
        }
        const isRootCommit = !parentHash;
        const parentVersionMatchesSeries = parentHash && versionAtParent && typeof versionAtParent === 'string' && versionAtParent.startsWith(majorMinorPrefix);
        const commitIsExplicitZeroPatch = versionAtCommit.endsWith('.0');
        if (isRootCommit || !parentVersionMatchesSeries || commitIsExplicitZeroPatch) return commitHash;
      }
    }
    return null;
  }
  catch { return null; }
}

function countWorkCommitsSince(commitHash: string): number {
  if (!commitHash) return 0;
  try {
    const commitSubjectsOutput = getGitCommandOutput('git', ['log', '--pretty=format:%s', `${commitHash}..HEAD`]);
    if (commitSubjectsOutput.startsWith('ERROR_')) return 0;
    const commitSubjects = commitSubjectsOutput.split('\n').filter(Boolean);

    if (commitSubjects.length === 0) return 0;
    const versionCommitRegexLocal = /^chore: Update version to \d+\.\d+\.\d+$/;
    return commitSubjects.filter(subject => !versionCommitRegexLocal.test(subject)).length;
  }
  catch { return 0; }
}

interface PackageJson {
  name: string;
  version: string;
  [key: string]: any;
}

/**
 * Manages the mod version.
 * - In normal mode: Calculates new version, updates package.json, commits, pushes.
 * - With --release: Also creates and pushes a git tag.
 * - With --ci-build: Reads version from package.json, no git ops, no file changes.
 * Outputs the determined version string to stdout on the last line if successful.
 */
async function manageVersion(packageJsonPath: string, isCiBuild: boolean, isRelease: boolean): Promise<string> {
  if (getGitDirtySuffix() && !isCiBuild) {
    console.error('ERROR: Repository is dirty. Please commit or stash changes before managing version.');
    process.exit(1);
  }

  const packageJsonFullPath = path.resolve(packageJsonPath);
  const packageJsonContent = await fs.readFile(packageJsonFullPath, 'utf8');
  const packageJson = JSON.parse(packageJsonContent) as PackageJson;
  let versionToUse = packageJson.version;
  let packageJsonWasUpdatedByScript = false;

  if (isCiBuild) {
    console.log(`CI Mode: Using existing version ${versionToUse} from ${packageJsonPath}`);
  }
  else {
    const currentVersion = packageJson.version;
    const [major, minor] = currentVersion.split('.').map(Number);
    const majorMinorPrefix = `${major}.${minor}.`;

    const baseCommitForSeries = findBaseCommitForVersionSeries(majorMinorPrefix);

    let patchNumber = 0;
    if (baseCommitForSeries) {
      patchNumber = countWorkCommitsSince(baseCommitForSeries);
    }
    else {
      // If no base commit for series, it could be the very first series or an error.
      // Count all commits if no specific series base.
      const headCommitCountOutput = getGitCommandOutput('git', ['rev-list', '--count', 'HEAD']);
      const headCommitCount = headCommitCountOutput.startsWith('ERROR_') ? 0 : Number.parseInt(headCommitCountOutput, 10);
      if (headCommitCount === 1 && countWorkCommitsSince('HEAD^') === 0) { // Special case for initial commit, M.m.0
        patchNumber = 0;
      }
      else {
        // Fallback: if no base commit for series, count from beginning of history effectively
        // This might lead to very large patch numbers if not careful or if repo history is unusual.
        // Or, assume current major.minor.0 if no base is found.
        // For now, let's make it count from very first commit (HEAD^) to be consistent with original logic.
        // if no baseCommitForSeries, count all non-version commits in history.
        // This seems like the previous logic if baseCommitForSeries was null.
        patchNumber = countWorkCommitsSince(''); // Empty string to count all from start
      }
    }

    const calculatedVersion = `${major}.${minor}.${patchNumber}`;

    const currentParts = currentVersion.split('.').map(Number);
    const calculatedParts = calculatedVersion.split('.').map(Number);

    let useCalculated = false;
    if (calculatedParts[0] > currentParts[0]) useCalculated = true;
    else if (calculatedParts[0] === currentParts[0] && calculatedParts[1] > currentParts[1]) useCalculated = true;
    else if (calculatedParts[0] === currentParts[0] && calculatedParts[1] === currentParts[1] && calculatedParts[2] > currentParts[2]) useCalculated = true;

    if (useCalculated) {
      versionToUse = calculatedVersion;
    }
    else {
      console.log(`Calculated version (${calculatedVersion}) is not newer than existing version (${currentVersion}). Using existing.`);
      versionToUse = currentVersion;
    }

    if (packageJson.version === versionToUse) {
      console.log(`package.json version ${currentVersion} is already up-to-date or manually set higher.`);
    }
    else {
      console.log(`Updating package.json version from ${packageJson.version} to ${versionToUse}`);
      packageJson.version = versionToUse;
      await fs.writeFile(packageJsonFullPath, JSON.stringify(packageJson, null, 2) + '\n');
      packageJsonWasUpdatedByScript = true;

      console.log(`Committing package.json version update to ${versionToUse}...`);
      try {
        gitAdd(packageJsonFullPath);
        gitCommit(`chore: Update version to ${versionToUse}`);
        console.log('Committed version update.');
        console.log('Pushing commit...');
        gitPush(); // Assumes origin and HEAD, adjust if needed
        console.log('Pushed commit.');
      }
      catch (gitError) {
        console.error(`ERROR: Git operation (commit/push) failed. ${(gitError as Error).message}`);
        process.exit(1);
      }
    }

    if (isRelease && (packageJsonWasUpdatedByScript || true)) {
      const tagName = `v${versionToUse}`;
      console.log(`Release mode: Attempting to create and push tag ${tagName}...`);
      try {
        const localTagCommit = getLocalTagCommit(tagName);
        const headCommit = getCurrentCommitHash();

        if (localTagCommit && headCommit && localTagCommit === headCommit) {
          console.log(`Tag ${tagName} already exists locally and points to HEAD. Attempting to push.`);
        }
        else if (localTagCommit && headCommit && localTagCommit !== headCommit) {
          console.warn(`Warning: Local tag ${tagName} exists but points to ${localTagCommit.slice(0, 7)}, not HEAD (${headCommit.slice(0, 7)}). Deleting and re-tagging HEAD.`);
          gitDeleteLocalTag(tagName);
          gitCreateTag(tagName); // Creates a lightweight tag
          console.log(`Re-created local tag ${tagName} on HEAD.`);
        }
        else {
          console.log(`Creating local tag ${tagName} on HEAD...`);
          gitCreateTag(tagName); // Creates a lightweight tag
          console.log(`Successfully created local tag ${tagName}.`);
        }

        console.log(`Pushing tag ${tagName} to origin...`);
        gitPushTag(tagName);
        console.log(`Successfully pushed tag ${tagName}.`);
      }
      catch (gitError) {
        console.error(`ERROR: Failed to ensure tag ${tagName} is on origin. ${(gitError as Error).message}`);
        process.exit(1);
      }
    }
  }

  console.log(versionToUse);
  return versionToUse;
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const packageJsonPathArg = args.find(arg => arg.endsWith('.json')) || './package.json';
  const isCiBuildArg = args.includes('--ci-build');
  const isReleaseArg = args.includes('--release');

  try {
    await manageVersion(packageJsonPathArg, isCiBuildArg, isReleaseArg);
  }
  catch (error) {
    console.error('Error during version management:', error);
    process.exit(1);
  }
}

run();
