#!/bin/bash
# Kronos预测服务启动脚本

set -e

echo "========================================"
echo "Kronos金融K线预测微服务"
echo "========================================"

# 检查Python版本
python_version=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "Python版本: $python_version"

if [[ $(echo "$python_version < 3.10" | bc) -eq 1 ]]; then
    echo "警告: 推荐使用Python 3.10+"
fi

# 检查依赖
echo "检查依赖..."
if ! command -v python3 &> /dev/null; then
    echo "错误: 未找到python3"
    exit 1
fi

# 安装依赖
echo "安装依赖..."
pip install -r requirements.txt

# 克隆Kronos仓库（如果需要）
if [ ! -d "../kronos-repo" ]; then
    echo "克隆Kronos仓库..."
    git clone https://github.com/shiyu-coder/Kronos.git ../kronos-repo
fi

# 添加Kronos到Python路径
export PYTHONPATH="../kronos-repo:$PYTHONPATH"
echo "PYTHONPATH: $PYTHONPATH"

# 检查模型库
echo "检查Kronos模型库..."
python3 -c "
try:
    from model.kronos import Kronos, KronosTokenizer, KronosPredictor
    print('✓ Kronos模型库导入成功')
except ImportError as e:
    print(f'✗ 无法导入Kronos模型库: {e}')
    print('请确保已正确克隆Kronos仓库并设置PYTHONPATH')
"

# 检查PyTorch设备
echo "检查硬件加速..."
python3 -c "
import torch
if torch.cuda.is_available():
    print(f'✓ CUDA可用: {torch.cuda.get_device_name(0)}')
elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
    print('✓ MPS可用 (Apple Silicon)')
else:
    print('⚠ 使用CPU模式，性能可能较低')
"

# 创建环境变量文件（如果不存在）
if [ ! -f ".env" ]; then
    echo "创建.env文件..."
    cat > .env << EOF
# Kronos服务配置
KRONOS_API_KEY=your_api_key_here
LOG_LEVEL=INFO

# 代理设置（如果需要）
# HTTP_PROXY=http://proxy.example.com:8080
# HTTPS_PROXY=http://proxy.example.com:8080
EOF
    echo "⚠ 请编辑.env文件设置API密钥"
fi

# 启动服务
echo "启动服务..."
echo "访问地址: http://localhost:8888"
echo "API文档: http://localhost:8888/docs"
echo ""
echo "按Ctrl+C停止服务"
echo "========================================"

python3 kronos_service.py