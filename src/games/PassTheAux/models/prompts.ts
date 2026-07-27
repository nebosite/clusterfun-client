// The built-in scenario prompt bank.
//
// Edit prompts as plain lines in the block below: ONE PROMPT PER LINE, no quotes and no
// commas.  Blank lines and lines starting with "#" are ignored, so you can group or annotate.
// (Apostrophes are fine as-is — the block is a backtick string, so nothing needs escaping.)
//
// A game shuffles a copy of the parsed list and draws from it without repeats until it is
// exhausted (then reshuffles).  Host-typed custom prompts are a deferred feature (see
// DESIGN.md cut-lines).
const RAW_PROMPTS = `
The background music your uncle picks for the slideshow of their vacation in China
When you bite into a soggy sandwich
2 AM road trip
Running through the rain with your best friend
A bad omen for your upcoming job interview
The song that should play when you walk into the room
Your neighbor's secret karaoke go-to song
Combination Taco Bell - McDonald's location background music
Give me your worst earworm
"I would say I have good taste in music."
Lost in the woods
Looking into the eyes of a stranger on the subway
What you wish you could say to your boss
The song that didn't deserve its popularity
Bird watching
The color red expressed as music
The color brown expressed as music
The ringtone you set for your ex's number
First day of school
When the nearest gas station is 50 miles away and your fuel light just came on
When you look into your newborn baby's eyes for the first time
Biting into a fresh fruit in the summer
What Batman listens to when he needs to get pumped up
Ninja training montage
When you chop some onions
What your pet listens to when you're not home
The song everyone else thinks is your favorite song
Sparkles and glitter
The song you need to scrape off the bottom of your shoe
The modern song that will be remembered 100 years from now
The good guy walks into the bar and the bad guy is already there
The waiter serves you a giant plate of spaghetti and meatballs
When you wake up in the middle of the night remembering that embarrassing thing you did 10 years ago
The ultimate pump-up song before a big moment
Best song to cry in the shower to
The song that always gets the whole party dancing
Most embarrassing song to blast with the windows down
The song you'd want playing during the closing credits of your life
The most underrated song of all time
Best song to hype up a workout
The song that instantly takes you back to being a kid
A rainy day by the window
The final dance at a wedding reception
Best song to sing badly at karaoke
The song you'd play to impress someone you just met
Hacking into the mainframe
The most average song ever written
Best song to break a bad mood
Spring cleaning playlist starter
The perfect song for a heartbreak recovery playlist
Best song to introduce someone to your favorite genre
The song that feels like a warm hug
Best song to blast to annoy your neighbors
The song you'd pick to represent your whole personality
Waiting in line at the DMV
Getting ready for a first date
Watching the loading bar on a slow website
When you open the curtains and get blinded by the sun
The song you liked but didn't truly understand until years later
The song you wish you could enjoy again for the first time
The song you wish you could get into but just can't
The song that you wish you could go back in time and tell the artist to never release
The song that you wish you could go back in time and show to Mozart
Backing track to Martin Luther King Jr.'s "I Have a Dream" speech
You got a surprise package in the mail
The clouds parted and the sun shone down on you
The wind is picking up...
Mowing the lawn at midnight
Surprise me!
The feeling of utter confusion
Riding in a motorcycle gang through the desert
The pilots are incapacitated and the steward asks if anyone on board can fly the plane
Don't. Don't play it. Yes, that song you're thinking of: Don't. I mean it!
Walking though the neighborhood alone at night
The most quotable song in existence
The popular song nobody really knows the lyrics to
The cover song that is better than the original
A song that should never have had words added to it
Painting together with Bob Ross
Hanging out with Mister Rogers
Watching saturday morning cartoons
Shaking hands with the President of the United States
You are the last person on Earth and you find a working jukebox
If onions made music
Running through the airport to catch your flight
Finding a dusty box of old photos in the attic
Staring contest
How to hype up a crowd of toddlers
`;

// One prompt per non-blank, non-comment line.
export const PASS_THE_AUX_PROMPTS: string[] = RAW_PROMPTS.split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));
