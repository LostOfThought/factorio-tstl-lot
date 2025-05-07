import { execSync } from 'child_process';
import path from 'path';

/**
 * Executes a Git command and returns its trimmed output.
 * Returns a specific error string if the command fails.
 */
export function getGitCommandOutput(command: string, allowError: boolean = false): string {
  try {
    return execSync(command, { encoding: 'utf8' }).trim();
  } catch (error) {
    if (allowError) {
        // When allowed, return empty or a marker but don't log full error here,
        // let the caller decide based on context.
        // For now, still returning the marker for consistency with existing code.
        return "ERROR_EXECUTING_GIT_COMMAND"; 
    }
    console.warn(`Git command failed: ${command}`, (error as any).status, (error as any).message);
    return "ERROR_EXECUTING_GIT_COMMAND";
  }
}

/**
 * Gets the short hash of the current Git HEAD.
 */
export function getGitShortHash(): string {
  const hash = getGitCommandOutput('git rev-parse --short HEAD');
  return hash === "ERROR_EXECUTING_GIT_COMMAND" ? "unknownhash" : hash;
}

/**
 * Returns '-dirty' if the Git working directory has uncommitted changes or untracked files, otherwise empty string.
 */
export function getGitDirtySuffix(): string {
  const statusOutput = getGitCommandOutput('git status --porcelain');
  if (statusOutput && statusOutput !== "ERROR_EXECUTING_GIT_COMMAND") {
    return '-dirty';
  }
  return '';
}

/**
 * Tries to find the Git tag that precedes the given currentTag.
 */
export function getPreviousTag(currentTag: string): string | undefined {
  try {
    const parentOfCurrentTagCommit = getGitCommandOutput(`git rev-parse ${currentTag}^1`, true); // Allow error for rev-parse
    if (!parentOfCurrentTagCommit.startsWith('ERROR_')) {
        const previousTagAttempt = getGitCommandOutput(`git describe --tags --abbrev=0 ${parentOfCurrentTagCommit}`, true);
        if (!previousTagAttempt.startsWith('ERROR_') && previousTagAttempt !== currentTag) {
            console.log(`Found previous tag ${previousTagAttempt} by describing parent of ${currentTag}`);
            return previousTagAttempt;
        }
    }
    // Fallback if parent describe failed or wasn't conclusive
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

/**
 * Gets the commit hash of the current HEAD.
 */
export function getCurrentCommitHash(): string | undefined {
    const hash = getGitCommandOutput('git rev-parse HEAD');
    return hash.startsWith('ERROR_') ? undefined : hash;
}

/**
 * Gets the date of a specific commit or tag.
 * @param ref Commit hash or tag name
 * @returns Date string (YYYY-MM-DD) or undefined if not found.
 */
export function getGitRefDate(ref: string): string | undefined {
    const dateStr = getGitCommandOutput(`git log -1 --format=%cs ${ref}`);
    if (!dateStr.startsWith('ERROR_') && dateStr.trim() !== '') {
        return dateStr.trim();
    }
    console.warn(`Could not get date for ref ${ref}`);
    return undefined;
}

/**
 * Checks if a local tag exists.
 */
export function getLocalTagCommit(tagName: string): string | undefined {
    const tagCommit = getGitCommandOutput(`git rev-parse refs/tags/${tagName}`, true);
    return tagCommit.startsWith('ERROR_') ? undefined : tagCommit;
}

// --- Git Action Functions ---

/**
 * Stages a file.
 * @throws If git add fails.
 */
export function gitAdd(filePath: string): void {
  console.log(`Staging file: ${filePath}...`);
  const result = getGitCommandOutput(`git add "${path.resolve(filePath)}"`); // Use absolute path for safety
  if (result.startsWith('ERROR_')) {
    throw new Error(`Failed to stage file ${filePath}. Output: ${result}`);
  }
  console.log("File staged.");
}

/**
 * Commits staged changes.
 * @throws If git commit fails.
 */
export function gitCommit(message: string): void {
  console.log(`Committing with message: "${message}"...`);
  // Need to escape quotes in the message if execSync passes it through a shell
  const escapedMessage = message.replace(/"/g, '\\"');
  const result = getGitCommandOutput(`git commit -m "${escapedMessage}"`);
  if (result.startsWith('ERROR_')) {
    // 'git commit' can return output even on success, or specific error messages.
    // A more robust check might be needed if `getGitCommandOutput` doesn't throw on non-zero exit for commits.
    // However, getGitCommandOutput is designed to return ERROR_EXECUTING_GIT_COMMAND or throw.
    throw new Error(`Failed to commit. Output: ${result}`);
  }
  console.log("Commit successful.");
}

/**
 * Pushes commits to a remote.
 * @throws If git push fails.
 */
export function gitPush(remote: string = 'origin', branch: string = 'HEAD'): void {
  console.log(`Pushing ${branch} to ${remote}...`);
  const result = getGitCommandOutput(`git push -u ${remote} ${branch}`);
  if (result.startsWith('ERROR_')) {
    throw new Error(`Failed to push to ${remote} ${branch}. Output: ${result}`);
  }
  console.log("Push successful.");
}

/**
 * Creates a Git tag.
 * @throws If git tag fails.
 */
export function gitCreateTag(tagName: string, message?: string, force: boolean = false): void {
  console.log(`Creating tag ${tagName}${force ? ' (forcing)' : ''}...`);
  let tagCommand = 'git tag';
  if (force) tagCommand += ' -f';
  if (message) tagCommand += ` -a "${tagName}" -m "${message.replace(/"/g, '\\"')}"`;
  else tagCommand += ` "${tagName}"`;
  
  const result = getGitCommandOutput(tagCommand);
  if (result.startsWith('ERROR_')) {
    throw new Error(`Failed to create tag ${tagName}. Output: ${result}`);
  }
  console.log(`Tag ${tagName} created.`);
}

/**
 * Pushes a specific tag to a remote.
 * @throws If git push tag fails.
 */
export function gitPushTag(tagName: string, remote: string = 'origin'): void {
  console.log(`Pushing tag ${tagName} to ${remote}...`);
  const result = getGitCommandOutput(`git push ${remote} "${tagName}"`);
  if (result.startsWith('ERROR_')) {
    throw new Error(`Failed to push tag ${tagName} to ${remote}. Output: ${result}`);
  }
  console.log(`Tag ${tagName} pushed to ${remote}.`);
}

/**
 * Deletes a local Git tag.
 * @throws If git tag -d fails.
 */
export function gitDeleteLocalTag(tagName: string): void {
  console.log(`Deleting local tag ${tagName}...`);
  const result = getGitCommandOutput(`git tag -d "${tagName}"`);
  if (result.startsWith('ERROR_')) {
    // Deleting a non-existent tag might be considered an error by git but okay for us.
    // Check output more carefully if needed. For now, strict error.
    throw new Error(`Failed to delete local tag ${tagName}. Output: ${result}`);
  }
  console.log(`Local tag ${tagName} deleted.`);
} 