#!/bin/bash

# TradingAgents 微服务启动脚本
# 端口: 8765

set -e  # 出错时退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   TradingAgents AI 选股微服务启动脚本   ${NC}"
echo -e "${GREEN}========================================${NC}"

# 检查 Python 版本
PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo -e "Python 版本: ${YELLOW}${PYTHON_VERSION}${NC}"

# 检查是否在虚拟环境中
if [[ -z "$VIRTUAL_ENV" ]]; then
    echo -e "${YELLOW}警告: 未检测到虚拟环境，建议在虚拟环境中运行${NC}"
    read -p "是否继续? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo -e "虚拟环境: ${GREEN}$VIRTUAL_ENV${NC}"
fi

# 检查依赖
echo -e "\n${GREEN}[1/4] 检查依赖...${NC}"
if [ ! -f "requirements.txt" ]; then
    echo -e "${RED}错误: 未找到 requirements.txt${NC}"
    exit 1
fi

# 安装依赖（如果未安装）
if ! python3 -c "import fastapi" &> /dev/null; then
    echo -e "${YELLOW}检测到依赖未安装，开始安装...${NC}"
    pip install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo -e "${RED}依赖安装失败${NC}"
        exit 1
    fi
    echo -e "${GREEN}依赖安装完成${NC}"
else
    echo -e "${GREEN}依赖已安装${NC}"
fi

# 检查环境变量
echo -e "\n${GREEN}[2/4] 检查环境变量...${NC}"

# 设置默认环境变量
export QUANTORACLE_BACKEND_URL=${QUANTORACLE_BACKEND_URL:-"http://localhost:3001"}
export OLLAMA_BASE_URL=${OLLAMA_BASE_URL:-"http://localhost:11434"}
export TRADING_AGENTS_HOST=${TRADING_AGENTS_HOST:-"0.0.0.0"}
export TRADING_AGENTS_PORT=${TRADING_AGENTS_PORT:-"8765"}

echo -e "QUANTORACLE_BACKEND_URL: ${YELLOW}${QUANTORACLE_BACKEND_URL}${NC}"
echo -e "OLLAMA_BASE_URL: ${YELLOW}${OLLAMA_BASE_URL}${NC}"
echo -e "TRADING_AGENTS_HOST: ${YELLOW}${TRADING_AGENTS_HOST}${NC}"
echo -e "TRADING_AGENTS_PORT: ${YELLOW}${TRADING_AGENTS_PORT}${NC}"

# 检查 OpenRouter API Key（可选）
if [ -z "$OPENROUTER_API_KEY" ]; then
    echo -e "${YELLOW}警告: OPENROUTER_API_KEY 未设置，将无法使用 OpenRouter 兜底${NC}"
else
    echo -e "OPENROUTER_API_KEY: ${GREEN}已设置${NC}"
fi

# 检查后端服务
echo -e "\n${GREEN}[3/4] 检查后端服务...${NC}"
if curl -s --head --fail "${QUANTORACLE_BACKEND_URL}/health" > /dev/null 2>&1; then
    echo -e "QuantOracle 后端: ${GREEN}在线${NC}"
else
    echo -e "${YELLOW}警告: QuantOracle 后端服务不可达，基本面和技术面分析可能受影响${NC}"
    echo -e "${YELLOW}确保后端服务运行在: ${QUANTORACLE_BACKEND_URL}${NC}"
fi

# 检查 Ollama 服务
echo -e "\n检查 Ollama 服务..."
if curl -s --head --fail "${OLLAMA_BASE_URL}/api/tags" > /dev/null 2>&1; then
    echo -e "Ollama 服务: ${GREEN}在线${NC}"
    
    # 检查 qwen2.5:9b 模型是否可用
    if curl -s "${OLLAMA_BASE_URL}/api/tags" | grep -q "qwen2.5:9b"; then
        echo -e "qwen2.5:9b 模型: ${GREEN}可用${NC}"
    else
        echo -e "${YELLOW}警告: qwen2.5:9b 模型未找到，将使用规则引擎${NC}"
        echo -e "${YELLOW}可以运行: ollama pull qwen2.5:9b${NC}"
    fi
else
    echo -e "${YELLOW}警告: Ollama 服务不可达，将使用规则引擎和 OpenRouter 兜底${NC}"
    echo -e "${YELLOW}确保 Ollama 运行在: ${OLLAMA_BASE_URL}${NC}"
fi

# 启动服务
echo -e "\n${GREEN}[4/4] 启动 TradingAgents 服务...${NC}"
echo -e "服务地址: ${GREEN}http://${TRADING_AGENTS_HOST}:${TRADING_AGENTS_PORT}${NC}"
echo -e "API 文档: ${GREEN}http://${TRADING_AGENTS_HOST}:${TRADING_AGENTS_PORT}/docs${NC}"
echo -e "\n${YELLOW}按 Ctrl+C 停止服务${NC}"
echo -e "${GREEN}========================================${NC}"

# 运行服务
exec python3 main.py