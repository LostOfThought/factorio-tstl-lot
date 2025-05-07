import fs from 'fs/promises';
import path from 'path';

const changelogPath = path.resolve(process.cwd(), 'dist', 'changelog.txt');
const markdownChangelogPath = path.resolve(process.cwd(), 'dist', 'changelog.md');

async function formatChangelog() {
  try {
    const changelogContent = await fs.readFile(changelogPath, 'utf-8');
    let markdownOutput = '';

    // Split into version blocks based on the hyphen separator line
    // and filter out any empty blocks that might result from multiple separators.
    const versionBlocksRaw = changelogContent
      .split(/\n?---------------------------------------------------------------------------------------------------\n?/)
      .filter(block => block.trim() !== '');

    versionBlocksRaw.forEach(blockText => {
      const lines = blockText.trim().split('\n');
      if (lines.length === 0) return;

      let version = '';
      let date = '';
      const categories: Record<string, string[]> = {};
      let currentCategory = '';

      lines.forEach(line => {
        const versionMatch = line.match(/^Version: (.*)/);
        const dateMatch = line.match(/^Date: (.*)/);
        // Categories are indented by 2 spaces, e.g., "  Bugfixes:"
        const categoryMatch = line.match(/^  (\w+):$/);
        // Items are indented by 4 spaces, e.g., "    - (ci) ..."
        const itemMatch = line.match(/^    - (.*)/);

        if (versionMatch) {
          version = versionMatch[1];
        } else if (dateMatch) {
          date = dateMatch[1];
        } else if (categoryMatch) {
          currentCategory = categoryMatch[1];
          categories[currentCategory] = [];
        } else if (itemMatch && currentCategory) {
          categories[currentCategory].push(itemMatch[1]);
        }
      });

      if (!version) return; // Skip if no version found in block (e.g., empty block after split)

      markdownOutput += `## Version ${version}${date ? ` (${date})` : ''}\n\n`;

      for (const category in categories) {
        if (categories[category].length > 0) {
          markdownOutput += `### ${category}\n`;
          categories[category].forEach(item => {
            markdownOutput += `* ${item}\n`;
          });
          markdownOutput += '\n';
        }
      }
      markdownOutput += '---\n\n';
    });

    await fs.writeFile(markdownChangelogPath, markdownOutput.trim());
    console.log(`Successfully formatted changelog to Markdown: ${markdownChangelogPath}`);

  } catch (error) {
    console.error('Error formatting changelog:', error);
    process.exit(1);
  }
}

formatChangelog(); 
formatChangelog(); 