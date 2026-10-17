package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type SteamAccount struct {
	Name  string
	Login string
	Pass  string
	Token string
}

func init() {
	// loads values from .env into the system
	if err := godotenv.Load(); err != nil {
		log.Printf("load .env: %v", err)
	}
}

func DB() string {
	DbUrl := os.Getenv("DB_URL")
	if DbUrl == "" {
		log.Println("DB_URL env variable not set")
	}
	return DbUrl
}

func Load() []SteamAccount {
	account1 := SteamAccount{
		Name:  "whymiutu",
		Login: os.Getenv("ACCOUNT1_USERNAME"),
		Pass:  os.Getenv("ACCOUNT1_PASSWORD"),
		Token: "ACCOUNT1_TOKEN.txt",
	}
	account2 := SteamAccount{
		Name:  "andudu",
		Login: os.Getenv("ACCOUNT2_USERNAME"),
		Pass:  os.Getenv("ACCOUNT2_PASSWORD"),
		Token: "ACCOUNT2_TOKEN.txt",
	}
	accounts := []SteamAccount{account1, account2}
	return accounts
}
