import fs from 'node:fs/promises';
import path from 'node:path';

import {
  generateChangelogDataStructure,
  type VersionEntry,
  type CategorizedCommits, // Import if needed by formatter logic directly
  // commitTypeToFactorioCategory, // This mapping is in the data service
} from './changelog-data-service';

// Factorio-specific formatting constants
const factorioCategoryOrder: string[] = [
  'Major Features', 'Features', 'Minor Features', 'Graphics', 'Sounds',
  'Optimizations', 'Balancing', 'Combat Balancing', 'Circuit Network',
  'Changes', 'Bugfixes', 'Modding', 'Scripting', 'Gui', 'Control',
  'Translation', 'Debug', 'Ease of use', 'Info', 'Locale',
];

function formatSingleVersionEntryToText(entry: VersionEntry): string {
  let sectionText = '';
  sectionText += '-'.repeat(99) + '\n';
  sectionText += `Version: ${entry.version}\n`;
  sectionText += `Date: ${entry.date}\n`;

  let hasCategorizedEntries = false;
  for (const categoryName of factorioCategoryOrder) {
    if (entry.categories[categoryName] && entry.categories[categoryName].length > 0) {
      hasCategorizedEntries = true;
      sectionText += `  ${categoryName}:\n`;
      for (const commitMsg of entry.categories[categoryName]) {
        sectionText += `    - ${commitMsg.scope ? `(${commitMsg.scope}) ` : ''}${commitMsg.message}\n`;
        if (commitMsg.body) {
          for (const bodyLine of commitMsg.body.split('\n')) {
            if (bodyLine.trim() !== '') {
              sectionText += `      ${bodyLine}\n`;
            }
          }
        }
      }
    }
  }

  // Handle any categories not in factorioCategoryOrder (e.g. default "Changes" if type unknown)
  for (const categoryName in entry.categories) {
    if (!factorioCategoryOrder.includes(categoryName) && entry.categories[categoryName].length > 0) {
      hasCategorizedEntries = true;
      sectionText += `  ${categoryName}:\n`;
      for (const commitMsg of entry.categories[categoryName]) {
        sectionText += `    - ${commitMsg.scope ? `(${commitMsg.scope}) ` : ''}${commitMsg.message}\n`;
        if (commitMsg.body) {
          for (const bodyLine of commitMsg.body.split('\n')) {
            if (bodyLine.trim() !== '') {
              sectionText += `      ${bodyLine}\n`;
            }
          }
        }
      }
    }
  }

  if (!hasCategorizedEntries) {
    sectionText += '  Changes:\n    - No specific changes documented for this version (or commits did not follow conventional format).\n';
  }
  return sectionText;
}

function formatChangelogDataToFactorioText(changelogData: VersionEntry[]): string {
  return changelogData.map(entry => formatSingleVersionEntryToText(entry)).join('');
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: pnpm vite-node tools/generate-changelog-txt.ts <currentModVersion> <versionWasJustUpdatedByScript (true|false)> <output/directory>');
    console.error('Example: pnpm vite-node tools/generate-changelog-txt.ts 1.2.3 false ./dist');
    process.exit(1);
  }
  const currentModVersionArg = args[0];
  const versionWasJustUpdatedArg = args[1].toLowerCase() === 'true';
  const outputDirArg = path.resolve(args[2]);

  try {
    console.log(`Generating changelog.txt data for version ${currentModVersionArg} (version updated by script: ${versionWasJustUpdatedArg})`);
    const changelogData: VersionEntry[] = await generateChangelogDataStructure(
      currentModVersionArg,
      versionWasJustUpdatedArg,
    );

    console.log(`Formatting changelog data to Factorio .txt format...`);
    const factorioChangelogText = formatChangelogDataToFactorioText(changelogData);

    await fs.mkdir(outputDirArg, { recursive: true });
    const changelogPath = path.resolve(outputDirArg, 'changelog.txt');
    await fs.writeFile(changelogPath, factorioChangelogText);
    console.log(`Successfully generated changelog.txt at ${changelogPath}`);
  }
  catch (error) {
    console.error('Error during changelog.txt generation:', error);
    process.exit(1);
  }
}

run();
