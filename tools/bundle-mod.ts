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

// Main function to generate the cumulative changelog using version change commits as boundaries
async function getCumulativeChangelog(currentBuildVersion: string): Promise<string> { // Make async
    console.log("Generating cumulative changelog based on version changes...");
    let cumulativeChangelog = "";

    try {
        // 1. Find all version change commits
        const versionChangeCommits = await findVersionChangeCommits(); // Use the new function
        console.log(`Found ${versionChangeCommits.length} version change commits.`);

        // 2. Generate section for the current build (since the latest version change)
        const latestChangeHash = versionChangeCommits.length > 0 ? versionChangeCommits[0].hash : null;
        const rangeForCurrent = latestChangeHash ? `${latestChangeHash}..HEAD` : "HEAD"; // HEAD includes all if no changes found
        console.log(`Generating section for current build ${currentBuildVersion} (range: ${rangeForCurrent})`);
        // Get entries SINCE last change. The filtering is inside getCategorizedEntries.
        const currentEntries = getCategorizedEntries(rangeForCurrent);
        cumulativeChangelog += formatVersionSection(currentBuildVersion, new Date().toISOString().split('T')[0], currentEntries);

        // 3. Generate sections for past versions based on detected changes
        for (let i = 0; i < versionChangeCommits.length; i++) {
            const currentChange = versionChangeCommits[i]; // e.g., commit H_n resulting in V_n
            const previousChange = versionChangeCommits[i + 1]; // e.g., commit H_n-1 resulting in V_n-1
            const previousChangeHash = previousChange ? previousChange.hash : null;

            let range = "";
            if (previousChangeHash) {
                // Commits *after* previous change up to *and including* current change
                range = `${previousChangeHash}..${currentChange.hash}`;
            } else {
                // Oldest version section: Commits from start up to the first version change
                range = currentChange.hash; // `git log HASH` includes commits up to HASH
            }
            
            console.log(`Generating section for past version ${currentChange.version} (range: ${range})`);
            // Get entries for this range. getCategorizedEntries now filters the chore commits.
            const pastEntries = getCategorizedEntries(range);
            
            if (Object.keys(pastEntries).some(cat => pastEntries[cat].length > 0)) {
                // Use the date the version *was set* for the section header
                cumulativeChangelog += formatVersionSection(currentChange.version, currentChange.date, pastEntries);
            } else {
                console.log(` - Skipping section for ${currentChange.version}, no work commits found in range ${range}.`);
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
    console.log("Starting mod bundle process...");

    // Determine Git status early, before any file modifications by this script
    const shortHash = getGitShortHash();
    const dirtySuffix = getGitDirtySuffix();

    // Fail fast if the repository is dirty
    if (dirtySuffix) {
      console.error("ERROR: Repository is dirty. Please commit or stash your changes before running the bundle script.");
      console.error("You can use 'git status' to see the changes.");
      process.exit(1);
    }

    const initialDistDir = 'dist';
    const releasesDir = path.resolve(process.cwd(), 'releases');
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');

    // 1. Read package.json and calculate version
    let packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    let packageJson = JSON.parse(packageJsonContent) as PackageJson;

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

    let versionToUse = currentVersion; // Default to using the version already in package.json

    if (newMajorMinorPatch[0] > currentMajorMinorPatch[0] || 
        (newMajorMinorPatch[0] === currentMajorMinorPatch[0] && newMajorMinorPatch[1] > currentMajorMinorPatch[1]) || 
        (newMajorMinorPatch[0] === currentMajorMinorPatch[0] && newMajorMinorPatch[1] === currentMajorMinorPatch[1] && newMajorMinorPatch[2] > currentMajorMinorPatch[2])) {
      // If new version is genuinely higher (M, m, or p)
      versionToUse = newVersion;
    } else if (newMajorMinorPatch[0] === currentMajorMinorPatch[0] && 
               newMajorMinorPatch[1] === currentMajorMinorPatch[1] && 
               newMajorMinorPatch[2] < currentMajorMinorPatch[2]) {
      // If M.m is same, but new patch is lower, stick with current (higher) patch from package.json.
      // This handles cases where package.json might have been manually set to a higher patch.
      console.log(`Calculated patch (${newMajorMinorPatch[2]}) is lower than existing patch (${currentMajorMinorPatch[2]}) for ${major}.${minor}. Using existing version: ${currentVersion}`);
      versionToUse = currentVersion;
    } else {
      // Otherwise (M.m.p is same, or new M.m is lower which shouldn't happen with current logic but good to be safe)
      // stick to currentVersion unless new one is strictly greater.
      // If newVersion is simply M.m.0 because no commits since M.m was set, and current is M.m.Z, we use M.m.Z.
      // If newVersion is M.m.N and current is M.m.Z where N > Z, it's covered by the first `if`.
      // If newVersion is M.m.N and current is M.m.Z where N == Z, it will fall here and use currentVersion (no change needed).
      versionToUse = currentVersion; 
    }

    if (packageJson.version !== versionToUse) {
      console.log(`Updating package.json version from ${packageJson.version} to ${versionToUse}`);
      packageJson.version = versionToUse;
      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
      // packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8'); // Re-read if other parts of packageJson were modified and needed. Not strictly necessary if only version changes.
      // packageJson = JSON.parse(packageJsonContent) as PackageJson; // As above.
      console.log(`package.json version updated to ${versionToUse}.`);

      // Automatically commit the package.json version update
      console.log(`Committing package.json version update to ${versionToUse}...`);
      try {
        // Use execSync from child_process, already imported
        execSync(`git add ${packageJsonPath} && git commit -m "chore: Update version to ${versionToUse}"`);
        console.log(`Committed version update: ${versionToUse} to package.json`);
      } catch (commitError: unknown) { // Explicitly type commitError as unknown or any
        let errorMessage = "An unknown error occurred during commit.";
        if (commitError instanceof Error) {
          errorMessage = commitError.message;
        }
        console.error(`ERROR: Failed to commit package.json version update. ${errorMessage}`);
        console.error("Please ensure Git is configured (user.name, user.email) and no other Git processes are interfering.");
        // Decide if this should be a fatal error. Making it fatal for consistency.
        process.exit(1);
      }
      // Re-read packageJson if it was truly re-parsed above, or ensure the in-memory 'packageJson' object is the source of truth.
      // For now, assuming the script uses the 'versionToUse' and 'packageJson.name' etc. that were set prior to this potential re-read.
      // If other parts of packageJson were modified by other means and then re-read, ensure consistency.
      // The current logic primarily uses packageJson.name, packageJson.description etc. which are read before this block.
      // And modVersion is set from 'packageJson.version' *after* this block (if updated) or from 'currentVersion' if not.
      // Let's ensure modVersion uses the *final* version.

    } else {
      console.log(`package.json version ${currentVersion} is already up-to-date.`);
    }

    // Ensure packageJson reflects the version that will be used, especially if it was updated and committed.
    // If it was updated, packageJson.version *is* versionToUse.
    // If not updated, versionToUse was currentVersion, so packageJson.version is also correct.
    const modName = packageJson.name;
    const modVersion = packageJson.version; // This should now reliably be the (potentially updated and committed) version

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
    const dynamicBuildFolderName = `${modName}_${modVersion}-${shortHash}${dirtySuffix}`;
    const dynamicBuildFolderPath = path.resolve(process.cwd(), dynamicBuildFolderName);

    console.log(`Mod Name: ${modName}`);
    console.log(`Mod Version (final): ${modVersion}`);
    console.log(`Target Factorio Version: ${factorioVersion}`);
    console.log(`Dynamic build folder name: ${dynamicBuildFolderName}`);

    // Clean and ensure initialDistDir exists (e.g., ./dist)
    console.log(`Cleaning and ensuring initial build directory \`./${initialDistDir}/\` exists...`);
    execSync(`pnpm rimraf ./${initialDistDir} && mkdir -p ./${initialDistDir}`, { stdio: 'inherit' });

    // 2. Generate info.json directly into initialDistDir
    const infoJsonData: InfoJson = {
      name: modName,
      version: modVersion,
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
    const changelogContent = await getCumulativeChangelog(newVersion); // Now async
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

    // 6. Create releases directory if it doesn't exist
    try { await fs.mkdir(releasesDir, { recursive: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    console.log(`Ensured releases directory exists at ${releasesDir}`);

    // 7. Bundle the mod (zip the dynamically named folder)
    const zipFileName = `${modName}_${modVersion}.zip`; // Zip file name is standard modName_version.zip
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

    console.log(`Successfully bundled mod to ${absoluteZipFilePath}`);

  } catch (error) {
    console.error("Error during bundling process:", error);
    process.exit(1);
  }
}

main(); 