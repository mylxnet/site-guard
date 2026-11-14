#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 by Mr lin
#
# 网站哨兵本地服务管理（开发/自测用）
# 用法：./scripts/service.sh {start|stop|restart|status|health|logs}
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PORT="${PORT:-8686}"
PID_FILE=".service.pid"
LOG_DIR="logs"

mkdir -p "$LOG_DIR"

latest_log() {
  ls -t "$LOG_DIR"/dev-*.log 2>/dev/null | head -n 1
}

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

wait_health() {
  for _ in $(seq 1 20); do
    if curl -fsS -m 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

cmd_start() {
  if is_running; then
    echo "已在运行（PID $(cat "$PID_FILE")，端口 ${PORT}）"
    return 0
  fi
  local log_file
  log_file="$LOG_DIR/dev-$(date +%Y%m%d).log"
  nohup node src/server.js >>"$log_file" 2>&1 &
  echo $! >"$PID_FILE"
  if wait_health; then
    echo "已启动（PID $(cat "$PID_FILE")，端口 ${PORT}，日志 ${log_file}）"
  else
    echo "启动失败，最后日志："
    tail -n 20 "$log_file" || true
    exit 1
  fi
}

cmd_stop() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "未在运行"
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "已停止（PID ${pid}）"
}

cmd_status() {
  if is_running; then
    echo "运行中（PID $(cat "$PID_FILE")，端口 ${PORT}）"
  else
    echo "未运行"
    return 3
  fi
}

cmd_health() {
  curl -fsS -m 5 "http://127.0.0.1:${PORT}/api/health"
  echo
}

cmd_logs() {
  local log_file
  log_file="$(latest_log)"
  if [ -z "$log_file" ]; then
    echo "暂无日志（先执行 start）"
    return 1
  fi
  tail -n 100 "$log_file"
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_stop; cmd_start ;;
  status) cmd_status ;;
  health) cmd_health ;;
  logs) cmd_logs ;;
  *)
    echo "用法：./scripts/service.sh {start|stop|restart|status|health|logs}"
    exit 1
    ;;
esac
