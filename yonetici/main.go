// Shorts Yönetici: sunucudaki paneli terminal açmadan yönetmek için küçük Windows uygulaması.
// Çift tıklayınca tarayıcıda yerel bir sayfa açılır; düğmeler SSH üzerinden sunucuda komut çalıştırır.
package main

import (
	"bufio"
	"crypto/ed25519"
	"crypto/rand"
	"embed"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

//go:embed index.html
var static embed.FS

type Config struct {
	Host    string `json:"host"`
	Port    string `json:"port"`
	User    string `json:"user"`
	Domain  string `json:"domain"`
	HostKey string `json:"hostKey"` // ilk bağlantıda kaydedilen sunucu anahtarı
	KeyOK   bool   `json:"keyOk"`   // uygulama anahtarı sunucuya eklendi mi
}

var (
	cfgDir  string
	cfgPath string
	keyPath string
	cfg     = Config{Host: "104.233.4.32", Port: "25416", User: "root", Domain: "104-233-4-32.sslip.io"}
	mu      sync.Mutex
	lastPing = time.Now()
	pendingPw string // şifre değiştirme için geçici (adres çubuğunda/geçmişte görünmesin diye POST ile gelir)
)

func main() {
	base, err := os.UserConfigDir()
	if err != nil {
		base = "."
	}
	cfgDir = filepath.Join(base, "ShortsYonetici")
	_ = os.MkdirAll(cfgDir, 0o700)
	cfgPath = filepath.Join(cfgDir, "ayarlar.json")
	keyPath = filepath.Join(cfgDir, "anahtar")
	if b, err := os.ReadFile(cfgPath); err == nil {
		_ = json.Unmarshal(b, &cfg)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	url := "http://" + ln.Addr().String()

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		b, _ := static.ReadFile("index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(b)
	})
	mux.HandleFunc("/api/config", handleConfig)
	mux.HandleFunc("/api/setup", handleSetup)
	mux.HandleFunc("/api/run", handleRun)
	mux.HandleFunc("/api/pw", func(w http.ResponseWriter, r *http.Request) {
		var b struct{ Password string }
		json.NewDecoder(r.Body).Decode(&b)
		mu.Lock()
		pendingPw = b.Password
		mu.Unlock()
	})
	mux.HandleFunc("/api/open", func(w http.ResponseWriter, r *http.Request) {
		openBrowser("https://" + cfg.Domain)
	})
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		lastPing = time.Now()
		mu.Unlock()
	})
	mux.HandleFunc("/api/quit", func(w http.ResponseWriter, r *http.Request) {
		go func() { time.Sleep(300 * time.Millisecond); os.Exit(0) }()
	})

	// Tarayıcı sekmesi kapanınca uygulama da kendini kapatır
	go func() {
		for range time.Tick(15 * time.Second) {
			mu.Lock()
			idle := time.Since(lastPing)
			mu.Unlock()
			if idle > 90*time.Second {
				os.Exit(0)
			}
		}
	}()

	log.Println("Shorts Yönetici:", url)
	openBrowser(url)
	log.Fatal(http.Serve(ln, localOnly(mux)))
}

// Sadece bu bilgisayardaki sayfadan gelen istekler kabul edilir
func localOnly(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); o != "" && !strings.HasPrefix(o, "http://127.0.0.1:") {
			http.Error(w, "yasak", http.StatusForbidden)
			return
		}
		h.ServeHTTP(w, r)
	})
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}

func saveConfig() {
	b, _ := json.MarshalIndent(cfg, "", "  ")
	_ = os.WriteFile(cfgPath, b, 0o600)
}

func handleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var c Config
		if err := json.NewDecoder(r.Body).Decode(&c); err == nil {
			if c.Host != cfg.Host || c.Port != cfg.Port {
				cfg.HostKey, cfg.KeyOK = "", false
			}
			cfg.Host, cfg.Port, cfg.User, cfg.Domain = strings.TrimSpace(c.Host), strings.TrimSpace(c.Port), strings.TrimSpace(c.User), strings.TrimSpace(c.Domain)
			saveConfig()
		}
	}
	json.NewEncoder(w).Encode(cfg)
}

// Uygulamaya özel SSH anahtarı (yoksa oluşturulur)
func signer() (ssh.Signer, error) {
	if b, err := os.ReadFile(keyPath); err == nil {
		return ssh.ParsePrivateKey(b)
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	block, err := ssh.MarshalPrivateKey(priv, "shorts-yonetici")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(block), 0o600); err != nil {
		return nil, err
	}
	return ssh.NewSignerFromKey(priv)
}

func hostKeyCallback(hostname string, remote net.Addr, key ssh.PublicKey) error {
	fp := ssh.FingerprintSHA256(key)
	if cfg.HostKey == "" {
		cfg.HostKey = fp
		saveConfig()
		return nil
	}
	if cfg.HostKey != fp {
		return fmt.Errorf("sunucu kimliği değişmiş (%s). Sunucuyu yeniden kurduysanız Ayarlar'dan sunucu bilgilerini tekrar kaydedin", fp)
	}
	return nil
}

func dial(auth ssh.AuthMethod) (*ssh.Client, error) {
	return ssh.Dial("tcp", net.JoinHostPort(cfg.Host, cfg.Port), &ssh.ClientConfig{
		User:            cfg.User,
		Auth:            []ssh.AuthMethod{auth},
		HostKeyCallback: hostKeyCallback,
		Timeout:         15 * time.Second,
	})
}

// İlk kurulum: sunucu parolasıyla bir kez bağlanıp uygulama anahtarını yetkili anahtarlara ekler.
// Parola hiçbir yere kaydedilmez.
func handleSetup(w http.ResponseWriter, r *http.Request) {
	var body struct{ Password string }
	json.NewDecoder(r.Body).Decode(&body)
	s, err := signer()
	if err != nil {
		jsonErr(w, err)
		return
	}
	c, err := dial(ssh.Password(body.Password))
	if err != nil {
		jsonErr(w, friendly(err))
		return
	}
	defer c.Close()
	sess, err := c.NewSession()
	if err != nil {
		jsonErr(w, err)
		return
	}
	defer sess.Close()
	pub := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(s.PublicKey()))) + " shorts-yonetici"
	sess.Stdin = strings.NewReader(pub + "\n")
	cmd := `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && ` +
		`IFS= read -r K && (grep -qxF "$K" ~/.ssh/authorized_keys || echo "$K" >> ~/.ssh/authorized_keys)`
	if out, err := sess.CombinedOutput(cmd); err != nil {
		jsonErr(w, fmt.Errorf("%v %s", err, out))
		return
	}
	cfg.KeyOK = true
	saveConfig()
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func friendly(err error) error {
	m := err.Error()
	switch {
	case strings.Contains(m, "unable to authenticate"):
		return errors.New("parola yanlış ya da sunucu parola girişini kabul etmiyor")
	case strings.Contains(m, "i/o timeout"), strings.Contains(m, "connection refused"):
		return errors.New("sunucuya ulaşılamadı: IP adresini ve SSH portunu kontrol edin")
	}
	return err
}

func jsonErr(w http.ResponseWriter, err error) {
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
}

const app = "cd /opt/shorts || exit 1; "

// Düğmelerin sunucuda çalıştırdığı komutlar (sabit liste: sayfa rastgele komut gönderemez)
var actions = map[string]string{
	"durum": app + `echo "== Kapsayıcılar =="; docker compose ps --format "table {{.Name}}\t{{.Status}}"; ` +
		`echo; echo "== Sağlık =="; docker exec shorts-app-1 curl -s localhost:3000/api/health; echo; ` +
		`echo; echo "== Disk =="; df -h / | tail -1; echo; echo "== Sürüm =="; git log -1 --format="%h %cd %s" --date=format:"%d.%m.%Y %H:%M"`,
	"guncelle":  "bash /opt/shorts/deploy/guncelle.sh 2>&1",
	"yeniden":   app + "docker compose restart app 2>&1 && echo && echo 'Panel yeniden başlatıldı.'",
	"kayitlar":  app + "docker compose logs --no-color --tail 150 app 2>&1",
	"yedek":     "bash /opt/shorts/deploy/yedekle.sh 2>&1 && ls -lh /opt/shorts/backups | tail -5",
	"sifre":     app + `IFS= read -r PW && grep -v '^PANEL_PASSWORD=' .env > .env.tmp && printf "PANEL_PASSWORD='%s'\n" "$PW" >> .env.tmp && mv .env.tmp .env && chmod 600 .env && docker compose up -d 2>&1 && echo && echo 'Yeni panel şifresi geçerli.'`,
	"caddy":     "docker restart temelim-caddy 2>&1 && echo 'HTTPS (Caddy) yeniden başlatıldı.'",
	"sunucuyeni": "echo 'Sunucu yeniden başlatılıyor, 1-2 dakika sonra panel kendiliğinden açılır.'; (sleep 2; reboot) >/dev/null 2>&1 &",
}

// Komutu çalıştırıp çıktıyı satır satır sayfaya akıtır (Server-Sent Events)
func handleRun(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("a")
	cmd, ok := actions[name]
	flusher, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	send := func(ev, line string) {
		b, _ := json.Marshal(line)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev, b)
		if flusher != nil {
			flusher.Flush()
		}
	}
	if !ok {
		send("end", "bilinmeyen işlem")
		return
	}
	var stdin io.Reader
	if name == "sifre" {
		mu.Lock()
		pw := pendingPw
		pendingPw = ""
		mu.Unlock()
		if len(pw) < 8 || strings.ContainsAny(pw, "'\n\r") {
			send("end", "HATA: şifre en az 8 karakter olmalı ve ' işareti içermemeli")
			return
		}
		stdin = strings.NewReader(pw + "\n")
	}
	if !cfg.KeyOK {
		send("end", "HATA: önce sunucu parolasıyla bağlantıyı kurun")
		return
	}
	s, err := signer()
	if err != nil {
		send("end", "HATA: "+err.Error())
		return
	}
	c, err := dial(ssh.PublicKeys(s))
	if err != nil {
		send("end", "HATA: "+friendly(err).Error())
		return
	}
	defer c.Close()
	sess, err := c.NewSession()
	if err != nil {
		send("end", "HATA: "+err.Error())
		return
	}
	defer sess.Close()
	if stdin != nil {
		sess.Stdin = stdin
	}
	pr, pw := io.Pipe()
	sess.Stdout = pw
	sess.Stderr = pw
	if err := sess.Start(cmd); err != nil {
		send("end", "HATA: "+err.Error())
		return
	}
	go func() { sess.Wait(); pw.Close() }()
	sc := bufio.NewScanner(pr)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		send("line", sc.Text())
	}
	send("end", "")
}
