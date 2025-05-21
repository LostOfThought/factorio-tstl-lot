import fs from 'node:fs/promises';
import path from 'node:path';

// Type definitions (these should ideally be shared if used by multiple tools)
interface FactorioDlcRequirementsConfig {
  quality_required?: boolean;
  space_travel_required?: boolean;
  spoiling_required?: boolean;
  freezing_required?: boolean;
  segmented_units_required?: boolean;
  expansion_shaders_required?: boolean;
}

interface FactorioPackageConfig {
  factorio_version?: string;
  title?: string;
  contact?: string;
  homepage?: string;
  dependencies?: string[];
  dlc?: FactorioDlcRequirementsConfig;
}

interface AuthorObject {
  name?: string;
  email?: string;
  url?: string;
}

interface PackageJson {
  name: string;
  version: string;
  author?: string | AuthorObject;
  description: string;
  homepage?: string;
  bugs?: {
    url?: string;
    email?: string;
  } | string;
  factorio?: FactorioPackageConfig;
  [key: string]: any;
}

interface InfoJson {
  name: string;
  version: string;
  title: string;
  author: string;
  factorio_version: string;
  description: string;
  contact?: string;
  homepage?: string;
  dependencies?: string[];
  quality_required?: boolean;
  space_travel_required?: boolean;
  spoiling_required?: boolean;
  freezing_required?: boolean;
  segmented_units_required?: boolean;
  expansion_shaders_required?: boolean;
}

const DEFAULT_FACTORIO_VERSION = '1.1';

async function generateInfoJson(packageJsonPath: string, outputDir: string): Promise<void> {
  console.log(`Reading package.json from: ${packageJsonPath}`);
  const packageJsonContent = await fs.readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonContent) as PackageJson;

  const modName = packageJson.name;
  const modVersion = packageJson.version;

  console.log(`Generating info.json for: ${modName} v${modVersion}`);

  let authorString = 'Unknown Author';
  let contactString: string | undefined = undefined;

  if (typeof packageJson.author === 'object' && packageJson.author !== null) {
    const authorObj = packageJson.author;
    authorString = authorObj.name || authorString;
    contactString = authorObj.email;
  }
  else if (typeof packageJson.author === 'string') {
    authorString = packageJson.author;
  }

  if (!contactString && typeof packageJson.bugs === 'object' && packageJson.bugs !== null) {
    const bugsObj = packageJson.bugs as { url?: string; email?: string };
    contactString = bugsObj.email;
  }
  // Allow override from factorio config
  contactString = packageJson.factorio?.contact || contactString;

  const homepageString = packageJson.homepage || packageJson.factorio?.homepage;
  const modDescription = packageJson.description || 'No description provided.';
  const factorioConfig = packageJson.factorio || {};
  const factorioVersion = factorioConfig.factorio_version || DEFAULT_FACTORIO_VERSION;
  const title = factorioConfig.title || modName;

  const infoJsonData: InfoJson = {
    name: modName,
    version: modVersion,
    title: title,
    author: authorString,
    factorio_version: factorioVersion,
    description: modDescription,
    contact: contactString,
    homepage: homepageString,
    dependencies: factorioConfig.dependencies || [`base >= ${factorioVersion}`],
    ...factorioConfig.dlc,
  };

  // Clean up undefined optional fields from infoJsonData
  for (const key in infoJsonData) {
    if (infoJsonData[key as keyof InfoJson] === undefined) {
      delete infoJsonData[key as keyof InfoJson];
    }
  }

  await fs.mkdir(outputDir, { recursive: true }); // Ensure output directory exists
  const infoJsonOutputPath = path.resolve(outputDir, 'info.json');
  await fs.writeFile(infoJsonOutputPath, JSON.stringify(infoJsonData, null, 2));
  console.log(`Successfully generated info.json at ${infoJsonOutputPath}`);
}

async function run(): Promise<void> {
  const args = process.argv.slice(2); // Exclude 'node' and script path
  if (args.length < 2) {
    console.error('Usage: pnpm vite-node tools/generate-info-json.ts <path/to/package.json> <output/directory>');
    console.error('Example: pnpm vite-node tools/generate-info-json.ts ./package.json ./dist');
    process.exit(1);
  }
  const packageJsonPathArg = path.resolve(args[0]);
  const outputDirArg = path.resolve(args[1]);

  try {
    await generateInfoJson(packageJsonPathArg, outputDirArg);
  }
  catch (error) {
    console.error('Error during info.json generation:', error);
    process.exit(1);
  }
}

run();
