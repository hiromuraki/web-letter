# ==========================================
# 第二阶段：构建
# ==========================================
FROM golang:1.26-alpine AS builder

# 设置 Go 环境变量
# CGO_ENABLED=0: 禁用 CGO，确保编译出纯静态链接的二进制文件，这对于在 alpine 或 scratch 中运行至关重要
# GOOS=linux: 目标操作系统
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64

# 设置工作目录
WORKDIR /build

COPY go.mod ./
RUN go mod download

COPY . .

# -ldflags="-w -s": 移除调试信息和符号表，能显著减小编译后的二进制文件体积
# 假设你的入口文件在 cmd/web-server/ 目录下
RUN go build -ldflags="-w -s" -o web-letter main.go


# ==========================================
# 第二阶段：运行
# ==========================================
FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata
ENV TZ=Asia/Shanghai

WORKDIR /app

COPY --from=builder /build/web-letter .

EXPOSE 8000

# 启动命令
CMD ["./web-letter"]