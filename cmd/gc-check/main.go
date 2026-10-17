package main

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/repository/postgres"
	"dota-stats/internal/source/coordinator"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/paralin/go-dota2/protocol"
)

func main() {
	dbString := config.DB()
	ctxDb, cancelDb := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelDb()

	db, err := postgres.Open_DB(ctxDb, dbString)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	accounts := config.Load()
	wg := &sync.WaitGroup{}

	historyResult := make(chan []*protocol.CMsgDOTAMatch, len(accounts))
	var allMatches []*protocol.CMsgDOTAMatch

	seen := make(map[uint64]bool)

	checkMatch := func(ctx context.Context, matchId uint64) (bool, error) {
		ctxCH, cancelCH := context.WithTimeout(ctx, 5*time.Second)
		defer cancelCH()
		dbCheck, err := postgres.CheckMatch(ctxCH, db, matchId)
		if err != nil {
			log.Printf("Failed to check match %v: %v", matchId, err)
		}
		if dbCheck == true {
			log.Printf("Match %v found, skip", matchId)
			return true, err
		}
		return false, err
	}

	for _, account := range accounts {
		wg.Add(1)
		go func() {
			defer wg.Done()

			matchIDs, err := coordinator.RunAccount(ctx, account, checkMatch)

			if err != nil {
				log.Printf("Account %v failed: %v", account.Name, err)
				return
			}
			historyResult <- matchIDs
			log.Printf("Acc: %v Match history: %v", account.Name, len(matchIDs))
		}()
	}
	wg.Wait()
	close(historyResult)

	for matches := range historyResult {
		for _, match := range matches {
			matchID := match.GetMatchId()
			if !seen[matchID] {
				seen[matchID] = true
				allMatches = append(allMatches, match)
			}
		}
	}
	log.Printf("Found %d matching IDs, %v", len(allMatches), allMatches)

	for _, match := range allMatches {
		matchData, err := json.Marshal(match)

		if err != nil {
			log.Printf("Failed to marshal match %v: %v", match, err)
			continue
		}

		ctxS, cancelS := context.WithTimeout(ctx, 5*time.Second)

		checkMatch, err := postgres.CheckMatch(ctxS, db, match.GetMatchId())
		if err != nil {
			log.Printf("Failed to check match %v: %v", match, err)
			cancelS()
			continue
		}
		if checkMatch == true {
			log.Printf("Match %v found, skip", match.GetMatchId())
			cancelS()
			continue
		}

		err = postgres.SaveMatch(ctxS, db, *match.MatchId, time.Unix(int64(match.GetStarttime()), 0), *match.Duration, *match.GameMode, *match.LobbyType, matchData)

		if err != nil {
			log.Printf("Failed to save match %v: %v", match, err)
		}
		cancelS()
	}
}
