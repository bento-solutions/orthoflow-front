// Writes the nginx config for one build configuration to stdout.
//
// The Content-Security-Policy's connect-src has to name the API origin the
// bundle calls, and that origin is baked into the bundle from the
// configuration's environment file (angular.json fileReplacements). Reading it
// from there means the two cannot drift apart: an enforced policy naming the
// wrong origin blocks every API call, which is what a hard-coded production
// origin would have done to the parity build.
//
//   node tools/render-nginx-conf.mjs <configuration> > default.conf
import { readFileSync } from 'node:fs';

const configuration = process.argv[2] ?? 'production';
const angular = JSON.parse(readFileSync('angular.json', 'utf8'));
const project = Object.values(angular.projects)[0];
const replacements = project.architect.build.configurations[configuration]?.fileReplacements ?? [];
const environmentFile = replacements.find(r => r.replace.endsWith('environment.ts'))?.with ?? 'src/environments/environment.ts';
const apiUrl = readFileSync(environmentFile, 'utf8').match(/apiUrl:\s*'([^']+)'/)?.[1];
if (!apiUrl) {
  console.error(`No apiUrl in ${environmentFile}`);
  process.exit(1);
}
const origin = new URL(apiUrl).origin;
process.stdout.write(readFileSync('nginx.conf', 'utf8').replaceAll('__API_ORIGIN__', origin));
