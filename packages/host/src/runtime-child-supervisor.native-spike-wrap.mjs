/**
 * S35 spike: wrap one launch in the native sandbox from inside a permission-limited Node process and report the
 * first permission refusal (or success) as one JSON line. Not shipped.
 */
import { tmpdir } from 'node:os';

const [, , readable, workingDirectory] = process.argv;
try {
  const { launchInNativeSandbox } = await import('../../core/native-process/src/native-sandbox.ts');
  const argv = await launchInNativeSandbox({
    executablePath: '/bin/echo',
    arguments: ['s35'],
    readablePaths: [readable, workingDirectory],
    writablePath: tmpdir(),
    workingDirectory,
    commandId: 's35-wrap',
  });
  console.log(JSON.stringify({ ok: true, argv }));
} catch (error) {
  const cause = error?.cause ?? error;
  console.log(
    JSON.stringify({
      ok: false,
      code: cause?.code,
      permission: cause?.permission,
      resource: cause?.resource,
      message: String(cause?.message ?? cause),
      at: String(cause?.stack ?? '')
        .split('\n')
        .find((line) => line.includes('sandbox-runtime')),
    }),
  );
}
process.exit(0);
