# General

This script is used to generate M3U format files from Stalker portal streams.

# Disclaimers

## Purpose

This project is intended solely for educational purposes, to demonstrate techniques for web scraping and parsing
publicly available data, and conversion from stalker to M3U protocols.

It is not intended to be used for accessing or distributing copyrighted materials without authorization.

## Usage

This tool does not endorse or condone illegal activities.

The project author is not responsible for how this software is used by others.

Users of this software must comply with all applicable laws, including copyright laws, in their jurisdiction.

## Responsibility

The author of this project assumes no responsibility for any unauthorized use of this tool.

Users are solely responsible for determining the legality of their actions.

## Contributions guidelines

Contributions that promote or enable the unauthorized access to copyrighted materials will not be accepted.

# Supported features

## Media

Supported channels are :

- **TV**
- **VOD**
- **SERIES**

## Prerequisites

In order to use this script, following are needed :

- [NodeJS](https://nodejs.org/en/download)

# Usage

## Script

Run configuration script at first execution only (only to be done once or after every new version) :

- [configure.bat](./configure.bat) (_Windows_)
- [configure](./configure) (_Linux / MacOS_)

The main entrypoint to run the script is from file :

- [stalker-to-m3u.bat](./stalker-to-m3u.bat) (_Windows_)
- [stalker-to-m3u](./stalker-to-m3u) (_Linux / MacOS_)

## Stalker provider

Stalker portal provider info needs to be set into [config.json](./config.json) file.

It is the responsibility of the user to use legal stalker portal sources.

## Commands

### Prompt 1

#### 1 - categories

**Categories listing** outputs all groups per media chosen, to the file `groups.txt`.

Use this file to remove unwanted categories to be excluded from m3u generation.

Only delete undesired lines. Do not manually edit or add entries in the file `groups.txt`.

#### 2 - m3u

**M3U generation** generates and outputs all channels to the file `[m3u|vod]-<stalker-dns>.m3u`.

### Prompt 2

#### 1 - iptv

IPTV are TV channels from stalker portal.

#### 2 - vod

VOD are video-on-demand channels from stalker portal.

#### 3 - series

SERIES are TV shows from stalker portal.

## Options (`config.json`)

Considering following stalker provider :
`http://my.dns.com:8080/stalker_portal/c/` with MAC `00:1F:BD:12:34:56`

| Property                    | Description                                                                                                                                                                                                                                                                                         | Optional | Default                                       |
|-----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|-----------------------------------------------|
| `hostname`                  | DNS as in `my.dns.com`                                                                                                                                                                                                                                                                              |          |                                               |
| `port`                      | Port as in `8080` (use `80` if there is no port in the URL)                                                                                                                                                                                                                                         |          |                                               |
| `contextPath`               | Context path as in `stalker_portal`. Set to `""` or remove property from `config.json` if your portal has no context path (ex. `http://my.dns.com:8080/c/`).                                                                                                                                        | [X]      | `""` (_none_)                                 |
| `mac`                       | Full mac address as in `00:1F:BD:12:34:56`                                                                                                                                                                                                                                                          |          |                                               |
| `deviceId`                  | Device ID                                                                                                                                                                                                                                                                                           | [X]      | Random auto-generated ID of 32 hex characters |
| `tvgIdPreFill`              | Try to assign a EPG tvid from existing mapping in `tvg.json`<br/>(feel free to add your own depending on your EPG provider)                                                                                                                                                                         | [X]      | `false`                                       |
| `computeUrlLink`            | Resolve each channel URL (otherwise set it to STB provider default which is not resolvable).<br/>Set it to `false` for M3U generation to only list channels (for EPG purpose for instance).<br/>Set it to `true` otherwise (most of the use cases).                                                 | [X]      | `false`                                       |
| `vodMaxPagePerGenre`        | Max number of pages per category to fetch the videos from. The more pages per genre are set, the longer the generation will take.                                                                                                                                                                   | [X]      | `2`                                           |
| `vodIncludeRating`          | Include IMDB rating in the title of each VOD (if provided).                                                                                                                                                                                                                                         | [X]      | `true`                                        |
| `vodOrdering`               | Indicate the sorting of each VOD item.<br/> Possible values are `none` (as given by provider), `alphabetic` (by VOD title) or `rating` (by IMDB rating where provided, _alphabetically_ for items with no rating).                                                                                  | [X]      | `alphabetic`                                  |
| `maxNumberOfChannelsToTest` | (Only if `computeUrlLink` is enabled.)<br/>Max number of channels to be picked up randomly among selected groups, and to test if streams are resolvable. If none responds successfully, the generation is aborted. Set `maxNumberOfChannelsToTest` to `0` to disable this test and always generate. | [X]      | `5`                                           |

### Options from command line

Options can also be passed to the script to override a value set from `config.json`, by adding `--<property>=<value>`
for each desired property.

Example : `$> ./stalker-to-m3u --mac="00:1F:BD:12:98:76" --vodMaxPagePerGenre=15`

## Stalker providers analyzer

A tool acting as a web scraper can crawl content to look for all http stalker portals and corresponding MAC addresses.

### Prerequisite

Create and fill the file [tools/sources.txt](./tools/sources.txt) with external sources.

Supported formats are web pages (`http://` or `https://`) or local files (`file:///`) with textual content (useful for
non-public or restricted web pages).

### Script

Run the following script :

- [tools/iptv-analyzer.bat](./tools/iptv-analyzer.bat) (_Windows_)
- [tools/iptv-analyzer](./tools/iptv-analyzer) (_Linux / MacOS_)

### Principles

The script looks for all **http** and **MAC** providers and tests for each the liveness of the IPTV provider, against
_N_ random
groups and _N_ random channels.

The number of groups and channels to fetch against can be configured through config
file [tools/analyzer-config.json](./tools/analyzer-config.json).

| Property         | Description                                                                                                                                                         | Optional | Default |
|------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|---------|
| `cache`          | Whether or not to test again a provider if it is already listed either in `succeeded.json` or `failed.json` upon subsequent relaunching of the script.              | [X]      | `false` |
| `groupsToTest`   | Number of IPTV groups to fetch channels from.<br/>The group(s) are selected randomly among all IPTV genres of the provider.                                         | [X]      | `1`     |
| `channelsToTest` | Number of IPTV channels to check the liveness.<br/>The channel(s) are selected randomly among all channels from the result of selected genres (see `groupsToTest`). | [X]      | `1`     |

A provider is considered live if at least ONE channel stream resolves successfully.

### Outputs

After the execution of the script, the following files are created :

| File                   | Description                                                                                                                                                                                              |
|------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| _tools/succeeded.json_ | A set of all resolving providers with following entries : `hostname`, `port`, `contextPath` and `mac`.<br/>Entries can be put selectively and manually into [config.json](./config.json) for processing. |
| _tools/failed.json_    | A set of all **un**resolving providers with following entries : `url` and `mac`.                                                                                                                         |