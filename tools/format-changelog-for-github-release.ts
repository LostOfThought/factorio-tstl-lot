import fs from 'fs/promises';
import path from 'path';

const changelogPath = path.resolve(process.cwd(), 'dist', 'changelog.txt');
const markdownChangelogPath = path.resolve(process.cwd(), 'dist', 'changelog.md');

async function formatChangelog() {
  try {
    const changelogContent = await fs.readFile(changelogPath, 'utf-8');
    const lines = changelogContent.split('\n');
    let markdownOutput = '';
    let currentVersionBlock: string[] = [];

    function processVersionBlock(block: string[]) {
      if (block.length === 0) return '';

      let version = '';
      let date = '';
      const categories: Record<string, string[]> = {};
      let currentCategory = '';

      block.forEach(line => {
        const versionMatch = line.match(/^Version: (.*)/);
        const dateMatch = line.match(/^Date: (.*)/);
        const categoryMatch = line.match(/^(\w+):$/); // Matches "Bugfixes:", "Features:", etc.
        const itemMatch = line.match(/^- (.*)/);

        if (versionMatch) {
          version = versionMatch[1];
        } else if (dateMatch) {
          date = dateMatch[1];
        } else if (categoryMatch) {
          currentCategory = categoryMatch[1];
          categories[currentCategory] = [];
        } else if (itemMatch && currentCategory) {
          categories[currentCategory].push(itemMatch[1]);
        } else if (line.trim() === '' && currentCategory) {
          // Potentially a blank line separating items, or end of category.
          // For now, we don't reset currentCategory on blank lines within a version block.
        }
      });

      if (!version) return ''; // Skip if no version found in block

      let blockMarkdown = `## Version ${version}${date ? ` (${date})` : ''}\n\n`;

      for (const category in categories) {
        if (categories[category].length > 0) {
          blockMarkdown += `### ${category}\n`;
          categories[category].forEach(item => {
            blockMarkdown += `* ${item}\n`;
          });
          blockMarkdown += '\n';
        }
      }
      return blockMarkdown + '---\n\n';
    }
    
    // Split into version blocks based on "Version: " prefix, handling the first block correctly
    const versionBlocksRaw = changelogContent.split(/\n(?=Version: )/);

    versionBlocksRaw.forEach(blockText => {
      markdownOutput += processVersionBlock(blockText.trim().split('\n'));
    });

    await fs.writeFile(markdownChangelogPath, markdownOutput.trim());
    console.log(`Successfully formatted changelog to Markdown: ${markdownChangelogPath}`);

  } catch (error) {
    console.error('Error formatting changelog:', error);
    process.exit(1);
  }
}

formatChangelog(); 