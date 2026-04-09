# 项目配置
BINARY_NAME=web-letter
DIST_DIR=dist
SOURCE_FILES=./main.go

# 编译参数
LDFLAGS=-w -s

.PHONY: all build build-amd64 build-arm64 clean setup

# 默认目标：同时构建两个平台
all: clean setup build-amd64 build-arm64

# 创建输出目录
setup:
	@mkdir -p $(DIST_DIR)

# 构建 x86_64 (amd64) 版本
build-amd64:
	@echo "正在构建 Linux x86_64 版本..."
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)-linux-amd64 $(SOURCE_FILES)

# 构建 arm64 (aarch64) 版本
build-arm64:
	@echo "正在构建 Linux arm64 版本..."
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)-linux-arm64 $(SOURCE_FILES)

# 清理构建目录
clean:
	@echo "正在清理 dist 目录..."
	@rm -rf $(DIST_DIR)