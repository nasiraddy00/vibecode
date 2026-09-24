# Running the live terminal

Five steps, about five minutes. Everything below is free.

---

## 1. Install Node.js

Node 22 LTS, from **https://nodejs.org** — download, run the installer, accept
the defaults.

Check it worked. Open Terminal (macOS) or PowerShell (Windows) and run:

```bash
node -v
```

You want `v22.x` or higher. Node 20.9+ works, but 22 avoids an edge case on
corporate networks.

## 2. Get the code

```bash
git clone -b claude/day-trading-signal-website-zcyeeg https://github.com/nasiraddy00/vibecode.git
cd vibecode
```

The `-b` matters — the work is on that branch, not on `main`.

## 3. Install the dependencies

```bash
npm install
```

Two or three minutes the first time. Warnings are normal; errors are not.

## 4. Add your Finnhub key

Get one free at **https://finnhub.io/register** (sixty seconds, no card).
Then, in the `vibecode` folder:

```bash
cp .env.example .env.local
```

Open `.env.local` in any text editor and put your key on the `FINNHUB_API_KEY`
line so it reads:

```
FINNHUB_API_KEY=your_key_here
```

Save it. `.env.local` is git-ignored, so the key never leaves your machine.

> Skipping this still works — crypto, indexes, commodities and FX need no key
> at all. You would lose live US stock quotes, the 31,000-symbol search, and
> analyst/earnings/insider data.

## 5. Start it

```bash
npm run dev
```

Wait for `Ready`, then open **http://localhost:3000**.

Leave that terminal window open — closing it stops the site. `Ctrl+C` stops it
deliberately.

---

## Check that it is actually live

```bash
npm run doctor
```

It probes one instrument per asset class and prints what is live and what is
not. All green means real market data. If something is down it names the
reason and the fix rather than just failing.

You can also read it off the screen: every panel carries a provenance badge.
`LIVE` is measured market data, `SIM` is the simulator. The bar at the bottom
summarises which feeds are up.

---

## If something goes wrong

**`command not found: git`** — install Git from https://git-scm.com, or
download the repo as a ZIP from GitHub and unzip it.

**`Port 3000 is in use`** — something else is on that port:

```bash
npm run dev -- -p 3001
```

Then use http://localhost:3001.

**Everything shows `SIM`** — run `npm run doctor`; it will say why. The usual
causes are no internet, a firewall blocking the data hosts, or a mistyped key.

**Stocks show `SIM` but crypto is `LIVE`** — that is the key. Check
`.env.local` has no quotes, no spaces around the `=`, and no trailing blank.
Restart with `Ctrl+C` then `npm run dev`; the file is only read at startup.

**Feeds are down but the sites load fine in your browser** — you are behind a
proxy. Use the `npm run` scripts rather than calling `next` or `tsx` directly;
they set the flag that makes Node respect your proxy settings.

---

## Coming back to it later

```bash
cd vibecode
npm run dev
```

Steps 1–4 are one-time. To pick up changes later, `git pull` first.
