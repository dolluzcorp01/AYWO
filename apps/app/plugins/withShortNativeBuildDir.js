// Windows refuses folder paths over about 260 letters. The C++ parts of the Android build write deep folders, and
// from a long project folder they go over that limit and the build fails. This sends those build leftovers to a
// short folder outside the project (C:/aywo-build) when building on Windows. Other systems are left alone.
// The android folder is generated from app.json, so the change has to be made here to survive `expo prebuild`.
// Also needed on a Windows machine: Ninja 1.12 or newer in the Android SDK's cmake/bin folder (older ones stop at
// 260 letters whatever the folder).
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARK = '// aywo: short native build folder on Windows';
const BLOCK = `${MARK}
if (org.gradle.internal.os.OperatingSystem.current().isWindows()) {
  subprojects { sub ->
    def shortDir = { sub.android.externalNativeBuild.cmake.buildStagingDirectory = new File("C:/aywo-build/\${sub.name}") }
    sub.plugins.withId('com.android.library', shortDir)
    sub.plugins.withId('com.android.application', shortDir)
  }
}

`;

module.exports = function withShortNativeBuildDir(config) {
  return withProjectBuildGradle(config, (cfg) => {
    const anchor = 'apply plugin: "expo-root-project"';
    // It must come before the plugins are applied: after that the folder has already been read.
    if (!cfg.modResults.contents.includes(MARK) && cfg.modResults.contents.includes(anchor)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(anchor, BLOCK + anchor);
    }
    return cfg;
  });
};
