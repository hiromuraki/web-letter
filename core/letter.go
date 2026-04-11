package core

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"
)

// Letter 结构体
type Letter struct {
	Title    string `json:"title"`
	Avatar   string `json:"avatar"`
	Content  string `json:"content"`
	Sign     string `json:"sign"`
	Music    string `json:"music"`
	PassCode string `json:"passCode"`
}

// LetterCache 是我们的“智能信箱”
type LetterCache struct {
	mu       sync.RWMutex // 读写锁：允许多个请求同时读，但写的时候阻塞读
	data     *Letter      // 缓存在内存中的信件数据
	lastMod  time.Time    // 记录文件最后修改时间
	FilePath string
}

func parseLetter(filePath string) (*Letter, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("打开文件失败: %w", err)
	}
	defer file.Close()

	letter := &Letter{}
	var contentLines []string
	isContentSection := false

	// 使用 Scanner 逐行读取，防止大文件吃光内存
	scanner := bufio.NewScanner(file)

	for scanner.Scan() {
		// 读取当前行，并去除首尾的空白字符和换行符
		line := strings.TrimSpace(scanner.Text())

		if !isContentSection {
			// 阶段一：解析头部信息
			if after, ok := strings.CutPrefix(line, "TITLE:"); ok {
				letter.Title = strings.TrimSpace(after)
			} else if after, ok := strings.CutPrefix(line, "SIGN:"); ok {
				letter.Sign = strings.TrimSpace(after)
			} else if after, ok := strings.CutPrefix(line, "AVATAR:"); ok {
				letter.Avatar = strings.TrimSpace(after)
			} else if after, ok := strings.CutPrefix(line, "MUSIC:"); ok {
				letter.Music = strings.TrimSpace(after)
			} else if after, ok := strings.CutPrefix(line, "PASSCODE:"); ok {
				letter.PassCode = strings.TrimSpace(after)
			} else if line == "" {
				// 遇到空行，标记进入正文阶段
				isContentSection = true
			}
		} else {
			// 阶段二：解析正文
			// 规范1：忽略行间空格 (空行不加入 slice)
			if line != "" {
				contentLines = append(contentLines, line)
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取文件过程中发生错误: %w", err)
	}

	// 规范2：用 \n 链接所有段落
	// strings.Join 是 Go 中最高效的字符串拼接方式
	letter.Content = strings.Join(contentLines, "\n")

	return letter, nil
}

// LoadFromDisk 核心方法：检查磁盘文件是否变动，如果变了才重新读取
func (c *LetterCache) LoadFromDisk() {
	info, err := os.Stat(c.FilePath)
	if err != nil {
		log.Printf("无法获取文件信息: %v", err)
		return
	}

	// 核心逻辑：如果修改时间和缓存的记录一样，说明文件没变，直接返回，绝对不读文件内容！
	if info.ModTime().Equal(c.lastMod) {
		return
	}

	// 如果变了，才真正去读磁盘
	log.Println("检测到信件已更新，正在重新加载到内存...")
	parsedLetter, err := parseLetter(c.FilePath)
	if err != nil {
		log.Printf("解析信件失败: %v", err)
		return
	}

	// 加写锁，安全地替换内存中的数据
	c.mu.Lock()
	c.data = parsedLetter
	c.lastMod = info.ModTime()
	c.mu.Unlock()
}

// Get 核心方法：API 请求直接调用它，无锁读，性能极其恐怖
func (c *LetterCache) Get() *Letter {
	c.mu.RLock()         // 加读锁
	defer c.mu.RUnlock() // 结束时释放
	return c.data
}
