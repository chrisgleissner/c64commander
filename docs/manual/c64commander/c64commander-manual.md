# C64 Commander Manual

Play SID music, run games and demos, mount disks, and control a Commodore 64 Ultimate, Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite II, or Ultimate-II from one app.

![C64 Commander launch screen](../../img/app/launch/profiles/medium/04-app-ready.png)

## Table of Contents

- [Welcome](#welcome)
- [Before You Start](#before-you-start)
- [First Connection](#first-connection)
- [Your First Tour](#your-first-tour)
- [Everyday Flows](#everyday-flows)
- [In Depth](#in-depth)
- [Safe Device Use](#safe-device-use)
- [Troubleshooting](#troubleshooting)
- [Appendices](#appendices)
  - [Feature Reference](#feature-reference)
  - [Keyboard and Directional Input Reference](#keyboard-and-directional-input-reference)
  - [File and Source Reference](#file-and-source-reference)
  - [Network Ports and Services](#network-ports-and-services)
  - [Device Safety Modes](#device-safety-modes)
  - [Drive Types and Disk Formats](#drive-types-and-disk-formats)
  - [Snapshot Types and Memory Ranges](#snapshot-types-and-memory-ranges)
  - [Health Check Probes](#health-check-probes)
  - [Status and Safety Reference](#status-and-safety-reference)

## Welcome

C64 Commander puts your C64 on the screen in your hand: its music, its games, its disks and its settings, over your own network and nobody else’s.

- **It plays.** SID music, games, demos and disk images, from your own files, from the machine itself, or from the great free archives.
- **It controls.** Reset, reboot, the menu, the drives, the printer, the SID mixer, memory and every setting the machine has.
- **It explains.** When something will not answer, health checks, logs and traces say what happened and where.

Read the tour if the app is new to you: it is short, and it goes page by page. Come back to the reference chapters when you already know what you want and only need to find it.

## Before You Start

### Supported Machines

C64 Commander works with the Commodore 64 Ultimate, Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite II, and Ultimate-II.

The app may call the device-file source **C64U** in lists and pickers. In that place, read it as storage on the connected Ultimate-family device, reached through FTP.

Three things have to work together: the device running the app, the connected Ultimate-family device, and the network between them.

Put the device running the app and the connected Ultimate-family device on the same Wi-Fi or wired network. Then, on the machine itself, open **Network Services & Timezone**.

![C64 Ultimate Network Services & Timezone menu](../../img/setup/enable_services.png)

Enable the services the app uses:

- **Web Remote Control Service** carries almost everything: the controls, the status, the settings. The app needs it.
- **FTP File Service** carries the files, so the app can browse the machine, build playlists and mount disks.
- **Telnet Remote Menu Service** carries a handful of extra actions that reach into the device menu. Turn it on if you want those.

Note the IP address under **Wired Network Setup** or **WI-FI Network Setup**. You will want it if the app cannot find the connected Ultimate-family device by itself.

## First Connection

Start C64 Commander. If no saved device is reachable, it scans the local network for supported devices.

If devices are found, the app opens **Choose your C64**:

1. Choose **Use** to connect now.
2. Choose **Save** to keep the device for later.
3. If the device is password-protected, enter its network password when asked.

If no devices are found, C64 Commander opens **No C64 found**, a manual setup prompt.

Enter a hostname such as `c64u`, `u64`, or `u2`, or an IP address such as `192.168.1.64`, then choose **Connect**. If the device answers but requires a password, the same dialog asks for it before saving and connecting.

Now watch the top right of the screen. A green badge there means the active device is answering, and you are ready to go on. You can scan again later from **Settings → Connection → Discover devices**.

### Starting With No Network

Start C64 Commander on a phone or tablet that has no network connection at all (airplane mode, or Wi-Fi and mobile data both off) and none of the above happens. There is nothing to scan for, so the app does not scan, does not ask you anything, and opens straight onto a built-in simulation of a Commodore 64 Ultimate, Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite II, or Ultimate-II. The badge reads **Demo mode**, so you always know which one you are looking at.

Everything the simulator answers for is yours to try: Home, the configuration, disks and drives, the playlist, and Remote Input. It answers the same network services a real machine does, but it runs no 6502 and sends no picture or sound, so programs and tunes do not play on it and Live View has nothing to show.

When you do have hardware, connect to it from **Settings → Connection**. Once the app has reached a real device, it stays with it for the rest of the session.

## Your First Tour

Start here if the app is new to you. This chapter goes through the app a page at a time and says what each page is for, beginning with two things you can reach from anywhere: the health badge in the corner, and search.

### The Header Badge

The badge at the top right tells you how the connected device is doing: healthy, degraded, unhealthy, or offline. Tap it to open Diagnostics. While the app is offline, the same tap also tries the connection again. Long-press the badge, press `#`, or use the Quick menu to open **Switch device**.

### Finding Your Way

Search covers the whole app: every page, every card, every setting the app owns, your disk collection, the HVSC archive, and the tunes you have liked or played recently. Type two or three letters and pick what you want.

Your machine's own settings join in once the Config page has read them, so open **Config** first if you are hunting for a device setting by name.

Open it in any of three ways:

- Tap the **search field** at the top of Home.
- Choose **Search**, the first entry of the **Quick menu**.
- Press **`7`**, which works even with directional navigation switched off.

Keep typing while you look: Up and Down move through the results and leave your text alone. OK opens the selected result, and Back closes search. Results are grouped, best match first, so typing `radio` offers you **Start SID Radio** ahead of any tune with the word in its title.

![Search, one query in](../../img/app/home/search/profiles/medium/01-overlay.png)

**A result you cannot use yet is still listed, and it tells you what it needs:** "Needs a connected C64 Ultimate", "Needs the HVSC music collection installed", "Live View is turned off in Settings". Pick it and you go straight to the setting that turns it on.

Search finds your music too. Pick a tune from the HVSC collection and **Find a tune** opens on the Play tab with that title already filled in.

Leave the box empty and search offers you four things worth doing first, then your recent searches.

### The Tour

The first time you open C64 Commander, it offers you a short guided walk through the app itself. It takes you to each page in turn, spotlights one thing, and explains it in a line or two.

**Next** and **Back** move you along, **Skip** ends the tour, and a step counter shows how far you have come. On a keypad, Left and Right are Back and Next, OK is Next, and the Back key leaves. Stop whenever you like.

To take it again, open **Docs** and use the card at the top, or go to **Settings → About → Take the tour**. If you took the tour before connecting your C64, Home offers you the steps you missed the first time your machine answers.

### Home

Home groups the day-to-day controls.

![Home overview](../../img/app/home/profiles/medium/01-overview.png)

Start at the top. The search field comes first, and under it **Quick Actions**.

Three of those tiles work without a C64 at all. **Radio** starts a SID Radio station of thousands of tunes, played on this device. **Last** picks up your last tune where it stopped, and names it underneath. **Recent** takes you back to anything you have opened before.

**Live** does need a machine, and takes you to the card that brings its picture and sound into the app. A tile you cannot use yet is still there, grayed, telling you what it needs.

The grid runs in four bands. **Watch** first: Live, Game and Input. **Listen** next: Radio, Last and Recent. Then the everyday controls: Menu, Pause/Resume, and **Backup** and **Restore** for the machine's memory. Last come **Reset** and **Power**, which interrupt whatever your C64 is doing.

The **Game** and **Input** tiles open the second-screen joystick and keyboard for the C64. Both have their own walkthrough in [Remote Input](#remote-input), later in this guide.

Tap **Power** for **Reboot**, **Power Cycle** where your device supports it, and **Power Off**. Those, and **Reset**, ask you to confirm first.

Two more actions can join the **Power** sheet: **Reboot (Clr Mem)**, which wipes memory on the way, and **Power Cycle**. Both reach the machine through the Telnet menu service, so switch Telnet on at the device first. Their own switches are **Home clear-RAM reboot action** and **Home power cycle action**, in **Settings → Experimental Features**.

Directly below sits **Live View**, which brings the sound and the picture of the running machine into the app. It is a card like the ones below it and starts closed, so tap its header to reach the switches inside; while it is playing, a **Reset** in that header stops both feeds without opening it. It has a chapter of its own later on.

Keep going and the rest of Home is a set of cards, and tapping a header opens or closes one.

**CPU & RAM** holds the processor speed, turbo behavior and the RAM expansion. **Ports** follows, with the joystick swap, the serial bus, the cartridge preference and the user port.

**Video** holds the output mode, resolution and scan lines, and **Audio**, directly below it, the SID mixer's channel strips. **User Interface** rounds the group out, and, on a machine that has them, so does **Lighting**, for the case and keyboard lights.

The remaining cards cover drives, the printer, streams, and **Config**. That last one holds **Save**, which writes the current settings into flash on the connected Ultimate-family device so they survive a power cycle, along with Load, Reset, Revert, and the app's own named configuration snapshots.

Some cards start open and some start closed, and the app remembers what you left open. On the compact display profile, opening one card closes the others, so the list of titles stays on screen. **Expand all sections** and **Collapse all sections** in the Quick menu do the whole page at once. Everything here is in Config as well; these cards save you the search.

At the foot of the page, the system strip tells you which app build, device and firmware you are on. Check it before an upgrade, or when something is wrong.

**With no C64 connected**, Home rearranges for you. The search field stays where it is, and so do Radio, Last, Recent and Live, drawn on their own below a card explaining how to connect one. The first three need no machine. Live does, so it is grayed and reads "Needs a connected C64 Ultimate".

The machine's own controls and cards stay on the page as titles with nothing inside them, under a line that says why, and the system strip drops to the app version alone.

Whichever cards you had open are open again the moment your C64 answers. A brief network hiccup will not shuffle the page under you either: the app waits a few seconds before rearranging, and returns the instant your machine is back.

### Play

Play is for building a playlist and running it.

![Play overview](../../img/app/play/profiles/medium/01-overview.png)

Choose **Add items**, which reads **Add more items** once there is something in the list, and then choose a source.

![Add items source chooser](../../img/app/play/import/profiles/medium/01-import-interstitial.png)

The picker stays inside the source you chose, so **Up** never escapes into somewhere else by accident. Tick files or folders and confirm. **Include subfolders** decides whether a ticked folder means that folder alone or everything beneath it, which is the difference between adding twelve files and adding twelve thousand.

> **Tip.** If the only thing you have ticked is a single program, cartridge or disk, the confirm button reads **Play** instead of **Add to playlist**, and the machine starts it there and then. A tune, several files, a whole folder, or a result from the online archive all keep queueing.

![C64U file picker](../../img/app/play/import/profiles/medium/02-c64u-file-picker.png)

Play handles SID and MOD music, PRG programs, CRT cartridges, and disk images. A SID file can hold several separate pieces of music, which this guide calls tunes. Where the length of a tune is known, the app shows it and moves on at the right moment instead of guessing.

![Playlist view all](../../img/app/play/profiles/medium/02-view-all.png)

A playlist can hold a single song, or become the queue for a whole evening.

While it is short, stay on the main Play page. When it grows, open **View all**, which gives you room to scan, filter, select and remove without losing sight of the playback controls. How many rows appear before you need View all is up to you: **Settings → Play and Disk → List preview limit** starts at 50.

> **Tip.** Add broadly, then filter narrowly. Add a whole folder, then type a few characters to narrow it down: the filter matches the title, the path, the source and the kind of file.

Filtering changes only what you can see, never the playlist itself. Clear the box and the full queue comes back.

Every item remembers where it came from. Local files stay local, C64U files point back at the device, archive results remember their source, and SID entries carry their tune and length information with them.

Rows read as titles rather than file names: `Bossa_in_Do_2SID.sid` appears as *Bossa in Do*, with a small badge where a tune uses more than one SID chip. **Settings → Play and Disk → Friendly SID names** puts the file names back if you would rather see them.

The transport controls run the session: play, stop, pause and resume, previous and next, shuffle, repeat, reshuffle, and volume. Beside them sit a **sleep timer**, a **default duration** for anything whose real length is unknown, and a **songlengths file** you can point at by hand if you have one.

Each row has its own menu, holding the item's details and its **playback config**, a device configuration the app can apply before that one item runs. To take items out of the list, tick them and choose **Remove selected items**.

Playback carries on when you leave the app or lock your phone or tablet, and the playlist and your place in it are still there the next time you open it.

Play is the quick way to start a disk and see what it does. Disks is the place to go when the drives, the grouping or the collection itself is what you are after.

### Disks

Disks is where the drives and your disk images live.

![Disks overview](../../img/app/disks/profiles/medium/01-overview.png)

The page has three drive cards: **Drive A**, **Drive B**, and a **Soft IEC Drive** that reads loose files straight from a folder rather than from a disk image. Each card turns its drive on or off, sets its bus ID and type, mounts and ejects, and resets.

Power and the mounted disk stay on the card header, so you can see and change both without opening the card. **Drive A** starts open and the other two start closed. Below them, **Add disks** builds a collection from the sources you have.

![Disk collection view](../../img/app/disks/profiles/medium/02-view-all.png)

Add a single image, a folder of them, or a result from the online archive. Adding a folder also groups what it finds: disks whose names share a prefix, or that share a folder, are put in one group for you, so a multi-disk title usually arrives ready to rotate through.

Filter by name, path or group to find something. Filtering never deletes or moves anything.

Mounting is what the page is for. Choose the disk, choose the drive, mount it; **Eject** empties the drive again. Each disk's own menu also offers **Rename disk**, which changes how the collection lists it and leaves the file itself alone.

Drive settings sit beside the collection. Bus ID, drive type, power, reset and the Soft IEC path all decide how a mounted image behaves, and all matter when a program expects a particular setup.

Come to Disks whenever more than one image is involved. The collection, its filters, the groups and the mounting are all on one page, so nothing sends you away halfway through.

### Config

Config holds every setting your machine has, laid out as one searchable tree.

![Config overview](../../img/app/config/profiles/medium/01-overview.png)

Search for a category, open it, and edit the rows directly. Each item gets the control that suits it: a slider, a select, a checkbox, a text field, or a masked field for a password. Every category the device reports has a card of its own, named after that category, and the app remembers which cards you left open.

A change goes to the device the moment you make it. Most take effect at once; a few, the cartridge choice among them, are stored now and take effect at the next reset.

Turn on **Keep device settings after a restart** in **Settings → Device Safety** to have the app save every device setting it changes, or use **Save** in the Config card to write the current settings to flash once.

The machine's own **Auto save config** does not cover this. It decides whether the machine saves changes you make in its on-screen setup menu, and has no effect on changes made from the app.

On a Commodore 64 Ultimate, set it at **C= + RESTORE → User interface → Auto save config**. C64 Commander mirrors that menu in Config as **User interface → Auto save config**. On other supported devices, search Config for **Auto Save Config** if the menu naming differs.

Config is where you look when you know a setting exists but not where the device menu keeps it. The search box narrows the tree to the pages and groups whose names match; open one to see its rows. After changing a value, let the write finish before changing a related one.

Config edits the live device, not a draft. Use it for a precise or uncommon setting, and use the page controls for everything routine.

### Settings

Settings controls app behavior and saved connection details.

![Settings overview](../../img/app/settings/profiles/medium/01-overview.png)

Settings is a list of chapters rather than one long page of controls. Each heading says in one line what its chapter decides, so you can find the right one without reading the others. **Connection** is open on your first visit; the rest start closed, and whatever you leave open is still open next time.

The chapters are **Appearance**, **Connection**, **Diagnostics**, **Play and Disk**, **Stable Features**, **Experimental Features**, **SID Radio**, **HVSC**, **Online Archive**, **Device Safety**, **Notifications**, and **About**. The two feature chapters show how many of their switches are on, **8/9 on** for example, so you can tell at a glance without opening them. **HVSC** and **Online Archive** disappear if you switch their features off.

If the device is hard to reach, start in **Connection**. If it answers but feels fragile, start in **Device Safety**.

**Connection** also holds your saved devices: their name, host, HTTP, FTP and Telnet ports, and network password. Saving checks that the web service answers before the device is kept; FTP and Telnet are stored as given and are tested by a health check.

**Appearance** is local to the app and never touches your C64. It sets the theme, the style, the text size, the display profile, card descriptions, whether the app runs full screen, and whether it turns with your phone or tablet or stays in portrait or landscape.

**Style** is a set of colors, corner rounding and shading, layered on top of **Theme**, which stays your light-or-dark switch. Pick a style, or choose **Match my device** to follow the Color Scheme your C64 Ultimate is set to.

Match my device reads your machine each time you connect, and leaves the current style in place with a note if it cannot read it yet. Two styles come in one shade only; for those, Theme is disabled and Settings tells you why.

There are seven:

| Style | What it is |
| --- | --- |
| Cool Grey | Neutral, with a cool blue lean. The one the app starts with. |
| Breadbin Beige | The warm beige of the original case. |
| Ocean Teal | Deep blue-green with a warm coral highlight. |
| Neon Pop | Translucent covers by day, arcade cabinet by night. |
| Amber Glow | An amber monitor. Dark only. |
| Vault Black | Near-black with a two-tone band. Dark only. |
| High Contrast | Maximum legibility: heavy edges, strong text, no soft fills. |

**Text size** enlarges every part of the app. Choose **Default**, or **Large**, which is 15 percent larger. Reach for it when the app is harder to read than you would like; the display profile beside it changes the layout rather than the type.

If the tab bar along the bottom runs out of room it scrolls sideways, and reaching a page another way scrolls that tab into view.

**Card descriptions** is the one-line summary under each card's title, on every page built from cards. It starts off; turn it on if you would rather read what a card holds than remember it. On a small screen it costs about half the height of every closed card. The Quick menu switches the same thing on and off without leaving the page you are on.

**Diagnostics** opens the diagnostics panel and switches debug logging on. It also carries **Settings transfer**, which lives here despite the name.

Settings transfer exports your app settings, feature switches and device-safety tuning to a file you can import onto another phone or tablet. Saved devices and passwords are left out, so the file is safe to move about.

**Notifications** decides whether you see every message or only errors, and how long each one stays on screen. **About** shows the version and links to the open source licenses.

Feature switches appear only where a feature is safe for anyone to change.

#### Making settings stick

A setting you change from the app reaches the connected Ultimate-family device at once: the colors, the video mode, the LED lights and the rest all change as you make them.

By default that is as far as it goes. Switch the machine off and on, and it comes back the way it was. Nothing you try from the app is permanent, which makes it a safe place to experiment.

**Keep device settings after a restart**, in **Settings → Device Safety**, changes that. With it on, every device setting the app changes is also written to the machine's own storage, so it survives a power cycle, exactly as though you had saved it from the machine's setup menu.

> **Take care.** Turn this on deliberately. A setting that leaves the machine awkward to use will come back that way every time you switch on.

If that happens, hold **RESTORE** while you switch the connected Ultimate-family device on. It starts with its default settings instead of the saved ones, which is enough to get you back to a working machine. Nothing is erased: your saved values are still there, so you can put the setting right and save it again.

### Docs

Docs is the built-in help page: the short version of this manual, carried on the device itself.

![Docs overview](../../img/app/docs/profiles/medium/01-overview.png)

It covers setup, Home, Play, Disks, Config, Settings, Diagnostics and disk swapping, and ends with links to the official device manuals and reference material.

### Diagnostics

Diagnostics shows the health of the connection, what the app has been doing, and anything that has failed.

![Diagnostics overview](../../img/app/diagnostics/profiles/medium/01-overview.png)

Open it when a control does nothing, playback will not start, a file transfer stalls, or the badge stops looking healthy. Inside are the health check, four kinds of activity (Problems, Actions, Logs and Traces), filters, latency and heat-map views, Share, and Clear.

Start with Problems for a plain-language summary. Filter to errors when something has failed. Use Traces when the timing or the order of requests is what matters. And a health check is the quickest way to see whether the web, FTP and Telnet services are alive.

**Share** packages the evidence. Use it before you restart the app, because the details that explain a failure are usually the last few actions before it.

For a closer look, see [Reading Diagnostics](#reading-diagnostics) and [Sharing a Diagnostics Report](#sharing-a-diagnostics-report) in the In Depth chapter.

### Device Switching

**Switch device** is for homes with more than one saved Ultimate-family device.

![Device switcher](../../img/app/diagnostics/switch-device/profiles/medium/01-picker.png)

Open it from the badge long-press, `#`, or Quick menu. Expand a row for more detail.

See [Switching Between Devices](#switching-between-devices) in the In Depth chapter for the detail.

![Device switcher expanded](../../img/app/diagnostics/switch-device/profiles/medium/02-picker-expanded.png)

## Everyday Flows

Each of these is a short recipe for something you will do often. The numbered steps are the whole job, and the line after them says which route to take when the app offers more than one.

### Connect by Hand

1. Open **Settings → Connection** or use the startup prompt when discovery finds nothing.
2. Enter a hostname or IP address.
3. Choose **Save & Connect** or **Connect**.
4. Enter the network password if prompted.

Preferred path: use startup discovery first, then manual host entry if discovery finds nothing.

### Maintain Saved Devices

1. Open **Settings → Connection**.
2. Review the saved-device list.
3. Give each device a name you will recognize, and check its ports.
4. Use **Save & Connect** after changing the active device.
5. Remove any device that is no longer on your network.

Preferred path: Settings for editing, **Switch device** for choosing.

### Reboot and Carry On

1. Open **Home**.
2. Choose **Power**, then **Reboot**.
3. Confirm.
4. Watch the badge until the device returns healthy.

Preferred path: Home Quick Actions. Use Diagnostics only if the device does not return.

### Play a SID or Program

1. Open **Play**.
2. Choose **Add items**.
3. Choose Local, C64U, HVSC, or CommoServe.
4. Select files or folders.
5. Confirm and press Play.

Preferred path: Play. Use C64U source for files already on the target device; use Local for files on the device running the app.

### Build a Playlist from Folders

1. Open **Play → Add items**.
2. Choose the source that owns the folder.
3. Navigate into the folder.
4. Select the files or folders you want.
5. Confirm the selection.
6. Open **View all** if the list is long.

To search rather than browse, type in the box at the top and choose **Everywhere**. **This folder** narrows what is on screen; **Everywhere** searches the whole source by title or composer, which for HVSC means the whole archive of some sixty thousand files.

Sources that have to be read folder by folder, such as a folder on your device or the card in your C64, offer a **Scan** button instead of searching as you type.

![Searching the whole of HVSC rather than one folder](../../img/app/play/import/profiles/medium/09-hvsc-search-scope.png)

Preferred path: Add a folder first, then filter the playlist to choose what to play next.

### Filter and Clean a Playlist

1. Open **Play → View all**.
2. Type a few characters from the title, the path, the source, or the kind of file.
3. Review the rows that remain.
4. Tick the ones you do not want and choose **Remove selected items**, or clear the filter to bring the whole list back.

Preferred path: filter before removing. A filter changes only what you can see.

### Choose a Tune Inside a SID

1. Add one or more SID files to Play and start one.
2. On the Now Playing card, tap the tune position, **1/19**, to list every tune in the file, with its name and its length.
3. Tap a tune to play it, or use **Play all 19 tunes** to add the whole file to the playlist in order.

Preferred path: choose tunes from the Now Playing card. The playlist rows have no tune chooser.

### Mount a Disk

1. Open **Disks**.
2. Add disks if the collection is empty.
3. Open the drive mount action.
4. Choose a disk.

Preferred path: Disks. Home also shows drive shortcuts, but Disks gives the clearest collection view.

### Build a Disk Collection

1. Open **Disks → Add disks**.
2. Choose Local, C64U, or CommoServe.
3. Select disk images or folders.
4. Confirm the selection.
5. Use **View all** to inspect the collection.

Preferred path: Disks to build a collection; Play to queue things up and start them.

### Filter, Group, and Rotate Disks

1. Open the disk collection view.
2. Filter by name, path, or group.
3. Check the groups the app assigned when you added the folder, and move any stragglers into the right one.
4. Mount the first disk.
5. Use rotation controls when the title asks for the next disk.

Preferred path: group related disks before you need to swap them.

### Mount to a Specific Drive

1. Open **Disks**.
2. Check that the drive you want is switched on.
3. Check its bus ID and type if the program is particular.
4. Choose the disk image.
5. Mount it to the intended drive.

Preferred path: adjust drive setup before mounting.

### Change a Common Setting

1. Try Home's own cards first: CPU & RAM, Video, Audio, Ports, User Interface, Lighting.
2. If the setting is not there, open **Config** and search.
3. Change the value.
4. Use **Save** in the **Config** card if the change should survive a device reboot or power cycle, unless **Keep device settings after a restart** is already on.

Preferred path: Home for common settings; Config for the full tree.

### Save Device Configuration

Use this flow to write the current settings to flash once. A device setting changed from the app is applied straight away but is not saved unless you save it, so without this the machine's next power-up brings back what it had before.

1. Make the changes you need on Home or Config.
2. Confirm the device is healthy.
3. Open the **Config** card on Home.
4. Choose **Save** in the Config card.

Preferred path: turn on **Keep device settings after a restart** in **Settings → Device Safety** and the app saves for you, a moment after your changes settle.

### Investigate a Problem

1. Tap the header badge or press `*`. If the app is offline, that tap also tries the connection again, and asks for the password if the device wants one.
2. Run a health check.
3. Review Problems, Errors, and Traces.
4. Share diagnostics if you need support.

Preferred path: Diagnostics from the badge.

### Export Useful Diagnostics

1. Open **Diagnostics**.
2. Check Problems and Errors.
3. Open Traces if request order matters.
4. Use **Share** before clearing logs.

Preferred path: Share before restart when you are trying to preserve evidence.

## In Depth

A few parts of the app have more to them than a recipe can carry. This chapter covers those in full.

### SID Music

A **SID**, short for **Sound Interface Device**, is the sound chip in every Commodore 64. It has three voices, and the music written for it keeps growing. The same name covers the files that hold that music: each one is a small program that drives the chip. Tens of thousands of them live in one free archive, the **High Voltage SID Collection**, or **HVSC**.

Your C64 will play any of it, and so will your phone or tablet for most tunes. This section covers playing that music yourself. The next one, **SID Radio**, covers letting the app choose it for you.

![The Now Playing card: the tune, what the file says about it, and the transport](../../img/app/play/sid-radio/profiles/medium/01-controls.png)

#### Where the music plays

When a SID tune is playing, the Play page shows an **output button** beside the volume slider, marked with the destination the sound is going to. Press it to choose:

- **Here**: your phone or tablet plays the tune itself. Your C64 need not even be switched on.
- **C64**: your C64 plays it, through its own SID chip.
- **Both**: your C64 plays it and also sends the sound across your network, so you hear it in both places.

**Both** is offered when Live View and its audio are switched on, and it takes itself away again if your C64 declines to send the sound. The sound leaves the machine over its **Ethernet** connection, so a C64 that is only on Wi-Fi cannot supply it.

The output button appears for SID tunes alone. Programs and disks always run on the C64, which is the only machine that can run them.

To play music on its own, your phone or tablet needs a copy of two programs built into every C64: the **KERNAL** and **BASIC** ROMs. Many tunes call into them, and without them those tunes start and then play nothing.

The ROMs are under copyright and cannot be shipped with an app, so C64 Commander reads them from your own machine. It does so by itself, the first time you play a tune here while the C64 is connected. There is nothing for you to set up.

The copies stay on your phone or tablet, and are never uploaded, never shared, and never included in a diagnostics report. Read them only from a machine that is yours, or that you have permission to use.

#### Moving around inside a tune

These apply to tunes playing on your phone or tablet. On the C64 the buttons step from one tune to the next and no further.

- **Press and hold the next or previous button** to wind forwards or backwards, about five seconds at a time, for as long as you hold on. A short tap still skips.
- **Tap the progress bar** anywhere to jump there, or hold and slide along it. The music picks up wherever you let go.
- Jumping *forward* past the part that has already been prepared takes a moment, because the music has to be worked out from that point on. The timer holds at the last note you heard while the bar shows the progress. Jumping back is immediate.

#### The sound itself

**Volume** and **Mute** follow whichever machine is making the sound: playing here, they change this tune alone and leave your ringer and notifications as they were; playing on the C64, they move the machine’s own mixer.

Your phone or tablet will either play a tune itself or play the sound sent from your C64, never both at once. Whichever you start last takes over.

The rest is under **Settings → SID Radio**. **Crossfade** overlaps one tune into the next, both audible while the first fades away: **Off** for a clean cut, or **Short** (0.6s), **Medium** (1.5s), **Long** (3s), or **Longest** (4s). It starts at Off.

Only your phone or tablet can sound two tunes at once, so the control is grayed out while the output is set to the C64.

There are two versions of the SID chip, the **6581** and the **8580**, and music written for one sounds a little different on the other. Most files say which the composer used, and those always play on the chip they name.

For the many older files that say nothing, turn on **Match my Commodore 64** and the app reads the chip out of your own machine. **Otherwise use** picks between 6581 and 8580 until it has read one. A line underneath tells you which is in use.

#### The SID Audio Mixer

A C64 can have more than one SID chip. **Home → Audio** gives you a **master volume**, plus a **volume** and **stereo position** for each SID your machine reports. Pan one SID left and another right for stereo, or turn one down so the other leads. Changes take effect immediately, and the same controls appear in **Config → Audio Mixer**.

### SID Radio

The High Voltage SID Collection holds around sixty thousand files, and more tunes than that, since many files hold several. That is far too many to browse. SID Radio plays it like a radio station: pick a mood, or a tune you already like, and the app keeps finding more music of the same kind.

There is no playlist to build, and nothing is downloaded as you listen. Once the collection is on your device, the app already knows which tunes resemble one another.

![Choosing a station: a mood, your own taste, or anything at all](../../img/app/play/sid-radio/profiles/medium/02-stations.png)

#### Starting a station

Go to the **Play** page, tap **SID Radio**, and pick what you are in the mood for:

- **A mood.** Nine of them: Fast-Paced, Chill / Ambient, Melodic, Experimental, Nostalgic, Composer Deep-Dive, Era Explorer, Deep Cuts, and Game Themes. Each draws on tens of thousands of tunes.
- **From tunes you like.** This becomes available once five tunes carry a heart, and builds a station out of them.
- **Surprise me.** Anything at all.

Switch on **Based on my likes** to tilt any mood toward your own taste. The station keeps the mood's name; what changes is the music it reaches for.

You can also start from whatever is already playing. Tap **More like this** and the station follows that tune. It appears whenever a SID the collection recognizes is playing, including while another station is running.

#### Telling it what you like

While a tune plays, a heart and a cross appear just above its title, at the right-hand edge of the card. Tap the **heart** to add it to your **Liked Tunes** list. Tap the **cross** to skip it: the station moves on immediately and avoids similar tunes. Both are optional; the station plays happily if you only listen.

Your choices stay on your phone or tablet. They are attached to the music itself rather than to a file name, so they survive an update to the collection even if the tune has moved.

**Liked Tunes** is an ordinary playable list: play it, shuffle it, or take a tune off it again. To start over, **Settings → SID Radio → Clear my rankings** removes every heart and cross at once.

#### What a station will and will not do

**It never repeats itself.** No tune twice, and only one tune from any one file for the whole session.

**It skips very short pieces.** The collection includes jingles, sound effects and test tones alongside the music. Anything under fifteen seconds is skipped; change that under **Settings → SID Radio → Shortest tune to play**, or set it to zero to hear everything.

**It can run out.** A station follows a chain of similar tunes, and occasionally it reaches the end of that chain, usually after many skips in one session. The app tells you, and you can pick another mood.

While a station runs it chooses what comes next, so Shuffle, Repeat and Reshuffle step out of the way. They come back, with your settings intact, the moment you stop it.

The line at the top of the Now Playing card says where the music is coming from. Tap it to see why this tune was chosen, or **Stop** beside it to end the station. Each station starts fresh, so the same mood gives you different music every time.

#### Finding one particular tune

To play one specific piece, tap **Find a tune** and type part of a title or a composer's name. The app searches the whole collection rather than one folder, which matters because the archive is filed by composer.

Any part of a word will do, in any case, and accents are ignored: "oorni" finds Lasse Öörni, "mando" finds Commando. Add a second word to narrow the search: "hubbard commando" matches both.

Tap a result and it plays immediately. Your station keeps its place and carries on when the tune ends. To hear more music like the one you found, tap the radio icon beside it, which appears for any tune the collection can start a station from.

With nothing typed, the sheet lists what you have heard recently, which is how you find your way back to something that has already played.

![Finding one tune by name, anywhere in the collection](../../img/app/play/sid-radio/profiles/medium/04-find-a-tune.png)

#### More than one tune per file

Many SID files hold several tunes: a title screen, a high-score jingle, a loading tune, sometimes twenty more. The second line under the title shows which one is playing and how many there are: **1/19**.

Tap **Play all 19 tunes** to add them all to your playlist in order, each with its own length and name. They then behave like any other tracks. The button disappears once you have added them.

To go straight to one tune, tap that **1/19**. It lists every tune in the file with its number, its name where there is one, and its length; tap one to play it. Lengths vary a lot, and a five-minute piece beside a one-second jingle in the same file is normal, so it is worth checking before you choose.

![Every tune in one SID file, with its name and length](../../img/app/play/sid-radio/profiles/medium/07-tunes-in-this-file.png)

#### What the tune is, and who wrote it

The line under the title comes from the SID file itself: the composer, the year and publisher, the chip it asks for, whether it was written for **PAL** or **NTSC**, which tune of the file is playing, and its length. Anything the file does not record is left out rather than guessed at.

Two things a SID file cannot record have been documented separately by the archive's editors. Both sit under **About this tune**, below the line described above. That section appears only for tunes the archive describes, about a third of them.

Tap it to open the pair, and tap it again to fold them away. It starts folded, so that the transport and the progress bar are still on screen on a small display.

The first is whether a tune is an arrangement, and of whose music. Much C64 music is a cover of a pop record, a film score or an arcade original, and the name in the file is whoever wrote the C64 version.

Rob Hubbard's *Commando* is an example. He did write the C64 version, but the music is Tamayo Kawamoto's, from the arcade game. Where the archive records this, **About this tune** shows it: **BGM1 · music by Tamayo Kawamoto**.

The second is what the individual tunes inside a file are called, so a list of nineteen numbered rows becomes a title screen, a high-score jingle and a game-over sting. Any note the editors left about a tune is shown underneath. Short notes appear in full; longer ones are trimmed and marked **Show more**, and tapping the note shows the rest.

Tapping the composer's name opens the search with that name filled in.

#### Stopping later

A station never stops on its own, so set a **Sleep timer** if you are listening at bedtime. It sits under the transport controls on Play: choose **This tune** to stop when the current one finishes, or 15, 30, 45 or 60 minutes. It says what it will do and counts down while it waits; **Off** cancels it.

### Live View

Your C64 can send its own sound and picture out across your network, and Live View brings them straight back into the app, so you can hear a tune or watch the screen without wiring up a speaker or a second television.

It is one shared session. Start it in a single place and it keeps playing wherever you go; there is never a second copy fighting for the same stream.

You will find it just below the Quick Actions on **Home**, as a card that starts closed; tap its header to open it. The card appears only where the machine can stream, so an Ultimate-II cartridge does not offer it. Inside are two switches:

- **Listen** turns the sound on. It asks for almost no room, a lit button and a small live dot, so it suits keeping half an ear on a game or a SID tune while you get on with something else. Wander to another page and a matching dot appears in the top bar to remind you it is still playing; a tap on it stops everything at once.
- **Watch** turns the picture on. A small preview of the C64 screen appears just beneath the switches; tap the chevron beside it to grow that preview in place.

![Live View on Home](../../img/app/home/content-explorer/profiles/medium/01-live-view.png)

While the sound or the picture is playing, a **Reset** appears in the card's header and stops both of them, so the mirror can be turned off without opening the card again.

And if what you started stops reaching the device running the app, because the network drops out or the machine is switched off, Live View says the stream stopped arriving rather than leaving a frozen picture under a switch that still reads as playing.

#### The immersive screen

Open **Remote Input** while **Watch** is on and the picture sits above the joystick and the keyboard, which gives you a screen for playing a game or following a program you are typing into. Enter **Game Mode** and the picture takes the whole sheet.

Move around the picture however suits you. On a touchscreen, **pinch** to zoom, **drag** to slide it about, and **double-tap** to jump straight in on a spot; a second double-tap fits the whole screen back on.

A small map in the corner shows which part you are looking at, and dragging its rectangle moves you elsewhere at once. Switch on **Follow** and the view drifts along on its own to wherever the action is, which keeps the cursor in sight as you type.

Locking the view onto your character keeps it in sight while you play. Press and hold your character on the screen, or, with no touchscreen, line the crosshair at the middle of the view up on it with the direction keys and press **OK**.

The view then travels with that one character while enemies move around it. It holds on through flashing, color changes, animation, fast movement, a wrap around the screen edge, and a moment out of sight.

The status line reads **Hold on your character** until something is locked, then **Locked on**. **Looking…** means it is still searching, and **Lost it** that the character has gone; both are normal. To let go, tap the status line, ask for the whole screen back, or press **OK** again. The view returns to ordinary following.

![The immersive screen in Remote Input](../../img/app/home/remote-input/profiles/medium/06-av-mirror-immersive.png)

#### Driving the C64, or adjusting the view

When you steer your phone or tablet with a physical keypad, those same keys can drive the C64 or move the picture. A colored border round the mirror, with a matching label in the corner, tells you which.

**Blue**, marked **“C64”**, means your keys go straight to the machine. **Amber**, marked **“View”**, means they zoom and pan the picture instead.

Press `*` or the **menu key**, or the on-screen button that reads **Fit** on the way in and **Done** on the way back, to change between the two. You are never stranded in front of a frozen game: adjusting the view returns to driving on its own after a short pause. While the border is amber, the keypad moves the view like this:

| Key | What it does |
| --- | --- |
| **2**, or D-pad up | Pan up |
| **8**, or D-pad down | Pan down |
| **4**, or D-pad left | Pan left |
| **6**, or D-pad right | Pan right |
| **3** or **9** | Zoom in |
| **1** or **7** | Zoom out |
| **0** or **5** | Fit the whole screen back on |
| the **center/OK** key | Lock the view onto what is under the crosshair, or let it go |
| the **menu** key | Return to driving the C64 |

In **Game Mode**, while the border is blue and the keys are driving the C64, `#` brings the quick keys and the **Watch** and **Listen** switches up over the bottom of the picture, and puts them away again, so the picture and the sound can be turned off and on without a touchscreen.

The same four moves have on-screen buttons: **plus** and **minus** to zoom, the **fit-to-screen** button to bring the whole screen back, and **follow** to turn Follow on and off. A touchscreen and a keypad each reach every control. However large you make the game controls, the picture stays in full view above them; the controls never creep up and cover it.

#### Smooth playback, and what it costs

Live View keeps the **sound** running smoothly above everything else. If a packet of audio goes missing on the network it fills the tiny gap so cleanly you will not hear a click, and it never lets the picture run away and leave the sound trailing behind.

The sound plays through a **fast, low-latency path**, so what you hear follows your keypresses closely.

Three switches in **Settings → Play and Disk** control this, and all three start on. **Low-latency audio (native)** is the fast path itself. **Fast video (native assembly)** builds the picture the same way, and is what reaches the full 50 frames a second of a PAL machine.

**Input priority (instant joystick)** gives the joystick and keyboard right of way: while you are driving, the picture gives up a few frames so your input lands at once, then climbs straight back. Turn any of the three off to compare, or if one misbehaves on your device.

One number sits beside them: the **audio network buffer**, 60 milliseconds to begin with. It is how much sound the app holds in hand against a network that delivers in fits and starts. Lower it for the shortest possible delay, raise it if the sound breaks up.

Your C64 sends color *numbers* rather than colors, so something has to decide what shade to paint each one. That choice is **Screen colors**, the first row of the **Video** card on the Home page. It shows the palette in use and all sixteen of its colors; tap it to choose another.

A palette can apply in two places, and **Show on** decides which of them. It is the same question the Play page asks about a tune.

**Local** changes the picture in Live View on your phone or tablet and touches nothing else. **Remote** changes what the connected Ultimate-family device itself draws, so the television in the room changes too. **Both** does each of them.

The list starts with **Follow the C64**, which is where it begins: Live View paints whatever palette the machine is set to, so your phone or tablet and your television match.

Below that are nine bundled palettes, warmer, cooler, monochrome and so on, each with all sixteen of its colors shown before you choose. Any palette already installed on the connected Ultimate-family device is listed too, under **Already on this C64**.

Sending a palette to the machine copies a small file to its storage and changes the picture straight away. Whether it is still there after you switch the machine off is a separate question, answered by **Keep device settings after a restart** in **Settings → Device Safety**. See *Making settings stick*.

The **picture** is the demanding part, and you get a say in how much of it to draw. Open **Stats**, which appears under Live View while it is playing, and choose a **Video frame rate**:

- **Auto** plays every frame it can, eases off when your device is under strain, and climbs back to full speed as soon as there is room to spare. Leave it here.
- **100%**, **50%**, and **25%** cap the picture at the full rate, half, or a quarter of what the C64 is sending. A lower setting is gentler on the battery and on older hardware, and leaves more headroom for the game you are driving. Even at a manual cap the app will still drop below it for a moment if that is what it takes to keep the sound clean, because the sound always comes first.

**Stats** also shows how the stream is doing, at a glance and over the last few minutes: the picture's frame rate, how full the audio buffer is, any packets lost on the network and how they were smoothed over, and the app's own load.

The sound and the picture cross the network as two separate streams, so **More** counts their losses apart: **Dropped pkts** under **Audio**, **Lost pkts** under **Video**. Open or close it as you like: it is light enough that watching it costs the stream nothing. **Export diagnostics** saves all of it as a small file.

#### Checking the sound and picture yourself

Under Live View are three checks you can run whenever something seems off. They come with the app; **A/V sync tests** in Settings → Experimental Features hides them if you would rather not see them.

- **A/V sync** and **Tap latency** answer *when*: how far apart the sound and picture are, and how long it takes a keypress to come back to you.
- **Tone & color ladder** answers *what*. It plays a short tune on your C64, a scale from C3 up to C4 and back at half a second a note, and changes the screen color on every note, stepping through all sixteen C64 colors as it goes. Because the C64 changes the note and the color at the very same instant, anything that arrives out of step arrived that way across your network.

The ladder grades what comes back and shows you five numbers: how many notes were **in tune**, how far off the **pitch** was, whether notes ran **long or short**, whether the two deliberate **silent gaps** really were silent, and how far apart the **sound and picture** were.

Wrong pitches, notes running long, or a gap that is not silent all point the same way: the sound is being damaged on its way to you, which a delay alone would not do. The commonest cause is a second machine on your network streaming into the same place, and this check makes that plain in one run.

Live View needs no setting up. The picture and the sound stay off until you press **Watch** or **Listen**, so nothing crosses the network until you ask for it.

The device sends to two network ports, 11000 for the picture and 11001 for the sound, and **Settings → Play and Disk** changes them if those numbers are already spoken for. Live View borrows the same feeds as **Streams** below, and while it plays it takes charge of them.

**Live View** itself is in Settings → Stable Features, and turning it off hides the whole thing. **Audio Mirror** and **Video Mirror**, in Experimental Features, choose which of the two feeds it offers.

### Streams

Your C64 can send what it is doing out across the network. **Home → Streams** offers three feeds: **VIC**, the picture; **Audio**, the sound of the SID; and **Debug**, a low-level trace for developers. Point a feed at an address, press **Start**, and it goes there; **Stop** ends it. The card appears when the connected device says it can stream.

Live View plays those same **VIC** and **Audio** feeds inside the app, and the two never fight over one stream. Turn Live View on and it takes charge of the feed it needs: that row wears a small **Live View** badge and stops accepting changes, so nothing here can pull the picture or the sound out from under it.

Your own address is remembered throughout, and the moment you stop Live View the row hands control back.

### Remote Input

Remote Input turns your phone or tablet into a second-screen controller for the C64. It is handy when you are sitting across the room from the machine, when no joystick is plugged in, or when you only want to type a command without reaching for the real keyboard.

Open it from either of two places:

- From **Home**, tap **Game** or **Input**, the second and third tiles in Quick Actions. The tiles carry one word each; both open the same second screen, Game Mode set up for playing and Remote Input with everything on show.
- From **Play**, tap **Remote Input** or **Game Mode** while an item is playing. The Play buttons keep the full names; only the Home tiles are shortened.

Each place opens its own copy of the controller, so a key you are holding in one never leaks into the other.

![Remote Input joystick mode](../../img/app/home/remote-input/profiles/medium/01-joystick.png)

At the top of the sheet you choose between two modes, **Joystick** and **Keys**.

**Joystick** puts a stick and a large **FIRE** button on the screen. You can:

- choose how the stick behaves with **Stick**, **D-Pad**, or **Swipe**;
- send the signal to **Port 1** or **Port 2** with the port toggle (most games read Port 2);
- resize the controls from M up to XXL with the **Size** stepper (L by default);
- turn on **Autofire** and set its rate between 1 and 10 presses a second. Few C64 games ask for autofire, so the button is hidden until you turn on **Show Autofire button** in **Settings → Play and Disk**, where the rate also lives. It starts at 5.

A quick-keys bar beside the joystick keeps the keys you reach for mid-game one tap away: RUN/STOP, SPACE, RETURN, the function keys f1 to f8, the cursor keys, and the CTRL, C= and SHIFT modifiers. Nudge a menu or answer a prompt without leaving the joystick.

#### Game Mode

**Game Mode** is the app set up for playing: the picture and the sound as you last left them, everything else out of the way, and whichever controls suit how you are driving.

One action starts it: the **Game** tile on Home, the **Game Mode** button on Play, or the `0` key from anywhere. Starting a program, a cartridge or a disk can open it for you as well, and **Settings → Play and Disk → Enter Game Mode when a game starts** decides whether it does.

![Game Mode](../../img/app/home/remote-input/profiles/medium/02-game-mode.png)

The on-screen joystick stays where it is until you pick up the keys. Play with the touchscreen and it is there; steer the game with a physical key and it steps aside so the picture has the whole screen, and touching it brings it straight back.

Nothing else moves it, and opening Game Mode with the `0` key does not count as playing on the keys. To decide yourself, press **Hide joystick** or **Show joystick** on the Game Mode toolbar for the game you are playing, or set **Settings → Play and Disk → On-screen joystick in Game mode** to **Visible** or **Hidden** instead of **Auto**.

![Game Mode, played on the physical keys](../../img/app/home/remote-input/profiles/medium/07-game-mode-keys.png)

With the controls out of the way, three keys still reach everything. `#` brings RETURN, SPACE, the rest of the quick keys and the **Watch** and **Listen** switches up over the bottom of the picture, and puts them away again. `*`, or the menu key, changes between driving the C64 and adjusting the view. **Back** leaves.

The floating **cog** button at the top of the picture brings the whole toolbar back, and **Show joystick** on that toolbar brings the on-screen joystick back.

Set the joystick to **Hidden** with the picture switched off and Game Mode has nothing to draw, so the space says so: it tells you the picture is off, and carries the **Watch** and **Listen** switches and the quick keys, all reachable without a touchscreen. The game keeps taking your keys the whole time. Turn **Watch** on and the picture takes the space instead.

If you are playing on a television, turn **Watch** off once and Game Mode keeps opening without the picture. The controls take the space instead, so it is never blank.

#### Steering with a physical keyboard

**Settings → Play and Disk → Joystick keys** decides which keys steer. **Classic T9** uses 2, 4, 6 and 8 with 5 as fire, and adds the diagonals on 1, 3, 7 and 9. **Diamond (8-centred)** uses the four keys around 8, with 8 itself as fire. **Custom** lets you press the key you want for each direction.

A hardware D-pad always steers as well, whatever you choose here. The mapping turns with your device, so you only ever set it up one way up. Where the sensor cannot tell which way up the device is, the **Orientation** control in Game Mode's toolbar pins the mapping to **Auto**, **0°**, **90°** or **270°**.

Leave with **Exit**, at the top of the Game Mode toolbar, or your device's Back button. Both release everything you were holding. Closing the sheet also stops the picture and sound if Game Mode was what started them, and leaves them running if they were already on before you arrived.

**Keys** shows a full Commodore 64 keyboard, including the SHIFT, CTRL, and C= modifiers, SHIFT LOCK, the function keys f1 to f8, and RESTORE. Tap a modifier once to arm it for the next key, or hold it down to chord.

![Remote Input keyboard mode](../../img/app/home/remote-input/04-keyboard-medium.png)

Full Joystick relay uses the device's `machine:input` REST endpoint. The app asks your machine for it and takes the answer as it comes: where the endpoint replies, the **Joystick** tab appears; where it does not, the app falls back to **Keys** only. In practice the endpoint arrives with Commodore 64 Ultimate firmware **1.2.0**, and with Ultimate 64, Ultimate 64 Elite and Ultimate 64 Elite II firmware **3.15**.

The Ultimate-II cannot relay a joystick at all: as a cartridge it cannot change the state of the C64's CIA 1 input chip, so it has no `machine:input` support.

That fallback types by placing characters into the C64's KERNAL keyboard buffer. It is ideal for BASIC, where you can type commands, `LOAD`, and `RUN`, but most games read the keyboard and joystick hardware directly and will not respond to it. RUN/STOP and RESTORE are also unavailable in the fallback.

If the device is password-protected, enter its password in Settings first, because both Joystick and Keys need it.

Nothing you are holding is left stuck on the real C64. Everything is released when you close the sheet, switch mode or port, switch to another device, or send the app to the background. If a message does not reach the device, the header shows **Reconnecting…** until the next one gets through.

At any moment you can tap **Release All** to let go of every key and button at once.

_Availability: on by default. Turn it off under **Remote Input** in Settings → Stable Features._

### File Sources

Everything you play or mount comes from a **source**, and each source keeps to its own picker so a wrong turn never lands you somewhere unexpected.

- **Local**: files and folders on the phone or tablet running the app.
- **C64U**: files on the connected Ultimate-family device, reached over FTP.
- **HVSC**: the High Voltage SID Collection, the definitive archive of C64 music. Choose it once from **Add items** and it fetches and indexes itself. A card at the foot of the Play page, closed until you open it, shows how far it has got and lets you start, stop or reset it by hand. After that the app watches for updates on its own, and **Settings → HVSC** holds the mirror it downloads from and how often it looks. Browsing then shows song lengths and the tunes inside each file.
- **CommoServe**: an online archive you search by name, pulling disks and programs straight into a playlist or disk collection. Set its address in **Settings → Online Archive**.

### A Setting Just for One Item

Some titles want the machine arranged a particular way: a cartridge out, a different processor speed, a joystick in the other port. Rather than remember that every time, attach a device configuration file to the playlist item, and the app applies it before that item runs.

Open a playlist row's menu and choose **Review playback config**. If a `.cfg` file sits beside the program, shares its name, or lives in the same folder, the app has already found it and lists it as a candidate with how confident it is. Take one, or attach a file of your own from this device or from your C64.

The status line says where things stand: **No config**, **Candidates found**, **Config resolved**, **Config edited**, or **Config declined**. **Edit values** changes individual settings on top of the file, **Re-discover** looks again after you have moved files about, and **No config** tells the app to stop offering.

### Drives and Disk Images

C64 Commander gives your C64 two disk drives and a Soft IEC drive, and the **Disks** page has a card for each. Every card is a small control panel of its own.

Turn a drive on or off with its power control. A drive must be **on** before it can mount anything.

Give it a **bus ID** so software can find it; the first drive is 8 by convention, and the device tells the app which numbers it will accept.

Set its **type** to match the disk: a 1541 for D64 and G64, a 1571 for D71 (which reads D64 too), a 1581 for D81. This list also comes from the device, so a machine that offers more types shows them.

**Reset** restarts the drive's own processor, which is the gentlest way to bring a confused drive back without disturbing the C64.

You will rarely set any of this by hand. Starting a disk from Play switches the drive on if it is off, and changes its type if the current one cannot read the disk, telling you so as it goes.

Choose a disk from your collection, choose the drive, and mount it; **Eject** empties the drive again.

A disk that already lives on the connected Ultimate-family device mounts in place. A **Local** disk is copied across first, and whatever a program writes to it returns to your own file when you eject, so your high scores and saved games survive.

A disk from the online archive has no file of yours to return to: its changes last only while the app is running, and ejecting it offers you **Save a local copy**.

There are two ways to start a disk once it is mounted, and **Settings → Play and Disk → Disk first-PRG load** chooses between them. **Classic KERNAL load** does what you would do at the keyboard: `LOAD"*",8,1` and `RUN`. **DMA** lifts the first program off the disk and writes it straight into memory, which is much quicker.

A few loaders object to arriving that way, so if a disk that used to start no longer does, try the classic route.

For a title that spans several disks, keep the related images in one **group**. Adding a folder does this for you, from the file names or from the folder itself; move any stragglers by hand. A group puts **rotate** controls on the drive card, so when a program asks for the next disk you swap without going near the collection.

The **Soft IEC** drive is the other way in. Point it at a folder on the device and your C64 reads the loose files inside it directly, which suits a large collection that was never packed into disk images.

### Content Explorer

Content Explorer is this guide's name for four features that reach the programs *inside* a disk image and start them safely. Each has its own switch in Settings, and the line at the end of each section below tells you whether it is on already. Searching inside images builds on Disk Explorer, so that one has to be on too.

#### Looking Inside a Disk

Mounting a disk image gives you the whole disk. Disk Explorer looks *inside* one, so you can pick a single program and start it. On **Disks**, open the menu of a `.d64`, `.d71` or `.d81` image and choose **Open (Disk Explorer)…**.

The app lists every file on the disk with its type, its size in blocks, a padlock if it is write-protected, and, for a program, its load address.

Each launchable file offers three actions:

- **Run** loads the program into the C64's memory and starts it.
- **Load** loads it into memory without starting it, which suits monitors and development.
- **Mount & Load** mounts the whole disk, resets the machine, waits for BASIC, then types the LOAD and RUN for you. It is the right choice for titles that load in several stages.

Only a proper **PRG** program can be launched directly. Other file types show a short note explaining why they cannot, and an unclosed "splat" file, one that was never finished being written, cannot be launched either.

_Availability: on by default. Turn it off under **Disk Explorer** in Settings → Stable Features._

#### Launch Safety

Some machines have a freezer cartridge configured, of the Action Replay or Retro Replay kind. On those, starting a program directly can land you in the cartridge's own menu.

Launch Safety heads that off. Around a direct **Run** or **Load** it *parks* the cartridge, then puts it back. It never writes to the device's saved settings, so a power cycle always restores the cartridge, and where no cartridge is configured it does nothing at all.

**Mount & Load** resets the machine in any case, and is left alone. All of this happens by itself; there is nothing for you to press.

One further option sits in **Settings → Play and Disk**: **Answer cartridge boot menu after reset**. It starts off, and helps in one narrow case: a cartridge that puts up a boot menu when the machine resets, swallowing the LOAD that Mount & Load types.

Turn it on to choose the **menu key** (F1 to F8, RETURN, or SPACE; F7 to start with) and a **boot settle** time in milliseconds, between 1000 and 8000 (2800 to start with). The app then presses that key after the reset to clear the menu. Leave it off unless you have such a cartridge.

_Availability: on by default. Turn it off under **Launch Safety** in Settings → Stable Features._

#### Searching Inside Disk Images

By default, searching your media matches disk images by their file name. Switch **In-image search** on in **Settings → Experimental Features**, and a **Search inside disk images** row appears in **Settings → Play and Disk**. Turn that on and search also reaches the programs *inside* your `.d64`, `.d71`, and `.d81` images.

A match found inside a disk is shown as **DISK → PROGRAM**, so you can see exactly which disk holds the program you want, then Run or Load it like any other.

_Availability: off to begin with. Turn it on under **In-image search** in Settings → Experimental Features._

#### Creating a Blank Disk

To make a fresh disk to save to, open **Disks** and choose **New disk**, which formats a blank image on the device. Pick the **type**: D64 (1541), D71 (1571), D81 (1581), or DNP (CMD native). Give it a **file name**, and a **disk label** of up to 16 characters, which follows the file name unless you change it.

A D64 lets you set the number of **tracks**, 35 to 41, and 35 is the usual answer. A DNP needs a number between 1 and 255. D71 and D81 need none.

Last, type the **storage folder** on the device. It starts at `/USB0`; the top-level `/` lists drives and holds no files. **Create & mount** builds the image, adds it to your collection, and mounts it in Drive A, ready to write to.

_Availability: on by default. Turn it off under **New disk** in Settings → Stable Features._

### RAM Snapshots

A RAM snapshot is a copy of what is in your C64's memory right now, saved onto your phone or tablet so you can put it back later. It is the nearest thing the app has to a save-and-restore button for programs that have none of their own.

Both live in **Home → Quick Actions**: **Backup** to capture, **Restore** to put it back. Do not confuse them with **Save** and **Load** on the Config card, which write your machine's settings rather than its memory.

Your device must be connected and idle. The app pauses the machine while the memory crosses the network and starts it again afterwards, so a running program carries on undisturbed.

When you tap **Backup**, the app asks which region of memory to capture:

- **CPU + RAM snapshot** freezes the running program and stores the whole 64K of memory together with the processor's registers, so it can pick up exactly where it left off. It suits BASIC and unhurried programs; a fast game may not resume cleanly. Not every machine or every program will give up its processor state, and when that happens the app says so and points you at a Program snapshot instead. Once in a while a program stays frozen afterwards, and the app tells you that too. Restore it, or reset the machine.
- **Program Snapshot** stores almost all of memory (everything but the stack). A good all-round choice.
- **Basic Snapshot** stores only the BASIC program and its variables.
- **Screen Snapshot** stores the current screen and its colors.
- **Custom Snapshot** lets you type the exact address ranges you want.

Snapshots live on your phone or tablet, not on the C64. Each is named from its type and the date and time, and if something is playing its title becomes the label. Add or change a **Comment** on any snapshot afterwards. The app keeps a hundred and drops the oldest once that fills.

**Restore** opens your snapshot library. Filter it by name or by type, then tap a snapshot to put it back. The app asks you to confirm, because restoring overwrites the matching memory on the C64.

It writes only the bytes the snapshot holds, and leaves the CIA timers alone so the cursor keeps its usual blink. A CPU + RAM snapshot resumes the program where it stopped; where that proves impossible the app restores the memory alone and tells you. A CPU + RAM snapshot is filed under **Program** in the library.

The same library edits comments and removes snapshots you have finished with.

_Availability: on by default. Turn it off under **RAM snapshots** in Settings → Stable Features._

### The Virtual Printer

Your C64 prints over the serial bus, and the machine provides the printer itself, so there is no separate box to buy or connect. **Home → Printers** turns it on, picks the **emulation** (a Commodore MPS, for example), and sets the **bus ID**, the **output type**, the **ink density** and the character sets. **Reset** clears the printer and starts a fresh page.

One more control, **Flush/Eject**, finishes the current page and sends it on. It goes through the Telnet menu service, so it appears once you turn on **Home printer shortcut actions** in Settings → Experimental Features.

### Configuration and Saving

Two ideas make the configuration tree easy to live with: where a change goes, and how to keep it.

Every change you make, on Home, on Disks, or in Config, reaches the running device at once, and almost all take effect there and then; a few, the cartridge choice among them, wait for the next reset.

The device holds two copies of its settings: the **live** ones it is using now, and a **flash** copy it reloads at power-on. A change is live instantly, and survives a reboot or power cycle only once it reaches flash.

The **Config** card on Home decides which. **Save** writes the live settings into flash now. Reach for it when you have left **Keep device settings after a restart** off and want this one change to last.

Beside it are **Load** from flash, **Reset** to the factory settings, and **Revert**, which undoes the changes you have made since the last save. The app also keeps its own named **configuration snapshots** on the phone or tablet, apart from the device's flash: save the setup you like, then load it back whenever you want the whole thing at once.

### Switching Between Devices

If you have saved more than one device, **Switch device** lets you hop between them without opening Settings.

Open it in any of three ways, whenever more than one device is saved:

- **Long-press the header badge** (a short tap opens Diagnostics instead).
- Press **`#`** on a hardware keyboard or keypad.
- Choose **Switch device** in the Quick menu.

The switcher checks each saved device for you, and looks again every ten seconds while it is open. Each row carries the name, a status pill reading **Selected**, **Verifying**, **Offline** or **Mismatch**, a health badge, and a short line such as how many checks passed or when the device was last seen. The device you are on is highlighted.

Tap the chevron to open a row and read the checks one by one, which tells a sleeping device from one that cannot be reached at all. These rows stay light on the machines they glance at: they check the web and FTP services and read a setting without writing one. For the full round, Telnet included, use **Run health check** in Diagnostics.

Tap a device to switch to it. Before anything else the app safely lets go of any input you were holding on the old device, stops tracking its playback and pause state, retargets to the new device's address and ports, and then checks that the new device answers. While that happens the target shows a **Verifying** pill; once it responds, it becomes the active device.

Saved devices are created and edited in **Settings → Connection**, under **Saved devices**. Add one, edit its **Device name**, **C64U hostname / IP** and its **HTTP**, **FTP** and **Telnet** ports, give it a **Network Password**, or delete one you have finished with.

**Save & Connect** waits for the device to answer before keeping it. With a single device saved there is nothing to switch to, and the switcher stays out of your way.

### Reading Diagnostics

Diagnostics shows the health of the connection and everything the app has recently done. It slides up from the bottom of the screen. Reach it by tapping the header badge, pressing `*`, choosing **Diagnostics** in Settings, or tapping any error notification.

The panel has three parts, from top to bottom:

- The **health header** shows the state (Healthy, Degraded, Unhealthy or Offline), which device it refers to, and when it was last checked. Tap **Run health check** to test the connection now. The check tries the web, FTP and Telnet services, then three signals from the C64 itself: CONFIG, RASTER and JIFFY. Each reports its own result and timing, alongside the overall latency. Open the header to read them one by one.
- The **Filters** bar says how much of the activity you are looking at and opens the filter editor. Filter by device, by kind of activity (Problems, Actions, Logs, Traces), by what raised it (App, REST, FTP, Telnet), or by severity (Errors, Warnings, Info). The editor also holds five one-tap shortcuts: **Errors only**, **Problems only**, **REST**, **FTP**, and **Reset**.
- The **Activity** list gathers problems, actions, logs, and traces together. Tap any row to expand it for the full details.

The CONFIG probe writes as well as reads. It nudges a live setting by a hair, reads it back to confirm the device applied the change, then puts the original value back.

On a machine with lights, the case light or the keyboard, you will see them **pulse once** as the check runs, a visible heartbeat that says the connection is alive. On a machine without lights it nudges a mixer volume instead, for about a twelfth of a second.

The three-dot menu in the corner holds the rest: connection details, health history, latency, the REST, FTP and Config heat maps, config drift, decision state, **Key Explorer**, and a way straight to **Manage devices**, alongside Share and Clear. To send any of it on for help, see the next section.

### Sharing a Diagnostics Report

When something goes wrong, the most useful evidence is usually the last handful of actions before the failure, so capture it before you clear anything or restart the app. The activity list is rebuilt fresh each time you open Diagnostics, and **Clear all** wipes it for good.

To share a report about a recent error:

1. Open **Diagnostics** (tap the header badge, press `*`, or tap the error notification).
2. Tap **Run health check** so the report carries a fresh connection test.
3. Use the **Errors only** or **Problems only** filter to confirm the failure is captured.
4. Open the three-dot menu and choose **Share all** for the full report, or **Share filtered** for a plain list of the rows you filtered to.
5. Pick an app in your device's share sheet (mail, chat, or notes) to send or save the report.

**Share all** produces a small ZIP file holding the app's logs, traces, errors and recent actions, a health snapshot, and details of your app version, your phone or tablet, and the active C64: its name, host address and firmware. Your network password is never in it. Its hostname or IP address can be, so send it only to people you trust, or to support.

Use **Clear all** afterwards for a clean slate. It asks you to confirm, then shows **Diagnostics cleared** when done.

## Safe Device Use

C64 Commander uses normal REST, FTP, and Telnet requests, but the firmware on the connected Ultimate-family device can still become unresponsive under some network conditions. The app reduces risk by pacing traffic and surfacing errors.

Good habits:

- avoid repeating the same command while the device is already busy;
- leave Device Safety on Auto, and only raise concurrency once the device and network have proved steady;
- drop to Conservative for older or unknown firmware, Wi-Fi, or a first setup;
- power-cycle the device if the web, FTP and Telnet services all stop answering while ping still works.

**Device Safety** in Settings decides how hard the app pushes the device. Its five modes trade speed for caution: they cap how many requests run at once, pace them, and set how long the app remembers an answer and how long it waits after a failure.

**Auto** reads the model and the firmware and picks for you, and is the one to leave it on. The full list is in [Device Safety Modes](#device-safety-modes). Choosing **Relaxed** asks you to confirm, and leaves a banner while it is in force.

The same chapter also opens up every individual number behind those modes: discovery windows, timeouts, how many requests may run at once, cooldowns, backoff, and the circuit breaker. Leave them alone unless you are chasing a particular fault.

The CPU speed setting can briefly drop the network while the device applies a clock change. Wait for the app to reconnect.

## Troubleshooting

Find your symptom below. If none of them fits, open Diagnostics: it keeps a record of what the app asked for and what came back, which is usually enough to show where the trouble is.

### Discovery finds nothing

- Confirm both devices are on the same network.
- Check that Web Remote Control Service is enabled.
- Enter the hostname or IP address manually.
- Try the IP address if the hostname does not resolve.

### Password required

Enter the network password configured on the connected Ultimate-family device. If the saved password stops working, the app asks again.

### File browsing fails

- Confirm FTP File Service is enabled.
- Check the FTP port in Settings.
- Reconnect from Settings if the device was restarted.

### Playback does not start

- Check that the device is connected and healthy.
- Confirm the selected file type is supported.
- For local files, reselect the source if Android storage permission was lost.
- For disk images, confirm the target drive is available.

### Controls look disabled

Some controls appear only when the connected device reports support. Others are disabled while an operation is running or when no matching item exists.

### Remote Input joystick is unavailable

The **Joystick** tab appears only when the connected device supports the `machine:input` endpoint. **Keys** is always available.

- Confirm the firmware offers the endpoint: it arrives with 1.2.0 on a Commodore 64 Ultimate and 3.15 on an Ultimate 64. The Ultimate-II has no joystick relay at all.
- If the device is password-protected, enter its password in Settings; both Joystick and Keys need it.
- Otherwise the app stays in **Keys** mode and types through the C64 keyboard buffer, which suits BASIC but not most games.

### Device stops answering

Open Diagnostics if possible and check recent REST/FTP/Telnet activity. If HTTP, FTP, and Telnet all refuse connections while ping still works, manually power-cycle the connected Ultimate-family device.

## Appendices

The rest of this guide is reference material: the numbers, the defaults, and the exact place to look, for when you want the answer without the explanation behind it.

### Feature Reference

Preferred locations are marked first.

| Feature | Where to find it | Notes |
| --- | --- | --- |
| Connect to a device | **Startup discovery**, Settings → Connection | Use startup discovery first. Use Settings for later edits. |
| Manual host/IP entry | **No C64 found** at startup, Settings → Connection | Startup prompt is fastest on first run; Settings is best for saved-device maintenance. |
| Network password | **Startup prompt or auth popup**, Settings → Connection | The app asks only when needed. |
| Switch saved device | **Header badge long-press / `#`**, Settings → Connection | Use **Switch device** for fast switching; Settings for editing. |
| Menu / Pause / Reset | **Home → Quick Actions** | The everyday controls. |
| Reboot | **Home → Quick Actions → Power** | In the Power sheet, with the other heavier controls. |
| Power Off | **Home → Quick Actions → Power** | Shown where the device can do it. Turning it back on needs the machine itself. |
| Power Cycle | **Home → Quick Actions → Power** | Off to begin with. Turn it on under **Home power cycle action** in Settings → Experimental Features. |
| Clear-RAM reboot | **Home → Quick Actions → Power** | Off to begin with. Turn it on under **Home clear-RAM reboot action** in Settings → Experimental Features. |
| Backup / Restore | **Home → Quick Actions** | On by default. Turn it off under **RAM snapshots** in Settings → Stable Features. |
| Game Mode | **Home → Quick Actions**, Play (while an item plays), `0` | In the first band of Quick Actions, labeled **Game**. Opens the controller with the picture and sound as you last left them. |
| Remote Input | **Home → Quick Actions**, Play (while an item plays) | On by default. Turn it off under **Remote Input** in Settings → Stable Features. Joystick appears where the machine offers the `machine:input` endpoint, which arrives with firmware 1.2.0 on a Commodore 64 Ultimate and 3.15 on an Ultimate 64; otherwise only Keys are available. |
| CPU speed and turbo | **Home → CPU & RAM**, Config | Home is preferred for common changes. |
| Video mode and scan lines | **Home → Video**, Config | Home is preferred. |
| Joystick, serial bus, cartridge, user port | **Home → Ports**, Config | Home is preferred. |
| Case and keyboard lights | **Home → Lighting**, Config | Shown for machines that have them. |
| Drive power, bus, type, reset | **Disks**, Home → Drives | Disks for the drives themselves; Home for a quick look. |
| Mount and eject disks | **Disks**, Home → Drives | Disks shows the collection most clearly. |
| Disk groups and rotation | **Disks** | Groups are assigned as you add a folder; rotate from the drive card. |
| Soft IEC folder | **Disks** | Read loose files from a folder on the device, with no disk image at all. |
| Printer controls | **Home → Printers**, Config | Home is preferred. |
| SID mixer | **Home → Audio**, Config → Audio Mixer | Home is preferred for live mixing. |
| Streams | **Home → Streams**, Config | Visible when the device exposes streaming support. |
| Save/load device config | **Home → Config** | Save writes the current settings to flash. Turn on Keep device settings after a restart to do it automatically. |
| App-stored config snapshots | **Home → Config** | Named snapshots kept by the app, apart from the device flash. |
| Disk Explorer (launch a program inside a disk) | **Disks → disk menu → Open (Disk Explorer)** | On by default. Turn it off under **Disk Explorer** in Settings → Stable Features. |
| Create a blank disk | **Disks → New disk** | On by default. Turn it off under **New disk** in Settings → Stable Features. |
| Search inside disk images | **Settings → Play and Disk**, once In-image search is on | Off to begin with. Turn it on under **In-image search** in Settings → Experimental Features. |
| Launch Safety (cartridge parking) | Automatic; boot-menu answer in **Settings → Play and Disk** | On by default. Turn it off under **Launch Safety** in Settings → Stable Features. |
| Live View (hear and see the machine) | **Home → Live View**, Play, Remote Input | On by default. Turn it off under **Live View** in Settings → Stable Features. |
| Live View: Listen | **Home → Live View**; switch in Settings → Experimental Features | On by default. Turn it off under **Audio Mirror** in Settings → Experimental Features. |
| Live View: Watch | **Home → Live View**; switch in Settings → Experimental Features | On by default. Turn it off under **Video Mirror** in Settings → Experimental Features. |
| Live View checks (A/V sync, tap latency, tone ladder) | **Home → Live View** | On by default. Turn it off under **A/V sync tests** in Settings → Experimental Features. |
| Advanced config file actions | **Home → Config** | Off to begin with. Turn it on under **Home advanced config actions** in Settings → Experimental Features. |
| Advanced drive shortcuts | **Home → Drives** | Off to begin with. Turn it on under **Home drive shortcut actions** in Settings → Experimental Features. |
| Advanced printer shortcuts | **Home → Printers** | Off to begin with. Turn it on under **Home printer shortcut actions** in Settings → Experimental Features. |
| Full configuration tree | **Config** | Use search, open a category, edit rows. |
| Add playlist items | **Play → Add items** | Sources: Local, C64U, HVSC, CommoServe. |
| Playback controls | **Play** | Play, stop, pause, previous and next, shuffle, repeat, reshuffle, volume. |
| Sleep timer, default duration, songlengths file | **Play** | Beneath the transport controls. |
| Per-item playback config | **Play → item menu** | Apply a device configuration before one playlist item runs. |
| HVSC preparation | **Play → Add items**, card at the foot of Play | On by default. Turn it off under **HVSC downloads** in Settings → Stable Features. Settings → HVSC holds the mirror and the update check. |
| SID Radio | **Play → SID Radio** | Endless stations of similar tunes. Settings → SID Radio tunes it. |
| CommoServe | **Play → Add items**, Disks → Add disks, Settings → Online Archive | On by default. Turn it off under **CommoServe** in Settings → Stable Features. |
| Demo Mode | **Settings → Connection** | On by default. Turn it off under **Demo Mode** in Settings → Stable Features. When no C64 Ultimate can be reached — because none answers, or because the phone has no network — the app offers the simulated device and waits for you to accept. **Preview Demo Mode**, in the same section, switches to it at any time, including while a real C64 Ultimate is connected, and **Use the simulated device** appears on the connection card behind the connectivity badge whenever the app is offline. The simulated device holds its own music, programs, cartridges and disks, and Live View shows its screen: the BASIC prompt, a load in progress, or the program you started. It cannot run a real C64 program, and says so on that screen; a tune plays on your phone's own SID engine instead. |
| Background playback scheduling | **Play**, Android app permissions | Always on. |
| Display profile, theme, style, text size, card descriptions, orientation | **Settings → Appearance** | Screenshots in this manual use the medium profile. |
| Settings transfer (export and import) | **Settings → Diagnostics** | App settings, feature switches and safety tuning. Saved devices and passwords stay behind. |
| Notification style and duration | **Settings → Notifications** | Show everything, or errors alone. |
| Device Safety | **Settings → Device Safety** | Leave it on Auto. It reads the model and the firmware, then chooses the profile that suits them. See Device Safety Modes. |
| Keep device settings after a restart | **Settings → Device Safety** | Off by default: changes apply at once but a power cycle undoes them. See Making settings stick. |
| Screen colors (palette) | **Home → Video → Screen colors** | Apply to this device, the C64, or both. |
| Diagnostics | **Header badge / `*`**, Settings → Diagnostics | Badge is preferred for fast access. |
| Logs, traces, errors, health checks | **Diagnostics** | Use filters and Share for support. |
| Built-in help | **Docs** | Good for quick reminders inside the app. |

### Keyboard and Directional Input Reference

On by default. Turn it off under **Keyboard and keypad navigation** in Settings → Experimental Features. Directional navigation answers to D-pad keys, arrow keys, and hardware keyboards.

While you are steering by keys, a bar along the bottom shows where you are and what the keys under your thumb will do: Back, Exit, Done or Close on the left; Open, Activate, Edit, Select, Toggle, Adjust or Switch in the middle; Menu on the right where there is one; and, on Home and Play, a reminder that `0` starts Game Mode.

#### Directional Pad

| Key | What it does |
| --- | --- |
| Up / Down | Move through the current page, card, list, or dialog in reading order; the tab bar comes last. |
| Left / Right | Adjust sliders, tabs, and segmented controls. Otherwise move to a nearby control. |
| OK / Center / Enter | Enter a group, open a select, press a button, or toggle a switch. |
| Back / Escape | Close the top dialog, leave a field, leave a group, or go back. |
| Menu / Context Menu | Open the focused item menu; if none exists, open the Quick menu. |

Two keys carry most of it: **OK goes in, Back comes out**. **F2** acts as the Menu soft key, and **F1** and **F3** are the transport keys on every keyboard (below).

#### Number Keys

Outside text fields, number keys jump to pages, and **0** goes straight to playing. An open dialog or sheet keeps the number keys for itself:

| Key | Page |
| --- | --- |
| 1 | Home |
| 2 | Play |
| 3 | Disks |
| 4 | Config |
| 5 | Settings |
| 6 | Docs |
| 7 | Search |
| 0 | Game Mode |

`7` opens search, and keeps working even with directional navigation switched off.

#### Transport Keys

| Key | What it does |
| --- | --- |
| F1 | Play or pause, from any page |
| F3 | Next tune, from any page |

Press either from any page and the app takes you to Play and does it there. **The Commodore key is not bound yet.** To see what your own keys send, open **Diagnostics → Key Explorer** and press one.

#### Star and Pound

| Key | Outside text fields | Inside text fields |
| --- | --- | --- |
| `*` | Open Diagnostics | Type `*` when the field accepts it |
| `#` | Open **Switch device** | Type `#` when the field accepts it |

#### Quick menu

There are two ways in. Press **Menu** when the selected control has no menu of its own, and the Quick menu lists the six pages, each with the number key that reaches it directly, followed by Game Mode on `0`, Diagnostics on `*`, and **Switch device** on `#` when more than one device is saved.

Every page also carries a three-dot **Quick menu** button in the top bar, beside the health badge. Opened that way, the menu leaves out the page jumps and gives you the actions for the page you are on.

**Search** is the first entry, whichever way you open the menu.

On a page built from cards, both ways in also offer **Expand all sections**, **Collapse all sections**, and **Show card descriptions**, which reads **Hide card descriptions** once they are on. Both section entries are always listed, so the one you want is in the same place every time; whichever of the two would do nothing is shown but unavailable.

### File and Source Reference

| Source | Used in | Meaning |
| --- | --- | --- |
| Local | Play, Disks | Files and folders available on the device running the app. |
| C64U | Play, Disks | Files on the connected Ultimate-family device through FTP. |
| HVSC | Play | On by default. Turn it off under **HVSC downloads** in Settings → Stable Features. SID library browsing after preparation. |
| CommoServe | Play, Disks | On by default. Turn it off under **CommoServe** in Settings → Stable Features. Online archive search. |

Supported playback/import types include SID, MOD, PRG, CRT, D64, G64, D71, G71, and D81. Disk collection workflows focus on disk images: D64, G64, D71, G71, and D81.

| Format | Kind | Notes |
| --- | --- | --- |
| SID | Music | One or more tunes; durations shown when songlength data is available. |
| MOD | Music | Amiga-style tracker module. |
| PRG | Program | A single loadable program. |
| CRT | Cartridge | Cartridge image; started as if you inserted a cartridge. |
| D64, G64 | Disk | 1541 single-sided disk image. |
| D71, G71 | Disk | 1571 double-sided disk image. |
| D81 | Disk | 1581 3.5-inch disk image. |

### Network Ports and Services

These are the defaults the app expects. Change them per device in **Settings → Connection** if yours differ.

| Service | Default port | Used for |
| --- | --- | --- |
| Web Remote Control (REST) | 80 | Control, status, and configuration. Required. |
| FTP File Service | 21 | Browsing and transferring files, playlists, and disks. |
| Telnet Remote Menu | 23 | Advanced menu-backed actions, when those are enabled. |

### Device Safety Modes

Set the mode in **Settings → Device Safety**. Higher concurrency is faster but pushes the device harder; the presets also tune caching, cooldowns, and backoff.

| Mode | Requests at once | Use it when |
| --- | --- | --- |
| Auto | Chosen for you | The one to leave it on. Reads the model and firmware and picks Conservative or Balanced. Every Ultimate-II stays on Conservative, and so does a machine whose firmware it cannot yet read. A model it does not recognize at all starts on Balanced. |
| Relaxed | Up to 3 | The device and network have proved fast and steady, and you accept the higher risk. Asks you to confirm. |
| Balanced | Up to 2 | A Commodore 64 Ultimate on firmware later than 1.1.0, or an Ultimate 64-family device on 3.14d or newer. |
| Conservative | 1 at a time | A first setup, Wi-Fi, or firmware you do not yet trust. The safest of the five. |
| Troubleshooting | 1 at a time | You are chasing a fault and want the extra debug logging. |

### Drive Types and Disk Formats

Set a drive's type on the **Disks** page to match the disk you are mounting. The list comes from the connected device, so a machine that offers more types will show them.

| Drive type | Disk images | Description |
| --- | --- | --- |
| 1541 | D64, G64 | Single-sided 5.25-inch drive, and the one most software expects. |
| 1571 | D71, G71, D64 | Double-sided 5.25-inch drive. Reads a 1541 disk as well. |
| 1581 | D81 | High-capacity 3.5-inch drive. |

### Snapshot Types and Memory Ranges

**Backup** offers these capture types. The app keeps up to 100 snapshots on your phone or tablet and drops the oldest once that fills.

| Snapshot | Captures | Memory range |
| --- | --- | --- |
| CPU + RAM | All of memory plus the processor registers, so the program can pick up where it stopped. Filed under Program in the library. Some machines and some programs decline; the app says so and suggests a Program snapshot. | $0000–$FFFF + registers |
| Program | Almost all of memory, skipping the stack. A good all-round choice. | $0000–$00FF, $0200–$FFFF |
| Basic | The BASIC program and its variables. | $002B–$0038, $0801–$9FFF |
| Screen | The current screen and its colors. | VIC bank, $D000–$D02E, $D800–$DBFF, $DD00–$DD01 |
| Custom | Exactly the address ranges you type. | User-defined |

### Health Check Probes

Run a health check from **Diagnostics** to test the connection. Each probe reports its own result and timing.

| Probe | What it checks |
| --- | --- |
| REST | The Web Remote Control service answers. |
| FTP | The FTP file service answers. |
| Telnet | The Telnet menu service answers. |
| CONFIG | Writes a live setting, reads it back, and restores it, proving the device applies changes. A machine with lights pulses them once; one without nudges a mixer volume instead. |
| RASTER | The VIC-II raster line is moving, so the video chip is running. Recorded as skipped where the device does not expose it. |
| JIFFY | The KERNAL jiffy clock is ticking, which also reports the machine's uptime. |

### Status and Safety Reference

| Signal | Meaning | Best next step |
| --- | --- | --- |
| Healthy badge | The selected device is responding. | Continue normally. |
| Degraded badge | Some check or recent activity suggests trouble. | Open Diagnostics. |
| Unhealthy badge | The selected device is not responding correctly. | Run a health check; verify network services. |
| Offline state | No live connection is active. | Use discovery, manual host entry, or Settings → Connection. |
| 401/403 password prompt | The device requires its network password. | Enter the network password set on the device. |
| TCP refused while ping works | The network stack on the device may be stuck. | Stop traffic and power-cycle the device. |
| CPU-speed network drop | Firmware may briefly drop network while applying clock changes. | Wait for reconnect before changing more settings. |
