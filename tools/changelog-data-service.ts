import { execSync } from 'child_process';

// --- Types for Structured Changelog Data ---
export type CommitMessage = {
  scope?: string;
  message: string;
  body: string;
};

export type CategorizedCommits = {
  [category: string]: CommitMessage[];
};

export type VersionInfo = {
  hash: string; // Commit hash where this version was defined
  version: string;
  date: string; // Date of the version commit
};

export type VersionEntry = {
  version: string;
  date: string;      // Date for this version section (could be version commit date or today for current work)
  isCurrentWork?: boolean; // Flag if this entry represents unreleased work on current version
  categories: CategorizedCommits;
};

// --- Git Helper & Constants ---
function getGitCommandOutput(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch (error) {
    // console.warn(`Git command failed: ${command}`, error.status, error.message);
    return "ERROR_EXECUTING_GIT_COMMAND";
  }
}

const conventionalCommitRegex = /^(\w+)(?:\(([^\)]+)\))?(!?): (.*)$/;
const versionCommitRegex = /^chore: Update version to (\d+\.\d+\.\d+)$/;

// This mapping is core to categorizing commits based on conventional types.
export const commitTypeToFactorioCategory: { [key: string]: string } = {
  feat: "Features",
  fix: "Bugfixes",
  perf: "Optimizations",
  docs: "Info",
  style: "Changes",  // Example: factorioCategoryOrder might be specific to txt output
  refactor: "Changes",
  test: "Changes",
  chore: "Changes", 
  build: "Changes",
  ci: "Changes",
  revert: "Changes",
};

// --- Core Data Generation Functions ---

/**
 * Parses raw commit messages from a git log range into categorized commit messages.
 * Filters out version bump commits.
 */
function getCategorizedCommitMessages(commitRange: string): CategorizedCommits {
    const commitSeparator = "----GIT_COMMIT_SEPARATOR----";
    const fieldSeparator = "----GIT_FIELD_SEPARATOR----";
    const gitLogFormat = `--pretty=format:%H${fieldSeparator}%s${fieldSeparator}%b${commitSeparator}`;
    const gitLogCommand = `git log ${gitLogFormat} ${commitRange}`;

    const rawLog = getGitCommandOutput(gitLogCommand);
    if (!rawLog || rawLog === "ERROR_EXECUTING_GIT_COMMAND") return {};

    const commits = rawLog.split(commitSeparator).filter(c => c.trim() !== "");
    const categorizedResult: CategorizedCommits = {};

    for (const commit of commits) {
        const parts = commit.split(fieldSeparator);
        if (parts.length < 2) continue;
        const subject = parts[1] ? parts[1].trim() : "";
        const body = parts[2] ? parts[2].trim() : "";

        if (versionCommitRegex.test(subject)) {
             continue; // Skip version bump commits
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

        if (!categorizedResult[category]) {
            categorizedResult[category] = [];
        }
        categorizedResult[category].push({ scope, message, body });
    }
    return categorizedResult;
}

/**
 * Finds commits where the version in package.json changed.
 * Returns them sorted newest first.
 */
async function findVersionChangeCommits(): Promise<VersionInfo[]> {
    const versionChanges: VersionInfo[] = [];
    try {
        const commitsTouchingPackageJson = getGitCommandOutput(`git log --pretty=format:"%H----%cs" --follow --reverse -- package.json`).split('\n').filter(Boolean);
        
        if (!commitsTouchingPackageJson || commitsTouchingPackageJson.length === 0 || commitsTouchingPackageJson[0] === "ERROR_EXECUTING_GIT_COMMAND") {
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
                    versionChanges.push({ hash: commitHash, version: versionAtCommit, date: commitDate });
                    previousCommitVersion = versionAtCommit;
                }
            }
             else {
                 previousCommitVersion = null; 
            }
        }
    } catch (error) {
        console.warn("Error scanning for version changes:", error);
    }
    return versionChanges.reverse(); // Newest first
}

/**
 * Generates a structured list of version entries for the changelog.
 * Each entry contains categorized commits for that version.
 */
export async function generateChangelogDataStructure(
    currentModVersion: string, 
    versionWasJustUpdatedByScript: boolean
): Promise<VersionEntry[]> {
    const structuredChangelog: VersionEntry[] = [];
    const todayDate = new Date().toISOString().split('T')[0];

    try {
        const versionChangeCommits = await findVersionChangeCommits(); // Newest first

        // Handle unreleased work on the current version if it wasn't just bumped
        if (!versionWasJustUpdatedByScript && versionChangeCommits.length > 0) {
            const latestVersionOnRecord = versionChangeCommits[0];
            // Check if currentModVersion matches the latest version commit found
            if (latestVersionOnRecord.version === currentModVersion) {
                const rangeForNewWork = `${latestVersionOnRecord.hash}..HEAD`;
                const newWorkCategories = getCategorizedCommitMessages(rangeForNewWork);
                if (Object.keys(newWorkCategories).some(cat => newWorkCategories[cat].length > 0)) {
                    structuredChangelog.push({
                        version: currentModVersion,
                        date: todayDate,
                        isCurrentWork: true,
                        categories: newWorkCategories
                    });
                }
            }
        } else if (!versionWasJustUpdatedByScript && versionChangeCommits.length === 0) {
            // No version history in package.json, treat all commits as for the current version
            const allCommitsAsCurrentWork = getCategorizedCommitMessages("HEAD");
            if (Object.keys(allCommitsAsCurrentWork).some(cat => allCommitsAsCurrentWork[cat].length > 0)) {
                structuredChangelog.push({
                    version: currentModVersion,
                    date: todayDate,
                    isCurrentWork: true,
                    categories: allCommitsAsCurrentWork
                });
            }
        }

        // Process historical versions based on package.json version change commits
        for (let i = 0; i < versionChangeCommits.length; i++) {
            const versionCommitInfo = versionChangeCommits[i];
            const previousVersionCommitInfo = versionChangeCommits[i + 1];
            const previousVersionCommitHash = previousVersionCommitInfo ? previousVersionCommitInfo.hash : null;

            let rangeForThisVersionEntries = previousVersionCommitHash 
                ? `${previousVersionCommitHash}..${versionCommitInfo.hash}` 
                : versionCommitInfo.hash; // Commits up to and including the first version tag
            
            const categoriesForVersion = getCategorizedCommitMessages(rangeForThisVersionEntries);
            
            // Add this version's section if it has categorized commits or if it's the version that was just set
            const isTheVersionJustSetByScript = versionWasJustUpdatedByScript && 
                                                 i === 0 && 
                                                 versionCommitInfo.version === currentModVersion;

            if (Object.keys(categoriesForVersion).some(cat => categoriesForVersion[cat].length > 0) || isTheVersionJustSetByScript) {
                structuredChangelog.push({
                    version: versionCommitInfo.version,
                    date: versionCommitInfo.date,
                    categories: categoriesForVersion
                });
            }
        }
    } catch (error) {
        console.error("Error generating changelog data structure:", error);
        // Return empty or partial data, or rethrow, depending on desired error handling
    }
    return structuredChangelog;
}

// --- Functions for Single Release Notes (GitHub Release style) ---

export function getPreviousTag(currentTag: string): string | undefined {
  try {
    // First, try to get the immediate parent commit of the tag and describe it.
    // This is often the most reliable way to find the tag on the main line of development before this one.
    const parentOfCurrentTagCommit = getGitCommandOutput(`git rev-parse ${currentTag}^1`); // ^1 ensures first parent
    if (parentOfCurrentTagCommit.startsWith('ERROR_')) {
        console.warn(`Could not get parent commit of tag ${currentTag}.`);
        // Fallback if tag has no direct parent (e.g., orphan tag or very first commit tag)
        // or if it's an annotated tag pointing to a commit that has other tags.
    } else {
        const previousTagAttempt = getGitCommandOutput(`git describe --tags --abbrev=0 ${parentOfCurrentTagCommit}`);
        if (!previousTagAttempt.startsWith('ERROR_') && previousTagAttempt !== currentTag) {
            console.log(`Found previous tag ${previousTagAttempt} by describing parent of ${currentTag}`);
            return previousTagAttempt;
        }
    }

    // Fallback: List all tags sorted by version and find the one before currentTag.
    // This assumes semver-like tags (e.g., v1.0.0, v1.2.3)
    // Use --sort=-v:refname for reverse chronological sort (newest first by version part of tag name)
    console.log(`Falling back to sorted tag list to find previous tag for ${currentTag}`);
    const allTagsRaw = getGitCommandOutput(`git tag --sort=-v:refname`);
    if (allTagsRaw.startsWith('ERROR_')) {
        console.warn('Could not list git tags.');
        return undefined;
    }
    const allTags = allTagsRaw.split('\n').filter(t => t.trim() !== '');
    const currentIndex = allTags.indexOf(currentTag);

    if (currentIndex !== -1 && currentIndex + 1 < allTags.length) {
        const prevTag = allTags[currentIndex + 1];
        console.log(`Found previous tag ${prevTag} from sorted list for ${currentTag}`);
        return prevTag;
    }
    console.log(`No previous tag found in sorted list for ${currentTag}. This might be the first tag.`);
    return undefined;
  } catch (e) {
    console.warn(`Error finding previous tag for ${currentTag}:`, e);
    return undefined;
  }
}

export async function generateSingleReleaseNotesData(
    currentTag: string,
    previousTag?: string
): Promise<VersionEntry | null> {
    const commitRange = previousTag ? `${previousTag}..${currentTag}` : currentTag;
    console.log(`Generating release notes data for git commit range: ${commitRange}`);
    
    const categories = getCategorizedCommitMessages(commitRange);
    // If previousTag is undefined (first release), and no commits found for currentTag (e.g. initial tag on empty repo or only version commit), return null.
    if (Object.keys(categories).length === 0 && previousTag) {
      console.log(`No user commits found in range ${commitRange}. Release notes might be minimal if only version commit exists.`);
      // Still proceed to create an entry if it's the first tag, could have a default message or just version/date.
    }
    if (Object.keys(categories).length === 0 && !previousTag && !versionCommitRegex.test(getGitCommandOutput(`git log -1 --pretty=%s ${currentTag}`))){
      // Truly no commits for the first tag except maybe the version commit itself.
      console.log(`No user commits found for the initial tag ${currentTag}.`);
      // Return a minimal entry just with version and date if desired, or null
      // Let's return null to indicate no substantial changes to list for now.
      // Or, provide a default message in the formatter if this returns null.
      // For now, if no categories, no entry.
       if (Object.keys(categories).length === 0) return null;
    }


    let tagDate = new Date().toISOString().split('T')[0]; // Default to today
    try {
        const dateStr = getGitCommandOutput(`git log -1 --format=%cs ${currentTag}`);
        if (!dateStr.startsWith('ERROR_') && dateStr.trim() !== '') {
            tagDate = dateStr.trim();
        }
    } catch (e) { 
        console.warn(`Could not get date for tag ${currentTag}, using today. Error: ${e}`);
    }

    return {
        version: currentTag.startsWith('v') ? currentTag.substring(1) : currentTag,
        date: tagDate,
        categories: categories,
        isCurrentWork: false // This is for a specific release tag
    };
} 