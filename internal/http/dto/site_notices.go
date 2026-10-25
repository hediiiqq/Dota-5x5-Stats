package dto

type SiteNotice struct {
	Id   string `json:"id"`
	Text string `json:"text"`
}

type SiteNoticesResponse struct {
	Items []SiteNotice `json:"items"`
}

type SiteNoticeRequest struct {
	Text string `json:"text"`
}
