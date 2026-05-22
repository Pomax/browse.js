# Browse dot JS

A super-simple but super-useful image browsing script.
Run as `node browse` in whatever toplevel dir houses all
your images, and then just fire up http:/localhost:8080

It will treat its own folder as root, and allow you to
browse any subfolder as either a dir listing (if there are
no images in it) or gallery (if there are).

Or, if you need a custom port use `node browse --port 12345`
with the obvious port number replacement.

## Requirements

- Node 22 or newer
- 7z CLI utility

## Code notes

This code is organized in blocks that any IDE should be able
to collapse/expand as needed to keep it easy to work on. But,
if your editor has no collapse/expand, there's also heading
comments to find your way around the code.

## How to browse

Basic avigation is pretty self-explanatory, and clicking an
image in an image gallery will swith to a "fullscreen" mode.

### Gallery mode controls

- click an image = load that image
- home/end = load first/last image
- left/right = load prev/next image
- pgup/pgdn = same
- up/esc or the "up" link = go up a dir
- the "delete" button = delete this entire folder

### Full screen mode controls:

- up/esc = exit full screen
- home/end = load first/last image
- left/right = load prev/next image
- pgup/pgdn = same

### Active regions in full screen

- top 25% of the image = exit full screen
- bottom 75% of the image:
  - left half = load previous image
  - right half = load next image

### Dir listings

While on a dir listing you can drag-and-drop a zip file
onto the dir and it will simply unpack the zip file as
its own subdir in that dir. Handy!

## Notes

The URL will update based on what you're doing, and you
can always reload/copy-paste the link to get the same
view you were looking at for that URL. That should be
obvious, but not every web based tool bothers with that.

## Contact

Either hit up the issue tracker over on the issue tracker
https://github.com/Pomax/browse.js/issues, or toot at
me on https://mastodon.social/users/@TheRealPomax
