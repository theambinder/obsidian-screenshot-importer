#!/bin/zsh
set -u

SCRIPT_DIR="${0:A:h}"
if [[ "${SCRIPT_DIR:t}" == "Resources" ]]; then
  PROJECT_DIR="${SCRIPT_DIR:h:h:h:h}"
else
  PROJECT_DIR="${SCRIPT_DIR:h}"
fi
URL="http://127.0.0.1:3787"
HEALTH_URL="${URL}/api/health"
PID_FILE="${PROJECT_DIR}/data/launcher.pid"
LOG_FILE="${PROJECT_DIR}/data/launcher.log"
SETUP_COMMAND="/bin/zsh ${PROJECT_DIR}/scripts/setup-macos.zsh"
SERVER_PID=""
STARTED_BY_LAUNCHER=0
STOP_REQUESTED=0

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

mkdir -p "${PROJECT_DIR}/data"
touch "${LOG_FILE}"
exec 3>&1 4>&2
exec >> "${LOG_FILE}" 2>&1

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "${LOG_FILE}"
}

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"Obsidian Screenshot Importer\"" >/dev/null 2>&1 || true
}

dialog() {
  /usr/bin/osascript <<APPLESCRIPT
display dialog "$1" buttons {$2} default button "$3" cancel button "$4" with title "Obsidian Screenshot Importer"
return button returned of result
APPLESCRIPT
}

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [ -x "${candidate}" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

missing_runtime_tools() {
  local missing=()
  for tool in cwebp ffmpeg; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
      missing+=("${tool}")
    fi
  done
  printf '%s' "${(j:, :)missing}"
}

pid_is_alive() {
  local pid="$1"
  [ -n "${pid}" ] && kill -0 "${pid}" >/dev/null 2>&1
}

pid_from_file() {
  [ -f "${PID_FILE}" ] || return 1
  local pid
  pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if pid_is_alive "${pid}"; then
    printf '%s\n' "${pid}"
    return 0
  fi
  rm -f "${PID_FILE}"
  return 1
}

pid_from_port() {
  /usr/sbin/lsof -nP -tiTCP:3787 -sTCP:LISTEN 2>/dev/null | head -n 1
}

server_healthy() {
  /usr/bin/curl -fsS "${HEALTH_URL}" >/dev/null 2>&1
}

stop_server() {
  local pid="${SERVER_PID}"
  if [ -z "${pid}" ]; then
    pid="$(pid_from_file || true)"
  fi
  if [ -z "${pid}" ] && server_healthy; then
    pid="$(pid_from_port || true)"
  fi
  if pid_is_alive "${pid}"; then
    log "Stopping server pid=${pid}"
    kill "${pid}" >/dev/null 2>&1 || true
    for _ in {1..30}; do
      pid_is_alive "${pid}" || break
      sleep 0.1
    done
  fi
  rm -f "${PID_FILE}"
}

cleanup() {
  if [ "${STOP_REQUESTED}" = "1" ]; then
    return
  fi
  if [ "${STARTED_BY_LAUNCHER}" = "1" ]; then
    stop_server
  fi
}

trap cleanup EXIT INT TERM

if [ "${1:-}" = "--doctor" ]; then
  NODE_BIN="$(find_node || true)"
  if [ -z "${NODE_BIN}" ]; then
    printf 'Node.js was not found.\n' >&3
    exit 1
  fi
  printf 'Node: %s\nProject: %s\nURL: %s\nLog: %s\n' "${NODE_BIN}" "${PROJECT_DIR}" "${URL}" "${LOG_FILE}" >&3
  exit 0
fi

if [ "${1:-}" = "--stop" ]; then
  STOP_REQUESTED=1
  stop_server
  exit 0
fi

if [ "${1:-}" = "--smoke" ]; then
  log "Smoke test requested"
fi

log "Launcher opened"
log "PATH=${PATH}"
log "SHELL=${SHELL:-unknown}"
log "HOME=${HOME:-unknown}"

if server_healthy; then
  SERVER_PID="$(pid_from_file || pid_from_port || true)"
  STARTED_BY_LAUNCHER=0
  log "Service is already running pid=${SERVER_PID:-unknown}"
else
  existing_pid="$(pid_from_port || true)"
  if [ -n "${existing_pid}" ]; then
    dialog "Port 3787 is already used by another process. Stop that process or change the service port.\n\nLog:\n${LOG_FILE}" '"OK"' "OK" "OK" >/dev/null 2>&1 || true
    exit 1
  fi

  NODE_BIN="$(find_node || true)"
  if [ -z "${NODE_BIN}" ]; then
    dialog "Node.js was not found.\n\nRun this once in Terminal on this Mac:\n\n${SETUP_COMMAND}" '"OK"' "OK" "OK" >/dev/null 2>&1 || true
    exit 1
  fi

  missing_tools="$(missing_runtime_tools)"
  if [ -n "${missing_tools}" ]; then
    dialog "Some required tools were not found: ${missing_tools}.\n\nRun this once in Terminal on this Mac:\n\n${SETUP_COMMAND}" '"OK"' "OK" "OK" >/dev/null 2>&1 || true
    exit 1
  fi

  cd "${PROJECT_DIR}" || exit 1
  log "Starting server with ${NODE_BIN}"
  /usr/bin/nohup "${NODE_BIN}" src/server.mjs &
  SERVER_PID="$!"
  STARTED_BY_LAUNCHER=1
  printf '%s\n' "${SERVER_PID}" > "${PID_FILE}"
  log "Started server pid=${SERVER_PID}"

  for _ in {1..80}; do
    if server_healthy; then
      log "Server became healthy"
      break
    fi
    if ! pid_is_alive "${SERVER_PID}"; then
      wait "${SERVER_PID}" 2>/dev/null
      exit_code="$?"
      log "Server exited during startup with code ${exit_code}"
      dialog "The service stopped during startup.\n\nLog:\n${LOG_FILE}" '"OK"' "OK" "OK" >/dev/null 2>&1 || true
      exit 1
    fi
    sleep 0.1
  done

  if ! server_healthy; then
    log "Server did not become healthy in time; pid_alive=$(pid_is_alive "${SERVER_PID}" && printf yes || printf no)"
    dialog "The service did not become ready in time.\n\nLog:\n${LOG_FILE}" '"OK"' "OK" "OK" >/dev/null 2>&1 || true
    exit 1
  fi
fi

if [ "${1:-}" = "--smoke" ]; then
  log "Smoke test succeeded; started_by_launcher=${STARTED_BY_LAUNCHER}"
  if [ "${STARTED_BY_LAUNCHER}" = "1" ]; then
    STOP_REQUESTED=1
    stop_server
  fi
  printf 'Launcher smoke test OK\n' >&3
  exit 0
fi

/usr/bin/open "${URL}" >/dev/null 2>&1 || true
log "Opened ${URL}"
notify "Service is running"

while true; do
  choice="$(dialog "The service is running at ${URL}.\n\nUse the browser window. When finished, click Stop Service." '"Open App", "Stop Service"' "Open App" "Stop Service" 2>/dev/null || printf 'Stop Service')"
  case "${choice}" in
    "Open App")
      /usr/bin/open "${URL}" >/dev/null 2>&1 || true
      ;;
    *)
      STOP_REQUESTED=1
      stop_server
      notify "Service stopped"
      exit 0
      ;;
  esac
done
