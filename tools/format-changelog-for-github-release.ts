import fs from 'node:fs/promises';
import path from 'node:path';

import {
  getPreviousTag,
  generateSingleReleaseNotesData,
  type VersionEntry,
} from './changelog-data-service';
import { getGitCommandOutput } from './git-utils';

// Output paths
const markdownChangelogPath = path.resolve(process.cwd(), 'dist', 'changelog.md');

function formatSingleEntryToMarkdown(entry: VersionEntry | null): string {
  if (!entry) {
    return 'No specific changes documented for this release (or no commits found since last tag).\n';
  }
  let markdownOutput = '';
  // GitHub Release title usually doesn't repeat "Version X.Y.Z" if the release is already named that.
  // So, we'll focus on the categories and date.
  // markdownOutput += `## Version ${entry.version}${entry.date ? ` (${entry.date})` : ''}\n\n`;
  if (entry.date) {
    markdownOutput += `_Release Date: ${entry.date}_\n\n`;
  }

  const categoriesInEntry = Object.keys(entry.categories);
  categoriesInEntry.sort();

  let hasContent = false;
  for (const categoryName of categoriesInEntry) {
    if (entry.categories[categoryName] && entry.categories[categoryName].length > 0) {
      hasContent = true;
      markdownOutput += `### ${categoryName}\n`;
      for (const commitMsg of entry.categories[categoryName]) {
        markdownOutput += `* ${commitMsg.scope ? `**${commitMsg.scope}:** ` : ''}${commitMsg.message}\n`;
        if (commitMsg.body) {
          for (const bodyLine of commitMsg.body.split('\n')) {
            if (bodyLine.trim() !== '') {
              markdownOutput += `  * _${bodyLine}_\n`;
            }
          }
        }
      }
      markdownOutput += '\n';
    }
  }

  if (!hasContent) {
    markdownOutput += 'No specific categorized changes found for this release.\n';
  }
  // markdownOutput += '---\n\n'; // Separator might not be needed if it's just one release section
  return markdownOutput.trim();
}

function getLatestTagLocally(): string | undefined {
  try {
    const latestTag = getGitCommandOutput('git', ['describe', '--tags', '--abbrev=0']);
    if (latestTag.startsWith('ERROR_')) {
      console.warn('Could not determine latest tag locally via getGitCommandOutput.');
      return undefined;
    }
    return latestTag;
  }
  catch (error) {
    console.warn('Error in getLatestTagLocally:', (error as Error).message);
    return undefined;
  }
}

async function run(): Promise<void> {
  let currentTag: string | undefined = process.env.GITHUB_REF_NAME; // e.g., refs/tags/v1.0.0
  const args = process.argv.slice(2);

  if (currentTag?.startsWith('refs/tags/')) {
    currentTag = currentTag.slice('refs/tags/'.length);
    console.log(`Using current tag from GITHUB_REF_NAME: ${currentTag}`);
  }
  else if (args.length > 0 && args[0].startsWith('v')) {
    currentTag = args[0];
    console.log(`Using current tag from argument: ${currentTag}`);
  }
  else {
    currentTag = getLatestTagLocally();
    if (currentTag) {
      console.log(`Using latest local tag: ${currentTag}`);
    }
    else {
      console.error('Error: Could not determine the current tag for release notes.');
      console.error('Please provide as argument, or ensure GITHUB_REF_NAME is set, or local tags exist.');
      process.exit(1);
    }
  }

  if (!currentTag) { // Should be caught above, but as a safeguard.
    console.error('Current tag could not be determined.');
    process.exit(1);
  }

  try {
    console.log(`Generating GitHub Release notes for tag: ${currentTag}`);
    const previousTag = getPreviousTag(currentTag);
    if (previousTag) {
      console.log(`Determined previous tag: ${previousTag}`);
    }
    else {
      console.log('No previous tag found, treating as first release.');
    }

    const releaseData: VersionEntry | null = await generateSingleReleaseNotesData(
      currentTag,
      previousTag,
    );

    console.log('Formatting changelog data to Markdown...');
    const markdownContent = formatSingleEntryToMarkdown(releaseData);

    await fs.mkdir(path.dirname(markdownChangelogPath), { recursive: true });
    await fs.writeFile(markdownChangelogPath, markdownContent);
    console.log(`Successfully formatted changelog for GitHub Release: ${markdownChangelogPath}`);
  }
  catch (error) {
    console.error('Error formatting changelog for GitHub release:', error);
    process.exit(1);
  }
}

run();
