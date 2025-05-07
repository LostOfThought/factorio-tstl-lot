import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

// --- Git Helper Functions (subset from package-mod.ts) ---
function getGitCommandOutput(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch (error) {
    return "ERROR_EXECUTING_GIT_COMMAND";
  }
}

function getGitDirtySuffix(): string {
  const statusOutput = getGitCommandOutput('git status --porcelain');
  if (statusOutput && statusOutput !== "ERROR_EXECUTING_GIT_COMMAND") {
    return '-dirty';
  }
  return '';
}

function findBaseCommitForVersionSeries(majorMinorPrefix: string): string | null {
  // console.log(`Searching for base commit for version series starting with: ${majorMinorPrefix}`);
  try {
    const commitsTouchingPackageJson = getGitCommandOutput(`git log --pretty=format:"%H" --follow -- package.json`).split('\n').filter(Boolean);
    if (!commitsTouchingPackageJson || commitsTouchingPackageJson.length === 0) return null;

    for (const commitHash of commitsTouchingPackageJson) {
      const versionAtCommitStr = getGitCommandOutput(`git show ${commitHash}:package.json`);
      let versionAtCommit: string | null = null;
      if (versionAtCommitStr && versionAtCommitStr !== "ERROR_EXECUTING_GIT_COMMAND") {
        try { versionAtCommit = JSON.parse(versionAtCommitStr).version; } catch { /* ignore */ }
      }
      if (!versionAtCommit || typeof versionAtCommit !== 'string') continue;

      if (versionAtCommit.startsWith(majorMinorPrefix)) {
        const parentHashes = getGitCommandOutput(`git rev-parse ${commitHash}^`).split('\n').filter(Boolean);
        const parentHash = (parentHashes.length > 0 && parentHashes[0] !== "ERROR_EXECUTING_GIT_COMMAND") ? parentHashes[0] : null;
        let versionAtParent: string | null = null;
        if (parentHash) {
          const versionAtParentStr = getGitCommandOutput(`git show ${parentHash}:package.json`);
          if (versionAtParentStr && versionAtParentStr !== "ERROR_EXECUTING_GIT_COMMAND") {
            try { versionAtParent = JSON.parse(versionAtParentStr).version; } catch { /* ignore */ }
          }
        }
        const isRootCommit = !parentHash;
        const parentVersionMatchesSeries = parentHash && versionAtParent && typeof versionAtParent === 'string' && versionAtParent.startsWith(majorMinorPrefix);
        const commitIsExplicitZeroPatch = versionAtCommit.endsWith('.0');
        if (isRootCommit || !parentVersionMatchesSeries || commitIsExplicitZeroPatch) return commitHash;
      }
    }
    return null;
  } catch (error) { return null; }
}

function countWorkCommitsSince(commitHash: string): number {
    if (!commitHash) return 0;
    try {
        const commitSubjects = getGitCommandOutput(`git log --pretty=format:%s ${commitHash}..HEAD`).split('\n').filter(Boolean);
        if (commitSubjects.length === 0 || commitSubjects[0] === "ERROR_EXECUTING_GIT_COMMAND") return 0;
        const versionCommitRegexLocal = /^chore: Update version to \d+\.\d+\.\d+$/;
        return commitSubjects.filter(subject => !versionCommitRegexLocal.test(subject)).length;
    } catch (error) { return 0; }
}

type PackageJson = {
  name: string;
  version: string;
  [key: string]: any;
};

/**
 * Manages the mod version.
 * - In normal mode: Calculates new version, updates package.json, commits, pushes.
 * - With --release: Also creates and pushes a git tag.
 * - With --ci-build: Reads version from package.json, no git ops, no file changes.
 * Outputs the determined version string to stdout on the last line if successful.
 */
async function manageVersion(packageJsonPath: string, isCiBuild: boolean, isRelease: boolean): Promise<string> {
  if (getGitDirtySuffix() && !isCiBuild) { // CI builds might run on specific commits that aren't HEAD of a clean checkout
    console.error("ERROR: Repository is dirty. Please commit or stash changes before managing version.");
    process.exit(1);
  }

  const packageJsonFullPath = path.resolve(packageJsonPath);
  let packageJsonContent = await fs.readFile(packageJsonFullPath, 'utf-8');
  let packageJson = JSON.parse(packageJsonContent) as PackageJson;
  let versionToUse = packageJson.version;
  let packageJsonWasUpdatedByScript = false;

  if (isCiBuild) {
    console.log(`CI Mode: Using existing version ${versionToUse} from ${packageJsonPath}`);
    // No changes, just output the version
  } else {
    // Not CI build: Perform version calculation and potential updates
    const currentVersion = packageJson.version;
    const [major, minor] = currentVersion.split('.').map(Number);
    const majorMinorPrefix = `${major}.${minor}.`;

    const baseCommitForSeries = findBaseCommitForVersionSeries(majorMinorPrefix);
    let patchNumber = countWorkCommitsSince(baseCommitForSeries || 'HEAD^'); // Fallback for initial series
    if (!baseCommitForSeries && patchNumber === 0 && getGitCommandOutput('git rev-list --count HEAD') === '1') {
        patchNumber = 0; // True initial commit, version should be M.m.0
    }

    const calculatedVersion = `${major}.${minor}.${patchNumber}`;

    const currentParts = currentVersion.split('.').map(Number);
    const calculatedParts = calculatedVersion.split('.').map(Number);

    // Determine if calculated version is actually newer or if current one was set higher manually
    let useCalculated = false;
    if (calculatedParts[0] > currentParts[0]) useCalculated = true;
    else if (calculatedParts[0] === currentParts[0] && calculatedParts[1] > currentParts[1]) useCalculated = true;
    else if (calculatedParts[0] === currentParts[0] && calculatedParts[1] === currentParts[1] && calculatedParts[2] > currentParts[2]) useCalculated = true;

    if (useCalculated) {
        versionToUse = calculatedVersion;
    } else {
        console.log(`Calculated version (${calculatedVersion}) is not newer than existing version (${currentVersion}). Using existing.`);
        versionToUse = currentVersion; // Stays as currentVersion
    }

    if (packageJson.version !== versionToUse) {
      console.log(`Updating package.json version from ${packageJson.version} to ${versionToUse}`);
      packageJson.version = versionToUse;
      await fs.writeFile(packageJsonFullPath, JSON.stringify(packageJson, null, 2) + '\n');
      packageJsonWasUpdatedByScript = true;

      console.log(`Committing package.json version update to ${versionToUse}...`);
      try {
        execSync(`git add "${packageJsonFullPath}" && git commit -m "chore: Update version to ${versionToUse}"`);
        console.log('Committed version update.');
        console.log('Pushing commit...');
        execSync(`git push -u origin HEAD`); // Assumes current branch is the one to push
        console.log('Pushed commit.');
      } catch (gitError) {
        console.error(`ERROR: Git operation (commit/push) failed. ${ (gitError as Error).message}`);
        process.exit(1);
      }
    } else {
      console.log(`package.json version ${currentVersion} is already up-to-date or manually set higher.`);
    }

    if (isRelease && (packageJsonWasUpdatedByScript || true)) { // Tag if version changed OR if --release and version is current
      const tagName = `v${versionToUse}`;
      console.log(`Release mode: Attempting to create and push tag ${tagName}...`);
      try {
        const localTagExistsOutput = getGitCommandOutput(`git rev-parse refs/tags/${tagName}`);
        const headCommit = getGitCommandOutput('git rev-parse HEAD');

        if (localTagExistsOutput !== "ERROR_EXECUTING_GIT_COMMAND" && localTagExistsOutput === headCommit) {
          console.log(`Tag ${tagName} already exists locally and points to HEAD. Attempting to push.`);
        } else if (localTagExistsOutput !== "ERROR_EXECUTING_GIT_COMMAND" && localTagExistsOutput !== headCommit) {
          console.warn(`Warning: Local tag ${tagName} exists but points to ${localTagExistsOutput.substring(0,7)}, not HEAD (${headCommit.substring(0,7)}). Deleting and re-tagging HEAD.`);
          execSync(`git tag -d ${tagName}`);
          execSync(`git tag ${tagName}`);
          console.log(`Re-created local tag ${tagName} on HEAD.`);
        } else {
          console.log(`Creating local tag ${tagName} on HEAD...`);
          execSync(`git tag ${tagName}`);
          console.log(`Successfully created local tag ${tagName}.`);
        }
        
        console.log(`Pushing tag ${tagName} to origin...`);
        execSync(`git push origin ${tagName}`);
        console.log(`Successfully pushed tag ${tagName}.`);
      } catch (gitError) {
        console.error(`ERROR: Failed to ensure tag ${tagName} is on origin. ${(gitError as Error).message}`);
        process.exit(1);
      }
    }
  }

  console.log(versionToUse); // Output version as the last line
  return versionToUse;
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const packageJsonPathArg = args.find(arg => arg.endsWith('.json')) || './package.json';
  const isCiBuildArg = args.includes('--ci-build');
  const isReleaseArg = args.includes('--release');

  try {
    await manageVersion(packageJsonPathArg, isCiBuildArg, isReleaseArg);
  } catch (error) {
    console.error("Error during version management:", error);
    process.exit(1);
  }
}

run(); 