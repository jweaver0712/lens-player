# Lens Player

YouTube playlists in Meta Ray-Ban Display glasses, controlled with the Neural Band.

- `index.html` is the lens app (600×600). It plays through YouTube's official IFrame player, so ads and creator rules stay intact.
- `setup.html` is the phone page. Paste up to 5 YouTube links and it makes your personal glasses link (lists are stored in the link's `?l=` value, not on a server).

Add the link in the Meta AI app: App Settings → Apps → Web Apps → Connect Web App. Developer mode must be on.

## Extra Neural Band gestures (`band.js`)

The band can't be reprogrammed, and a web app only receives swipe up/down/left/right (arrow keys) and pinch (Enter).
`band.js` builds 8 more gestures out of those, inside the app:

- **Double pinch** opens a 4-way wheel. Swipe a direction to run that slot's action. Pinch again to close.
- **Quick flicks**: two opposite swipes in a row (left-right, right-left, up-down, down-up), each its own action. Focus returns to where it was.

Home › **Gestures** lists every slot. Pinch a row to change what it does; gestures tried on that screen only show their name, so it doubles as practice. Choices stay on the glasses.

Trade-off: with double pinch on, a single pinch waits about a quarter second before it presses. Turning double pinch off on the Gestures screen removes the wait.

Starting set: wheel up = play/pause, right = next, left = previous, down = audio mode; flick left-right = +30 s, right-left = −15 s, up-down = show the time, down-up = back to the video.
