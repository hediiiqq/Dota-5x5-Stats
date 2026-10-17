package main

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/source/coordinator"
	"log"
	"sync"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	accounts := config.Load()
	wg := &sync.WaitGroup{}
	historyResult := make(chan []uint64, len(accounts))

	seen := make(map[uint64]bool)
	var allMathcIds []uint64

	for _, account := range accounts {
		wg.Add(1)
		go func() {
			defer wg.Done()

			matchIDs, err := coordinator.RunAccount(ctx, account)

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

	for matchIDs := range historyResult {
		for _, matchID := range matchIDs {
			if !seen[matchID] {
				seen[matchID] = true
				allMathcIds = append(allMathcIds, matchID)
			}
		}
	}
	log.Printf("Found %d matching IDs, %v", len(allMathcIds), allMathcIds)
}
