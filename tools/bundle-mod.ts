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

type PackageJson = {
  name: string;
  version: string;
  author: string;
  description: string;
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
    console.warn(`Error executing git command: ${command}`, error);
    return "";
  }
}

function getGitShortHash(): string {
  return getGitCommandOutput('git rev-parse --short HEAD');
}

function getGitDirtySuffix(): string {
  // Check for uncommitted changes (both staged and unstaged)
  const unstagedChanges = getGitCommandOutput('git diff --quiet');
  const stagedChanges = getGitCommandOutput('git diff --cached --quiet');
  // If either command fails (non-zero exit code), it means there are changes.
  // execSync throws on non-zero exit, caught by getGitCommandOutput, which returns "".
  // So we need to check if the *attempt* to run them indicated changes.
  // A more direct way for dirtiness:
  const isDirty = getGitCommandOutput('git status --porcelain');
  return isDirty ? '-dirty' : '';
}

// Finds the hash of the most recent commit that touched package.json
// and where the version in package.json started with the given majorMinorPrefix.
function findBaseCommitForVersionSeries(majorMinorPrefix: string): string | null {
  try {
    // Get all commits that touched package.json, with their hash and subject (for the version)
    // This is a bit complex:
    // 1. `git log --pretty=format:"%H" --follow -- package.json` gets commit hashes for package.json changes.
    // 2. For each hash, we need to check the version in package.json *at that commit*.
    const commitsTouchingPackageJson = getGitCommandOutput('git log --pretty=format:"%H" --follow -- package.json').split('\n').filter(Boolean);

    for (const commitHash of commitsTouchingPackageJson) {
      const packageJsonContentAtCommit = getGitCommandOutput(`git show ${commitHash}:package.json`);
      if (packageJsonContentAtCommit) {
        try {
          const pkg = JSON.parse(packageJsonContentAtCommit);
          if (pkg.version && typeof pkg.version === 'string' && pkg.version.startsWith(majorMinorPrefix)) {
            // This is the first commit (most recent) in the log that matches our series
            return commitHash;
          }
        } catch (parseError) {
          console.warn(`Failed to parse package.json at commit ${commitHash}`, parseError);
        }
      }
    }
    return null; // No such commit found
  } catch (error) {
    console.warn("Error finding base commit for version series:", error);
    return null;
  }
}

function countCommitsSince(commitHash: string): number {
  if (!commitHash) return 0;
  try {
    // Count commits on the current branch since the given commit (exclusive of the commit itself)
    // If the base commit is the current HEAD, this will be 0.
    const count = getGitCommandOutput(`git rev-list --count ${commitHash}..HEAD`);
    return parseInt(count, 10) || 0;
  } catch (error) {
    console.warn(`Error counting commits since ${commitHash}:`, error);
    return 0; // Fallback to 0 if error
  }
}

// --- Changelog Generation with Conventional Commits ---

const conventionalCommitRegex = /^(\w+)(?:\(([^\)]+)\))?(!?): (.*)$/;

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
  docs: "Info", // Or "Changes"
  style: "Changes", // Or could be ignored if not user-facing
  refactor: "Changes", // Or "Modding" / "Scripting"
  test: "Changes",   // Or could be ignored
  chore: "Changes",  // Or could be ignored
  build: "Changes",  // Or "Modding"
  ci: "Changes",     // Or could be ignored
  revert: "Changes",
  // You can add more mappings here
};

function getChangelog(baseCommitHash: string | null, currentModVersion: string): string {
  let gitLogCommand = "";
  const commitSeparator = "----GIT_COMMIT_SEPARATOR----";
  const fieldSeparator = "----GIT_FIELD_SEPARATOR----";
  // We need subject (%s) and body (%b)
  const gitLogFormat = `--pretty=format:%s${fieldSeparator}%b${commitSeparator}`;

  if (baseCommitHash) {
    const commitsSinceBase = countCommitsSince(baseCommitHash);
    if (commitsSinceBase === 0) {
      gitLogCommand = `git log -1 ${gitLogFormat} ${baseCommitHash}`;
    } else {
      gitLogCommand = `git log ${gitLogFormat} ${baseCommitHash}..HEAD`;
    }
  } else {
    gitLogCommand = `git log -${DEFAULT_CHANGELOG_COMMITS_FOR_NEW_SERIES} ${gitLogFormat}`;
  }

  const rawLog = getGitCommandOutput(gitLogCommand);
  if (!rawLog) return "No commits found for this version range.";

  const commits = rawLog.split(commitSeparator).filter(c => c.trim() !== "");
  const categorizedCommits: { [category: string]: { scope?: string; message: string; body: string }[] } = {};

  for (const commit of commits) {
    const parts = commit.split(fieldSeparator);
    const subject = parts[0] ? parts[0].trim() : "";
    const body = parts[1] ? parts[1].trim() : "";

    const match = subject.match(conventionalCommitRegex);
    let category = "Changes"; // Default category
    let message = subject;
    let scope: string | undefined = undefined;

    if (match) {
      const type = match[1];
      scope = match[2];
      // const isBreaking = match[3] === '!'; // Could use this for "Major Features" or warnings
      message = match[4];
      category = commitTypeToFactorioCategory[type] || category;
    }

    if (!categorizedCommits[category]) {
      categorizedCommits[category] = [];
    }
    categorizedCommits[category].push({ scope, message, body });
  }

  let changelogText = "";
  changelogText += "-".repeat(99) + "\n";
  changelogText += `Version: ${currentModVersion}\n`;
  changelogText += `Date: ${new Date().toISOString().split('T')[0]}\n`; // YYYY-MM-DD

  let hasEntries = false;
  for (const categoryName of factorioCategoryOrder) {
    if (categorizedCommits[categoryName] && categorizedCommits[categoryName].length > 0) {
      hasEntries = true;
      changelogText += `  ${categoryName}:\n`;
      for (const entry of categorizedCommits[categoryName]) {
        changelogText += `    - ${entry.scope ? `(${entry.scope}) ` : ''}${entry.message}\n`;
        if (entry.body) {
          entry.body.split('\n').forEach(bodyLine => {
            if (bodyLine.trim() !== "") { // Avoid empty lines from body creating weird spacing
              changelogText += `      ${bodyLine}\n`;
            }
          });
        }
      }
    }
  }
  
  // Fallback for commits that didn't fit into the ordered categories or if no conventional commits were found
  for (const categoryName in categorizedCommits) {
    if (!factorioCategoryOrder.includes(categoryName) && categorizedCommits[categoryName].length > 0) {
        hasEntries = true;
        changelogText += `  ${categoryName}:\n`; // This would be "Changes" for non-conventional or unmapped
        for (const entry of categorizedCommits[categoryName]) {
            changelogText += `    - ${entry.scope ? `(${entry.scope}) ` : ''}${entry.message}\n`;
            if (entry.body) {
                entry.body.split('\n').forEach(bodyLine => {
                    if (bodyLine.trim() !== "") {
                        changelogText += `      ${bodyLine}\n`;
                    }
                });
            }
        }
    }
  }

  if (!hasEntries) {
    changelogText += "  Changes:\n    - No specific changes documented for this version (or commits did not follow conventional format).\n";
  }

  return changelogText;
}

// --- Main Script ---

async function main() {
  try {
    console.log("Starting mod bundle process...");

    const initialDistDir = 'dist'; // Temporary name for initial build output
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
      patchNumber = countCommitsSince(baseCommitForSeries);
    }
    const newVersion = `${major}.${minor}.${patchNumber}`;

    if (packageJson.version !== newVersion) {
      console.log(`Updating package.json version from ${currentVersion} to ${newVersion}`);
      packageJson.version = newVersion;
      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
      packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8'); // Re-read
      packageJson = JSON.parse(packageJsonContent) as PackageJson;
    } else {
      console.log(`package.json version ${currentVersion} is already up-to-date.`);
    }

    const modName = packageJson.name;
    const modVersion = packageJson.version; // Final version for naming
    const modAuthor = packageJson.author || 'Unknown Author';
    const modDescription = packageJson.description || 'No description provided.';
    const factorioConfig = packageJson.factorio || {};
    const factorioVersion = factorioConfig.factorio_version || DEFAULT_FACTORIO_VERSION;
    const title = factorioConfig.title || modName;

    // Construct dynamic build folder name
    const shortHash = getGitShortHash();
    const dirtySuffix = getGitDirtySuffix();
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
      name: modName, version: modVersion, title: title, author: modAuthor,
      factorio_version: factorioVersion, description: modDescription,
      contact: factorioConfig.contact, homepage: factorioConfig.homepage,
      dependencies: factorioConfig.dependencies || [`base >= ${factorioVersion}`],
      ...(factorioConfig.dlc || {}),
    };
    for (const key in infoJsonData) { if (infoJsonData[key as keyof InfoJson] === undefined) { delete infoJsonData[key as keyof InfoJson]; }}
    const infoJsonPathInInitialDist = path.resolve(initialDistDir, 'info.json');
    await fs.writeFile(infoJsonPathInInitialDist, JSON.stringify(infoJsonData, null, 2));
    console.log(`Generated info.json at ${infoJsonPathInInitialDist}`);

    // 3. Generate changelog.txt directly into initialDistDir
    const changelogBaseCommit = baseCommitForSeries;
    const changelogContent = getChangelog(changelogBaseCommit, newVersion);
    const changelogPathInInitialDist = path.resolve(initialDistDir, 'changelog.txt');
    await fs.writeFile(changelogPathInInitialDist, changelogContent);
    console.log(`Generated changelog.txt at ${changelogPathInInitialDist}`);

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