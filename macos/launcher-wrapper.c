#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

int main(int argc, char *argv[]) {
  char executablePath[PATH_MAX];
  uint32_t size = sizeof(executablePath);

  if (_NSGetExecutablePath(executablePath, &size) != 0) {
    fprintf(stderr, "Executable path is too long.\n");
    return 1;
  }

  char resolvedPath[PATH_MAX];
  const char *pathToUse = realpath(executablePath, resolvedPath) ? resolvedPath : executablePath;

  char appRoot[PATH_MAX];
  if (strlen(pathToUse) >= sizeof(appRoot)) {
    fprintf(stderr, "Application path is too long.\n");
    return 1;
  }
  strcpy(appRoot, pathToUse);

  char *contentsMarker = strstr(appRoot, "/Contents/MacOS/");
  if (!contentsMarker) {
    fprintf(stderr, "Could not locate app bundle Contents/MacOS directory.\n");
    return 1;
  }
  *contentsMarker = '\0';

  char launcherPath[PATH_MAX];
  int written = snprintf(
    launcherPath,
    sizeof(launcherPath),
    "%s/Contents/Resources/launcher.zsh",
    appRoot
  );
  if (written < 0 || written >= (int)sizeof(launcherPath)) {
    fprintf(stderr, "Launcher path is too long.\n");
    return 1;
  }

  char **execArgs = calloc((size_t)argc + 2, sizeof(char *));
  if (!execArgs) {
    fprintf(stderr, "Could not allocate launcher arguments.\n");
    return 1;
  }

  execArgs[0] = "zsh";
  execArgs[1] = launcherPath;
  for (int index = 1; index < argc; index += 1) {
    execArgs[index + 1] = argv[index];
  }
  execArgs[argc + 1] = NULL;

  execv("/bin/zsh", execArgs);
  perror("execv /bin/zsh");
  free(execArgs);
  return 1;
}
