package metadata

import (
	"bufio"
	"compress/bzip2"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/klauspost/compress/zstd"
	"github.com/paralin/go-dota2/protocol"
)

type HTTPStatusError struct{ StatusCode int }

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("сервер метаданных ответил HTTP %d", e.StatusCode)
}

func CheckMetadata(matchId uint64, cluster uint32, replaySalt uint64) ([]byte, error) {
	return CheckMetadataContext(context.Background(), matchId, cluster, replaySalt)
}

func CheckMetadataContext(ctx context.Context, matchId uint64, cluster uint32, replaySalt uint64) ([]byte, error) {

	url := "http://replay" + strconv.FormatUint(uint64(cluster), 10) + ".valve.net/570/" + strconv.FormatUint(matchId, 10) + "_" + strconv.FormatUint(replaySalt, 10) + ".meta.bz2"

	client := http.Client{
		Timeout: 60 * time.Second,
	}

	var zipType io.Reader

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(request)
	if err != nil {
		log.Printf("MetadataCheck Error: %s\n", err)
		return nil, err
	}
	defer func(Body io.ReadCloser) {
		err := Body.Close()
		if err != nil {
			log.Printf("MetadataCheck Error: %s\n", err)
		}
	}(resp.Body)

	if resp.StatusCode != http.StatusOK {
		log.Printf("MetadataCheck Bad status: %s для id: %v\n", resp.Status, matchId)
		return nil, &HTTPStatusError{StatusCode: resp.StatusCode}
	}

	log.Printf("metedata return :%v", resp)

	log.Printf("URL: %s; Content-Type: %s",
		resp.Request.URL,
		resp.Header.Get("Content-Type"),
	)

	body := bufio.NewReader(resp.Body)

	header, err := body.Peek(4)
	if err != nil {
		log.Printf("Не удалось прочитать заголовок файла: %v", err)
		return nil, err
	}

	log.Printf("Первые байты: %q; hex: % x", header, header)

	if header[0] == 0x28 && header[1] == 0xb5 && header[2] == 0x2f && header[3] == 0xfd {

		decoder, err := zstd.NewReader(body)
		if err != nil {
			log.Printf("Ошибка создания zstd-декодера: %v", err)
			return nil, err
		}
		zipType = decoder
		defer decoder.Close()

	} else if string(header[:3]) == "BZh" {

		zipType = bzip2.NewReader(body)

	} else {
		log.Printf("не известный формат архива метадаты")
		return nil, errors.New("не известный формат архива метадаты")
	}

	data, err := io.ReadAll(zipType)
	if err != nil {
		log.Printf("Ошибка распаковки метаданных: %v", err)
		return nil, err
	}

	log.Printf("Распаковано %d байт", len(data))

	metadataFile := &protocol.CDOTAMatchMetadataFile{}

	if err := metadataFile.UnmarshalVT(data); err != nil {
		log.Printf("Ошибка разбора protobuf: %v", err)
		return nil, err
	}

	if metadataFile.GetMatchId() != matchId {
		log.Printf("ID матча не совпал: получен %d, ожидался %d",
			metadataFile.GetMatchId(), matchId)
		return nil, errors.New("ID матча не совпал")
	}

	metadata := metadataFile.GetMetadata()
	if metadata == nil {
		log.Printf("Файл разобран, но поле metadata отсутствует")
		return nil, errors.New("Файл разобран, но поле metadata отсутствует")
	}

	log.Printf("Матч: %d; команд: %d",
		metadataFile.GetMatchId(),
		len(metadata.GetTeams()),
	)
	for i, team := range metadata.GetTeams() {
		log.Printf(
			"Запись %d: dota_team=%d; игроков=%d; XP=%d; золото=%d; net worth=%d",
			i,
			team.GetDotaTeam(),
			len(team.GetPlayers()),
			len(team.GetGraphExperience()),
			len(team.GetGraphGoldEarned()),
			len(team.GetGraphNetWorth()),
		)
	}
	mvp := metadata.GetMvpData()
	if mvp == nil {
		log.Printf("Поле MVP отсутствует")
	} else {
		log.Printf("Записей MVP: %d", len(mvp.GetMvps()))

		for _, entry := range mvp.GetMvps() {
			log.Printf("MVP: player_slot=%d; отличий=%d",
				entry.GetPlayerSlot(),
				len(entry.GetAccolades()),
			)
		}
	}
	jsonData, err := json.MarshalIndent(metadataFile, "", "  ")
	if err != nil {
		log.Printf("Ошибка преобразования в JSON: %v", err)
		return nil, err
	}

	return jsonData, nil

}
