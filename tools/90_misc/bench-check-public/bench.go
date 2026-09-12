// check-public の検査を Go で書いた見積もり用の実装。
// 条件は bench.cs ・ bench.js と同じ（同じフォルダ・同じ拡張子・同じ 4 つの正規表現）。
// 正規表現は標準ライブラリの regexp を使う。
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var exts = []string{".cs", ".ps1", ".md", ".html", ".cmd", ".txt", ".json", ".js"}
var skipDirs = map[string]bool{".git": true, "tmp": true, "etc": true, "node_modules": true}

var patterns = []*regexp.Regexp{
	// 1. メールアドレス
	regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`),
	// 2. C:\Users\ の直後がプレースホルダでないもの
	//    Go の regexp は先読みを持たないため、除きたい文字を文字クラスで表す
	regexp.MustCompile(`[Cc]:\\Users\\[A-Za-z0-9._-]`),
	// 3. 認証情報に値が続くもの
	regexp.MustCompile(`(?i)(password|passwd|secret|api_key|token)\s*[:=]\s*[^\s"'<$%{]{4,}`),
	// 5. 日本語・英数字の並びに混ざったキリル・ハングル
	regexp.MustCompile(`[\x{0400}-\x{04FF}\x{AC00}-\x{D7AF}]`),
}

func walk(root string) []string {
	var out []string
	dirs := []string{root}
	for len(dirs) > 0 {
		dir := dirs[len(dirs)-1]
		dirs = dirs[:len(dirs)-1]
		if skipDirs[filepath.Base(dir)] {
			continue
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			full := filepath.Join(dir, e.Name())
			if e.IsDir() {
				dirs = append(dirs, full)
				continue
			}
			ext := strings.ToLower(filepath.Ext(e.Name()))
			for _, x := range exts {
				if ext == x {
					out = append(out, full)
					break
				}
			}
		}
	}
	return out
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "使い方: bench-go.exe <対象フォルダ>")
		os.Exit(2)
	}
	start := time.Now()

	files, lines, hits := 0, 0, 0
	for _, p := range walk(os.Args[1]) {
		files++
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(strings.ReplaceAll(string(b), "\r\n", "\n"), "\n") {
			lines++
			for _, re := range patterns {
				if re.MatchString(line) {
					hits++
				}
			}
		}
	}

	ms := time.Since(start).Milliseconds()
	fmt.Printf("files=%d lines=%d hits=%d inner_ms=%d\n", files, lines, hits, ms)
}
