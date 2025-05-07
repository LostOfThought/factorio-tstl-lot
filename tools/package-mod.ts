import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

// Type for the 'dlc' object within package.json's 'factorio' config
type FactorioDlcRequirementsConfig = {
  quality_required?: boolean;
  space_travel_required?: boolean;
  spoiling_required?: boolean;
  freezing_required?: boolean;
  segmented_units_required?: boolean;
  expansion_shaders_required?: boolean;
  // No index signature here to prevent conflicts when spreading
};

type FactorioPackageConfig = {
  factorio_version?: string;
  title?: string;
  contact?: string;
  homepage?: string;
  dependencies?: string[];
  dlc?: FactorioDlcRequirementsConfig; // Use the refined type here
};

type AuthorObject = {
  name?: string;
  email?: string;
  url?: string;
};

type PackageJson = {
  name: string;
  version: string;
  author?: string | AuthorObject; // Author can be string or object
  description: string;
  homepage?: string; // Standard homepage field
  bugs?: { // Standard bugs field (can be string or object)
    url?: string;
    email?: string;
  } | string;
  factorio?: FactorioPackageConfig;
  [key: string]: any;
};

// Type for the actual info.json file structure
type InfoJson = {
  name: string;
  version: string;
  title: string;
  author: string;
  factorio_version: string;
  description: string;
  contact?: string;
  homepage?: string;
  dependencies?: string[];
  // DLC flags are top-level optional properties in info.json
  quality_required?: boolean;
  space_travel_required?: boolean;
  spoiling_required?: boolean;
  freezing_required?: boolean;
  segmented_units_required?: boolean;
  expansion_shaders_required?: boolean;
  // If other dynamic keys are possible and need to be strictly typed,
  // this would require a more complex mapped type or further refinement.
  // For now, explicit properties are safest.
};

const DEFAULT_FACTORIO_VERSION = "1.1"; // Default if not specified in package.json
const DEFAULT_CHANGELOG_COMMITS_FOR_NEW_SERIES = 10; // Commits for a .0 version

// --- Git Helper Functions ---

function getGitCommandOutput(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch (error) {
    // console.warn(`Git command failed: ${command}`, error.status, error.message); // Keep this for debugging if needed
    return "ERROR_EXECUTING_GIT_COMMAND"; // Return a distinct string for caught errors
  }
}

function getGitShortHash(): string {
  const hash = getGitCommandOutput('git rev-parse --short HEAD');
  return hash === "ERROR_EXECUTING_GIT_COMMAND" ? "unknownhash" : hash;
}

function getGitDirtySuffix(): string {
  // Check for uncommitted changes using `git status --porcelain`
  // This command outputs one line per changed/staged/untracked file.
  // If it outputs anything, the working directory is dirty or has untracked files.
  const statusOutput = getGitCommandOutput('git status --porcelain');
  if (statusOutput && statusOutput !== "ERROR_EXECUTING_GIT_COMMAND") {
    return '-dirty';
  }
  return '';
}

// Finds the hash of the commit that *started* the current version series (M.m).
// This is typically the commit where M.m.0 was set, or where M or m was bumped.
function findBaseCommitForVersionSeries(majorMinorPrefix: string): string | null {
  console.log(`Searching for base commit for version series starting with: ${majorMinorPrefix}`);
  try {
    const commitsTouchingPackageJson = getGitCommandOutput(`git log --pretty=format:"%H" --follow -- package.json`).split('\n').filter(Boolean);
    if (!commitsTouchingPackageJson || commitsTouchingPackageJson.length === 0) {
        console.log("No commits found touching package.json.");
        return null;
    }

    for (const commitHash of commitsTouchingPackageJson) {
      const versionAtCommitStr = getGitCommandOutput(`git show ${commitHash}:package.json`);
      let versionAtCommit: string | null = null;
      if (versionAtCommitStr && versionAtCommitStr !== "ERROR_EXECUTING_GIT_COMMAND") {
        try { versionAtCommit = JSON.parse(versionAtCommitStr).version; } catch { /* ignore parse errors */ }
      }

      if (!versionAtCommit || typeof versionAtCommit !== 'string') {
        // console.log(` - Skipping commit ${commitHash}: Could not get version from package.json.`);
        continue; // Skip commits where we can't read the version
      }

      if (versionAtCommit.startsWith(majorMinorPrefix)) {
        // This commit matches our series. Now check its parent.
        // console.log(` - Commit ${commitHash} matches series with version ${versionAtCommit}. Checking parent...`);
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

        // This commit is the base if it starts the M.m series, or resets it to .0
        if (isRootCommit || !parentVersionMatchesSeries || commitIsExplicitZeroPatch) {
          console.log(`   - Found base commit: ${commitHash} (Version: ${versionAtCommit}, Parent Version: ${versionAtParent || 'N/A'})`);
          return commitHash;
        }
        // else {
        //    console.log(`   - Commit ${commitHash} continues series (Parent Version: ${versionAtParent}).`);
        // }
      } else {
        // This commit is from a previous series. If we already passed commits matching our target series,
        // we might have missed the base (e.g., if the base commit itself had parse errors). 
        // However, iterating newest-first, the first match found by the logic above *should* be correct.
        // console.log(` - Commit ${commitHash} has version ${versionAtCommit}, not matching ${majorMinorPrefix}.`);
      }
    }
    console.log("No suitable base commit found for the series.");
    return null; // No commit found that started the series
  } catch (error) {
    console.warn("Error finding base commit for version series:", error);
    return null;
  }
}

// Counts work commits since a given hash (exclusive of the hash itself).
function countWorkCommitsSince(commitHash: string): number {
    if (!commitHash) return 0;
    try {
        // Get subjects of commits AFTER the base commit up to HEAD
        const commitSubjects = getGitCommandOutput(`git log --pretty=format:%s ${commitHash}..HEAD`).split('\n').filter(Boolean);
        if (commitSubjects.length === 0 || commitSubjects[0] === "ERROR_EXECUTING_GIT_COMMAND") {
            // Handle case where the base commit is HEAD or error occurred
             if (commitSubjects[0] !== "ERROR_EXECUTING_GIT_COMMAND") {
                 console.log(` - No commits found since base ${commitHash.substring(0,7)}.`);
             } else {
                 console.warn(`Could not get commit subjects since ${commitHash.substring(0,7)}`);
             }
            return 0;
        }

        const versionCommitRegex = /^chore: Update version to \d+\.\d+\.\d+$/;
        let workCommitCount = 0;
        for (const subject of commitSubjects) {
            if (!versionCommitRegex.test(subject)) {
                workCommitCount++;
            }
        }
         console.log(` - Found ${commitSubjects.length} total commits, ${workCommitCount} work commits since base ${commitHash.substring(0,7)}.`);
        return workCommitCount;
    } catch (error) {
        console.warn(`Error counting work commits since ${commitHash}:`, error);
        return 0; // Fallback
    }
}

// --- Cumulative Changelog Generation --- //

const conventionalCommitRegex = /^(\w+)(?:\(([^\)]+)\))?(!?): (.*)$/;
const versionCommitRegex = /^chore: Update version to (\d+\.\d+\.\d+)$/;

const factorioCategoryOrder: string[] = [
  "Major Features", "Features", "Minor Features", "Graphics", "Sounds",
  "Optimizations", "Balancing", "Combat Balancing", "Circuit Network",
  "Changes", "Bugfixes", "Modding", "Scripting", "Gui", "Control",
  "Translation", "Debug", "Ease of use", "Info", "Locale"
];

const commitTypeToFactorioCategory: { [key: string]: string } = {
  feat: "Features",
  fix: "Bugfixes",
  perf: "Optimizations",
  docs: "Info",
  style: "Changes",
  refactor: "Changes",
  test: "Changes",
  chore: "Changes", // Default, but version bumps are handled separately
  build: "Changes",
  ci: "Changes",
  revert: "Changes",
};

// Parses commits in a given range and returns categorized entries
function getCategorizedEntries(commitRange: string): { [category: string]: { scope?: string; message: string; body: string }[] } {
    const commitSeparator = "----GIT_COMMIT_SEPARATOR----";
    const fieldSeparator = "----GIT_FIELD_SEPARATOR----";
    // Keep %H for potential future use, but we mainly need subject/body now
    const gitLogFormat = `--pretty=format:%H${fieldSeparator}%s${fieldSeparator}%b${commitSeparator}`;
    const gitLogCommand = `git log ${gitLogFormat} ${commitRange}`;

    const rawLog = getGitCommandOutput(gitLogCommand);
    if (!rawLog || rawLog === "ERROR_EXECUTING_GIT_COMMAND") return {};

    const commits = rawLog.split(commitSeparator).filter(c => c.trim() !== "");
    const categorizedCommits: { [category: string]: { scope?: string; message: string; body: string }[] } = {};

    for (const commit of commits) {
        const parts = commit.split(fieldSeparator);
        // Skip if parts are malformed
        if (parts.length < 2) continue; 
        // const commitHash = parts[0] ? parts[0].trim() : ""; // We don't strictly need the hash here anymore
        const subject = parts[1] ? parts[1].trim() : "";
        const body = parts[2] ? parts[2].trim() : "";

        // Skip automated version bump commits based on their subject pattern
        if (versionCommitRegex.test(subject)) {
             console.log(` - Filtering out version commit: ${subject}`);
             continue;
        }

        const match = subject.match(conventionalCommitRegex);
        let category = "Changes"; // Default category
        let message = subject;
        let scope: string | undefined = undefined;

        if (match) {
            const type = match[1];
            scope = match[2];
            message = match[4];
            category = commitTypeToFactorioCategory[type] || category;
        }

        if (!categorizedCommits[category]) {
            categorizedCommits[category] = [];
        }
        categorizedCommits[category].push({ scope, message, body });
    }
    return categorizedCommits;
}

// Finds commits where the version in package.json changed compared to the previous commit affecting the file.
async function findVersionChangeCommits(): Promise<{ hash: string; version: string; date: string }[]> {
    console.log("Scanning history for version changes in package.json...");
    const versionChanges: { hash: string; version: string; date: string }[] = [];
    try {
        // Get history including hash and date, oldest first for easier comparison
        const commitsTouchingPackageJson = getGitCommandOutput(`git log --pretty=format:"%H----%cs" --follow --reverse -- package.json`).split('\n').filter(Boolean);
        
        if (!commitsTouchingPackageJson || commitsTouchingPackageJson.length === 0 || commitsTouchingPackageJson[0] === "ERROR_EXECUTING_GIT_COMMAND") {
            console.log("No history found for package.json.");
            return [];
        }

        let previousCommitVersion: string | null = null;

        for (const line of commitsTouchingPackageJson) {
            const parts = line.split('----');
            if (parts.length !== 2) continue;
            const commitHash = parts[0];
            const commitDate = parts[1];

            const versionAtCommitStr = getGitCommandOutput(`git show ${commitHash}:package.json`);
            let versionAtCommit: string | null = null;
            if (versionAtCommitStr && versionAtCommitStr !== "ERROR_EXECUTING_GIT_COMMAND") {
                try { versionAtCommit = JSON.parse(versionAtCommitStr).version; } catch { /* ignore */ }
            }

            if (versionAtCommit && typeof versionAtCommit === 'string') {
                if (versionAtCommit !== previousCommitVersion) {
                    // Version changed at this commit!
                    console.log(` - Found version change: ${previousCommitVersion || 'Initial'} -> ${versionAtCommit} at commit ${commitHash.substring(0, 7)} on ${commitDate}`);
                    versionChanges.push({ hash: commitHash, version: versionAtCommit, date: commitDate });
                    previousCommitVersion = versionAtCommit;
                }
            } else {
                 // If we can't read the version, reset comparison baseline
                 console.log(` - Warning: Could not read version at commit ${commitHash.substring(0,7)}. Resetting comparison.`);
                 previousCommitVersion = null; 
            }
        }
    } catch (error) {
        console.warn("Error scanning for version changes:", error);
    }
    // Return sorted newest first for processing by getCumulativeChangelog
    return versionChanges.reverse();
}

// Formats a single version section
function formatVersionSection(version: string, date: string, categorizedEntries: { [category: string]: { scope?: string; message: string; body: string }[] }): string {
  let sectionText = "";
  sectionText += "-".repeat(99) + "\n";
  sectionText += `Version: ${version}\n`;
  sectionText += `Date: ${date}\n`;

  let hasEntries = false;
  for (const categoryName of factorioCategoryOrder) {
    if (categorizedEntries[categoryName] && categorizedEntries[categoryName].length > 0) {
      hasEntries = true;
      sectionText += `  ${categoryName}:\n`;
      for (const entry of categorizedEntries[categoryName]) {
        sectionText += `    - ${entry.scope ? `(${entry.scope}) ` : ''}${entry.message}\n`;
        if (entry.body) {
          entry.body.split('\n').forEach(bodyLine => {
            if (bodyLine.trim() !== "") {
              sectionText += `      ${bodyLine}\n`;
            }
          });
        }
      }
    }
  }

  // Handle uncategorized/fallback
  for (const categoryName in categorizedEntries) {
    if (!factorioCategoryOrder.includes(categoryName) && categorizedEntries[categoryName].length > 0) {
        hasEntries = true;
        sectionText += `  ${categoryName}:\n`; // Usually "Changes"
        for (const entry of categorizedEntries[categoryName]) {
            sectionText += `    - ${entry.scope ? `(${entry.scope}) ` : ''}${entry.message}\n`;
            if (entry.body) {
                entry.body.split('\n').forEach(bodyLine => {
                    if (bodyLine.trim() !== "") {
                        sectionText += `      ${bodyLine}\n`;
                    }
                });
            }
        }
    }
  }
  
  if (!hasEntries) {
      sectionText += "  Changes:\n    - No specific changes documented for this version (or commits did not follow conventional format).\n";
  }

  return sectionText;
}

// Main function to generate the cumulative changelog
async function getCumulativeChangelog(currentPackageJsonVersion: string, buildScriptJustUpdatedPackageJson: boolean): Promise<string> {
    console.log("Generating cumulative changelog based on version changes...");
    let cumulativeChangelog = "";
    const todayDate = new Date().toISOString().split('T')[0];

    try {
        const versionChangeCommits = await findVersionChangeCommits(); // Newest first
        console.log(`Found ${versionChangeCommits.length} version change commits.`);

        // If the script did NOT just update package.json, it means we are building against
        // an existing version. We should show any commits made since that version was established.
        if (!buildScriptJustUpdatedPackageJson && versionChangeCommits.length > 0) {
            const latestVersionCommitDetails = versionChangeCommits[0];

            // Ensure we are actually talking about the same version.
            if (latestVersionCommitDetails.version === currentPackageJsonVersion) {
                const rangeForNewWork = `${latestVersionCommitDetails.hash}..HEAD`;
                console.log(`Generating section for new work on current version ${currentPackageJsonVersion} (range: ${rangeForNewWork})`);
                const newWorkEntries = getCategorizedEntries(rangeForNewWork);

                if (Object.keys(newWorkEntries).some(cat => newWorkEntries[cat].length > 0)) {
                    cumulativeChangelog += formatVersionSection(currentPackageJsonVersion, todayDate, newWorkEntries);
                } else {
                    console.log(` - No new work commits found for current version ${currentPackageJsonVersion} since it was established. Its standard section will be generated by the loop if applicable.`);
                }
            }
        } else if (!buildScriptJustUpdatedPackageJson && versionChangeCommits.length === 0) {
            // Initial commit(s) of the project before any version bump commit.
            console.log(`Generating section for initial build (no prior version commits found, version from package.json: ${currentPackageJsonVersion})`);
            const currentEntries = getCategorizedEntries("HEAD"); // All commits
            cumulativeChangelog += formatVersionSection(currentPackageJsonVersion, todayDate, currentEntries);
        }
        // If buildScriptJustUpdatedPackageJson is true, versionChangeCommits[0] IS the current build version.
        // The loop below will handle its section generation.

        // Generate sections for all versions found in versionChangeCommits
        for (let i = 0; i < versionChangeCommits.length; i++) {
            const versionCommitDetail = versionChangeCommits[i];
            const previousVersionCommit = versionChangeCommits[i + 1];
            const previousVersionCommitHash = previousVersionCommit ? previousVersionCommit.hash : null;

            let rangeForEntries = "";
            if (previousVersionCommitHash) {
                // Commits *after* previous change up to *and including* current version's commit
                rangeForEntries = `${previousVersionCommitHash}..${versionCommitDetail.hash}`;
            } else {
                // Oldest version section: Commits from start up to (and including) the first version change commit
                rangeForEntries = versionCommitDetail.hash;
            }
            
            console.log(`Processing entries for version ${versionCommitDetail.version} (range: ${rangeForEntries})`);
            const entries = getCategorizedEntries(rangeForEntries);
            
            // Determine if this version is the one that was just set by the script in this run.
            const isCurrentVersionJustSetByScript = buildScriptJustUpdatedPackageJson && 
                                                 i === 0 && 
                                                 versionCommitDetail.version === currentPackageJsonVersion;

            if (Object.keys(entries).some(cat => entries[cat].length > 0) || isCurrentVersionJustSetByScript) {
                // Always add a section for the version just set by the script, even if no specific work items.
                // Use the date from the version commit itself.
                cumulativeChangelog += formatVersionSection(versionCommitDetail.version, versionCommitDetail.date, entries);
            } else {
                console.log(` - Skipping section for ${versionCommitDetail.version}, no qualifying work commits found and not the version just set by script.`);
            }
        }

    } catch (error) {
        console.error("Error generating cumulative changelog:", error);
        return "Changelog generation failed.";
    }

    return cumulativeChangelog;
}

// --- Main Script ---

async function main() {
  try {
    console.log("Starting mod packaging process...");

    const isCiBuildArg = process.argv.includes('--ci-build');
    let isReleaseModeArg = process.argv.includes('--release');

    if (isCiBuildArg && isReleaseModeArg) {
      console.warn("Warning: --ci-build and --release flags were both specified. --ci-build takes precedence; --release actions will be skipped.");
      isReleaseModeArg = false;
    }

    if (isCiBuildArg) {
      console.log("CI Build Mode: Version bumping, git commits, and tagging will be skipped.");
    }
    // Only log if release mode is actually active and not overridden by CI mode
    if (isReleaseModeArg && !isCiBuildArg) { 
      console.log("Release Mode Active: A git tag will be created and pushed if operations are successful.");
    }

    const shortHash = getGitShortHash();
    const dirtySuffix = getGitDirtySuffix();

    if (dirtySuffix) {
      console.error("ERROR: Repository is dirty. Please commit or stash your changes before running the package script.");
      console.error("You can use 'git status' to see the changes.");
      process.exit(1);
    }

    const initialDistDir = 'dist';
    const releasesDir = path.resolve(process.cwd(), 'releases');
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');

    let packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    let packageJson = JSON.parse(packageJsonContent) as PackageJson;

    let versionToUse = packageJson.version;
    let packageJsonWasUpdatedByScript = false;

    if (!isCiBuildArg) {
      const currentVersion = packageJson.version;
      const [major, minor] = currentVersion.split('.').map(Number);
      const majorMinorPrefix = `${major}.${minor}.`;

      const baseCommitForSeries = findBaseCommitForVersionSeries(majorMinorPrefix);
      let patchNumber = 0;
      if (baseCommitForSeries) {
        patchNumber = countWorkCommitsSince(baseCommitForSeries);
      }
      const newVersion = `${major}.${minor}.${patchNumber}`;

      const currentMajorMinorPatch = currentVersion.split('.').map(Number);
      const newMajorMinorPatch = newVersion.split('.').map(Number);

      if (newMajorMinorPatch[0] > currentMajorMinorPatch[0] || 
          (newMajorMinorPatch[0] === currentMajorMinorPatch[0] && newMajorMinorPatch[1] > currentMajorMinorPatch[1]) || 
          (newMajorMinorPatch[0] === currentMajorMinorPatch[0] && newMajorMinorPatch[1] === currentMajorMinorPatch[1] && newMajorMinorPatch[2] > currentMajorMinorPatch[2])) {
        versionToUse = newVersion;
      } else if (newMajorMinorPatch[0] === currentMajorMinorPatch[0] && 
                 newMajorMinorPatch[1] === currentMajorMinorPatch[1] && 
                 newMajorMinorPatch[2] < currentMajorMinorPatch[2]) {
        console.log(`Calculated patch (${newMajorMinorPatch[2]}) is lower than existing patch (${currentMajorMinorPatch[2]}) for ${major}.${minor}. Using existing version: ${currentVersion}`);
        versionToUse = currentVersion; // Stays as currentVersion
      } else {
        versionToUse = currentVersion; // Stays as currentVersion
      }

      if (packageJson.version !== versionToUse) {
        console.log(`Updating package.json version from ${packageJson.version} to ${versionToUse}`);
        packageJson.version = versionToUse;
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
        console.log(`package.json version updated to ${versionToUse}.`);
        packageJsonWasUpdatedByScript = true;

        console.log(`Committing package.json version update to ${versionToUse}...`);
        try {
          execSync(`git add ${packageJsonPath} && git commit -m "chore: Update version to ${versionToUse}"`);
          console.log(`Committed version update: ${versionToUse} to package.json`);

          console.log(`Pushing commit for version ${versionToUse}...`);
          execSync(`git push -u origin HEAD`);
          console.log(`Pushed commit for version ${versionToUse}.`);
        } catch (gitError: unknown) { 
          let errorMessage = "An unknown error occurred during git operation.";
          let specificErrorType = "general";
          if (gitError instanceof Error) {
            errorMessage = gitError.message;
            if (errorMessage.toLowerCase().includes("commit")) specificErrorType = "commit";
            else if (errorMessage.toLowerCase().includes("push")) specificErrorType = "push";
          }
          if (specificErrorType === "commit") console.error(`ERROR: Failed to commit package.json version update. ${errorMessage}`);
          else if (specificErrorType === "push") console.error(`ERROR: Failed to push version update commit. ${errorMessage}`);
          else console.error(`ERROR: Git operation failed. ${errorMessage}`);
          console.error("Please ensure Git is configured (user.name, user.email), no other Git processes are interfering, and you have push access.");
          process.exit(1);
        }

        // Successfully committed and pushed package.json update if it happened.
        // Now, if in release mode, handle tagging.
        if (isReleaseModeArg) {
          const tagName = `v${versionToUse}`;
          console.log(`Release mode: Attempting to create and push tag ${tagName}...`);
          try {
            const localTagExistsOutput = getGitCommandOutput(`git rev-parse refs/tags/${tagName}`);
            const localTagExists = localTagExistsOutput !== "ERROR_EXECUTING_GIT_COMMAND";

            if (localTagExists) {
              const localTagCommit = localTagExistsOutput;
              const headCommit = getGitCommandOutput('git rev-parse HEAD');
              console.log(`Tag ${tagName} already exists locally.`);
              if (localTagCommit !== headCommit && headCommit !== "ERROR_EXECUTING_GIT_COMMAND") {
                console.warn(`Warning: Local tag ${tagName} points to commit ${localTagCommit.substring(0, 7)}, but HEAD is ${headCommit.substring(0, 7)}.`);
                console.warn(`The script will attempt to push the existing local tag ${tagName}. If this is not intended, please resolve manually (e.g., delete and recreate the tag on the correct commit, or ensure HEAD is the desired commit).`);
              } else if (headCommit === "ERROR_EXECUTING_GIT_COMMAND") {
                console.warn(`Warning: Could not verify if existing local tag ${tagName} points to HEAD due to git error.`);
              }
            } else {
              console.log(`Creating tag ${tagName} on current commit (HEAD)...`);
              execSync(`git tag ${tagName}`);
              console.log(`Successfully created local tag ${tagName}.`);
            }

            console.log(`Pushing tag ${tagName} to origin...`);
            execSync(`git push origin ${tagName}`);
            console.log(`Successfully pushed tag ${tagName}.`);

          } catch (gitError: unknown) {
            let errorMessage = "An unknown error occurred during git tagging or tag push operation.";
            if (gitError instanceof Error) { errorMessage = gitError.message; }
            console.error(`ERROR: Failed to ensure tag ${tagName} is on origin. ${errorMessage}`);
            console.error("Details: This could be due to the tag already existing on the remote and pointing to a different commit, network issues, or permissions.");
            console.error(`Please verify the tag status manually (e.g., local: 'git show-ref --tags', remote: 'git ls-remote --tags origin'). Then, resolve any conflicts and push the tag manually if needed ('git push origin ${tagName}').`);
            process.exit(1); // Tagging is critical for a --release flow.
          }
        }
      } else { // This else corresponds to 'if (packageJson.version !== versionToUse)'
        console.log(`package.json version ${currentVersion} is already up-to-date.`);
        // If package.json wasn't updated, but we are in release mode, still attempt to tag and push current version.
        if (isReleaseModeArg) {
          const tagName = `v${versionToUse}`;
          console.log(`Release mode (no version change): Attempting to create and push tag ${tagName}...`);
          try {
            const localTagExistsOutput = getGitCommandOutput(`git rev-parse refs/tags/${tagName}`);
            const localTagExists = localTagExistsOutput !== "ERROR_EXECUTING_GIT_COMMAND";

            if (localTagExists) {
              const localTagCommit = localTagExistsOutput;
              const headCommit = getGitCommandOutput('git rev-parse HEAD');
              console.log(`Tag ${tagName} already exists locally.`);
              if (localTagCommit !== headCommit && headCommit !== "ERROR_EXECUTING_GIT_COMMAND") {
                console.warn(`Warning: Local tag ${tagName} points to commit ${localTagCommit.substring(0, 7)}, but HEAD is ${headCommit.substring(0, 7)}.`);
                console.warn(`The script will attempt to push the existing local tag ${tagName}. If this is not intended, please resolve manually.`);
              } else if (headCommit === "ERROR_EXECUTING_GIT_COMMAND") {
                console.warn(`Warning: Could not verify if existing local tag ${tagName} points to HEAD due to git error.`);
              }
            } else {
              console.log(`Creating tag ${tagName} on current commit (HEAD)...`);
              execSync(`git tag ${tagName}`);
              console.log(`Successfully created local tag ${tagName}.`);
            }

            console.log(`Pushing tag ${tagName} to origin...`);
            execSync(`git push origin ${tagName}`);
            console.log(`Successfully pushed tag ${tagName}.`);

          } catch (gitError: unknown) {
            let errorMessage = "An unknown error occurred during git tagging or tag push operation.";
            if (gitError instanceof Error) { errorMessage = gitError.message; }
            console.error(`ERROR: Failed to ensure tag ${tagName} is on origin. ${errorMessage}`);
            console.error("Details: This could be due to the tag already existing on the remote and pointing to a different commit, network issues, or permissions.");
            console.error(`Please verify the tag status manually (e.g., local: 'git show-ref --tags', remote: 'git ls-remote --tags origin'). Then, resolve any conflicts and push the tag manually if needed ('git push origin ${tagName}').`);
            process.exit(1); 
          }
        }
      }
    } else { // This is the isCiBuildArg === true block
      console.log(`CI Mode: Using version ${packageJson.version} from package.json.`);
      // versionToUse remains packageJson.version from initialization, which is correct for CI
    }

    // Ensure finalModVersion reflects the version determined by the logic above
    const finalModVersion = versionToUse;
    const modName = packageJson.name;

    // Derive author and contact from standard fields
    let authorString = 'Unknown Author';
    let contactString: string | undefined = undefined;

    if (typeof packageJson.author === 'object' && packageJson.author !== null) {
      // Explicitly check the type again for the linter
      const authorObj = packageJson.author as AuthorObject;
      authorString = authorObj.name || authorString;
      contactString = authorObj.email;
    } else if (typeof packageJson.author === 'string') {
      authorString = packageJson.author;
    }

    // Fallback to bugs email if no author email
    if (!contactString && typeof packageJson.bugs === 'object' && packageJson.bugs !== null) {
      // Explicitly check type again
      const bugsObj = packageJson.bugs as { url?: string; email?: string };
      contactString = bugsObj.email;
    }

    // Allow override from factorio config (though discouraged)
    contactString = packageJson.factorio?.contact || contactString;

    // Derive homepage from standard field
    // Allow override from factorio config (though discouraged)
    const homepageString = packageJson.homepage || packageJson.factorio?.homepage;

    const modDescription = packageJson.description || 'No description provided.';
    const factorioConfig = packageJson.factorio || {};
    const factorioVersion = factorioConfig.factorio_version || DEFAULT_FACTORIO_VERSION;
    // Title: Use factorio.title override, then package.json.name
    const title = factorioConfig.title || modName;

    // Construct dynamic build folder name using pre-determined git status
    const dynamicBuildFolderName = `${modName}_${finalModVersion}-${shortHash}${dirtySuffix}`;
    const dynamicBuildFolderPath = path.resolve(process.cwd(), dynamicBuildFolderName);

    console.log(`Mod Name: ${modName}`);
    console.log(`Mod Version (final): ${finalModVersion}`);
    console.log(`Target Factorio Version: ${factorioVersion}`);
    console.log(`Dynamic build folder name: ${dynamicBuildFolderName}`);

    // Clean and ensure initialDistDir exists (e.g., ./dist)
    console.log(`Cleaning and ensuring initial build directory \`./${initialDistDir}/\` exists...`);
    execSync(`pnpm rimraf ./${initialDistDir} && mkdir -p ./${initialDistDir}`, { stdio: 'inherit' });

    // 2. Generate info.json directly into initialDistDir
    const infoJsonData: InfoJson = {
      name: modName,
      version: finalModVersion, // Use finalModVersion
      title: title, // Use derived title
      author: authorString, // Use derived author
      factorio_version: factorioVersion,
      description: modDescription,
      contact: contactString, // Use derived contact
      homepage: homepageString, // Use derived homepage
      dependencies: factorioConfig.dependencies || [`base >= ${factorioVersion}`],
      ...(factorioConfig.dlc || {}),
    };
    // Clean up undefined fields
    for (const key in infoJsonData) { if (infoJsonData[key as keyof InfoJson] === undefined) { delete infoJsonData[key as keyof InfoJson]; }}
    const infoJsonPathInInitialDist = path.resolve(initialDistDir, 'info.json');
    await fs.writeFile(infoJsonPathInInitialDist, JSON.stringify(infoJsonData, null, 2));
    console.log(`Generated info.json at ${infoJsonPathInInitialDist}`);

    // 3. Generate cumulative changelog directly into initialDistDir
    const changelogContent = await getCumulativeChangelog(finalModVersion, packageJsonWasUpdatedByScript); // Pass the flag
    const changelogPathInInitialDist = path.resolve(initialDistDir, 'changelog.txt');
    await fs.writeFile(changelogPathInInitialDist, changelogContent);
    console.log(`Generated cumulative changelog.txt at ${changelogPathInInitialDist}`);

    // 4. Build Lua files (output should also go to ./initialDistDir)
    console.log(`Building Lua files (output should be in ./${initialDistDir})...`);
    execSync('pnpm run build:all', { stdio: 'inherit' }); // Assumes tsconfigs output to initialDistDir
    console.log("Lua build complete.");

    // 5. Rename initialDistDir to dynamicBuildFolderName
    // First, ensure no folder exists with the dynamic name (clean up from previous failed run perhaps)
    try { await fs.rm(dynamicBuildFolderPath, { recursive: true, force: true }); } catch (e) { /* ignore if not found */ }
    await fs.rename(path.resolve(initialDistDir), dynamicBuildFolderPath);
    console.log(`Renamed ./${initialDistDir} to ./${dynamicBuildFolderName}`);

    console.log(`Copying additional Factorio assets from ./src to ${dynamicBuildFolderName}...`);

    // 1. Copy thumbnail.png
    const srcThumbnailPath = path.resolve(process.cwd(), 'src', 'thumbnail.png');
    const destThumbnailPath = path.resolve(dynamicBuildFolderPath, 'thumbnail.png');
    try {
      await fs.access(srcThumbnailPath); // Check if source exists using fs.access from fs/promises
      await fs.copyFile(srcThumbnailPath, destThumbnailPath);
      console.log(`  Copied thumbnail.png to ${destThumbnailPath}`);
    } catch (error) {
      // fs.access throws if file doesn't exist or isn't accessible
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log(`  thumbnail.png not found in ./src, skipping.`);
      } else {
        // Log other errors but don't necessarily fail the build for optional assets
        console.warn(`  Warning: Could not copy thumbnail.png: ${(error as Error).message}`);
      }
    }

    // 2. Copy standard subfolders
    const standardSubfolders = ['locale', 'scenarios', 'campaigns', 'tutorials', 'migrations'];
    for (const subfolder of standardSubfolders) {
      const srcSubfolderPath = path.resolve(process.cwd(), 'src', subfolder);
      const destSubfolderPath = path.resolve(dynamicBuildFolderPath, subfolder);
      try {
        await fs.access(srcSubfolderPath); // Check if source directory exists
        const stats = await fs.stat(srcSubfolderPath);
        if (stats.isDirectory()) {
          console.log(`  Copying directory ${subfolder} from ${srcSubfolderPath} to ${destSubfolderPath}...`);
          // Using execSync for recursive copy, consistent with other parts of the script
          // Ensure paths are quoted if they might contain spaces, though dynamicBuildFolderPath typically won't.
          execSync(`cp -R "${srcSubfolderPath}" "${destSubfolderPath}"`);
          console.log(`    Successfully copied ${subfolder}.`);
        } else {
          // This case should ideally not happen if fs.access passed and it's not ENOENT
          // but good to be aware of. If srcSubfolderPath is a file, fs.stat would not throw ENOENT.
          // console.log(`  Path ./src/${subfolder} exists but is not a directory, skipping.`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.log(`  Subfolder ./${subfolder} not found in ./src, skipping.`);
        } else {
          // execSync for cp -R will throw an error on failure, which would be caught by the main try/catch.
          // This specific catch handles fs.access/fs.stat errors or if we wanted to log other errors distinctly.
          console.warn(`  Warning: Could not process or copy subfolder ./src/${subfolder}: ${(error as Error).message}`);
        }
      }
    }
    console.log(`Finished copying additional Factorio assets.`);

    // 6. Create releases directory if it doesn't exist
    try { await fs.mkdir(releasesDir, { recursive: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    console.log(`Ensured releases directory exists at ${releasesDir}`);

    // 7. Bundle the mod (zip the dynamically named folder)
    const zipFileName = `${modName}_${finalModVersion}.zip`; // Zip file name is standard modName_version.zip
    const absoluteZipFilePath = path.resolve(releasesDir, zipFileName);

    console.log(`Creating zip file: ${absoluteZipFilePath}`);
    try { await fs.unlink(absoluteZipFilePath); console.log(`Removed existing zip file: ${absoluteZipFilePath}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

    // Zip the dynamicBuildFolderName from the project root
    const zipCommand = `zip -r "${absoluteZipFilePath}" "${dynamicBuildFolderName}" -x "*/.DS_Store" "**/.DS_Store"`;
    console.log(`Executing: ${zipCommand}`);
    execSync(zipCommand, { stdio: 'inherit' });

    // 8. Rename the dynamically named build folder back to initialDistDir (e.g., ./dist)
    await fs.rename(dynamicBuildFolderPath, path.resolve(process.cwd(), initialDistDir));
    console.log(`Renamed build folder ./${dynamicBuildFolderName} back to ./${initialDistDir}`);

    console.log(`Successfully packaged mod to ${absoluteZipFilePath}`);

  } catch (error) {
    console.error("Error during main script execution:", error);
    process.exit(1);
  }
}

main(); 