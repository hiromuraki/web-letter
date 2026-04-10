package main

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
	"web-letter-go/core"
)

// 义与前端交互的数据结构
type UnlockRequest struct {
	Password string `json:"password"`
}

// 异常的 JSON 格式 {"detail": "..."}
type ErrorResponse struct {
	Detail string `json:"detail"`
}

// 封装一个快捷返回错误 JSON 的小助手
func writeJSONError(w http.ResponseWriter, statusCode int, detail string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(ErrorResponse{Detail: detail})
}

type Config struct {
	LetterFile     string
	LetterPassword string
	Port           string
}

var config Config

func loadConfig() Config {
	config := Config{
		LetterFile:     os.Getenv("LETTER_FILE"),
		LetterPassword: os.Getenv("LETTER_PASSWORD"),
		Port:           os.Getenv("PORT"),
	}

	if config.LetterFile == "" {
		config.LetterFile = "/data/letter"
	}
	if config.LetterPassword == "" {
		config.LetterPassword = "000000"
	}
	if config.Port == "" {
		config.Port = "8000"
	}

	log.Printf("配置加载完成")

	return config
}

//go:embed static/*
var staticEmbed embed.FS

func registerStaticFilesRoute() {
	staticFiles, err := fs.Sub(staticEmbed, "static")
	if err != nil {
		log.Fatalf("加载嵌入式静态文件失败: %v", err)
	}
	http.Handle("/", http.FileServer(http.FS(staticFiles)))
}

func registerLetterApiRoute() {
	letterCache := &core.LetterCache{FilePath: config.LetterFile}
	letterCache.LoadFromDisk()

	// 后台检视信件文件的变化，每 5 秒钟检查一次
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		for range ticker.C {
			letterCache.LoadFromDisk()
		}
	}()

	http.HandleFunc("/api/letter", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSONError(w, http.StatusMethodNotAllowed, "请求方法错误")
			return
		}

		// 解析前端传来的 JSON
		var req UnlockRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSONError(w, http.StatusBadRequest, "请求数据格式有误")
			return
		}

		// 校验密码
		if strings.TrimSpace(req.Password) != config.LetterPassword {
			writeJSONError(w, http.StatusBadRequest, "口令无效哦")
			return
		}

		// 获取信件内容 (如果文件不存在或加载失败，这里 cache.Get() 可能返回 nil)
		letter := letterCache.Get()
		if letter == nil {
			writeJSONError(w, http.StatusInternalServerError, "当前没有信件哦")
			return
		}

		// 校验通过，返回 200 OK 和信件 JSON
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(letter)
	})
}

func main() {
	config = loadConfig()

	registerStaticFilesRoute()
	registerLetterApiRoute()

	log.Printf("🚀 服务器已启动 (Port=%s)", config.Port)
	err := http.ListenAndServe(":"+config.Port, nil)
	if err != nil {
		log.Fatalf("❌ 服务器异常退出: %v", err)
	}
}
