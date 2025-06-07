// eslint-disable-next-line import-x/no-internal-modules -- We need this
import { FlatESLint } from 'eslint/use-at-your-own-risk';

const eslint = new FlatESLint({
  useEslintrc: false,
  overrideConfigFile: __dirname + '/../eslint.config.ts',
});

const rules = await eslint.calculateConfigForFile(__dirname + '/../eslint.config.ts');

console.log(rules);