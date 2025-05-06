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

// Counts commits since a given hash, EXCLUDING automated version bump commits.
function countWorkCommitsSince(commitHash: string): number {
  if (!commitHash) return 0;
  try {
    // Get subjects of commits since the base commit
    const commitSubjects = getGitCommandOutput(`git log --pretty=format:%s ${commitHash}..HEAD`).split('\n').filter(Boolean);
    if (commitSubjects[0] === "ERROR_EXECUTING_GIT_COMMAND") {
        console.warn(`Could not get commit subjects since ${commitHash}`);
        return 0; // Fallback on error
    }

    const versionCommitRegex = /^chore: Update version to \d+\.\d+\.\d+$/;
    let workCommitCount = 0;
    for (const subject of commitSubjects) {
      if (!versionCommitRegex.test(subject)) {
        workCommitCount++;
      }
    }
    return workCommitCount;
  } catch (error) {
    console.warn(`Error counting work commits since ${commitHash}:`, error);
    return 0; // Fallback to 0 if error
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
  const gitLogFormat = `--pretty=format:%s${fieldSeparator}%b${commitSeparator}`;
  const gitLogCommand = `git log ${gitLogFormat} ${commitRange}`;

  const rawLog = getGitCommandOutput(gitLogCommand);
  if (!rawLog || rawLog === "ERROR_EXECUTING_GIT_COMMAND") return {};

  const commits = rawLog.split(commitSeparator).filter(c => c.trim() !== "");
  const categorizedCommits: { [category: string]: { scope?: string; message: string; body: string }[] } = {};

  for (const commit of commits) {
    const parts = commit.split(fieldSeparator);
    const subject = parts[0] ? parts[0].trim() : "";
    const body = parts[1] ? parts[1].trim() : "";

    // Explicitly skip automated version commits if they somehow get included in range
    if (versionCommitRegex.test(subject)) continue;

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
function getCumulativeChangelog(currentBuildVersion: string): string {
  console.log("Generating cumulative changelog...");
  let cumulativeChangelog = "";

  try {
    // 1. Find all version bump commits
    const versionCommitFormat = `%H----%cs----%s`; // Hash----Date----Subject
    const rawVersionCommits = getGitCommandOutput(`git log --grep="^chore: Update version to" --pretty=format:"${versionCommitFormat}"`).split('\n').filter(Boolean);
    
    const versionBumps: { hash: string; version: string; date: string }[] = [];
    for (const line of rawVersionCommits) {
        if (line === "ERROR_EXECUTING_GIT_COMMAND") continue;
        const parts = line.split('----');
        if (parts.length === 3) {
            const hash = parts[0];
            const date = parts[1];
            const subject = parts[2];
            const match = subject.match(versionCommitRegex);
            if (match) {
                versionBumps.push({ hash, version: match[1], date });
            }
        }
    }
    // Sorted newest first by git log default
    console.log(`Found ${versionBumps.length} version bump commits.`);

    // 2. Generate section for the current build (since the latest version bump)
    const latestBumpHash = versionBumps.length > 0 ? versionBumps[0].hash : null;
    const rangeForCurrent = latestBumpHash ? `${latestBumpHash}..HEAD` : "HEAD"; // HEAD includes all if no bumps
    console.log(`Generating section for current build ${currentBuildVersion} (range: ${rangeForCurrent})`);
    const currentEntries = getCategorizedEntries(rangeForCurrent);
    cumulativeChangelog += formatVersionSection(currentBuildVersion, new Date().toISOString().split('T')[0], currentEntries);

    // 3. Generate sections for past versions based on bumps
    for (let i = 0; i < versionBumps.length; i++) {
      const currentBump = versionBumps[i];
      const previousBump = versionBumps[i + 1]; // Older bump
      const previousBumpHash = previousBump ? previousBump.hash : null;

      let range = "";
      if (previousBumpHash) {
        range = `${previousBumpHash}..${currentBump.hash}`;
      } else {
        // Range for the oldest version found: from start up to the oldest bump
        range = currentBump.hash; // `git log HASH` shows from start up to HASH
      }
      
      console.log(`Generating section for past version ${currentBump.version} (range: ${range})`);
      const pastEntries = getCategorizedEntries(range);
      // Only add section if there were actual work entries in that range
      if (Object.keys(pastEntries).length > 0) {
         cumulativeChangelog += formatVersionSection(currentBump.version, currentBump.date, pastEntries);
      } else {
         console.log(` - Skipping section for ${currentBump.version}, no work commits found in range ${range}.`);
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
      packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8'); // Re-read
      packageJson = JSON.parse(packageJsonContent) as PackageJson;
      console.log(`package.json version updated to ${versionToUse}.`);
    } else {
      console.log(`package.json version ${currentVersion} is already up-to-date.`);
    }

    const modName = packageJson.name;
    const modVersion = packageJson.version;

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
    const changelogContent = getCumulativeChangelog(newVersion); // Use the calculated newVersion
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