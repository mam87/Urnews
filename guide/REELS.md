# «لحظة ريلز» — short vertical videos (`reels.html`)

Full-screen, swipeable feed of YouTube Shorts from verified news and sports publishers. Added 2026-11-07.

## Where the videos come from
* Each publisher's **public Shorts feed**: `https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH<channel id without "UC">`
  (free, no API key, Shorts only). 21 channels seeded in `news_video_channels` — Arabic news (Al Jazeera, Al Arabiya,
  Sky News Arabia, BBC Arabic, Al Mamlaka, France 24 Arabic, DW Arabic, Alaraby, Al Jazeera Mubasher), English news
  (Reuters, AP, BBC News, Al Jazeera English, DW News, Sky News) and sports (FIFA, UEFA, Premier League, LALIGA,
  FC Barcelona, Real Madrid). Every ID was verified on 2026-11-07 (feed answered and its author matched).
* `news_videos_cycle()` (pg_cron job `news-videos`, every 10 min, pg_net — no Edge Function, no secret) collects the
  previous run's responses, keeps entries whose channel matches the feed and whose link is a `/shorts/` URL, stores
  metadata only (id, title, first paragraph of the publisher's caption without links/hashtags, time, thumbnail URL,
  views), links a closely matching Lahza story (same language, last 36 h, trigram similarity ≥ 0.42), deletes videos
  older than 14 days, then requests the feeds that are due. Errors per channel go to `news_video_channels.last_error`.
* Add a channel: insert into `news_video_channels` (channel id, Arabic + English name, `news`/`sports`, `ar`/`en`).
  Switch one off: `update news_video_channels set enabled = false where channel_id = '…'`.

## Playback and rights
* Videos play only in YouTube's **official embedded player** (`youtube-nocookie.com`, privacy-enhanced mode) — nothing is
  downloaded or re-uploaded. Each card names the publisher, shows the publication time and links to the video on
  YouTube; if a publisher disables embedding, the "Watch on YouTube" link still works.
* One player at a time (the card that is ≥ 60 % on screen); others show the thumbnail — saves mobile data.
  Starts muted (browser autoplay rules); after the reader unmutes once, later videos start with sound.
  Play/pause, mute and captions (reloads the player with `cc_load_policy=1`) use YouTube's documented player parameters
  and `postMessage` commands. Keyboard: ↑/↓ (or j/k), space, m.
* Filters: all / news / sports and all / Arabic / English (kept in the URL). Share uses the system share sheet or copies
  `reels.html?v=ID`, which opens that video first.

## Not included, and why
* **Instagram Reels / TikTok:** neither offers a free public feed of a publisher's videos; their APIs need app review and
  account tokens, and scraping is against their terms. Single posts can be embedded by URL if an editor chooses one —
  not automated here.
* Sports clubs and leagues publish mostly in English; Arabic sports broadcasters' channels can be added the same way once
  their channel IDs are verified.

## Tests
`CHROME=/path/to/chrome node tests/ui/reels-smoke.mjs . /tmp/shots` — official embed parameters, one player at a time,
scroll handover, sound/captions/pause, paging, end state, filters, shared link, RTL/LTR, error and empty states.
