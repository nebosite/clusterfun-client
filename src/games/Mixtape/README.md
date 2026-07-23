# Mixtape

A music-matching party game for ClusterFun. See [DESIGN.md](DESIGN.md) for the full spec
(state machines, message table, IRV rules, the music-provider abstraction, cut-lines).

## How to play

1. The big screen (**presenter**) shows a scenario prompt and reads it aloud
   (e.g. _"Best song for a 2am road trip"_).
2. On your **phone**, search YouTube and cue the song you think fits best — pick where it
   should start.
3. The presenter plays each song for 30s (a mystery tile for 5s, then title/artist/thumbnail
   fade in — but never who submitted it).
4. Everyone **ranks their top 3** songs on their phones. Songs are tallied with **instant-runoff
   voting**; the submitter of the winning song scores a point.
5. First player to the host's target score wins. The end screen lists every prompt's songs as
   shareable YouTube links.

3–8 players. YouTube search goes through the relay server's `/api/youtube_search` proxy, which
holds the YouTube Data API key server-side (`YOUTUBE_API_KEY`) and caches results across all
rooms — so the key never ships in the client bundle and a search term costs quota at most once.
In the dev Test Lobby (no relay server) a built-in **mock catalog** powers search so the whole
loop runs offline. Real audio plays only when a real YouTube video id is cued — the presenter
embeds the YouTube IFrame player; mock tracks show a silent placeholder tile on the same 30s
timeline.
