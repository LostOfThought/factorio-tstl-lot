import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';

/**
 * Executes a Git command and returns its trimmed output.
 * Returns a specific error string if the command fails.
 */
export function getGitCommandOutput(baseCommand: string, args: string[], allowError = false): string {
  try {
    const result: SpawnSyncReturns<string> = spawnSync(baseCommand, args, { encoding: 'utf8' });

    if (result.error) {
      if (allowError) return 'ERROR_SPAWN_FAILED';
      console.warn(`Execution error with command: ${baseCommand} ${args.join(' ')}`, result.error.message);
      return 'ERROR_SPAWN_FAILED';
    }

    if (result.status !== 0) {
      if (allowError) return 'ERROR_COMMAND_FAILED_NON_ZERO_EXIT';
      console.warn(`Command failed: ${baseCommand} ${args.join(' ')}, Exit code: ${result.status}`, result.stderr?.toString().trim());
      return 'ERROR_COMMAND_FAILED_NON_ZERO_EXIT';
    }

    return result.stdout.toString().trim();
  }
  catch (error) { // This catch is more for unexpected errors during the spawnSync call itself
    if (allowError) return 'ERROR_UNEXPECTED_DURING_SPAWN';
    console.warn(`Unexpected error executing git command: ${baseCommand} ${args.join(' ')}`, (error as Error).message);
    return 'ERROR_UNEXPECTED_DURING_SPAWN';
  }
}

/**
 * Gets the short hash of the current Git HEAD.
 */
export function getGitShortHash(): string {
  const hash = getGitCommandOutput('git', ['rev-parse', '--short', 'HEAD']);
  return hash.startsWith('ERROR_') ? 'unknownhash' : hash; // Simplified error check
}

/**
 * Returns '-dirty' if the Git working directory has uncommitted changes or untracked files, otherwise empty string.
 */
export function getGitDirtySuffix(): string {
  const statusOutput = getGitCommandOutput('git', ['status', '--porcelain']);
  if (statusOutput && !statusOutput.startsWith('ERROR_')) { // Simplified error check
    return '-dirty';
  }
  return '';
}

/**
 * Tries to find the Git tag that precedes the given currentTag.
 */
export function getPreviousTag(currentTag: string): string | undefined {
  try {
    const parentOfCurrentTagCommit = getGitCommandOutput('git', ['rev-parse', `${currentTag}^1`], true); // Allow error for rev-parse
    if (!parentOfCurrentTagCommit.startsWith('ERROR_')) {
      const previousTagAttempt = getGitCommandOutput('git', ['describe', '--tags', '--abbrev=0', parentOfCurrentTagCommit], true);
      if (!previousTagAttempt.startsWith('ERROR_') && previousTagAttempt !== currentTag) {
        console.log(`Found previous tag ${previousTagAttempt} by describing parent of ${currentTag}`);
        return previousTagAttempt;
      }
    }
    console.log(`Falling back to sorted tag list to find previous tag for ${currentTag}`);
    const allTagsRaw = getGitCommandOutput('git', ['tag', '--sort=-v:refname']);
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
  }
  catch (error) {
    console.warn(`Error finding previous tag for ${currentTag}:`, (error as Error).message);
    return undefined;
  }
}

/**
 * Gets the commit hash of the current HEAD.
 */
export function getCurrentCommitHash(): string | undefined {
  const hash = getGitCommandOutput('git', ['rev-parse', 'HEAD']);
  return hash.startsWith('ERROR_') ? undefined : hash;
}

/**
 * Gets the date of a specific commit or tag.
 * @param ref Commit hash or tag name
 * @returns Date string (YYYY-MM-DD) or undefined if not found.
 */
export function getGitRefDate(ref: string): string | undefined {
  const dateStr = getGitCommandOutput('git', ['log', '-1', '--format=%cs', ref]);
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
  const tagCommit = getGitCommandOutput('git', ['rev-parse', `refs/tags/${tagName}`], true);
  return tagCommit.startsWith('ERROR_') ? undefined : tagCommit;
}

// --- Git Action Functions ---

/**
 * Stages a file.
 * @throws If git add fails.
 */
export function gitAdd(filePath: string): void {
  console.log(`Staging file: ${filePath}...`);
  const result = getGitCommandOutput('git', ['add', path.resolve(filePath)]);
  if (result.startsWith('ERROR_')) {
    throw new Error(`Failed to stage file ${filePath}. Output: ${result}`);
  }
  console.log('File staged.');
}

/**
 * Commits staged changes.
 * @throws If git commit fails.
 */
export function gitCommit(message: string): void {
  console.log(`Committing with message: "${message}"...`);
  const result = getGitCommandOutput('git', ['commit', '-m', message]);
  if (result.startsWith('ERROR_')) {
    throw new Error(`Failed to commit. Output: ${result}`);
  }
  console.log('Commit successful.');
}

/**
 * Pushes commits to a remote.
 * @throws If git push fails.
 */
export function gitPush(remote = 'origin', branch = 'HEAD'): void {
  console.log(`Pushing ${branch} to ${remote}...`);
  const result = getGitCommandOutput('git', ['push', '-u', remote, branch]);
  if (result.startsWith('ERROR_')) {
    throw new Error(`Failed to push to ${remote} ${branch}. Output: ${result}`);
  }
  console.log('Push successful.');
}

/**
 * Creates a Git tag.
 * @throws If git tag fails.
 */
export function gitCreateTag(tagName: string, message?: string, force = false): void {
  console.log(`Creating tag ${tagName}${force ? ' (forcing)' : ''}...`);
  const args = ['tag'];
  if (force) args.push('-f');
  if (message) {
    args.push('-a', tagName, '-m', message);
  }
  else {
    args.push(tagName);
  }

  const result = getGitCommandOutput('git', args);
  if (result.startsWith('ERROR_')) {
    throw new Error(`Failed to create tag ${tagName}. Output: ${result}`);
  }
  console.log(`Tag ${tagName} created.`);
}

/**
 * Pushes a specific tag to a remote.
 * @throws If git push tag fails.
 */
export function gitPushTag(tagName: string, remote = 'origin'): void {
  console.log(`Pushing tag ${tagName} to ${remote}...`);
  const result = getGitCommandOutput('git', ['push', remote, tagName]);
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
  const result = getGitCommandOutput('git', ['tag', '-d', tagName]);
  if (result.startsWith('ERROR_')) {
    throw new Error(`Failed to delete local tag ${tagName}. Output: ${result}`);
  }
  console.log(`Local tag ${tagName} deleted.`);
}
