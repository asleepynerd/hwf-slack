## the gist

fuck you, firebase. that's the main takeaway from this

oookay, so i finally did it. i reverse engineered the "How We Feel" app. i'd tried before and failed miserably because reading smali code makes my eyes bleed. turns out, i was overthinking it (by quite a lot actually)

the app is just a pretty frontend for a Firebase backend. that's literally it. there's no magic, just a ton of firestore documents and a few cloud functions holding it all together

this repo contains the result: a slack bot that uses the unofficial, reverse engineered api to post my friends' feelings into their own slack channels.

---

## the "how the fuck did you do this" section

it was a pain in the ass, but here's the short version:

1.  decompiling the apk: threw the app's apk into jadx. it spits out mostly readable java, which is way better than the smali nightmare

2.  api calls: searched the code for keywords like "friends," "firebase," and "groups." this led me down a rabbit hole of obfuscated class names (`Ii.b`, `ii.s`, you get the idea) until i found the code that actually talks to firestore. the collection is just called `"groups"`. simple (right?)

3.  fucking authentication: this was the worst part. couldn't just log in. had to use mitmproxy to sniff the traffic between my phone and google's servers. the app does this stupid multi step dance:
    *   logs into google to get a google token.
    *   immediately trades that google token with firebase to get a ✨firebase refresh token ✨
    *   that refresh token is the key to everything. i snagged it from the network traffic one time, and now my script can pretend to be the app forever (cool right?)

4.  extracting the shapes: the little animated blobs for each feeling weren't pngs or svgs. they were android VectorDrawable xml files, buried in the `res/drawable` folder. wrote a basic python script to automatically parse all of them, figure out which ones were the final shapes vs. the starting shapes, find their colors, and convert the whole mess into clean `.svg` files. again, pretty simple.

---

## warning?: this code is jank as hell

seriously, do not use this in production. i wrote this while fueled by caffeine and spite. it's held together with tape and tears at this point.

*   the error handling is probably nonexistent.
*   if the app updates, this will break instantly.
*   there are no tests. the only test is if it works. right now, it works. tomorrow? who knows lmao

wait until I clean this up and write a proper setup guide before you even think about running this yourself :3

ok thx baiii
