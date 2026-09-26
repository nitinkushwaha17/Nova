// Android helper: builds the web app, copies it into the native shell, then opens Android Studio,
// runs on a device/emulator, or builds a debug APK. Uses Android Studio's bundled JDK (21) for Gradle,
// so the system JAVA_HOME can stay on another version.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const action = process.argv[2] ?? 'open';
const win = process.platform === 'win32';
const env = { ...process.env };

const jbrCandidates = win
  ? [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Android', 'Android Studio', 'jbr'), join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Android Studio', 'jbr')]
  : ['/Applications/Android Studio.app/Contents/jbr/Contents/Home', '/opt/android-studio/jbr', join(process.env.HOME ?? '', 'android-studio', 'jbr')];
const jbr = process.env.NOVA_JAVA_HOME ?? jbrCandidates.find((p) => existsSync(join(p, 'bin', win ? 'java.exe' : 'java')));
if (jbr) env.JAVA_HOME = jbr;

const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT ?? (win ? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk') : join(process.env.HOME ?? '', 'Android', 'Sdk'));
if (existsSync(sdk)) {
  env.ANDROID_HOME = sdk;
  env.PATH = [join(sdk, 'platform-tools'), env.PATH].join(win ? ';' : ':');
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, cwd, shell: win });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('npm', ['run', 'build']);
run('npx', ['cap', 'sync', 'android']);

if (action === 'open') run('npx', ['cap', 'open', 'android']);
else if (action === 'run') run('npx', ['cap', 'run', 'android']);
else if (action === 'apk') {
  run(win ? join(process.cwd(), 'android', 'gradlew.bat') : './gradlew', ['assembleDebug'], 'android');
  console.log('\nAPK: android/app/build/outputs/apk/debug/app-debug.apk');
} else if (action !== 'sync') {
  console.error(`Unknown action "${action}". Use open | run | apk | sync.`);
  process.exit(1);
}
