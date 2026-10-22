#!/bin/bash
set -e

echo "=== Diamond-Marketing 安装 ==="
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ANTFARM_WORKFLOWS="$HOME/.openclaw/workspace/antfarm/workflows"
ANTFARM_CLI="$HOME/.openclaw/workspace/antfarm/dist/cli/cli.js"

# 1. 安装 workflow
echo "[1/3] 安装 Antfarm 工作流..."
mkdir -p "$ANTFARM_WORKFLOWS/diamond-marketing"
cp -R "$ROOT/workflow/"* "$ANTFARM_WORKFLOWS/diamond-marketing/"
echo "  ✅ workflow 已复制到 $ANTFARM_WORKFLOWS/diamond-marketing/"

# 2. 安装 agent crons
echo "[2/3] 注册 Agent Cron..."
node "$ANTFARM_CLI" workflow install diamond-marketing 2>&1 || echo "  ⚠️ workflow install 出错，请手动执行"
echo "  ✅ Agent Cron 已注册"

# 3. 启动后台
echo "[3/3] 启动后台..."
echo ""
echo "  启动命令："
echo "  cd $ROOT/backend && node server.js"
echo ""
echo "  环境变数（可选）："
echo "  DIAMOND_PORT=3330  # 默认"
echo "  DIAMOND_DB=$ROOT/storage/diamond.db"
echo "  DIAMOND_DATA=$ROOT/backend/data"
echo ""
echo "  Port 地图："
echo "  - 3330: Diamond Marketing 后台（输入/仪表板）"
echo "  - 3333: Antfarm Dashboard（进度）"
echo ""
echo "=== 安装完成 ==="