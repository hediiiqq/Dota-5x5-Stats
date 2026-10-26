package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type SteamAccount struct {
	ID    string
	Name  string
	Login string
	Pass  string
	Token string
}

type AuthConfig struct {
	PublicBaseURL string
	AdminSteamIDs map[string]struct{}
	CSRFSecret    []byte
}

const AdminSessionTTL = 15 * 24 * time.Hour

func init() {
	// loads values from .env into the system
	if err := godotenv.Load(); err != nil {
		log.Printf("Не удалось загрузить файл .env; переменные окружения процесса остаются доступны: %v", err)
	}
}

func DB() string {
	DbUrl := os.Getenv("DB_URL")
	if DbUrl == "" {
		log.Println("Переменная окружения DB_URL отсутствует или пуста")
	}
	return DbUrl
}

func SteamWebAPIKey() string {
	return os.Getenv("STEAM_WEB_API_KEY")
}

func StratzToken() string {
	return os.Getenv("STRATZ_TOKEN")
}

func Load() []SteamAccount {
	account1 := SteamAccount{
		ID:    "account1",
		Name:  "whymiutu",
		Login: os.Getenv("ACCOUNT1_USERNAME"),
		Pass:  os.Getenv("ACCOUNT1_PASSWORD"),
		Token: "ACCOUNT1_TOKEN.txt",
	}
	account2 := SteamAccount{
		ID:    "account2",
		Name:  "andudu",
		Login: os.Getenv("ACCOUNT2_USERNAME"),
		Pass:  os.Getenv("ACCOUNT2_PASSWORD"),
		Token: "ACCOUNT2_TOKEN.txt",
	}
	accounts := []SteamAccount{account1, account2}
	return accounts
}

func LoadAuthConfig() (AuthConfig, error) {
	baseURL := strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL"))
	parsedURL, err := url.Parse(baseURL)
	if err != nil || parsedURL.Scheme != "https" || parsedURL.Hostname() == "" ||
		parsedURL.User != nil || parsedURL.Opaque != "" ||
		(parsedURL.Path != "" && parsedURL.Path != "/") ||
		parsedURL.RawQuery != "" || parsedURL.ForceQuery || strings.Contains(baseURL, "#") {
		return AuthConfig{}, fmt.Errorf("PUBLIC_BASE_URL: требуется полный HTTPS-адрес без пути, учётных данных, query и fragment")
	}
	if port := parsedURL.Port(); port != "" {
		portNumber, err := strconv.ParseUint(port, 10, 16)
		if err != nil || portNumber == 0 {
			return AuthConfig{}, fmt.Errorf("PUBLIC_BASE_URL: недопустимый порт")
		}
	}

	authConfig := AuthConfig{
		PublicBaseURL: strings.TrimSuffix(baseURL, "/"),
		AdminSteamIDs: make(map[string]struct{}),
	}

	csrf := os.Getenv("ADMIN_CSRF_SECRET")

	if csrf == "" {
		return AuthConfig{}, errors.New("ADMIN_CSRF_SECRET пустой")
	}

	csrfToken, err := base64.StdEncoding.DecodeString(csrf)

	if err != nil {
		return AuthConfig{}, errors.New("Ошибка декодирования ADMIN_CSRF_SECRET ")
	}

	if len(csrfToken) != 32 {
		return AuthConfig{}, errors.New("ADMIN_CSRF_SECRET: после декодирования требуется 32 байта")
	}
	authConfig.CSRFSecret = csrfToken

	rawIDs := strings.TrimSpace(os.Getenv("ADMIN_STEAM_IDS"))
	if rawIDs == "" {
		return authConfig, nil
	}
	for index, value := range strings.Split(rawIDs, ",") {
		id := strings.TrimSpace(value)
		// SteamID64 must contain decimal digits only.
		if id == "" || strings.IndexFunc(id, func(r rune) bool { return r < '0' || r > '9' }) != -1 {
			return AuthConfig{}, fmt.Errorf("ADMIN_STEAM_IDS: элемент %d должен быть положительным десятичным SteamID64", index+1)
		}
		numericID, err := strconv.ParseUint(id, 10, 64)
		if err != nil || numericID == 0 {
			return AuthConfig{}, fmt.Errorf("ADMIN_STEAM_IDS: элемент %d вне допустимого диапазона uint64", index+1)
		}
		authConfig.AdminSteamIDs[strconv.FormatUint(numericID, 10)] = struct{}{}
	}

	return authConfig, nil
}
