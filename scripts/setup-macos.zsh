#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
APP_DIR="${PROJECT_DIR}/macos/Obsidian Screenshot Importer.app"
APP_EXE="${APP_DIR}/Contents/MacOS/ObsidianScreenshotAutomation"
WRAPPER_SOURCE="${PROJECT_DIR}/macos/launcher-wrapper.c"
LAUNCHER_SOURCE="${PROJECT_DIR}/macos/launcher.zsh"
LAUNCHER_SCRIPT="${APP_DIR}/Contents/Resources/launcher.zsh"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

info() {
  printf '\033[1;34m==>\033[0m %s\n' "$*"
}

ok() {
  printf '\033[1;32mOK\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33mWARN\033[0m %s\n' "$*"
}

fail() {
  printf '\033[1;31mERROR\033[0m %s\n' "$*" >&2
  exit 1
}

if [ "$(uname -s)" != "Darwin" ]; then
  fail "This setup script is for macOS."
fi

find_brew() {
  if command -v brew >/dev/null 2>&1; then
    command -v brew
    return 0
  fi
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -x "${candidate}" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

load_brew_shellenv() {
  local brew_bin="$1"
  eval "$("${brew_bin}" shellenv)"
  export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH}"
}

install_homebrew_if_needed() {
  local brew_bin
  brew_bin="$(find_brew || true)"
  if [ -n "${brew_bin}" ]; then
    ok "Homebrew found: ${brew_bin}"
    load_brew_shellenv "${brew_bin}"
    return
  fi

  info "Homebrew is not installed. Installing Homebrew..."
  /bin/bash -c "$(/usr/bin/curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  brew_bin="$(find_brew || true)"
  if [ -z "${brew_bin}" ]; then
    fail "Homebrew installation finished, but brew was not found. Reopen Terminal and run this setup again."
  fi
  load_brew_shellenv "${brew_bin}"
  ok "Homebrew installed: ${brew_bin}"
}

brew_install_or_upgrade() {
  local formula="$1"
  if brew list --formula "${formula}" >/dev/null 2>&1; then
    info "Updating Homebrew formula: ${formula}"
    brew upgrade "${formula}" || true
  else
    info "Installing Homebrew formula: ${formula}"
    brew install "${formula}"
  fi
}

command_ok() {
  command -v "$1" >/dev/null 2>&1
}

ensure_formula_command() {
  local command_name="$1"
  local formula="$2"
  if command_ok "${command_name}"; then
    ok "${command_name} found: $(command -v "${command_name}")"
    return
  fi
  brew_install_or_upgrade "${formula}"
  if ! command_ok "${command_name}"; then
    brew link "${formula}" >/dev/null 2>&1 || true
  fi
  command_ok "${command_name}" || fail "${command_name} was not found after installing ${formula}."
  ok "${command_name} installed: $(command -v "${command_name}")"
}

ensure_node() {
  local major="0"
  if command_ok node; then
    major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')"
  fi

  if [ "${major}" -ge 20 ] 2>/dev/null; then
    ok "Node.js $(node --version) found: $(command -v node)"
    return
  fi

  if command_ok node; then
    warn "Node.js $(node --version) is older than required v20. Installing/upgrading Homebrew node."
  else
    info "Node.js was not found. Installing Homebrew node."
  fi

  brew_install_or_upgrade node
  hash -r
  command_ok node || fail "Node.js was not found after installing node."

  major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')"
  if [ "${major}" -lt 20 ] 2>/dev/null; then
    fail "Node.js $(node --version) is still older than v20. Check PATH and Homebrew links."
  fi
  ok "Node.js $(node --version) installed: $(command -v node)"
}

ensure_compiler() {
  if command_ok cc; then
    ok "C compiler found: $(command -v cc)"
    return
  fi

  warn "C compiler was not found. macOS Command Line Tools may need to be installed."
  warn "If macOS opens an installer, complete it and rerun this setup command."
  xcode-select --install >/dev/null 2>&1 || true
  fail "C compiler is required to rebuild the launcher wrapper. Rerun setup after Command Line Tools are installed."
}

rebuild_launcher() {
  [ -f "${WRAPPER_SOURCE}" ] || fail "Wrapper source not found: ${WRAPPER_SOURCE}"
  [ -f "${LAUNCHER_SOURCE}" ] || fail "Launcher source not found: ${LAUNCHER_SOURCE}"

  info "Rebuilding macOS launcher wrapper for this Mac..."
  mkdir -p "${APP_DIR}/Contents/MacOS" "${APP_DIR}/Contents/Resources"
  cp "${PROJECT_DIR}/macos/LegacyInfo.plist" "${APP_DIR}/Contents/Info.plist"
  cp "${LAUNCHER_SOURCE}" "${LAUNCHER_SCRIPT}"
  cc -Wall -Wextra -O2 "${WRAPPER_SOURCE}" -o "${APP_EXE}"
  chmod +x "${APP_EXE}" "${LAUNCHER_SCRIPT}"
  ok "Launcher wrapper rebuilt: ${APP_EXE}"
}

run_smoke_test() {
  info "Running launcher smoke test..."
  "${APP_EXE}" --smoke
  ok "Launcher smoke test passed."
}

print_versions() {
  printf '\nInstalled tools:\n'
  printf '  node:   %s (%s)\n' "$(node --version)" "$(command -v node)"
  printf '  npm:    %s (%s)\n' "$(npm --version)" "$(command -v npm)"
  printf '  cwebp:  %s (%s)\n' "$(cwebp -version 2>&1 | head -n 1)" "$(command -v cwebp)"
  printf '  ffmpeg: %s (%s)\n' "$(ffmpeg -version 2>&1 | head -n 1)" "$(command -v ffmpeg)"
}

info "Setting up Obsidian Screenshot Importer for macOS"
info "Project: ${PROJECT_DIR}"

install_homebrew_if_needed
ensure_node
ensure_formula_command npm node
ensure_formula_command cwebp webp
ensure_formula_command ffmpeg ffmpeg
ensure_compiler
/bin/bash "${PROJECT_DIR}/scripts/build-native-helpers.sh"
rebuild_launcher
run_smoke_test
print_versions

printf '\nDone. You can now open:\n%s\n' "${PROJECT_DIR}/macos/Obsidian Screenshot Importer.app"
