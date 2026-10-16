package coordinator

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/paralin/go-dota2"
	"github.com/paralin/go-dota2/events"
	"github.com/paralin/go-steam"
	"github.com/paralin/go-steam/protocol/protobuf/unified"
	"github.com/paralin/go-steam/protocol/steamlang"
	"github.com/sirupsen/logrus"

	"dota-stats/internal/config"
)

func RunAccount(ctx context.Context, account config.SteamAccount) {

	accountCtx, accountCancel := context.WithTimeout(ctx, 5*time.Minute)
	defer accountCancel()
	steamLoginInfo := new(steam.LogOnDetails)
	steamLoginInfo.Username = account.Login
	steamLoginInfo.Password = account.Pass
	steamLoginInfo.DeviceFriendlyName = "Dota 5x5 stats"
	steamLoginInfo.ConfirmSteamGuard = func(
		ctx context.Context,
		confirmations []steam.SteamGuardConfirmation,
	) (string, unified.EAuthSessionGuardType, error) {
		for _, confirmation := range confirmations {
			if confirmation.Type == unified.EAuthSessionGuardType_k_EAuthSessionGuardType_DeviceConfirmation {
				log.Printf("Подтверди вход в приложении Steam на телефоне %v", account.Name)
				return "", confirmation.Type, nil
			}
		}
		return "", 0, fmt.Errorf("Steam не предложил подтверждение через телефон %v", account.Name)
	}
	steamLoginInfo.ShouldRememberPassword = true

	if file, err := os.ReadFile(account.Token); err == nil {
		steamLoginInfo.AccessToken = string(bytes.TrimSpace(file))
	} else if os.IsNotExist(err) == true {
		log.Printf("файла не существует %v", account.Name)
	} else {
		log.Printf("failed to read %v file: %v %v", account.Token, err, account.Name)
	}

	client := steam.NewClient()
	defer client.Disconnect()
	dota := dota2.New(client, logrus.New())
	defer dota.Close()

	if _, err := client.ConnectContext(accountCtx); err != nil {
		log.Printf("Steam connection failed: %v %v", err, account.Name)
		return
	}

	for {
		select {
		case event := <-client.Events():
			switch event := event.(type) {
			case *steam.ConnectedEvent:
				log.Printf("Connected to Steam %v", account.Name)
				go func() {
					authCtx, authCancel := context.WithTimeout(accountCtx, 180*time.Second)
					defer authCancel()
					if steamLoginInfo.AccessToken == "" {
						token, err := client.Auth.Authenticate(authCtx, steamLoginInfo)
						if err != nil {
							log.Printf("Steam authentication failed: %v %v", err, account.Name)
							accountCancel()
							return
						}
						steamLoginInfo.AccessToken = token
						err = os.WriteFile(account.Token, []byte(token), 0600)
						if err != nil {
							log.Printf("failed write file: %v %v", err, account.Name)

						}

					}

					if err := client.Auth.LogOn(authCtx, steamLoginInfo); err != nil {
						log.Printf("Steam login failed: %v %v", err, account.Name)
						accountCancel()
					}
				}()
			case *steam.LoggedOnEvent:
				if event.Result == steamlang.EResult_OK {
					log.Printf("Logged on steam %v", account.Name)
					dota.SetPlaying(true)
					dota.SayHello()
					log.Println("Приветстие GC отправленно")
				} else {
					log.Printf("Steam login failed: %v %v", event.Result, account.Name)
					accountCancel()
				}
			case *steam.LogOnFailedEvent:
				log.Printf("failed to log on steam: %v, auth session state: %v %v", event.Err, event.AuthSessionState, account.Name)
				accountCancel()
				return
			case *steam.DisconnectedEvent:
				log.Printf("Disconnected from Steam %v", account.Name)
				return
			case *events.ClientWelcomed:
				log.Printf("Координатор Доты готов %v", account.Name)
				accountId := client.SteamId().GetAccountId()
				go HistoryDota(accountCtx, dota, &accountId)
			case *events.GCConnectionStatusChanged:
				log.Printf("GC connection status changed:%v %v", event.NewState, account.Name)

			case error:
				log.Printf("Steam error: %v %v", event, account.Name)
				return

			}
		case <-accountCtx.Done():
			log.Printf("Connection timed out %v", account.Name)
			return
		}
	}

}
