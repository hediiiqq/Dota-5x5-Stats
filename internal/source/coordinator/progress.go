package coordinator

import "context"

// Progress reports stage changes and counter increments during GC requests.
type Progress struct {
	Stage                                  string
	Discovered, Existing, Filtered, Failed int64
}

func reportProgress(ctx context.Context, p Progress, observers []func(context.Context, Progress) error) error {
	for _, observer := range observers {
		if err := observer(ctx, p); err != nil {
			return err
		}
	}
	return nil
}
