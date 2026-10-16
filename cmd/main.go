package main

import (
	"context"
	"dota-stats/internal/config"
	"dota-stats/internal/source/coordinator"
	"sync"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	accounts := config.Load()
	wg := &sync.WaitGroup{}
	for _, account := range accounts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			coordinator.RunAccount(ctx, account)
		}()
	}
	wg.Wait()
}
