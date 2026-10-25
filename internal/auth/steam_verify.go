package auth

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func VerifySteamOpenIDSignature(ctx context.Context, params url.Values) error {

	verificationParams := url.Values{}

	for key, values := range params {
		if strings.HasPrefix(key, "openid.") {
			for _, value := range values {
				verificationParams.Add(key, value)
			}
		}
	}

	verificationParams.Set("openid.mode", "check_authentication")

	body := strings.NewReader(verificationParams.Encode())

	req, err := http.NewRequestWithContext(ctx, "POST", "https://steamcommunity.com/openid/login", body)

	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	resp, err := client.Do(req)
	if err != nil {
		return ErrSteamAuthUnavailable
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ErrSteamAuthUnavailable
	}

	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 8193))
	if err != nil {
		return ErrSteamAuthUnavailable
	}
	if len(responseBody) > 8192 {
		return ErrSteamAuthUnavailable
	}

	fields := make(map[string]string)
	lines := strings.Split(string(responseBody), "\n")

	for index, line := range lines {
		if line == "" && index == len(lines)-1 {
			continue
		}

		key, value, ok := strings.Cut(line, ":")
		if !ok || key == "" {
			return ErrSteamAuthUnavailable
		}

		if _, exists := fields[key]; exists {
			return ErrSteamAuthUnavailable
		}

		fields[key] = value
	}

	if fields["ns"] != "http://specs.openid.net/auth/2.0" {
		return ErrSteamAuthUnavailable
	}

	switch fields["is_valid"] {
	case "true":
		return nil
	case "false":
		return ErrSteamAuthInvalid
	default:
		return ErrSteamAuthUnavailable
	}

}
