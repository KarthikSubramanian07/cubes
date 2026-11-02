# About cubes

cubes is an original territory game about light that spreads by its corners, made by Karthik Subramanian. It is free to play, has no ads, no accounts and no tracking, and its source code is public under the MIT license.

## Why it exists

Good board games deserve to be one link away. cubes was built so that two to four people can be playing together within seconds of opening a URL, on a laptop, a phone or a tablet, without installing anything or signing up for anything. If nobody is around, three levels of bots are always ready, and they run on your own device.

## What makes it different

The core rule fits in one sentence: every new shard must touch your own light at a corner and never along a side. On top of that, cubes adds Cores, glowing nodes and charge, four surges (Spark, Leap, Shatter and Scan), fog of war, a collapsing storm, a board that wraps around, team play, and two 3D modes with their own geometry. The board sizes and the second player's starting charge were tuned from thousands of bot-against-bot games, and the numbers are published.

## How it is built

The rules engine, move generation and bots are written in Rust. The same code runs in your browser as WebAssembly and on Cloudflare as the referee for online rooms, so the two can never disagree. Each online room is a Cloudflare Durable Object. The boards are drawn with three.js (the glowing Night look) and SVG (the hand-inked Paper look), and every sound is synthesised in the browser.

## Open source

Everything is on GitHub: [github.com/KarthikSubramanian07/cubes](https://github.com/KarthikSubramanian07/cubes). The design spec, the balance notes and every line of code are there to read, and contributions are welcome.

[Contact](https://playcubes.pages.dev/contact) · [Privacy](https://playcubes.pages.dev/privacy) · [Play](https://playcubes.pages.dev/play)
