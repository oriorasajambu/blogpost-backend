import { prepareBuild, writeNativeProvenance } from './prepare.mjs';
try {
  const build = await prepareBuild(process.cwd());
  await writeNativeProvenance(process.cwd(), build.provenance);
  process.stdout.write('Prepared native Development build metadata.\n');
} catch {
  process.stderr.write('{"event":"native_build_metadata_failed"}\n');
  process.exitCode = 1;
}
